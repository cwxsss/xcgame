import { aiPlayedModel, aiRosterInfo } from '@avalon/types';
import { roomChannel, userChannel } from '@/helpers/channels';
import { validID, validName } from '@/security/validation';
import { installSocketAdmission } from '@/security/socket-admission';
import { createRoomVoice, registerVoiceEndpoints } from '@/voice/runtime';
import type { VoiceService } from '@/voice/service';
import { publicRoomState } from '@/ai/public-state';
import { AiService } from '@/ai/service';
import { BotRoom } from '@/ai/room';
import { getBotProfile } from '@/ai/agents';
import { registerChatEndpoints } from '@/room/chat-endpoints';
import { ChatService } from '@/room/chat-service';
import { ChatRepository } from '@/room/chat-repository';
import { registerStickerEndpoints } from '@/stickers/endpoints';
import { StickersManager } from '@/stickers';
import { Room, RoomSeatError } from '@/room';
import { Chat } from '@/room/chat';
import { GameManager } from '@/core/game-manager';
import type {
  Dictionary,
  TRoomInfo,
  TRoomsList,
  GameOptions,
  StartedRoomState,
  TLoyalty,
  TRoles,
  TVoteOption,
} from '@avalon/types';
import type { Server, ServerSocket } from '@avalon/types';
import crypto from 'crypto';

import { handleSocketErrors, eventBus } from '@/helpers';
import { Drain } from '@/helpers/drain';
import { GameResultWorker } from '@/scripts/game-results';
import { DBManager } from '@/db';
import { installSessionChecks } from '@/user/sessions';
import { AvatarsManager } from '@/user/avatars';
import {
  WAITING_ROOM_SNAPSHOT_VERSION,
  type StartedRoomSnapshot,
  type WaitingRoomSnapshot,
} from '@/db/waiting-room-snapshot';

const roomRetentionMs = 30 * 60000;
const startedRoomSnapshotRetentionMs = 24 * 60 * 60000;
const roomCleanupRetryMs = 60000;
const finishedLobbyLimit = 50;
const firstSnapshotRetryMs = 2000;

