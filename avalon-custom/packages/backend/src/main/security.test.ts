import { Manager } from './index';
import { eventBus } from '@/helpers';
import type { Server, ServerSocket, StartedRoomState } from '@avalon/types';
import type { DBManager } from '@/db';
import { BotRoom } from '@/ai/room';
import { Room } from '@/room';

test('retries of one create-room request return one room while a new request creates another', async () => {
  const { manager, handlers } = fixture(true);
  const reply = jest.fn();
  const first = 'f5488784-79f1-4bfa-8ab8-d33f3da95ac1';
  const second = 'b56ea878-6154-44ba-b705-3502878af211';
  await Promise.all([handlers.createRoomOnce(first, reply), handlers.createRoomOnce(first, reply)]);
  const [roomID] = reply.mock.calls[0];
  expect(reply.mock.calls).toEqual([[roomID], [roomID]]);
  expect(Object.keys(manager.rooms)).toEqual([roomID]);
  await handlers.createRoomOnce(second, reply);
  expect(reply.mock.lastCall![0]).not.toBe(roomID);
  expect(Object.keys(manager.rooms)).toHaveLength(2);
});

test('a rematch keeps the exact seat map and the finished archive links to the successor', async () => {
  const { manager, handlers } = fixture(true);
  manager.createRoom('old-game', 'alice', ['alice', 'bob']);
  const original = manager.rooms['old-game'];
  original.seatGame('alice', 8);
  original.seatGame('bob', 6);
  original.setRoomBots([{}, {}, {}]);
  const seats = original.getSeatAssignments();
  original.startGame();
  if (original.data.stage !== 'started') throw Error('Expected started game');
  original.data.manager.game.endGame('manualy');
  const archive = original.calculateRoomState() as StartedRoomState;
  handlers.restartGame('old-game');

  const nextRoomID = original.nextRoomID!;
  expect(manager.rooms[nextRoomID].getSeatAssignments()).toEqual(seats);
  expect(manager.rooms[nextRoomID].roomBots).toEqual(original.roomBots);
  const live = jest.fn();
  await handlers.joinRoom('old-game', live);
  expect(live).toHaveBeenCalledWith(expect.objectContaining({ nextRoomID }));

  const savedNextRoom = manager.rooms[nextRoomID];
  delete manager.rooms['old-game'];
  delete manager.rooms[nextRoomID];
  manager.dbManager.getRoomFromDB = jest.fn(async (id) => id === 'old-game' ? archive : null);
  manager.dbManager.getWaitingRoomSnapshot = jest.fn(async (id) => id === nextRoomID ? ({
    roomID: nextRoomID,
    expiresAt: new Date(Date.now() + 10000),
  } as Awaited<ReturnType<DBManager['getWaitingRoomSnapshot']>>) : null);
  const late = jest.fn();
  await handlers.joinRoom('old-game', late);
  expect(late).toHaveBeenCalledWith(expect.objectContaining({ archived: true, nextRoomID }));
  expect(savedNextRoom.data.stage).toBe('created');
});

test('seat commands acknowledge occupied, locked and released seats', () => {
  const { manager, handlers } = fixture(true);
  const result = jest.fn();
  manager.createRoom('open', 'bob', ['bob', 'alice']);
  handlers.seatGame('open', 0, result);
  expect(result).toHaveBeenLastCalledWith({ error: 'seatOccupied' });
  handlers.leaveGame('open', result);
  expect(result).toHaveBeenLastCalledWith(true);
  expect(manager.rooms.open.seats[1]).toBeNull();

  manager.rooms.open.toggleLockedState();
  handlers.seatGame('open', 1, result);
  expect(result).toHaveBeenLastCalledWith({ error: 'seatLocked' });
  manager.rooms.open.toggleLockedState();
  handlers.joinGame('open', result);
  expect(result).toHaveBeenLastCalledWith(true);
  expect(manager.rooms.open.seats[1]).toBe('alice');

  manager.createRoom('started', 'bob', ['bob', 'alice', 'carol', 'dave', 'eve']);
  manager.rooms.started.startGame();
  handlers.leaveGame('started', result);
  expect(result).toHaveBeenLastCalledWith({ error: 'seatStarted' });
  expect(manager.rooms.started.players).toContain('alice');
});

