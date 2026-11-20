import { roomChannel, userChannel } from '@/helpers/channels';
import { publicRoomState } from '@/ai/public-state';
import type { TRoomState, Server, GameOptions, TVoteTarget, VoteInRoom, TRoles, RoomBot } from '@avalon/types';
import { playModeRules } from '@avalon/types/game/play-mode';
import type { TRoomData } from '@/room/interface';
import { eventBus } from '@/helpers';
import { GameManager } from '@/core/game-manager';
import { Chat } from '@/room/chat';
import * as _ from 'lodash';
import { BuiltinBotRunner, validateBuiltinBotOptions, type RoomBotConfig } from '@/room/builtin-bots';
import { validateRoleOptions } from '@/core/game/helpers';

export class RoomSeatError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export class Room {
  onChatMessage?: (entry: import('@avalon/types').ChatMessage) => void;
  persistChatMessage?: (userID: string, text: string, requestID?: string) => Promise<unknown>;
  ai?: import('@avalon/types').AiRoomState;
  roomID: string;
  nextRoomID?: string;
  players: string[];
  /** Physical seats in clockwise table order. Null means the seat is vacant. */
  seats: Array<string | null>;
  leaderID: string;
  vote?: VoteInRoom;
  chat: Chat;
  options: GameOptions;
  data: TRoomData = { stage: 'created' };
  maxCapacity = 10;
  /** Built-in, local AI seats configured in the waiting room. */
  roomBots: RoomBotConfig[] = [];
  private botRunner?: BuiltinBotRunner;
  createAt: string;
  startAt?: string;
  io: Server;

  constructor(
    roomID: string,
    leaderID: string,
    players: string[],
    io: Server,
    options?: GameOptions,
    seats?: Array<string | null>,
  ) {
    this.io = io;
    this.roomID = roomID;
    this.players = players;
    this.leaderID = leaderID;
    this.chat = new Chat();
    this.options = options || {
      addons: {},
      roles: {},
      features: {
        wtfMode: false,
        customRules: playModeRules('custom'),
      },
    };
    this.createAt = String(new Date());
    this.seats = this.buildSeats(seats);
  }

  private buildSeats(assignments?: Array<string | null>): Array<string | null> {
    const seats = Array<string | null>(this.maxCapacity).fill(null);
    const known = new Set<string>();
    const source = assignments?.length === this.maxCapacity ? assignments : this.players.map((id) => id);
    for (const [index, id] of source.entries()) {
      if (index >= this.maxCapacity || id === null || typeof id !== 'string' || !this.players.includes(id) || known.has(id))
        continue;
      seats[index] = id;
      known.add(id);
    }
    for (const id of this.players) {
      if (known.has(id)) continue;
      const index = seats.findIndex((seat) => seat === null);
      if (index === -1) break;
      seats[index] = id;
      known.add(id);
    }
    return seats;
  }

  /** Repair state loaded from an older snapshot before an operation uses it. */
  private ensureSeats() {
    const rebuilt = this.buildSeats(this.seats);
    const changed = rebuilt.some((id, index) => id !== this.seats[index]);
    if (changed || rebuilt.length !== this.seats.length) this.seats = rebuilt;
    this.players = this.seats.filter((id): id is string => id !== null);
  }

  /** Copy the physical seating map for durable waiting-room snapshots. */
  getSeatAssignments(): Array<string | null> {
    this.ensureSeats();
    return [...this.seats];
  }

  /** Restore an optional seating map from a compatible waiting-room snapshot. */
  restoreSeatAssignments(assignments?: Array<string | null>) {
    if (!assignments) return;
    this.seats = this.buildSeats(assignments);
    this.players = this.seats.filter((id): id is string => id !== null);
  }

