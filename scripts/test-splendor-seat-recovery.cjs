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
  if (expected !== 200) return null;
  return response.json();
}

async function enterAccessGate() {
  const response = await fetch(new URL('/access', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.TABLETOP_ACCESS_PASSWORD }),
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(response.status, 200, '/access');
  accessCookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(accessCookie, 'Access gate did not set a cookie');
}

(async () => {
  await enterAccessGate();
  const { matchID } = await request('/games/splendor/create', {
    numPlayers: 2,
    unlisted: true,
  });
  const path = `/games/splendor/${matchID}`;
  const original = await request(path + '/join', {
    playerID: '0',
    playerName: '回座测试玩家',
  });
  const issued = await request(path + '/seat-recovery-code', {
    playerID: original.playerID,
    credentials: original.playerCredentials,
  });
  assert.match(issued.recoveryCode, /^[A-F0-9]{10}$/);
  const room = await request(path);
  assert.equal('seatRecovery' in room, false);
  assert.equal('_seatRecovery' in room, false);

  const recovered = await request(path + '/recover-seat', {
    recoveryCode: issued.recoveryCode,
  });
  assert.equal(recovered.playerID, original.playerID);
  assert.notEqual(recovered.playerCredentials, original.playerCredentials);
  await request(
    path + '/recover-seat',
    { recoveryCode: issued.recoveryCode },
    403,
  );
  await request(
    path + '/seat-recovery-code',
    { playerID: original.playerID, credentials: original.playerCredentials },
    403,
  );
  console.log('Splendor seat recovery API checks passed:', matchID);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