test.each(['created', 'locked', 'started'] as const)('host can transfer ownership in a %s room', (stage) => {
  const { manager, handlers, broadcasts } = fixture(true);
  manager.createRoom('table', 'alice', ['alice', 'bob', 'carol', 'dave', 'eve']);
  const room = manager.rooms.table;
  if (stage === 'locked') room.toggleLockedState();
  if (stage === 'started') room.startGame();
  const gameLeader = room.data.stage === 'started' ? room.data.manager.game.leader.userID : undefined;

  handlers.transferHost('table', 'bob');

  expect(room.leaderID).toBe('bob');
  expect(room.calculateRoomState().players.find((player) => player.id === 'bob')?.isLeader).toBe(true);
  expect(broadcasts).toContainEqual(
    expect.objectContaining({
      event: 'roomUpdated',
      value: expect.objectContaining({ leaderID: 'bob' }),
    }),
  );
  if (room.data.stage === 'started') expect(room.data.manager.game.leader.userID).toBe(gameLeader);
  handlers.transferHost('table', 'carol');
  handlers.lockRoom('table');
  expect(room.leaderID).toBe('bob');
  expect(room.data.stage).toBe(stage);
});

test('ownership transfer rejects non-hosts, absent players, malformed input and replaced rooms', () => {
  const { manager, handlers } = fixture(true);
  manager.createRoom('table', 'bob', ['alice', 'bob']);
  const room = manager.rooms.table;
  handlers.transferHost('table', 'alice');
  expect(room.leaderID).toBe('bob');
  room.leaderID = 'alice';
  for (const target of ['spectator', '', null, ['bob'], 'alice']) handlers.transferHost('table', target);
  expect(room.leaderID).toBe('alice');
  room.nextRoomID = 'next';
  handlers.transferHost('table', 'bob');
  expect(room.leaderID).toBe('alice');
});

jest.mock('@/voice/runtime', () => ({
  createRoomVoice: () => ({ destroyRoom() {}, reconcile() {}, revokeSocket() {} }),
  registerVoiceEndpoints() {},
}));

test('only the current lobby host can assign and advance the shared manual timer', () => {
  const { manager, handlers, broadcasts } = fixture(true);
  manager.createRoom('table', 'alice', ['alice', 'bob', 'carol', 'dave', 'eve'], {
    roles: {},
    addons: {},
    features: { useCustomTimer: true },
  });
  const room = manager.rooms.table;
  handlers.setCustomTimerPlayer('table', 'bob');
  room.startGame();
  const timer = (room.calculateRoomState() as StartedRoomState).game.timer;
  expect(timer?.playerID).toBeUndefined();
  handlers.startCustomTimer('table', 120);
  handlers.setCustomTimerDuration('table', 180);
  handlers.setCustomTimerPlayer('table', 'eve');
  handlers.nextCustomTimerPlayer('table');
  expect((room.calculateRoomState() as StartedRoomState).game.timer).toMatchObject({ playerID: 'alice', active: true });
  expect(broadcasts).toContainEqual(
    expect.objectContaining({
      event: 'gameUpdated',
      value: expect.objectContaining({ timer: expect.objectContaining({ playerID: 'alice' }) }),
    }),
  );
  handlers.transferHost('table', 'bob');
  handlers.setCustomTimerDuration('table', 30);
  expect((room.calculateRoomState() as StartedRoomState).game.timer?.durationSeconds).toBe(180);
  handlers.setCustomTimerPlayer('table', 'eve');
  handlers.nextCustomTimerPlayer('table');
  expect((room.calculateRoomState() as StartedRoomState).game.timer?.playerID).toBe('alice');
  handlers.setCustomTimerPlayer('missing', 'alice');
  handlers.nextCustomTimerPlayer('missing');
});