function derivedRoomID(kind: 'created' | 'next', ...parts: string[]): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${kind}-${digest.slice(0, 32)}`;
}

function lobbyOrder(rooms: TRoomsList): TRoomsList {
  const active: TRoomsList = [];
  const finished: TRoomsList = [];
  for (const room of rooms) {
    (room.result || room.aiStatus === 'finished' ? finished : active).push(room);
  }
  active.sort((a, b) => Number(b.state === 'created') - Number(a.state === 'created') ||
    Date.parse(b.createAt) - Date.parse(a.createAt));
  finished.sort((a, b) => Date.parse(b.startAt || b.createAt) - Date.parse(a.startAt || a.createAt));
  return [...active, ...finished.slice(0, finishedLobbyLimit)];
}

export class Manager {
  voice: VoiceService;
  aiService: AiService;
  stickersManager = new StickersManager();
  avatarsManager: AvatarsManager;
  chatService: ChatService;
  rooms: Dictionary<Room> = Object.create(null);
  roomsList: TRoomsList = [];
  private removedLobbyRooms = new Set<string>();
  private roomAdminSessions = new WeakMap<ServerSocket, number>();
  private roomTimers = new Map<string, NodeJS.Timeout>();
  private roomSnapshotWrites = new Map<string, Promise<void>>();
  private roomSnapshotRetry = new Map<string, { failures: number; timer?: NodeJS.Timeout }>();
  private stopping = false;
  private readonly socketDrain = new Drain();
  private stopResultRetry?: () => void;
  private flushArchivesOnShutdown?: () => Promise<void>;
  // Track when a live table becomes empty so disconnected test rooms expire.
  private emptyRoomSince = new Map<string, number>();
  // Do not expire rooms that were only created by the server (or restored in a
  // test) and never had a connected player.  A room becomes eligible for the
  // empty-table retention policy after the first successful room join.
  private roomHasSeenOnline = new Set<string>();
  /** Resolves after durable room snapshots have been loaded into memory. */
  readonly initialized: Promise<void>;
  private startupComplete = false;
  io: Server;
  dbManager: DBManager;
  onlineCounter: Dictionary<number> = Object.create(null);

  isLobbyRoomRemoved(uuid: string): boolean {
    return this.removedLobbyRooms.has(uuid);
  }

  async saveBeforeShutdown(): Promise<void> {
    this.stopping = true;
    for (const retry of this.roomSnapshotRetry.values()) clearTimeout(retry.timer);
    this.roomSnapshotRetry.clear();
    await this.socketDrain.close();
    await this.initialized;
    this.stopResultRetry?.();
    for (const timer of this.roomTimers.values()) clearTimeout(timer);
    this.roomTimers.clear();
    for (const room of Object.values(this.rooms)) {
      if (room.ai) continue;
      room.stopBuiltinBots();
      if (room.data.stage === 'started') room.data.manager.game.timer.suspend();
      void this.queueRoomSnapshot(room.roomID);
    }
    const persisted = await Promise.allSettled([
      ...this.roomSnapshotWrites.values(),
      this.flushArchivesOnShutdown?.(),
    ]);
    // A durable game result can enqueue its snapshot removal while the archive queue drains.
    const cleanup = await Promise.allSettled(this.roomSnapshotWrites.values());
    if ([...persisted, ...cleanup].some((result) => result.status === 'rejected'))
      throw Error('Room save failed during shutdown');
  }

  get roomListCutted() {
    return lobbyOrder(this.roomsList);
  }

  createRoom(
    uuid: string,
    leaderID: string,
    players: string[],
    options?: GameOptions,
    seating?: Pick<Room, 'seats' | 'roomBots'>,
  ) {
    const retained = Object.values(this.rooms);
    if (
      retained.length >= 500 ||
      retained.filter(
        (room) =>
          room.leaderID === leaderID &&
          !room.nextRoomID &&
          (room.data.stage !== 'started' || room.data.manager.game.stage !== 'end'),
      ).length >= 3
    )
      throw Error('roomLimit');
    const room = new Room(uuid, leaderID, players, this.io, options, seating?.seats);
    if (seating) room.roomBots = structuredClone(seating.roomBots);
    this.rooms[uuid] = room;
    this.bindRoomPersistence(room);

    this.updateRoomsList(room);
    this.queueRoomSnapshot(uuid);
    this.scheduleRoomExpiry(uuid, roomRetentionMs);
  }

  private async existingRoom(roomID: string): Promise<boolean> {
    if (this.removedLobbyRooms.has(roomID)) return false;
    if (this.rooms[roomID]) return true;
    const saved = await Promise.all([
      this.dbManager.getRoomFromDB(roomID),
      this.dbManager.getWaitingRoomSnapshot(roomID),
      this.dbManager.getStartedRoomSnapshot(roomID),
    ]);
    return !this.removedLobbyRooms.has(roomID) && (Boolean(this.rooms[roomID]) || saved.some(Boolean));
  }

  private async resolveRematch(oldRoomID: string, knownNextID?: string): Promise<string | undefined> {
    const nextID = knownNextID ?? derivedRoomID('next', oldRoomID);
    // Looking at a finished game should work even if the optional link cannot be loaded.
    const exists = await this.existingRoom(nextID).catch(() => false);
    return exists ? nextID : undefined;
  }

  private async archivedRoomState(room: StartedRoomState): Promise<StartedRoomState> {
    const [chat, nextRoomID] = await Promise.all([
      this.chatService.history(room.roomID, room.chat),
      room.ai ? undefined : this.resolveRematch(room.roomID),
    ]);
    return publicRoomState({ ...room, chat, archived: true, nextRoomID });
  }

  private scheduleRoomExpiry(uuid: string, initialDelay: number) {
    clearTimeout(this.roomTimers.get(uuid));
    const expire = () => {
      const room = this.rooms[uuid];
      if (!room) return;
      if (room.data.stage === 'started' && room.data.manager.game.stage !== 'end') {
        if (this.roomHasSeenOnline.has(uuid) && (this.onlineCounter[uuid] || 0) === 0) {
          const emptySince = this.emptyRoomSince.get(uuid) ?? Date.now();
          this.emptyRoomSince.set(uuid, emptySince);
          const emptyFor = Date.now() - emptySince;
          if (emptyFor >= roomRetentionMs) {
            this.destroyRoom(uuid);
            return;
          }
          const timer = setTimeout(expire, Math.min(5 * 60000, roomRetentionMs - emptyFor));
          timer.unref();
          this.roomTimers.set(uuid, timer);
          return;
        }
        this.emptyRoomSince.delete(uuid);
        const timer = setTimeout(expire, 5 * 60000);
        timer.unref();
        this.roomTimers.set(uuid, timer);
      } else {
        this.destroyRoom(uuid);
      }
    };
    const timer = setTimeout(expire, Math.max(0, initialDelay));
    timer.unref();
    this.roomTimers.set(uuid, timer);
  }

  private queueRoomPersistence(uuid: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.roomSnapshotWrites.get(uuid) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.roomSnapshotWrites.set(uuid, current);
    void current.catch(() => console.error(`Room snapshot persistence failed: ${uuid}`)).finally(() => {
      if (this.roomSnapshotWrites.get(uuid) === current) this.roomSnapshotWrites.delete(uuid);
    });
    return current;
  }

  private bindRoomPersistence(room: Room) {
    room.onChatMessage = () => {
      void this.queueRoomSnapshot(room.roomID);
    };
  }

  private queueRoomSnapshot(uuid: string): Promise<void> {
    const previous = this.roomSnapshotRetry.get(uuid);
    clearTimeout(previous?.timer);
    const retry: { failures: number; timer?: NodeJS.Timeout } = { failures: previous?.failures ?? 0 };
    this.roomSnapshotRetry.set(uuid, retry);
    const save = this.queueRoomPersistence(uuid, async () => {
      if (this.removedLobbyRooms.has(uuid)) {
        await this.dbManager.deleteWaitingRoomSnapshot(uuid);
        return;
      }
      const room = this.rooms[uuid];
      if (!room || room.ai) {
        await this.dbManager.deleteWaitingRoomSnapshot(uuid);
        return;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + roomRetentionMs);
      if (room.data.stage === 'created' || room.data.stage === 'locked') {
        const snapshot: WaitingRoomSnapshot = {
          snapshotVersion: WAITING_ROOM_SNAPSHOT_VERSION,
          kind: 'waiting',
          roomID: room.roomID,
          stage: room.data.stage,
          leaderID: room.leaderID,
          players: [...room.players],
          seats: room.getSeatAssignments(),
          options: structuredClone(room.options),
          roomBots: structuredClone(room.roomBots),
          chat: structuredClone(room.chat.history),
          createAt: room.createAt,
          updatedAt: now,
          expiresAt: new Date(Math.min(expiresAt.getTime(), Date.parse(room.createAt) + roomRetentionMs)),
        };
        await this.dbManager.saveWaitingRoomSnapshot(snapshot);
        return;
      }

      if (room.data.manager.game.stage === 'end') {
        // Keep the last active checkpoint until GameResultWorker confirms the
        // terminal archive.  A crash between gameEnded and the DB write must
        // remain recoverable rather than becoming a lost game.
        return;
      }
      const gameRecovery = room.data.manager.recoverySnapshot();
      if (!gameRecovery) {
        await this.dbManager.deleteWaitingRoomSnapshot(uuid);
        return;
      }
      const snapshot: StartedRoomSnapshot = {
        snapshotVersion: WAITING_ROOM_SNAPSHOT_VERSION,
        kind: 'started',
        roomID: room.roomID,
        stage: 'started',
        leaderID: room.leaderID,
        players: [...room.players],
        seats: room.getSeatAssignments(),
        options: structuredClone(room.options),
        roomBots: structuredClone(room.roomBots),
        chat: structuredClone(room.chat.history),
        createAt: room.createAt,
        startAt: room.startAt || new Date().toISOString(),
        gameRecovery,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + startedRoomSnapshotRetentionMs),
      };
      await this.dbManager.saveStartedRoomSnapshot(snapshot);
    });
    void save.then(
      () => {
        if (this.roomSnapshotRetry.get(uuid) === retry) this.roomSnapshotRetry.delete(uuid);
      },
      () => {
        if (this.roomSnapshotRetry.get(uuid) !== retry) return;
        if (this.stopping || !this.rooms[uuid] || this.removedLobbyRooms.has(uuid)) {
          this.roomSnapshotRetry.delete(uuid);
          return;
        }
        const delay = Math.min(30000, firstSnapshotRetryMs * 2 ** retry.failures);
        retry.failures += 1;
        retry.timer = setTimeout(() => void this.queueRoomSnapshot(uuid), delay);
        retry.timer.unref();
      },
    );
    return save;
  }

  private restoreWaitingRoom(snapshot: WaitingRoomSnapshot): Room | undefined {
    if (this.removedLobbyRooms.has(snapshot.roomID) || this.rooms[snapshot.roomID]) return this.rooms[snapshot.roomID];
    const age = Date.now() - Date.parse(snapshot.createAt);
    const remaining = roomRetentionMs - age;
    if (remaining <= 0) {
      void this.dbManager.deleteWaitingRoomSnapshot(snapshot.roomID);
      return undefined;
    }
    const room = new Room(snapshot.roomID, snapshot.leaderID, [...snapshot.players], this.io, structuredClone(snapshot.options));
    this.bindRoomPersistence(room);
    room.createAt = snapshot.createAt;
    room.data = { stage: snapshot.stage };
    room.roomBots = structuredClone(snapshot.roomBots);
    room.restoreSeatAssignments(snapshot.seats);
    room.chat = new Chat();
    snapshot.chat.forEach((entry) => room.chat.append(structuredClone(entry)));
    this.rooms[snapshot.roomID] = room;
    this.updateRoomsList(room);
    this.scheduleRoomExpiry(snapshot.roomID, remaining);
    return room;
  }

  private restoreStartedRoom(snapshot: StartedRoomSnapshot): Room | undefined {
    if (this.removedLobbyRooms.has(snapshot.roomID) || this.rooms[snapshot.roomID]) return this.rooms[snapshot.roomID];
    try {
      const room = new Room(snapshot.roomID, snapshot.leaderID, [...snapshot.players], this.io, structuredClone(snapshot.options));
      this.bindRoomPersistence(room);
      room.createAt = snapshot.createAt;
      room.roomBots = structuredClone(snapshot.roomBots);
      room.restoreSeatAssignments(snapshot.seats);
      room.chat = new Chat();
      snapshot.chat.forEach((entry) => room.chat.append(structuredClone(entry)));
      const manager = GameManager.restore(this.io, snapshot.roomID, snapshot.gameRecovery);
      room.attachRecoveredManager(manager, snapshot.startAt);
      this.rooms[snapshot.roomID] = room;
      this.roomHasSeenOnline.add(snapshot.roomID);
      this.emptyRoomSince.set(snapshot.roomID, Date.now());
      manager.onRecoveryChanged = () => {
        void this.queueRoomSnapshot(snapshot.roomID);
      };
      this.updateRoomsList(room);
      this.scheduleRoomExpiry(snapshot.roomID, roomRetentionMs);
      room.scheduleBuiltinBots();
      return room;
    } catch (error) {
      console.error(`Could not restore room ${snapshot.roomID}`, error);
      return undefined;
    }
  }

  updateRoomsList(roomOrID: Room | string, removeRoom: boolean = false) {
    const room = typeof roomOrID === 'string' ? this.rooms[roomOrID] : roomOrID;

    if (!room || this.removedLobbyRooms.has(room.roomID)) {
      return;
    }

    if (room.ai && !removeRoom) {
      if (room.ai.status === 'finished' || room.ai.status === 'stopped') {
        if (!this.roomTimers.has(room.roomID)) this.scheduleAiRoomExpiry(room, roomRetentionMs);
      } else {
        clearTimeout(this.roomTimers.get(room.roomID));
        this.roomTimers.delete(room.roomID);
      }
    }

    if (removeRoom || room.ai?.status === 'stopped') {
      this.roomsList = this.roomsList.filter((el) => el.uuid !== room.roomID);
    } else {
      const roomData: TRoomInfo = {
        ai: Boolean(room.ai),
        builtinBotCount: room.roomBots?.length || undefined,
        aiStatus: room.ai?.status,
        aiModel: aiPlayedModel(room.ai),
        aiTitle: room.ai?.title,
        ...aiRosterInfo(room.ai, room.players.length),
        aiBeginner: room.ai?.beginner,
        aiBotDifficulty: room.ai?.botDifficulty,
        aiLanguage: room.ai ? (room.ai.language ?? 'en') : undefined,
        hostID: room.leaderID,
        state: room.data.stage,
        options: room.options,
        startAt: room.startAt,
        createAt: room.createAt,
        uuid: room.roomID,
        players: room.players.length,
      };

      if (room.data.stage === 'started') {
        roomData.result = room.data.manager.game.result;
      }

      const roomIndex = this.roomsList.findIndex((el) => el.uuid === room.roomID);

      if (roomIndex !== -1) {
        this.roomsList[roomIndex] = roomData;
      } else {
        this.roomsList.unshift(roomData);
      }
    }

    this.roomsList = this.roomListCutted;
    this.io.to('lobby').emit('roomsListUpdated', this.roomsList);
  }

  generateRoomsListFromDB(rooms: StartedRoomState[]) {
    const roomsInfo = rooms.map<TRoomInfo>((room) => {
      return {
        ai: Boolean(room.ai),
        builtinBotCount: room.roomBots?.length || undefined,
        aiStatus: room.ai?.status,
        aiModel: aiPlayedModel(room.ai),
        aiTitle: room.ai?.title,
        ...aiRosterInfo(room.ai, room.players.length),
        aiBeginner: room.ai?.beginner,
        aiBotDifficulty: room.ai?.botDifficulty,
        aiLanguage: room.ai ? (room.ai.language ?? 'en') : undefined,
        hostID: room.leaderID,
        state: 'started',
        options: room.options,
        startAt: room.startAt,
        createAt: room.createAt,
        uuid: room.roomID,
        players: room.players.length,
        result: room.game.result,
      };
    });

    // Existing live entries take precedence if a room was created during startup loading.
    this.roomsList = [...new Map([...roomsInfo, ...this.roomsList].map((room) => [room.uuid, room])).values()]
      .filter((room) => !this.removedLobbyRooms.has(room.uuid) && room.aiStatus !== 'stopped' && this.rooms[room.uuid]?.ai?.status !== 'stopped');
    this.roomsList = this.roomListCutted;
    this.io.to('lobby').emit('roomsListUpdated', this.roomListCutted);
  }

  restartRoom(uuid: string) {
    const room = this.rooms[uuid];

    if (room == null) {
      throw new Error(`Cant find game for restart with uuid ${uuid}`);
    }

    if (room.ai) throw new Error('Create a new AI room with AI controls');

    if (room.data.stage === 'started') {
      if (room.nextRoomID) return;

      if (room.data.manager.game.stage === 'end') {
        const newUUID = derivedRoomID('next', uuid);
        if (this.removedLobbyRooms.has(newUUID)) throw Error('forbidden');
        if (!this.rooms[newUUID]) {
          this.createRoom(newUUID, room.leaderID, [...room.players], structuredClone(room.options), {
            seats: room.getSeatAssignments(),
            roomBots: room.roomBots,
          });
        }
        room.nextRoomID = newUUID;
        this.voice.destroyRoom(uuid);

        this.io.to(roomChannel(room.roomID)).emit('restartGame', newUUID, room.roomID);
      } else {
        throw new Error(`Cant restart game with uuid ${uuid}, room stage ${room.data.manager.game.stage}`);
      }
    } else {
      throw new Error(`Cant restart game with uuid ${uuid}, room stage ${room.data.stage}`);
    }
  }

  private scheduleAiRoomExpiry(room: Room, delay: number) {
    const id = room.roomID;
    const expire = async () => {
      if (this.roomTimers.get(id) !== timer) return;
      const status = room.ai?.status;
      if (this.rooms[id] !== room || (status !== 'finished' && status !== 'stopped')) {
        this.roomTimers.delete(id);
        return;
      }

      if (room.data.stage === 'started') {
        try {
          const archive = this.aiService.archiveRepository;
          if (!archive) throw Error('AI archive unavailable');
          const saved = await archive.hasTerminalReplay(id, status);
          if (this.roomTimers.get(id) !== timer || this.rooms[id] !== room) return;
          // The final checkpoint may have failed even if an earlier replay was saved.
          if (!saved) await archive.save(room.calculateRoomState());
        } catch {
          if (this.roomTimers.get(id) === timer) this.scheduleAiRoomExpiry(room, roomCleanupRetryMs);
          return;
        }
      }

      if (this.roomTimers.get(id) === timer && this.rooms[id] === room) this.releaseRoom(id);
    };
    const timer = setTimeout(() => void expire(), delay);
    timer.unref();
    this.roomTimers.set(id, timer);
  }

  destroyRoom(uuid: string) {
    if (this.rooms[uuid]?.ai) return;
    this.releaseRoom(uuid);
  }

  private releaseRoom(uuid: string) {
    clearTimeout(this.roomSnapshotRetry.get(uuid)?.timer);
    this.roomSnapshotRetry.delete(uuid);
    clearTimeout(this.roomTimers.get(uuid));
    this.roomTimers.delete(uuid);
    this.emptyRoomSince.delete(uuid);
    this.roomHasSeenOnline.delete(uuid);
    const room = this.rooms[uuid];
    room?.stopBuiltinBots?.();
    if (room?.data.stage === 'started') {
      room.data.manager.game.stateObserver.gameStateChanged = () => {};
      room.data.manager.game.timer.cleanup();
    }
    this.voice.destroyRoom(uuid);
    // Releasing a completed room must not remove its saved game from the lobby.
    const completed = room?.data.stage === 'started' && room.data.manager.game.stage === 'end';
    if (!completed) this.updateRoomsList(uuid, true);
    delete this.rooms[uuid];
    if (!completed || this.removedLobbyRooms.has(uuid))
      void this.queueRoomPersistence(uuid, () => this.dbManager.deleteWaitingRoomSnapshot(uuid));
    this.io.to(roomChannel(uuid)).emit('destroyRoom', uuid);
  }

  async saveRoomToDB(room: Room) {
    const state = room.calculateRoomState();

    if (state.stage === 'started') {
      await this.dbManager.saveRoomToDB(state);
    }
  }

  constructor(io: Server, dbManager: DBManager) {
    this.io = io;
    this.dbManager = dbManager;
    this.voice = createRoomVoice(this);
    this.avatarsManager = new AvatarsManager(dbManager);
    this.aiService = new AiService(this);
    const chatDB = dbManager.dbInstance?.connection.db;
    this.chatService = new ChatService(
      chatDB ? new ChatRepository(chatDB) : undefined,
      (id) => this.rooms[id],
      async (id) => (await this.dbManager.getRoomFromDB(id)) || (await this.aiService.archiveRepository?.load(id)),
      io,
    );

    this.startupComplete = !dbManager.dbInstance;
    this.initialized = Promise.allSettled([
      this.dbManager.getLastRooms(finishedLobbyLimit),
      this.aiService.archiveRepository?.recent(finishedLobbyLimit) || Promise.resolve([]),
      this.dbManager.getWaitingRoomSnapshots(500),
      this.dbManager.getStartedRoomSnapshots(500),
    ]).then(async (results) => {
      try {
        if (this.dbManager.dbInstance?.connection.db) {
          for (const id of await this.dbManager.getRemovedLobbyRooms()) this.removedLobbyRooms.add(id);
        }
      } catch {
        console.error('Could not load removed lobby rooms');
        this.startupComplete = true;
        return;
      }
      const waiting = results[2].status === 'fulfilled' ? results[2].value : [];
      const started = results[3].status === 'fulfilled' ? results[3].value : [];
      const archives = [
        ...(results[0].status === 'fulfilled' ? results[0].value : []),
        ...(results[1].status === 'fulfilled' ? results[1].value : []),
      ];
      const archivedIDs = new Set(archives.map((room) => room.roomID));
      waiting.forEach((snapshot) => this.restoreWaitingRoom(snapshot));
      started.forEach((snapshot) => {
        if (archivedIDs.has(snapshot.roomID)) void this.dbManager.deleteWaitingRoomSnapshot(snapshot.roomID);
        else this.restoreStartedRoom(snapshot);
      });
      this.generateRoomsListFromDB(archives);
      if (results.some((result) => result.status === 'rejected'))
        console.error('Could not load part of the saved rooms list');
      this.startupComplete = true;
    });

    eventBus.on('roomUpdated', (room) => {
      this.updateRoomsList(room);
      const roomID = typeof room === 'string' ? room : room.roomID;
      const live = this.rooms[roomID];
      if (live?.data.stage === 'started' && !live.ai && !live.data.manager.onRecoveryChanged) {
        live.data.manager.onRecoveryChanged = () => {
          void this.queueRoomSnapshot(roomID);
        };
      }
      void this.queueRoomSnapshot(roomID);
      this.io.to(roomChannel(roomID)).emit('voiceStateChanged', roomID);
      void this.voice.reconcile(roomID);
    });

    if (dbManager.dbInstance) {
      const results = new GameResultWorker(dbManager, async (game) => {
        this.stickersManager.invalidateGameCounts(game.players.map((player) => player.id));
        game.players.forEach((player) => this.io.to(userChannel(player.id)).emit('stickersUpdated'));
      });
      this.flushArchivesOnShutdown = () => results.flushArchives();
      const retry = () => {
        void results.flush().catch(() => console.error('Game result processing failed; will retry'));
      };
      const timer = setInterval(retry, 5000);
      timer.unref();
      this.stopResultRetry = () => clearInterval(timer);
      retry();
      eventBus.on('gameEnded', (roomID) => {
        const room = this.rooms[roomID];
        if (!room || room.ai) return;
        const state = room.calculateRoomState();
        if (state.stage === 'started')
          void results
            .submit(state)
            .then(() => this.queueRoomPersistence(roomID, () => this.dbManager.deleteWaitingRoomSnapshot(roomID)))
            .catch(() => console.error('Game result save failed; will retry'));
      });
    }

    eventBus.on('gameEnded', (roomID) => {
      const room = this.rooms[roomID];
      if (!room || room.ai) return;
      // Give players a full conversation window after the game, regardless of its duration.
      clearTimeout(this.roomTimers.get(roomID));
      const timer = setTimeout(() => this.destroyRoom(roomID), roomRetentionMs);
      timer.unref();
      this.roomTimers.set(roomID, timer);
    });

    eventBus.on('restartRoom', (room) => {
      this.restartRoom(room.roomID);
    });

    eventBus.on('destroyRoom', (room) => {
      this.destroyRoom(room.roomID);
    });

    installSocketAdmission(io);
    installSessionChecks(io);
    io.on('connection', (socket) => {
      // Register endpoints
      handleSocketErrors(socket, this.socketDrain);
      this.updateOnlineCounter('lobby', 1);

      const userState: {
        userID: string | undefined;
      } = {
        userID: undefined,
      };

      if (socket.data.authUser) {
        const tokenValue = socket.data.authUser;
        userState.userID = tokenValue.id;
      }

      if (userState.userID) {
        socket.join(userChannel(userState.userID));
      }

      this.aiService.register(socket, userState.userID);
      registerVoiceEndpoints(this.voice, socket, userState.userID);

      socket.on('joinRoom', async (uuid, cb) => {
        if (!this.startupComplete) await this.initialized;
        if (!validID(uuid)) throw Error('invalidRequest');
        let room: Room | undefined = this.rooms[uuid];
        const gameFromDB = room
          ? null
          : (await this.dbManager.getRoomFromDB(uuid)) || (await this.aiService.archiveRepository?.load(uuid));

        if (!room && !gameFromDB) {
          const snapshot = await this.dbManager.getWaitingRoomSnapshot(uuid);
          if (snapshot) room = this.restoreWaitingRoom(snapshot);
          if (!room) {
            const startedSnapshot = await this.dbManager.getStartedRoomSnapshot(uuid);
            if (startedSnapshot) room = this.restoreStartedRoom(startedSnapshot);
          }
        }

        if (room || gameFromDB) {
          if (!socket.rooms.has(roomChannel(uuid))) {
            if ([...socket.rooms].filter((id) => id.startsWith('room:')).length >= 20) throw Error('roomLimit');
            await socket.join(roomChannel(uuid));
            this.updateOnlineCounter(uuid, 1);
            if (room) this.roomHasSeenOnline.add(uuid);
          }
        }

        if (gameFromDB) {
          cb(await this.archivedRoomState(gameFromDB));
          return;
        }

        if (room) {
          await this.chatService.history(uuid, room.chat.history);
          const current = this.rooms[uuid];
          if (current) {
            const state = current.calculateRoomState(userState.userID);
            if (state.nextRoomID) state.nextRoomID = await this.resolveRematch(uuid, state.nextRoomID);
            cb(publicRoomState(state));
          } else {
            // A post-game room may expire while its durable history is loading.
            const archived =
              (await this.dbManager.getRoomFromDB(uuid)) || (await this.aiService.archiveRepository?.load(uuid));
            if (archived) cb(await this.archivedRoomState(archived));
            else cb({ error: 'errorNotFound' });
          }
        } else {
          cb({ error: 'errorNotFound' });
        }
      });

      socket.on('leaveRoom', (uuid) => {
        this.voice.revokeSocket(socket.id, uuid);
        if (socket.rooms.has(roomChannel(uuid))) {
          socket.leave(roomChannel(uuid));
          this.updateOnlineCounter(uuid, -1);
        }
      });

      socket.on('getRoomsList', async (cb) => {
        if (!this.startupComplete) await this.initialized;
        socket.join('lobby');
        cb(this.roomListCutted);
      });

      socket.on('getOnlineCounter', (id, cb) => {
        cb(this.onlineCounter[id] || 0);
      });

      socket.on('createGuest', async (name, cb) => {
        if (userState.userID) throw Error('forbidden');
        cb(await dbManager.createGuest(name));
      });

      socket.on('getUserProfile', async (id, cb) => {
        const publicUser = getBotProfile(id) || (await dbManager.getPublicUserProfile(id));

        cb(publicUser);
      });

      if (userState.userID) {
        this.createMethodsForRoom(socket, userState.userID);
        this.createMethodsForGame(socket, userState.userID);
      }

      socket.on('disconnecting', () => {
        Array.from(socket.rooms).forEach((room) => {
          if (room.startsWith('room:')) this.updateOnlineCounter(room.slice(5), -1);
        });

        this.updateOnlineCounter('lobby', -1);
      });
    });

    setInterval(() => {
      const currentTime = new Date();

      this.roomsList = this.roomsList.filter((el) => {
        const createAt = new Date(el.createAt);
        const minutes = 60 * 1000;

        if (!el.startAt) {
          return (Number(currentTime) - Number(createAt)) / minutes < 30;
        } else {
          const startAt = new Date(el.startAt);

          return (Number(currentTime) - Number(startAt)) / minutes < 600 || el.result?.winner;
        }
      });
    }, 60000 * 30);
  }

  createMethodsForRoom(socket: ServerSocket, userID: string): void {
    const hasRoomAdmin = () => (this.roomAdminSessions.get(socket) ?? 0) > Date.now();
    socket.on('getRoomAdminStatus', (cb) => cb(hasRoomAdmin()));
    socket.on('lockRoomAdmin', (cb) => {
      this.roomAdminSessions.delete(socket);
      cb(true);
    });
    socket.on('unlockRoomAdmin', (password, cb) => {
      const expected = process.env.XCGAME_ROOM_ADMIN_PASSWORD;
      const hash = (value: string) => crypto.createHash('sha256').update(value).digest();
      const matches = Boolean(expected && crypto.timingSafeEqual(hash(expected), hash(password)));
      if (matches) this.roomAdminSessions.set(socket, Date.now() + 8 * 60 * 60 * 1000);
      cb(matches);
    });
    socket.on('deleteLobbyRoom', async (uuid, cb) => {
      if (!hasRoomAdmin()) return cb({ error: 'forbidden' });
      try {
        const snapshot = !this.rooms[uuid]
          ? (await this.dbManager.getWaitingRoomSnapshot(uuid)) || (await this.dbManager.getStartedRoomSnapshot(uuid))
          : null;
        if (
          !this.rooms[uuid] &&
          !this.roomsList.some((room) => room.uuid === uuid) &&
          !(await this.aiService.archiveRepository?.load(uuid)) &&
          !snapshot
        ) return cb(false);
        await this.dbManager.markLobbyRoomRemoved(uuid);
        this.removedLobbyRooms.add(uuid);
        const room = this.rooms[uuid];
        if (room instanceof BotRoom && room.ai?.status !== 'finished') room.stop();
        if (room) this.releaseRoom(uuid);
        this.roomsList = this.roomsList.filter((room) => room.uuid !== uuid);
        this.io.to('lobby').emit('roomsListUpdated', this.roomListCutted);
        cb(true);
      } catch {
        cb({ error: 'requestFailed' });
      }
    });

    socket.on('getMyProfile', async (cb) => {
      cb(await this.dbManager.getUserProfile(userID));
    });

    const publishIdentity = (fields: { name?: string; avatar?: string }) => {
      const roomChannels = Object.values(this.rooms)
        .filter((room) => room.players.includes(userID))
        .map((room) => roomChannel(room.roomID));
      this.io.to([userChannel(userID), ...roomChannels]).emit('publicProfileChanged', userID, fields);
    };

    socket.on('updateUserName', async (name, cb) => {
      if (!validName(name) || name.trim().length > 24) throw Error('invalidRequest');
      await this.dbManager.updateUserName(userID, name);
      publishIdentity({ name: name.trim() });
      cb?.(true);
    });

    // Keep the in-room avatar picker available for nickname-only guests.
    socket.on('getUserAvatars', async (cb) => {
      cb(await this.avatarsManager.getAvailableAvatarsForUser(userID));
    });
    socket.on('updateUserAvatar', async (avatarID, cb) => {
      const result = await this.avatarsManager.updateUserAvatar(userID, avatarID);
      if (result === true) publishIdentity({ avatar: avatarID });
      cb(result);
    });

    socket.on('createRoom', async (cb) => {
      if (!this.startupComplete) await this.initialized;
      const uuid = crypto.randomUUID();
      this.createRoom(uuid, userID, [userID]);
      cb(uuid);
    });

    socket.on('createRoomOnce', async (requestID, cb) => {
      if (!this.startupComplete) await this.initialized;
      const roomID = derivedRoomID('created', userID, requestID.toLowerCase());
      const exists = await this.existingRoom(roomID);
      if (!exists && !this.rooms[roomID]) {
        if (this.removedLobbyRooms.has(roomID)) return cb({ error: 'errorNotFound' });
        this.createRoom(roomID, userID, [userID]);
      }
      cb(roomID);
    });

    socket.on('restartGame', (uuid) => {
      if (this.rooms[uuid]?.leaderID !== userID) throw Error('forbidden');
      this.restartRoom(uuid);
    });

    registerStickerEndpoints(socket, userID, this.stickersManager, this.chatService);

    registerChatEndpoints(socket, userID, this.chatService);

    const changeSeat = (
      uuid: string,
      apply: (room: Room) => void,
      callback?: (result: true | { error: string }) => void,
    ) => {
      const room = this.rooms[uuid];
      if (!room) {
        callback?.({ error: 'roomUnavailable' });
        return;
      }
      try {
        apply(room);
        if (this.rooms[uuid] === room) eventBus.emit('roomUpdated', room);
      } catch (error) {
        if (!(error instanceof RoomSeatError) || !callback) throw error;
        callback({ error: error.code });
        return;
      }
      callback?.(true);
    };

    socket.on('joinGame', (uuid, callback) => changeSeat(uuid, (room) => room.joinGame(userID), callback));
    socket.on('leaveGame', (uuid, callback) => changeSeat(uuid, (room) => room.leaveGame(userID), callback));
    socket.on('seatGame', (uuid, seatIndex, callback) => {
      changeSeat(
        uuid,
        (room) => {
          if (room.ai) throw new RoomSeatError('roomUnavailable', 'This room uses separate bot seating');
          room.seatGame(userID, seatIndex);
        },
        callback,
      );
    });

    socket.on('lockRoom', (uuid) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID) {
        room.toggleLockedState();
        eventBus.emit('roomUpdated', room);
      }
    });

    socket.on('updateOptions', (uuid, options) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID) {
        room.updateOptions(options);
        eventBus.emit('roomUpdated', room);
      }
    });

    socket.on('setRoomBots', (uuid, bots, callback) => {
      const room = this.rooms[uuid];
      if (!room || room.ai || room.leaderID !== userID) {
        callback({ error: 'forbidden' });
        return;
      }
      try {
        room.setRoomBots(bots);
        eventBus.emit('roomUpdated', room);
        callback(true);
      } catch (error) {
        callback({ error: error instanceof Error ? error.message : 'invalidBots' });
      }
    });

    socket.on('endGame', (uuid) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID) {
        room.startVoteFor('endGame');
        eventBus.emit('roomUpdated', room);
      }
    });

    socket.on('endAndRestartGame', (uuid) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID) {
        room.startVoteFor('endAndRestartGame');
        eventBus.emit('roomUpdated', room);
      }
    });

    socket.on('shuffle', (uuid) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID) {
        room.shuffle();
        eventBus.emit('roomUpdated', room);
      }
    });

    socket.on('voteInRoom', (uuid, result) => {
      const room = this.rooms[uuid];
      if (room) {
        room.makeVote(userID, result);
        eventBus.emit('roomUpdated', room);
      }
    });

    socket.on('startGame', (uuid, customRules) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID && room.data.stage === 'locked') {
        const options = customRules
          ? { ...room.options, features: { ...room.options.features, customRules } }
          : room.options;
        room.startGame(undefined, options);
        eventBus.emit('roomUpdated', room);
      }
    });

    socket.on('transferHost', (uuid, nextHostID) => {
      if (typeof uuid !== 'string' || typeof nextHostID !== 'string') return;
      const room = this.rooms[uuid];
      if (
        !room ||
        room.ai ||
        room.nextRoomID ||
        room.leaderID !== userID ||
        nextHostID === userID ||
        !room.players.includes(nextHostID)
      )
        return;

      room.leaderID = nextHostID;
      room.updateRoomState(true);
      eventBus.emit('roomUpdated', room);
    });

    socket.on('kickPlayer', (uuid, kickUserID) => {
      const room = this.rooms[uuid];
      const canKickGuest =
        room instanceof BotRoom &&
        room.ai?.publicBotGame &&
        room.ai.withFriend &&
        room.ai.status === 'ready' &&
        room.data.stage === 'locked' &&
        kickUserID !== room.leaderID &&
        room.isHuman(kickUserID);
      if (room && (!room.ai || canKickGuest) && room.leaderID === userID) {
        room.leaveGame(kickUserID);

        if (this.rooms[uuid]) {
          eventBus.emit('roomUpdated', room);
        }
      }
    });

    // Custom timer events
    socket.on('setCustomTimerDuration', (uuid: string, durationSeconds: number) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID && room.data.stage === 'started') {
        room.data.manager.callGameMethods(userID, { method: 'setCustomTimerDuration', durationSeconds });
      }
    });

    socket.on('setCustomTimerPlayer', (uuid: string, playerID: string | null) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID && room.data.stage === 'started') {
        room.data.manager.callGameMethods(userID, { method: 'setCustomTimerPlayer', playerID });
      }
    });

    socket.on('nextCustomTimerPlayer', (uuid: string) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID && room.data.stage === 'started') {
        room.data.manager.callGameMethods(userID, { method: 'nextCustomTimerPlayer' });
      }
    });

    socket.on('startCustomTimer', (uuid: string, durationSeconds?: number) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID && room.data.stage === 'started') {
        room.data.manager.callGameMethods(userID, { method: 'startCustomTimer', durationSeconds });
      }
    });

    socket.on('addCustomTimerTime', (uuid: string, additionalSeconds: number) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID && room.data.stage === 'started') {
        room.data.manager.callGameMethods(userID, { method: 'addCustomTimerTime', additionalSeconds });
      }
    });

    socket.on('stopCustomTimer', (uuid: string) => {
      const room = this.rooms[uuid];
      if (room && !room.ai && room.leaderID === userID && room.data.stage === 'started') {
        room.data.manager.callGameMethods(userID, { method: 'stopCustomTimer' });
      }
    });
  }

  createMethodsForGame(socket: ServerSocket, userID: string): void {
    const getRoomManager = (uuid: string) => {
      const room = this.rooms[uuid];
      if (room?.ai) {
        if (!(room instanceof BotRoom) || !room.isHuman(userID) || room.data.stage !== 'started')
          throw new Error('AI players are controlled by the server');
        const manager = room.data.manager;
        return {
          callGameMethods: (id: string, params: Parameters<typeof manager.callGameMethods>[1]) =>
            room.humanAction(id, params),
          getGameData: manager.getGameData.bind(manager),
        };
      }
      if (room?.data.stage === 'started' && room.players.includes(userID)) {
        return room.data.manager;
      }

      throw new Error(`Room with uuid ${uuid} have wrong stage ${this.rooms[uuid]?.data.stage}`);
    };

    socket.on('selectPlayer', (uuid, selectedUserID) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'selectPlayer', playerID: selectedUserID });
    });

    socket.on('sentSelectedPlayers', (uuid) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'sentSelectedPlayers' });
    });

    socket.on('voteForMission', (uuid, option) => {
      console.log(`Player ${userID} vote for mission (${option}) in game ${uuid}`);
      getRoomManager(uuid).callGameMethods(userID, { method: 'voteForMission', option });
    });

    socket.on('actionOnMission', (uuid, result) => {
      console.log(`Player ${userID} action in mission (${result}) in game ${uuid}`);
      getRoomManager(uuid).callGameMethods(userID, { method: 'actionOnMission', result });
    });

    socket.on('assassinate', (uuid, type, role) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'assassinate', type, customRole: role });
    });

    socket.on('checkLoyalty', (uuid: string) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'checkLoyalty' });
    });

    socket.on('checkLoyaltyWithCard', (uuid: string, cardID: string) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'checkLoyalty', cardID });
    });

    socket.on('revealLoyalty', (uuid: string) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'revealLoyalty' });
    });

    socket.on('revealLoyaltyWithCard', (uuid: string, cardID: string) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'revealLoyalty', cardID });
    });

    socket.on('announceLoyalty', (uuid: string, loyalty: TLoyalty | TRoles) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'announceLoyalty', loyalty });
    });

    socket.on('announceLoyaltyWithCard', (uuid: string, loyalty: TLoyalty | TRoles, cardID: string) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'announceLoyalty', loyalty, cardID });
    });

    socket.on('getLoyalty', (uuid: string, cb: (loyalty: TLoyalty | TRoles) => void) => {
      cb(getRoomManager(uuid).getGameData(userID, { method: 'getLoyalty' }));
    });

    socket.on('getLoyaltyWithCard', (uuid: string, cardID: string, cb: (loyalty: TLoyalty | TRoles) => void) => {
      cb(getRoomManager(uuid).getGameData(userID, { method: 'getLoyalty', cardID }));
    });

    socket.on('giveExcalibur', (uuid) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'giveExcalibur' });
    });

    socket.on('discardMissionCard', (uuid) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'discardMissionCard' });
    });

    socket.on('useExcalibur', (uuid) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'useExcalibur' });
    });

    socket.on('useWitchAbility', (uuid, result) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'witchAbility', result });
    });

    socket.on('givePlotCard', (uuid) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'givePlotCard' });
    });

    socket.on('preVote', (uuid: string, option: TVoteOption, cardID: string) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'preVote', option, cardID });
    });

    socket.on('useLeadToVictory', (uuid: string, use: boolean, cardID: string) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'useLeadToVictory', use, cardID });
    });

    socket.on('useAmbush', (uuid: string, cardID: string) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'useAmbush', cardID });
    });

    socket.on('useRestoreHonor', (uuid, restoreHonorCardID, cardID) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'useRestoreHonor', cardID, restoreHonorCardID });
    });

    socket.on('useKingReturns', (uuid: string, use: boolean, cardID: string) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'useKingReturns', use, cardID });
    });

    socket.on('useWeFoundYou', (uuid: string, use: boolean, cardID: string) => {
      getRoomManager(uuid).callGameMethods(userID, { method: 'useWeFoundYou', use, cardID });
    });
  }

  updateOnlineCounter(id: string, diff: -1 | 1): void {
    if (diff === -1 && !this.onlineCounter[id]) {
      return;
    }

    this.onlineCounter[id] = this.onlineCounter[id] || 0;
    this.onlineCounter[id] += diff;
    if (this.onlineCounter[id] === 0) {
      delete this.onlineCounter[id];
      if (diff === -1 && this.roomHasSeenOnline.has(id)) this.emptyRoomSince.set(id, Date.now());
    }
    const emitName = id === 'lobby' ? 'onlineCounterUpdated' : 'roomOnlineUpdated';
    this.io.to(id === 'lobby' ? 'lobby' : roomChannel(id)).emit(emitName, this.onlineCounter[id] || 0);
  }
}
