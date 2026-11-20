const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

const base = process.argv[2];
assert.ok(base, 'Pass the server URL');
let accessCookie;
const sockets = [];

async function request(path, body, expected = 200) {
  const response = await fetch(new URL(path, base), {
    ...(body === undefined
      ? {}
      : { method: 'POST', body: JSON.stringify(body) }),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessCookie ? { Cookie: accessCookie } : {}),
    },
  });
  assert.equal(response.status, expected, path);
  return expected === 200 ? response.json() : null;
}

function waitFor(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      timeout,
    );
    socket.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

async function connect(namespace, auth) {
  const socket = io(`${base}/${namespace}`, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    extraHeaders: { Cookie: accessCookie },
    auth,
  });
  sockets.push(socket);
  const connected = waitFor(socket, 'connect');
  socket.connect();
  await connected;
  return socket;
}

async function sync(socket, matchID, seat, event = 'sync') {
  const response = waitFor(socket, event);
  socket.emit('sync', matchID, seat.playerID, seat.playerCredentials);
  return response;
}

function voiceAuth(matchID, seat) {
  return {
    gameName: 'splendor',
    matchID,
    playerID: seat.playerID,
    credentials: seat.playerCredentials,
  };
}

(async () => {
  const gate = await fetch(new URL('/access', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.TABLETOP_ACCESS_PASSWORD }),
  });
  assert.equal(gate.status, 200);
  accessCookie = gate.headers.get('set-cookie')?.split(';', 1)[0];
  const { matchID } = await request('/games/splendor/create', {
    numPlayers: 2,
    unlisted: true,
  });
  const path = `/games/splendor/${matchID}`;
  const original = await request(path + '/join', {
    playerID: '0',
    playerName: '旧设备',
  });
  const teammate = await request(path + '/join', {
    playerID: '1',
    playerName: '其他玩家',
  });
  const game = await connect('splendor');
  const otherGame = await connect('splendor');
  await sync(game, matchID, original);
  await sync(otherGame, matchID, teammate);
  const voice = await connect('tabletop-voice', voiceAuth(matchID, original));
  const otherVoice = await connect(
    'tabletop-voice',
    voiceAuth(matchID, teammate),
  );

  const revoked = Promise.all([
    waitFor(game, 'seat-replaced'),
    waitFor(game, 'disconnect'),
    waitFor(voice, 'voice-seat-replaced'),
    waitFor(voice, 'disconnect'),
  ]);
  const issued = await request(path + '/seat-recovery-code', {
    playerID: original.playerID,
    credentials: original.playerCredentials,
  });
  const recovered = await request(path + '/recover-seat', {
    recoveryCode: issued.recoveryCode,
  });
  const [[gamePayload], , [voicePayload]] = await revoked;
  const expected = { matchID, playerID: original.playerID };
  assert.deepEqual(gamePayload, expected);
  assert.deepEqual(voicePayload, { ...expected, gameName: 'splendor' });
  assert.equal(game.connected, false);
  assert.equal(voice.connected, false);
  assert.equal(otherGame.connected, true);
  assert.equal(otherVoice.connected, true);
  const staleGame = await connect('splendor');
  const [unavailable] = await sync(
    staleGame,
    matchID,
    original,
    'seat-unavailable',
  );
  assert.deepEqual(unavailable, expected);
  const currentGame = await connect('splendor');
  await sync(currentGame, matchID, recovered);
  const currentVoice = await connect(
    'tabletop-voice',
    voiceAuth(matchID, recovered),
  );
  assert.equal(currentVoice.connected, true);
  await request(
    path + '/recover-seat',
    { recoveryCode: issued.recoveryCode },
    403,
  );
  console.log(
    'Splendor live recovery: old game and voice disconnected, old resync blocked, new seat joined, teammate unaffected.',
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sockets.forEach((socket) => socket.close()));