test('an active room with no connected players expires after the empty-room retention window', async () => {
  const { manager, handlers } = fixture(true);
  manager.createRoom('empty-live', 'alice', ['alice', 'bob', 'carol', 'dave', 'eve']);
  const room = manager.rooms['empty-live'];
  room.startGame();
  await handlers.joinRoom('empty-live', () => {});
  handlers.leaveRoom('empty-live');

  expect(manager.rooms['empty-live']).toBe(room);
  jest.advanceTimersByTime(30 * 60000);

  expect(manager.rooms['empty-live']).toBeUndefined();
});
jest.mock('@/ai/service', () => ({
  AiService: class {
    register() {}
  },
}));
jest.mock('@/achievements', () => ({ AchievementManager: class {} }));

test('owner can remove only the guest from a ready friend bot room', () => {
  const { manager, handlers } = fixture(true);
  const room = new BotRoom(
    'friend-room',
    'alice',
    manager.io,
    async () => ({ choice: 0, speech: '' }),
    async () => {},
    0,
    'en',
    5,
  );
  room.ai!.publicBotGame = true;
  room.ai!.withFriend = true;
  room.ai!.launchExpiresAt = Date.now() + 120000;
  room.joinAsHuman('alice');
  room.joinGame('guest');
  manager.rooms[room.roomID] = room;
  const deadline = room.ai!.launchExpiresAt;
  manager.updateRoomsList(room);
  expect(manager.roomListCutted[0]).toMatchObject({ aiHumanCount: 2, aiBotCount: 3, aiOpenSeats: 0 });
  handlers.kickPlayer(room.roomID, 'alice');
  handlers.kickPlayer(room.roomID, room.players[0]);
  expect(room.humanIDs).toEqual(['alice', 'guest']);
  handlers.kickPlayer(room.roomID, 'guest');
  expect(room.humanIDs).toEqual(['alice']);
  expect(room.players).not.toContain('guest');
  expect(room.players).toHaveLength(5);
  expect(room.ai!.launchExpiresAt).toBe(deadline);
  manager.updateRoomsList(room);
  expect(manager.roomListCutted[0]).toMatchObject({ aiHumanCount: 1, aiBotCount: 3, aiOpenSeats: 1 });
  room.joinGame('friend');
  room.ai!.status = 'running';
  handlers.kickPlayer(room.roomID, 'friend');
  expect(room.humanIDs).toEqual(['alice', 'friend']);
});

test('another player cannot kick the guest from a bot room', () => {
  const { manager, handlers } = fixture(true);
  const room = new BotRoom(
    'friend-room',
    'owner',
    manager.io,
    async () => ({ choice: 0, speech: '' }),
    async () => {},
    0,
    'en',
    5,
  );
  room.ai!.publicBotGame = true;
  room.ai!.withFriend = true;
  room.joinAsHuman('owner');
  room.joinGame('guest');
  manager.rooms[room.roomID] = room;
  handlers.kickPlayer(room.roomID, 'guest');
  expect(room.humanIDs).toEqual(['owner', 'guest']);
});

function fixture(auth = false) {
  const connections: ((socket: unknown) => void)[] = [];
  const broadcasts: { channel: string; event: string; value: unknown }[] = [];
  const io = {
    use() {},
    except() {
      return io;
    },
    on(event: string, fn: (socket: unknown) => void) {
      if (event === 'connection') connections.push(fn);
    },
    to(channel: string) {
      return {
        emit(event: string, value: unknown) {
          broadcasts.push({ channel, event, value });
        },
      };
    },
  };
  const db = {
    getLastRooms: async () => [],
    getWaitingRoomSnapshots: async () => [],
    getStartedRoomSnapshots: async () => [],
    getWaitingRoomSnapshot: async () => null,
    getStartedRoomSnapshot: async () => null,
    saveWaitingRoomSnapshot: async () => {},
    saveStartedRoomSnapshot: async () => {},
    deleteWaitingRoomSnapshot: async () => {},
    getRoomFromDB: async (id: string) => (id === 'archive' ? { roomID: id, stage: 'started' } : null),
    getUserCompletedAchievements: async () => [],
  };
  const manager = new Manager(io as unknown as Server, db as unknown as DBManager);
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const socket = {
    id: 'socket',
    data: auth ? { authUser: { id: 'alice' } } : {},
    rooms: new Set<string>(['socket']),
    on(event: string, fn: (...args: unknown[]) => unknown) {
      handlers[event] = fn;
      return socket;
    },
    emit() {},
    join(id: string) {
      socket.rooms.add(id);
    },
    leave(id: string) {
      socket.rooms.delete(id);
    },
  };
  connections[connections.length - 1](socket as unknown as ServerSocket);
  return { manager, handlers, socket, broadcasts };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  eventBus.removeAllListeners();
});

