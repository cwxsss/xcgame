const assert = require('node:assert/strict');

const base = process.argv[2];
assert.ok(base, 'Pass the server URL, for example http://127.0.0.1:8000');
let accessCookie;

async function request(path, body, expected = 200) {
  const response = await fetch(new URL(path, base), {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          body: JSON.stringify(body),
        }),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessCookie ? { Cookie: accessCookie } : {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(response.status, expected, path);
  if (expected !== 200) return;
  return response.json();
}

async function enterAccessGate() {
  const password = process.env.TABLETOP_ACCESS_PASSWORD;
  if (!password) return;
  const response = await fetch(new URL('/access', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(response.status, 200, '/access');
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'Access gate did not set a cookie');
  accessCookie = cookie.split(';', 1)[0];
}

(async () => {
  await enterAccessGate();
  const { matchID } = await request('/games/avalon/create', {
    numPlayers: 5,
    unlisted: true,
  });
  const path = `/games/avalon/${matchID}`;
  const host = await request(path + '/join', {
    playerID: '0',
    playerName: '座位测试房主',
  });
  const guest = await request(path + '/join', {
    playerID: '3',
    playerName: '座位测试玩家',
  });

  let room = await request(path);
  assert.equal(room.seatingOpen, true);
  assert.equal(
    room.players.find((player) => player.id === 3).name,
    '座位测试玩家',
  );
  assert.equal('credentials' in room.players[3], false);

  const moved = await request(path + '/seat', {
    playerID: guest.playerID,
    credentials: guest.playerCredentials,
    targetID: '2',
  });
  assert.equal(moved.playerID, '2');
  assert.notEqual(moved.playerCredentials, guest.playerCredentials);

  room = await request(path);
  assert.equal(
    room.players.find((player) => player.id === 2).name,
    '座位测试玩家',
  );
  assert.equal(room.players.find((player) => player.id === 3).name, undefined);

  await request(
    path + '/seat',
    {
      playerID: guest.playerID,
      credentials: guest.playerCredentials,
      targetID: '1',
    },
    403,
  );
  await request(
    path + '/seat',
    {
      playerID: host.playerID,
      credentials: host.playerCredentials,
      targetID: '1',
    },
    409,
  );

  assert.deepEqual(
    await request(path + '/seat', {
      playerID: moved.playerID,
      credentials: moved.playerCredentials,
      targetID: null,
    }),
    { ok: true },
  );
  room = await request(path);
  assert.equal(room.players.find((player) => player.id === 2).name, undefined);
  assert.equal(room.seatingOpen, true);
  console.log('Avalon seating API checks passed:', matchID);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