  joinGame(userID: string) {
    if (this.data.stage !== 'created') {
      throw this.data.stage === 'locked'
        ? new RoomSeatError('seatLocked', 'The room is locked')
        : new RoomSeatError('seatStarted', 'Seats cannot be changed after the game starts');
    }

    this.ensureSeats();
    if (!this.players.find((id) => id === userID)) {
      const seatIndex = this.seats.findIndex((seat) => seat === null);
      if (seatIndex === -1) throw new RoomSeatError('seatFull', 'The room is full');
      this.seats[seatIndex] = userID;
      this.players = this.seats.filter((id): id is string => id !== null);
      this.updateRoomState();
    }
  }

  /**
   * Atomically claim or move a human to a physical waiting-room seat. A seat
   * occupied by another player (including a configured local bot) is never
   * overwritten; the first accepted socket event wins.
   */
  seatGame(userID: string, seatIndex: number) {
    if (this.data.stage !== 'created' && this.data.stage !== 'locked') {
      throw new RoomSeatError('seatStarted', 'Seats cannot be changed after the game starts');
    }
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= this.maxCapacity) {
      throw new Error('Invalid seat');
    }
    this.ensureSeats();
    if (this.roomBots.some((bot) => bot.id === userID)) throw new Error('AI seats cannot be moved');
    const currentIndex = this.seats.indexOf(userID);
    if (this.data.stage === 'locked' && currentIndex === -1)
      throw new RoomSeatError('seatLocked', 'The room is locked');
    const target = this.seats[seatIndex];
    if (target !== null && target !== userID) throw new RoomSeatError('seatOccupied', 'Seat is occupied');
    if (currentIndex === seatIndex) return;
    if (currentIndex !== -1) this.seats[currentIndex] = null;
    this.seats[seatIndex] = userID;
    this.players = this.seats.filter((id): id is string => id !== null);
    this.updateRoomState(true);
  }

  leaveGame(userID: string) {
    if (this.data.stage === 'started') {
      throw new RoomSeatError('seatStarted', 'Seats cannot be changed after the game starts');
    }

    this.ensureSeats();
    const seatIndex = this.seats.indexOf(userID);

    if (seatIndex !== -1) this.seats[seatIndex] = null;
    this.players = this.seats.filter((id): id is string => id !== null);

    if (userID === this.leaderID) {
      if (this.players.length === 0) {
        this.destroyRoom();
        return;
      } else {
        const nextHuman = this.players.find((id) => !this.roomBots.some((bot) => bot.id === id));
        // A local bot must never become the room administrator. If the last
        // human leaves a bot-filled waiting room, close it instead of leaving
        // an unmanageable table behind.
        if (!nextHuman) {
          this.destroyRoom();
          return;
        }
        this.leaderID = nextHuman;
      }
    }

    this.updateRoomState();
  }

  addMessage(userID: string, message: string, requestID?: string) {
    const previous = this.chat.history[this.chat.history.length - 1];
    const entry = this.chat.addMessage(message, userID, requestID);
    if (entry !== previous && entry === this.chat.history[this.chat.history.length - 1]) {
      this.io.to(roomChannel(this.roomID)).emit('newMessage', {
        id: entry.id,
        roomID: this.roomID,
        text: entry.message,
        author: userID,
      });
      this.updateRoomState(true);
    }
    return entry;
  }

  toggleLockedState() {
    if (this.data.stage === 'created') {
      this.data = { stage: 'locked' };
    } else if (this.data.stage === 'locked') {
      this.data = { stage: 'created' };
    }

    this.updateRoomState();
  }

  updateRoomState(direct: boolean = false, chatOnly = false) {
    if (direct) {
      this.players.forEach((playerID) => {
        this.io
          .to(userChannel(playerID))
          .emit('roomUpdated', publicRoomState(this.calculateRoomState(playerID)), chatOnly);
      });

      this.io
        .except(this.players.map(userChannel))
        .to(roomChannel(this.roomID))
        .emit('roomUpdated', publicRoomState(this.calculateRoomState()), chatOnly);
    } else {
      this.io.to(roomChannel(this.roomID)).emit('roomUpdated', publicRoomState(this.calculateRoomState()), chatOnly);
    }
  }

  startGame(
    selectedRole?: { userID: string; role: import('@avalon/types').TRoles } | Array<{ userID: string; role: TRoles }>,
    options: GameOptions = this.options,
  ) {
    if (!this.ai) this.ensureSeats();
    if (this.roomBots.length) validateBuiltinBotOptions(options);
    const selectedBots = this.roomBots
      .filter((bot): bot is RoomBotConfig & { role: TRoles } => Boolean(bot.role))
      .map((bot) => ({ userID: bot.id, role: bot.role }));
    const requestedRoles = Array.isArray(selectedRole)
      ? [...selectedRole, ...selectedBots]
      : selectedRole
        ? [selectedRole, ...selectedBots]
        : selectedBots;
    const manager = new GameManager(
      this.players,
      options,
      this.io,
      this.roomID,
      requestedRoles.length ? requestedRoles : undefined,
      Boolean(this.ai),
    );
    this.options = options;
    this.startAt = String(new Date());
    this.data = {
      stage: 'started',
      startAt: this.startAt,
      manager,
    };
    this.attachRecoveredManager(manager, this.startAt);
    this.updateRoomState(true);
    this.scheduleBuiltinBots();
  }

  /** Attach a replayed authoritative manager without emitting intermediate state. */
  attachRecoveredManager(manager: GameManager, startAt: string) {
    this.startAt = startAt;
    this.data = { stage: 'started', startAt, manager };
    this.botRunner = this.roomBots.length
      ? new BuiltinBotRunner(manager, new Set(this.roomBots.map((bot) => bot.id)))
      : undefined;
    manager.onStateChanged = () => this.botRunner?.schedule();
  }

  scheduleBuiltinBots() {
    this.botRunner?.schedule();
  }

  calculateRoomState(userID?: string): TRoomState {
    if (!this.ai) this.ensureSeats();
    const roomState = {
      ai: this.ai,
      archived: Boolean(this.nextRoomID),
      nextRoomID: this.nextRoomID,
      roomID: this.roomID,
      leaderID: this.leaderID,
      vote: this.vote,
      chat: this.chat.history,
      options: this.options,
      players: this.players.map((id) => ({ id, isLeader: id === this.leaderID })),
      ...(!this.ai ? { seats: [...this.seats] } : {}),
      createAt: this.createAt,
      roomBots: this.roomBots.map((bot): RoomBot => ({ id: bot.id, ...(userID === this.leaderID && this.data.stage !== 'started' && bot.role ? { role: bot.role } : {}) })),
    };

    if (this.data.stage === 'started') {
      return {
        ...roomState,
        startAt: this.data.startAt,
        stage: this.data.stage,
        game: this.data.manager.prepareStateForUser(userID),
      };
    } else {
      return {
        ...roomState,
        stage: this.data.stage,
      };
    }
  }

  updateOptions(options: GameOptions) {
    validateRoleOptions(options);
    if (options.addons.trapper && options.addons.plotCards) {
      throw new Error('Trapper cannot be combined with plot cards');
    }
    if (this.roomBots.length) {
      validateBuiltinBotOptions(options);
      const counts = new Map<TRoles, number>();
      this.roomBots.forEach((bot) => bot.role && counts.set(bot.role, (counts.get(bot.role) || 0) + 1));
      counts.forEach((count, role) => {
        const configured = (options.roles as unknown as Record<string, number | undefined>)[role];
        if (!['servant', 'minion'].includes(role) && (!configured || count > configured))
          throw new Error(`Bot role is not enabled: ${role}`);
      });
    }
    this.options = options;
    this.updateRoomState();
  }

  /** Atomically replace built-in AI seats while the room is waiting. */
  setRoomBots(bots: Array<{ role?: TRoles }>): void {
    if (this.data.stage !== 'created' && this.data.stage !== 'locked') throw new Error('Bots can only be configured before start');
    if (!Array.isArray(bots) || bots.length > this.maxCapacity - 1) throw new Error('Too many bot seats');
    validateBuiltinBotOptions(this.options);
    const roleCounts = new Map<TRoles, number>();
    for (const bot of bots) {
      if (bot.role !== undefined) {
        const configured = (this.options.roles as unknown as Record<string, number | undefined>)[bot.role];
        if (!['servant', 'minion'].includes(bot.role) && (!configured || !Object.prototype.hasOwnProperty.call(this.options.roles, bot.role))) {
          throw new Error(`Bot role is not enabled: ${bot.role}`);
        }
        roleCounts.set(bot.role, (roleCounts.get(bot.role) || 0) + 1);
      }
    }
    for (const [role, count] of roleCounts) {
      if (!['servant', 'minion'].includes(role)) {
        const configured = (this.options.roles as unknown as Record<string, number | undefined>)[role] || 0;
        if (count > configured) throw new Error(`Too many bots assigned role: ${role}`);
      }
    }
    this.ensureSeats();
    const humanPlayers = this.players.filter((id) => !this.roomBots.some((bot) => bot.id === id));
    if (humanPlayers.length + bots.length > this.maxCapacity) throw new Error('A game supports at most 10 seats');
    const nextBots = bots.map((bot, index) => ({ id: `avalon-agent-${index + 1}`, role: bot.role }));
    this.roomBots = nextBots;
    this.seats = this.seats.map((id) => (id && !humanPlayers.includes(id) ? null : id));
    for (const bot of nextBots) {
      const seatIndex = this.seats.findIndex((id) => id === null);
      if (seatIndex === -1) throw new Error('A game supports at most 10 seats');
      this.seats[seatIndex] = bot.id;
    }
    this.players = this.seats.filter((id): id is string => id !== null);
    this.updateRoomState(true);
  }

  startVoteFor(target: TVoteTarget) {
    if (target === 'endGame' || target === 'endAndRestartGame') {
      if (this.data.stage !== 'started' || this.data.manager.game.stage === 'end') {
        throw new Error(`Cant vote: ${target} in room with stage: ${this.data.stage}`);
      }

      if (this.vote) {
        throw new Error(`Cant start vote: ${target} in room with vote: ${this.vote.target}`);
      }

      this.vote = {
        target,
        votes: this.players.map((id) => ({
          id,
          isLeader: id === this.leaderID,
          voteResult: undefined,
        })),
        result: {
          total: this.players.length,
          yes: 0,
          no: 0,
          required: Math.floor(this.players.length / 2) + 1,
        },
      };
    }

    this.updateRoomState(true);
  }

  makeVote(userID: string, result: boolean) {
    if (!this.vote) {
      throw new Error('There are no active votes');
    }

    const userVote = this.vote.votes.find((player) => player.id === userID);

    if (!userVote || userVote.voteResult !== undefined) {
      throw new Error('You cannot participate in this vote');
    }

    userVote.voteResult = result;

    this.vote.result[result ? 'yes' : 'no'] += 1;

    if (this.vote.result.yes >= this.vote.result.required) {
      this.endVoteFor(this.vote.target);
    } else if (this.vote.result.no >= this.vote.result.total - this.vote.result.required + 1) {
      this.vote = undefined;
    }

    this.updateRoomState(true);
  }

  endVoteFor(target: TVoteTarget) {
    this.vote = undefined;

    if (target === 'endAndRestartGame' || target === 'endGame') {
      if (this.data.stage !== 'started' || this.data.manager.game.stage === 'end') {
        throw new Error(`Cant end vote: ${target} in room with stage: ${this.data.stage}`);
      }

      this.data.manager.game.endGame('manualy');
    }

    if (target === 'endAndRestartGame') {
      eventBus.emit('restartRoom', this);
    }
  }

  shuffle() {
    if (this.data.stage === 'started') {
      throw new Error('You cant shuffle started game');
    }

    this.ensureSeats();
    this.seats = _.shuffle(this.seats);
    this.players = this.seats.filter((id): id is string => id !== null);

    this.updateRoomState();
  }

  stopBuiltinBots() {
    this.botRunner?.stop();
  }

  protected destroyRoom() {
    eventBus.emit('destroyRoom', this);
  }
}