test('guest cannot subscribe arrays or private channel names; valid archives use room namespace', async () => {
  const { socket, handlers } = fixture();
  await handlers.joinRoom(['archive', 'alice'], () => {});
  await handlers.joinRoom('user:alice', () => {});
  expect([...socket.rooms]).toEqual(['socket']);
  await handlers.joinRoom('archive', () => {});
  expect([...socket.rooms]).toEqual(['socket', 'room:archive']);
});

test('room snapshots retry in the background even while everyone is idle', async () => {
  const { manager } = fixture(true);
  const save = jest.fn().mockRejectedValueOnce(Error('temporary Mongo failure')).mockResolvedValue(undefined);
  manager.dbManager.saveWaitingRoomSnapshot = save;
  const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    manager.createRoom('retry-room', 'alice', ['alice']);
    await jest.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].roomID).toBe('retry-room');
    await jest.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(2);
  } finally {
    warn.mockRestore();
  }
});

test('recent finished entries cannot push an older playable room out of the lobby', async () => {
  const { manager, handlers } = fixture(true);
  manager.createRoom('older-open', 'alice', ['alice']);
  const active = manager.roomsList[0];
  manager.roomsList = [
    ...Array.from({ length: 51 }, (_, i) => ({
      ...active, uuid: `finished-${i}`, state: 'started' as const, result: { reason: 'manualy' as const },
    })),
    active,
  ];
  const reply = jest.fn();
  await handlers.getRoomsList(reply);
  const rooms = reply.mock.calls[0][0];
  expect(rooms[0].uuid).toBe('older-open');
  expect(rooms.filter((room: { result?: unknown }) => Boolean(room.result))).toHaveLength(50);
});

test('planned shutdown holds the last live checkpoint, suspends the timer and rejects new game operations', async () => {
  const { manager, handlers } = fixture(true);
  manager.createRoom('saved-before-stop', 'alice', ['alice', 'bob', 'carol', 'dave', 'eve'], {
    roles: {},
    addons: {},
    features: { timerDurations: { firstSelectTeam: { enabled: true, duration: 10 } } },
  });
  const room = manager.rooms['saved-before-stop'];
  room.toggleLockedState();
  handlers.startGame(room.roomID);
  if (room.data.stage !== 'started') throw Error('Expected a started room');
  const game = room.data.manager.game;
  const timer = game.timer.recoveryState();
  expect(timer.current?.stage).toBe('firstSelectTeam');

  let notifySave!: () => void;
  let finishSave!: () => void;
  const saving = new Promise<void>((resolve) => { notifySave = resolve; });
  const stored = new Promise<void>((resolve) => { finishSave = resolve; });
  manager.dbManager.saveStartedRoomSnapshot = jest.fn(() => {
    notifySave();
    return stored;
  });
  const complete = jest.fn();
  const stop = manager.saveBeforeShutdown().then(complete);
  const reply = jest.fn();
  await handlers.createRoom(reply);
  expect(reply).toHaveBeenCalledWith({ error: 'serverRestarting' });
  await saving;
  await jest.advanceTimersByTimeAsync(11_000);
  expect(game.timer.recoveryState()).toEqual(timer);
  expect(game.stage).toBe('selectTeam');
  expect(complete).not.toHaveBeenCalled();
  finishSave();
  await stop;
  expect(complete).toHaveBeenCalledTimes(1);
});

