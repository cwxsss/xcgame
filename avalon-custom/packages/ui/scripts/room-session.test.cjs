const { test } = require('node:test');
const { setImmediate: tick } = require('node:timers/promises');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS' } });
const { createRoomSession } = require('../src/helpers/room-session.ts');

function setup() {
  const handlers = {};
  const pending = [];
  const states = [];
  const sources = [];
  const errors = [];
  const chats = [];
  const games = [];
  let redirects = 0;
  let id = 'room';
  let acknowledgementTimeout;
  const socket = {
    on: (name, handler) => {
      handlers[name] = handler;
    },
    off: (name) => {
      delete handlers[name];
    },
    timeout: (ms) => {
      acknowledgementTimeout = ms;
      return socket;
    },
    emitWithAck: (event, roomID) =>
      new Promise((resolve, reject) => {
        pending.push({ event, roomID, resolve, reject, acknowledgementTimeout });
      }),
  };
  const session = createRoomSession(
    socket,
    () => id,
    (state, source) => {
      states.push(state);
      sources.push(source);
    },
    (error) => errors.push(error),
    () => redirects++,
    (chat) => chats.push(chat),
    (game) => games.push(game),
  );
  return {
    handlers,
    pending,
    states,
    sources,
    errors,
    chats,
    games,
    session,
    setID: (value) => {
      id = value;
    },
    redirects: () => redirects,
  };
}

test('room joins use a finite acknowledgement timeout and retry without discarding a newer board update', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup();
  const load = f.session.load('room');
  assert.ok(f.pending[0].acknowledgementTimeout > 0);
  f.handlers.gameUpdated({ uuid: 'room', revision: 7 });
  f.pending[0].reject(new Error('ack timed out'));
  await tick();
  t.mock.timers.tick(2000);
  await tick();
  f.pending[1].resolve({ roomID: 'room', stage: 'started', game: { revision: 6 }, chat: [] });
  await load;
  assert.equal(f.states[0].game.revision, 7);
  assert.deepEqual(f.errors, []);
});

test('room join retries stop at three attempts and permit a manual retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup();
  const load = f.session.load('room');
  for (let i = 0; i < 3; i++) {
    f.pending[i].reject(new Error('ack timed out'));
    await tick();
    t.mock.timers.tick(2000);
    await tick();
  }
  await load;
  assert.equal(f.pending.length, 3);
  assert.deepEqual(f.errors, [{ error: 'requestFailed' }]);
  const manual = f.session.load('room');
  f.pending[3].resolve({ roomID: 'room', chat: [] });
  await manual;
  assert.equal(f.states.length, 1);
});

test('leaving the page cancels scheduled room join retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup();
  const load = f.session.load('room');
  f.pending[0].reject(new Error('ack timed out'));
  await tick();
  f.session.dispose();
  t.mock.timers.tick(2000);
  await load;
  assert.equal(f.pending.length, 1);
  assert.deepEqual(f.errors, []);
});

test('room expiry reloads the archive and keeps the chat page open', async () => {
  const f = setup();
  const expiry = f.handlers.destroyRoom('room');
  f.pending[0].resolve({ roomID: 'room', archived: true, chat: [{ message: 'saved' }] });
  await expiry;
  assert.equal(f.redirects(), 0);
  assert.equal(f.states[0].chat[0].message, 'saved');
  assert.equal(f.states[0].archived, true);
});

test('only a missing expired room redirects; a database failure keeps the page recoverable', async () => {
  const f = setup();
  const first = f.handlers.destroyRoom('room');
  f.pending[0].resolve({ error: 'requestFailed' });
  await first;
  assert.equal(f.redirects(), 0);
  assert.equal(f.errors[0].error, 'requestFailed');
  const second = f.handlers.destroyRoom('room');
  f.pending[1].resolve({ error: 'errorNotFound' });
  await second;
  assert.equal(f.redirects(), 1);
});

test('reconnect rejoins, ignores stale loads, and retains a broadcast newer than the join snapshot', async () => {
  const f = setup();
  const first = f.session.load('room');
  f.setID('other');
  const second = f.handlers.connect();
  f.pending[0].resolve({ roomID: 'room', chat: [] });
  f.handlers.roomUpdated({ roomID: 'other', chat: [{ message: 'new' }] });
  f.pending[1].resolve({ roomID: 'other', chat: [] });
  await Promise.all([first, second]);
  assert.deepEqual(f.states, [{ roomID: 'other', chat: [{ message: 'new' }] }]);
  f.session.dispose();
  assert.deepEqual(Object.keys(f.handlers), []);
});

test('a buffered lobby update cannot replace a newer started-game acknowledgement', async () => {
  const f = setup();
  const loading = f.session.load('room');
  f.handlers.roomUpdated({ roomID: 'room', stage: 'locked', chat: [] });
  f.pending[0].resolve({ roomID: 'room', stage: 'started', game: { stage: 'selectTeam' }, chat: [] });
  await loading;
  assert.equal(f.states[0].stage, 'started');
  assert.equal(f.states[0].game.stage, 'selectTeam');
});

test('reconnect keeps the highest board revision received before or after the acknowledgement', async () => {
  const f = setup();
  const loading = f.session.load('room');
  f.handlers.gameUpdated({ uuid: 'room', revision: 7, stage: 'votingForTeam' });
  f.handlers.gameUpdated({ uuid: 'room', revision: 6, stage: 'selectTeam' });
  f.handlers.gameUpdated({ uuid: 'other', revision: 50 });
  f.pending[0].resolve({ roomID: 'room', stage: 'started', game: { revision: 6, stage: 'selectTeam' }, chat: [] });
  await loading;
  assert.equal(f.states[0].game.revision, 7);
  f.handlers.gameUpdated({ uuid: 'room', revision: 6 });
  f.handlers.gameUpdated({ uuid: 'room', revision: 8, stage: 'onMission' });
  assert.deepEqual(f.games.map((game) => game.revision), [8]);
});

test('chat-only broadcasts update messages without rebuilding the game replay', () => {
  const f = setup();
  f.handlers.roomUpdated({ roomID: 'room', chat: [{ id: 'new', message: 'hello' }] }, true);
  assert.deepEqual(f.states, []);
  assert.deepEqual(f.chats, [[{ id: 'new', message: 'hello' }]]);
});

test('room snapshots distinguish initial join and reconnect from live room broadcasts', async () => {
  const f = setup();
  const initial = f.session.load('room');
  f.pending[0].resolve({ roomID: 'room', stage: 'started', chat: [] });
  await initial;
  f.handlers.roomUpdated({ roomID: 'room', stage: 'started', chat: [] });

  const reconnect = f.handlers.connect();
  f.handlers.roomUpdated({ roomID: 'room', chat: [{ id: 'new', message: 'while joining' }] });
  f.pending[1].resolve({ roomID: 'room', stage: 'started', chat: [] });
  await reconnect;

  assert.deepEqual(f.sources, ['snapshot', 'update', 'snapshot']);
  assert.equal(f.states[2].chat[0].id, 'new');
});

test('pending joins remain loading until the acknowledgement or disposal', async () => {
  const f = setup();
  assert.equal(f.session.isLoading?.(), false);
  const initial = f.session.load('room');
  assert.equal(f.session.isLoading(), true);
  f.handlers.roomUpdated({ roomID: 'room', chat: [] });
  assert.equal(f.session.isLoading(), true);
  f.pending[0].resolve({ roomID: 'room', chat: [] });
  await initial;
  assert.equal(f.session.isLoading(), false);

  const reconnect = f.handlers.connect();
  assert.equal(f.session.isLoading(), true);
  f.session.dispose();
  assert.equal(f.session.isLoading(), false);
  f.pending[1].resolve({ roomID: 'room', chat: [] });
  await reconnect;
  assert.equal(f.states.length, 1);
});

test('game state snapshot revision changes only for loaded room snapshots', () => {
  const fs = require('node:fs');
  const ts = require('typescript');
  const vue = require('vue');
  const source = fs.readFileSync(require.resolve('../src/helpers/game-state-manager/index.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports = {};
  const load = (id) => (id === 'vue' ? { ...vue, provide() {} } : id.startsWith('@/') ? {} : require(id));
  new Function('require', 'exports', code)(load, exports);
  const manager = new exports.GameStateManager();
  const game = { stage: 'selectTeam', history: [], players: [] };
  const room = { stage: 'started', game };

  manager.mutateRoomState({ newRoomState: room });
  assert.equal(manager.snapshotRevision?.value, 1);
  manager.mutateRoomState({ newRoomState: room, isLiveUpdate: true });
  manager.mutateRoomState({ newGameState: game });
  assert.equal(manager.snapshotRevision.value, 1);
  manager.mutateRoomState({ newRoomState: room });
  assert.equal(manager.snapshotRevision.value, 2);
});