test('room administration is socket scoped and removes only the selected lobby room', async () => {
  const { manager, handlers, broadcasts } = fixture(true);
  const previousPassword = process.env.XCGAME_ROOM_ADMIN_PASSWORD;
  process.env.XCGAME_ROOM_ADMIN_PASSWORD = 'test-admin-pass';
  const markRemoved = jest.fn(async () => {});
  manager.dbManager.markLobbyRoomRemoved = markRemoved;
  try {
    manager.createRoom('admin-test-room', 'bob', ['bob']);
    manager.createRoom('other-room', 'carol', ['carol']);
    const ack = jest.fn();
    await handlers.deleteLobbyRoom('admin-test-room', ack);
    expect(ack).toHaveBeenLastCalledWith({ error: 'forbidden' });
    handlers.unlockRoomAdmin('wrong-password', ack);
    expect(ack).toHaveBeenLastCalledWith(false);
    handlers.unlockRoomAdmin('test-admin-pass', ack);
    expect(ack).toHaveBeenLastCalledWith(true);
    await handlers.deleteLobbyRoom('admin-test-room', ack);
    expect(ack).toHaveBeenLastCalledWith(true);
    expect(markRemoved).toHaveBeenCalledWith('admin-test-room');
    expect(manager.rooms['admin-test-room']).toBeUndefined();
    expect(manager.rooms['other-room']).toBeDefined();
    expect(manager.isLobbyRoomRemoved('admin-test-room')).toBe(true);
    expect(broadcasts).toContainEqual({ channel: 'room:admin-test-room', event: 'destroyRoom', value: 'admin-test-room' });
    jest.advanceTimersByTime(8 * 60 * 60 * 1000);
    handlers.getRoomAdminStatus(ack);
    expect(ack).toHaveBeenLastCalledWith(false);
  } finally {
    if (previousPassword === undefined) delete process.env.XCGAME_ROOM_ADMIN_PASSWORD;
    else process.env.XCGAME_ROOM_ADMIN_PASSWORD = previousPassword;
  }
});

test('authenticated users join only their namespaced personal channel', () => {
  expect([...fixture(true).socket.rooms]).toEqual(['socket', 'user:alice']);
});

test('joining twice and leaving another room cannot corrupt online counters', async () => {
  const { manager, handlers } = fixture();
  await handlers.joinRoom('archive', () => {});
  await handlers.joinRoom('archive', () => {});
  handlers.leaveRoom('other');
  expect(manager.onlineCounter.archive).toBe(1);
  handlers.leaveRoom('archive');
  expect(manager.onlineCounter.archive || 0).toBe(0);
});

test('one account cannot retain unlimited waiting rooms', () => {
  const { manager } = fixture(true);
  manager.createRoom('one', 'alice', ['alice']);
  manager.createRoom('two', 'alice', ['alice']);
  manager.createRoom('three', 'alice', ['alice']);
  expect(() => manager.createRoom('four', 'alice', ['alice'])).toThrow('roomLimit');
  expect(Object.keys(manager.rooms)).toHaveLength(3);
  manager.destroyRoom('one');
  expect(() => manager.createRoom('four', 'alice', ['alice'])).not.toThrow();
});

test('waiting rooms are actually released after idle TTL, not just hidden from lobby', () => {
  const { manager } = fixture();
  manager.createRoom('waiting', 'alice', ['alice']);
  jest.advanceTimersByTime(30 * 60000);
  expect(manager.rooms.waiting).toBeUndefined();
  expect(manager.roomListCutted).not.toEqual(expect.arrayContaining([expect.objectContaining({ uuid: 'waiting' })]));
});

test.each(['manualy', 'rejectedVote'] as const)(
  'expired completed games remain in the lobby after ending with %s',
  async (reason) => {
    const { manager, handlers, broadcasts } = fixture();
    manager.createRoom('completed', 'alice', ['alice', 'bob', 'carol', 'dave', 'eve']);
    const room = manager.rooms.completed;
    room.startGame();
    if (room.data.stage !== 'started') throw Error('game did not start');
    room.data.manager.game.endGame(reason);
    jest.advanceTimersByTime(30 * 60000);

    expect(manager.rooms.completed).toBeUndefined();
    const list = jest.fn();
    await handlers.getRoomsList(list);
    expect(list).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ uuid: 'completed', result: expect.objectContaining({ reason }) }),
      ]),
    );
    expect(broadcasts.filter(({ event }) => event === 'roomsListUpdated').pop()?.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uuid: 'completed', result: expect.objectContaining({ reason }) }),
      ]),
    );
  },
);

test('stopping a ready AI room removes it from lobby responses and broadcasts but keeps its direct link', async () => {
  const { BotRoom } = await import('@/ai/room');
  const { manager, handlers, broadcasts } = fixture(true);
  const room = new BotRoom('bot-ready', 'alice', manager.io, async () => ({ choice: 0, speech: '' }));
  room.joinAsHuman('alice');
  room.ai!.beginner = true;
  room.ai!.botDifficulty = 'regular';
  manager.rooms[room.roomID] = room;
  manager.updateRoomsList(room);
  expect(manager.roomListCutted).toContainEqual(
    expect.objectContaining({ uuid: room.roomID, aiStatus: 'ready', aiBeginner: true, aiBotDifficulty: 'regular' }),
  );

  room.stop();
  manager.updateRoomsList(room);
  const list = jest.fn();
  handlers.getRoomsList(list);
  expect(list).toHaveBeenCalledWith([]);
  expect(broadcasts.filter(({ event }) => event === 'roomsListUpdated').pop()?.value).toEqual([]);
  expect(manager.rooms[room.roomID]).toBe(room);
  const direct = jest.fn();
  await handlers.joinRoom(room.roomID, direct);
  expect(direct).toHaveBeenCalledWith(
    expect.objectContaining({ roomID: room.roomID, ai: expect.objectContaining({ status: 'stopped' }) }),
  );
});

test('startup lobby loading hides stopped archives and cannot restore a stopped live room from a stale snapshot', async () => {
  const { BotRoom } = await import('@/ai/room');
  const { manager, handlers } = fixture();
  manager.createRoom('human-ended', 'alice', ['alice', 'bob', 'carol', 'dave', 'eve']);
  const human = manager.rooms['human-ended'];
  human.startGame();
  if (human.data.stage !== 'started') throw Error('game did not start');
  human.data.manager.game.endGame('manualy');
  const saved = human.calculateRoomState() as StartedRoomState;
  const stopped = new BotRoom('live-stopped', 'alice', manager.io, async () => ({ choice: 0, speech: '' }));
  stopped.stop();
  manager.rooms[stopped.roomID] = stopped;
  manager.generateRoomsListFromDB([
    ...Array.from({ length: 55 }, (_, index) => ({
      ...saved,
      roomID: `stopped-${index}`,
      createAt: '2026-10-11T12:00:00.000Z',
      ai: { ...stopped.ai!, status: 'stopped' as const },
    })),
    { ...saved, roomID: stopped.roomID, ai: { ...stopped.ai!, status: 'running' } },
    {
      ...saved,
      roomID: 'ai-finished',
      ai: { ...stopped.ai!, status: 'finished', beginner: true, botDifficulty: 'regular' },
    },
    saved,
  ]);
  const list = jest.fn();
  handlers.getRoomsList(list);
  expect(list.mock.calls[0][0].map(({ uuid }: { uuid: string }) => uuid).sort()).toEqual([
    'ai-finished',
    'human-ended',
  ]);
  expect(list.mock.calls[0][0]).toContainEqual(
    expect.objectContaining({ uuid: 'ai-finished', aiBeginner: true, aiBotDifficulty: 'regular' }),
  );
});

test('new chat messages still broadcast when bounded history is full; retries do not', () => {
  const { manager, broadcasts } = fixture();
  manager.createRoom('chat-room', 'alice', ['alice']);
  const room = manager.rooms['chat-room'];
  for (let i = 0; i < 1000; i++) room.chat.addMessage(`message ${i}`, 'alice', String(i));
  room.addMessage('alice', 'newest', 'new');
  room.addMessage('alice', 'newest', 'new');
  expect(room.chat.history).toHaveLength(1000);
  expect(broadcasts.filter((event) => event.event === 'newMessage')).toEqual([
    expect.objectContaining({ channel: 'room:chat-room', value: expect.objectContaining({ text: 'newest' }) }),
  ]);
});

test('room responses distinguish saved archives and rooms replaced by the next game', async () => {
  const { manager, handlers } = fixture();
  const archive = jest.fn();
  await handlers.joinRoom('archive', archive);
  expect(archive).toHaveBeenCalledWith(expect.objectContaining({ archived: true }));
  manager.createRoom('live', 'alice', ['alice']);
  const live = jest.fn();
  await handlers.joinRoom('live', live);
  expect(live).toHaveBeenCalledWith(expect.objectContaining({ archived: false }));
  manager.rooms.live.nextRoomID = 'next';
  const replaced = jest.fn();
  await handlers.joinRoom('live', replaced);
  expect(replaced).toHaveBeenCalledWith(expect.objectContaining({ archived: true }));
});

test.each([29, 64])('a game ending %i minutes after creation keeps its room for 30 more minutes', async (minutes) => {
  const { manager, handlers } = fixture();
  manager.createRoom('postgame', 'alice', ['alice', 'bob', 'carol', 'dave', 'eve']);
  const room = manager.rooms.postgame;
  room.startGame();
  jest.advanceTimersByTime(minutes * 60000);
  if (room.data.stage !== 'started') throw Error('game did not start');
  room.data.manager.game.endGame('manualy');
  jest.advanceTimersByTime(30 * 60000 - 1);
  expect(manager.rooms.postgame).toBe(room);
  const state = jest.fn();
  await handlers.joinRoom('postgame', state);
  expect(state).toHaveBeenCalledWith(expect.objectContaining({ archived: false }));
  jest.advanceTimersByTime(1);
  expect(manager.rooms.postgame).toBeUndefined();
});

test('ordinary game sockets admit only the mixed-room human, never bot identities or spectators', async () => {
  const { BotRoom } = await import('@/ai/room');
  const { Room } = await import('@/room');
  const { manager, handlers } = fixture(true);
  const room = new BotRoom('mixed', 'alice', manager.io, async () => ({ choice: 0, speech: '' }));
  room.joinAsHuman('alice');
  manager.rooms.mixed = room;
  Room.prototype.startGame.call(room);
  room.ai!.status = 'running';
  if (room.data.stage !== 'started') throw Error('not started');
  const game = room.data.manager.game;
  game.leader = game.players.find((p) => p.userID === 'alice')!;
  handlers.selectPlayer('mixed', game.players[0].userID);
  expect(game.players[0].features.isSelected).toBe(true);
  room.ai!.status = 'paused';
  handlers.selectPlayer('mixed', game.players[0].userID);
  expect(game.players[0].features.isSelected).toBe(true);
  room.ai!.status = 'running';
  room.ai!.humanPlayerID = 'someone-else';
  handlers.selectPlayer('mixed', game.players[0].userID);
  expect(game.players[0].features.isSelected).toBe(true);
  room.stop();
});

test('expiring a finished bot room frees a slot and keeps the replay available', async () => {
  const { manager, handlers, broadcasts } = fixture(true);
  await Promise.resolve();
  const room = new BotRoom('finished-bot', 'bob', manager.io, async () => ({ choice: 0, speech: '' }));
  manager.rooms[room.roomID] = room;
  Room.prototype.startGame.call(room);
  if (room.data.stage !== 'started') throw Error('game did not start');
  room.data.manager.game.endGame('rejectedVote');
  room.ai!.status = 'finished';
  const snapshot = structuredClone(room.calculateRoomState());
  const load = jest.fn(async () => structuredClone(snapshot));
  Object.assign(manager.aiService, { archiveRepository: { load, hasTerminalReplay: async () => true } });

  for (let i = 0; i < 499; i++) manager.rooms[`active-${i}`] = { leaderID: 'bob' } as Room;
  manager.updateRoomsList(room);
  expect(() => manager.createRoom('new', 'alice', ['alice'])).toThrow('roomLimit');
  await jest.advanceTimersByTimeAsync(30 * 60000 - 1);
  expect(manager.rooms[room.roomID]).toBe(room);

  // Join starts against the live room but the chat lookup finishes after expiry.
  let resumeJoin!: (chat: []) => void;
  jest.spyOn(manager.chatService, 'history').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resumeJoin = resolve;
      }),
  );
  const joiningReplay = jest.fn();
  const joining = handlers.joinRoom(room.roomID, joiningReplay);
  await Promise.resolve();

  await jest.advanceTimersByTimeAsync(1);
  expect(manager.rooms[room.roomID]).toBeUndefined();
  resumeJoin([]);
  await joining;
  expect(joiningReplay).toHaveBeenCalledWith(expect.objectContaining({ roomID: room.roomID, archived: true }));
  expect(broadcasts).toContainEqual({ channel: 'room:finished-bot', event: 'destroyRoom', value: 'finished-bot' });
  expect(manager.roomListCutted).toContainEqual(expect.objectContaining({ uuid: room.roomID, aiStatus: 'finished' }));
  const created = jest.fn();
  handlers.createRoom(created);
  expect(manager.rooms[created.mock.calls[0][0]]).toBeDefined();

  const replay = jest.fn();
  await handlers.joinRoom(room.roomID, replay);
  expect(replay).toHaveBeenCalledWith(
    expect.objectContaining({
      roomID: room.roomID,
      archived: true,
      ai: expect.objectContaining({ status: 'finished' }),
      game: expect.objectContaining({ stage: 'end', result: expect.objectContaining({ reason: 'rejectedVote' }) }),
    }),
  );
});

test('AI expiry retries a failed final replay write before releasing the room', async () => {
  const { manager, handlers } = fixture();
  const room = new BotRoom('stopped-bot', 'owner', manager.io, async () => ({ choice: 0, speech: '' }));
  manager.rooms[room.roomID] = room;
  Room.prototype.startGame.call(room);
  let saved = structuredClone(room.calculateRoomState());
  const save = jest
    .fn(async (state) => {
      saved = structuredClone(state);
    })
    .mockRejectedValueOnce(new Error('database unavailable'));
  Object.assign(manager.aiService, {
    archiveRepository: {
      load: async () => structuredClone(saved),
      hasTerminalReplay: async () => saved.ai?.status === 'stopped',
      save,
    },
  });
  room.stop();
  manager.updateRoomsList(room);

  await jest.advanceTimersByTimeAsync(30 * 60000);
  expect(save).toHaveBeenCalledTimes(1);
  expect(manager.rooms[room.roomID]).toBe(room);

  await jest.advanceTimersByTimeAsync(60000);
  expect(save).toHaveBeenCalledTimes(2);
  expect(manager.rooms[room.roomID]).toBeUndefined();
  const replay = jest.fn();
  await handlers.joinRoom(room.roomID, replay);
  expect(replay).toHaveBeenCalledWith(
    expect.objectContaining({
      archived: true,
      ai: expect.objectContaining({ status: 'stopped' }),
      game: expect.objectContaining({ stage: 'end', result: expect.objectContaining({ reason: 'manualy' }) }),
    }),
  );
});

test('stopped AI drafts expire without affecting active AI rooms', async () => {
  const { manager } = fixture();
  const decide = async () => ({ choice: 0, speech: '' });
  const draft = new BotRoom('draft', 'owner', manager.io, decide);
  const active = new BotRoom('active', 'owner', manager.io, decide);
  manager.rooms.draft = draft;
  manager.rooms.active = active;
  draft.stop();
  active.ai!.status = 'running';
  manager.updateRoomsList(draft);
  manager.updateRoomsList(active);

  await jest.advanceTimersByTimeAsync(30 * 60000);
  expect(manager.rooms.draft).toBeUndefined();
  expect(manager.rooms.active).toBe(active);
});

test('adopting a lobby as an AI room clears its ordinary expiry timer without destroying voice', () => {
  jest.useFakeTimers();
  try {
    const { manager } = fixture();
    const voice = jest.spyOn(manager.voice, 'destroyRoom');
    const before = jest.getTimerCount();
    manager.createRoom('lobby', 'owner', ['owner']);
    expect(jest.getTimerCount()).toBe(before + 1);
    const adopted = new BotRoom('lobby', 'owner', manager.io, async () => ({ choice: 0, speech: '' }));
    manager.rooms.lobby = adopted;
    manager.updateRoomsList(adopted);
    expect(jest.getTimerCount()).toBe(before);
    expect(manager.rooms.lobby).toBe(adopted);
    expect(voice).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
