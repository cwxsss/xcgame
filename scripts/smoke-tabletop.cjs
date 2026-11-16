const assert = require('node:assert/strict');
const { once } = require('node:events');
const { io } = require('socket.io-client');

const base = process.argv[2];
assert.ok(base, 'Pass the server URL');
const password = process.env.TABLETOP_ACCESS_PASSWORD;
assert.ok(password, 'Set TABLETOP_ACCESS_PASSWORD for the test server');

const sockets = [];
const versions = new Map();
let accessCookie;

async function request(path, body, status = 200) {
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
  assert.equal(response.status, status, path);
  if (status === 200) return response.json();
}

async function verifyAccess() {
  assert.deepEqual(await request('/access'), { allowed: false });
  await request('/games', undefined, 401);
  const blocked = io(new URL('/avalon', base).href, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    autoConnect: false,
  });
  sockets.push(blocked);
  const rejected = nextEvent(blocked, 'connect_error');
  blocked.connect();
  await rejected;
  blocked.disconnect();
  await request('/access', { password: 'incorrect-password' }, 401);
  const entry = await fetch(new URL('/access', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      password,
    }),
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(entry.status, 200);
  const cookie = entry.headers.get('set-cookie');
  assert.ok(cookie?.includes('HttpOnly'));
  if (base.startsWith('https:')) assert.ok(cookie.includes('; Secure'));
  accessCookie = cookie.split(';', 1)[0];
  assert.deepEqual(await request('/access'), { allowed: true });
}

function nextEvent(socket, event) {
  return once(socket, event, { signal: AbortSignal.timeout(8000) });
}

function recordVersion(room, state) {
  versions.set(room, Math.max(versions.get(room) ?? 0, state._stateID));
}

async function sync(player, room) {
  const result = nextEvent(player.socket, 'sync');
  player.socket.emit('sync', room, player.id, player.credentials);
  const [id, info] = await result.catch((error) => {
    throw new Error('Room sync failed for seat ' + player.id, { cause: error });
  });
  assert.equal(id, room);
  player.state = info.state;
  recordVersion(room, info.state);
  return info;
}

async function gameState(player, room) {
  const { state } = await sync(player, room);
  return state.G;
}

async function connect(game, room, seat = null) {
  const socket = io(new URL('/' + game, base).href, {
    extraHeaders: { Cookie: accessCookie },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  sockets.push(socket);
  await nextEvent(socket, 'connect');
  const player = {
    socket,
    id: seat ? String(seat.playerID) : null,
    credentials: seat?.playerCredentials,
  };
  await sync(player, room);
  socket.on('update', (id, state) => {
    if (id === room) {
      player.state = state;
      recordVersion(room, state);
    }
  });
  return player;
}

async function play(room, player, type, ...args) {
  const previousVersion = versions.get(room);
  async function receive() {
    for (;;) {
      const [id, state] = await nextEvent(player.socket, 'update');
      if (id === room && state._stateID > previousVersion) return state.G;
    }
  }
  const result = receive();
  player.socket.emit(
    'update',
    {
      type: 'MAKE_MOVE',
      payload: {
        type,
        args,
        playerID: player.id,
        credentials: player.credentials,
      },
    },
    previousVersion,
    room,
    player.id,
  );
  return result.catch((error) => {
    throw new Error(type + ' did not update player ' + player.id, {
      cause: error,
    });
  });
}

async function waitForState(player, condition) {
  if (condition(player.state.G, player.state)) return player.state.G;
  for (let attempt = 0; attempt < 30; attempt++) {
    const [, state] = await nextEvent(player.socket, 'update');
    if (condition(state.G, state)) return state.G;
  }
  throw new Error('Expected Avalon phase was not reached');
}

async function verifyVoice(matchID, players) {
  const voiceURL = new URL('/tabletop-voice', base).href;
  const voiceSockets = [];
  for (const player of players) {
    const socket = io(voiceURL, {
      extraHeaders: { Cookie: accessCookie },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      autoConnect: false,
      auth: {
        gameName: 'avalon',
        matchID,
        playerID: player.id,
        credentials: player.credentials,
      },
    });
    sockets.push(socket);
    voiceSockets.push(socket);
    const roster = nextEvent(socket, 'voice-peers');
    socket.connect();
    const [members] = await roster;
    assert.equal(members.length, voiceSockets.length - 1);
  }
  const [sender, ...receivers] = voiceSockets;
  const received = Promise.all(
    receivers.map((socket) => nextEvent(socket, 'voice-audio')),
  );
  const frame = Buffer.alloc(320, 140);
  const payload = { targets: receivers.map((socket) => socket.id), frame };
  const retry = setInterval(() => sender.emit('voice-audio', payload), 80);
  try {
    for (const [packet] of await received) {
      assert.equal(packet.from, sender.id);
      assert.deepEqual(packet.frame, frame);
    }
  } finally {
    clearInterval(retry);
  }
  const invalid = io(voiceURL, {
    extraHeaders: { Cookie: accessCookie },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    autoConnect: false,
    auth: {
      gameName: 'avalon',
      matchID,
      playerID: players[0].id,
      credentials: 'invalid',
    },
  });
  sockets.push(invalid);
  const rejected = nextEvent(invalid, 'connect_error');
  invalid.connect();
  const [connectionError] = await rejected;
  assert.match(connectionError.message, /Unauthorized/);
  voiceSockets.forEach((socket) => socket.disconnect());
}

async function roomFor(game, seats) {
  const { matchID } = await request('/games/' + game + '/create', {
    numPlayers: seats,
    unlisted: true,
  });
  const path = '/games/' + game + '/' + matchID;
  const host = await request(path + '/join', {
    playerID: '0',
    playerName: '测试房主',
  });
  const guests = await Promise.all(
    Array.from({ length: seats - 1 }, (_, index) =>
      request(path + '/join', { playerName: '测试玩家' + index }),
    ),
  );
  const claims = [host, ...guests];
  assert.equal(
    new Set(claims.map(({ playerID }) => String(playerID))).size,
    seats,
  );
  const { players: metadata } = await request(path);
  assert.ok(
    metadata.every((player) => player.name && !('credentials' in player)),
  );
  await request(path + '/join', { playerName: '额外座位' }, 409);
  await request(
    path + '/leave',
    { playerID: '0', credentials: host.playerCredentials },
    404,
  );
  const players = [];
  for (const seat of claims) players.push(await connect(game, matchID, seat));
  for (const player of players) await play(matchID, player, 'readyUp');
  return { matchID, players };
}

(async () => {
  await verifyAccess();
  const games = await request('/games');
  assert.deepEqual(games.sort(), ['avalon', 'splendor']);

  const splendor = await roomFor('splendor', 2);
  const { matchID: gemRoom, players: merchants } = splendor;
  const { actionSeconds } = await play(
    gemRoom,
    merchants[0],
    'setActionSeconds',
    45,
  );
  assert.equal(actionSeconds, 45);
  const started = await play(gemRoom, merchants[0], 'startGame');
  assert.ok(started.actionClock?.endsAt > Date.now());
  const waitingMerchant = await gameState(merchants[1], gemRoom);
  assert.equal(waitingMerchant.actionClock, null);
  assert.equal(started.started, true);
  assert.deepEqual(
    started.tiers.map((tier) => tier.length),
    [4, 4, 4],
  );
  const picked = await play(gemRoom, merchants[0], 'takeGems', [
    'white',
    'blue',
    'green',
  ]);
  assert.equal(picked.players[0].tokens.white, 1);
  assert.equal(picked.tokens.white, 3);
  assert.equal(merchants[0].state.ctx.currentPlayer, '1');
  assert.equal(picked.actionClock, null);
  const activeMerchant = await gameState(merchants[1], gemRoom);
  assert.ok(activeMerchant.actionClock?.endsAt > Date.now());

  const { matchID: gemAI } = await request('/games/splendor/create', {
    numPlayers: 2,
    unlisted: true,
  });
  const gemAIPath = '/games/splendor/' + gemAI;
  const gemHost = await request(gemAIPath + '/join', {
    playerID: '0',
    playerName: '宝石 AI 验证',
  });
  const soloMerchant = await connect('splendor', gemAI, gemHost);
  await play(gemAI, soloMerchant, 'setActionSeconds', 1);
  await request(gemAIPath + '/start-ai', { credentials: 'invalid' }, 403);
  await request(gemAIPath + '/start-ai', {
    credentials: gemHost.playerCredentials,
  });
  await request(gemAIPath + '/join', { playerName: '满座验证' }, 409);
  const gemStarted = await waitForState(soloMerchant, (G) => G.started);
  assert.deepEqual(gemStarted.bots, ['1']);
  const skippedMerchant = await waitForState(
    soloMerchant,
    (G, state) =>
      G.timeoutCounts?.['0'] === 1 && state.ctx.currentPlayer === '1',
  );
  assert.equal(skippedMerchant.afkPlayers?.includes('0'), false);
  await waitForState(soloMerchant, (G, state) => {
    const bot = G.players[1];
    return (
      state.ctx.currentPlayer === '0' &&
      (bot.cards.length > 0 ||
        bot.reservedCount ||
        Object.values(bot.tokens).some(Boolean))
    );
  });

  const replay = await roomFor('splendor', 2);
  const [replayHost, replayGuest] = replay.players;
  const replayPath = '/games/splendor/' + replay.matchID + '/rematch';
  const replaySeat = (player) => ({
    playerID: player.id,
    credentials: player.credentials,
  });
  await request(
    replayPath,
    { ...replaySeat(replayHost), credentials: 'invalid' },
    403,
  );
  await request(replayPath, replaySeat(replayHost), 409);
  await play(replay.matchID, replayHost, 'setActionSeconds', 1);
  await play(replay.matchID, replayHost, 'startGame');
  await waitForState(replayHost, (_, state) => Boolean(state.ctx.gameover));
  const [nextHost, nextGuest] = await Promise.all(
    replay.players.map((player) => request(replayPath, replaySeat(player))),
  );
  assert.notEqual(nextHost.matchID, replay.matchID);
  assert.equal(nextGuest.matchID, nextHost.matchID);
  assert.equal(nextHost.playerID, replayHost.id);
  assert.equal(nextGuest.playerID, replayGuest.id);
  assert.notEqual(nextHost.playerCredentials, replayHost.credentials);
  assert.deepEqual(await request(replayPath, replaySeat(replayHost)), nextHost);
  const nextMerchant = await connect('splendor', nextHost.matchID, nextHost);
  assert.equal(nextMerchant.state.G.started, false);
  assert.equal(nextMerchant.state.G.actionSeconds, 1);
  assert.deepEqual(nextMerchant.state.G.afkPlayers, []);
  await play(nextHost.matchID, nextMerchant, 'readyUp');
  const nextOpponent = await connect('splendor', nextGuest.matchID, nextGuest);
  await play(nextGuest.matchID, nextOpponent, 'readyUp');
  const restartedGame = await play(nextHost.matchID, nextMerchant, 'startGame');
  assert.equal(restartedGame.started, true);
  assert.ok(restartedGame.players.every((player) => player.points === 0));
  const avalon = await roomFor('avalon', 5);
  const { matchID: questRoom, players: knights } = avalon;
  await verifyVoice(questRoom, knights);
  const guest = knights[1];
  guest.socket.emit(
    'update',
    {
      type: 'MAKE_MOVE',
      payload: {
        type: 'startGame',
        args: [],
        playerID: '0',
        credentials: guest.credentials,
      },
    },
    versions.get(questRoom),
    questRoom,
    guest.id,
  );
  const waitingQuest = await gameState(guest, questRoom);
  assert.equal(waitingQuest.phase, 'waiting');
  const startedQuest = await play(questRoom, knights[0], 'startGame');
  assert.equal(startedQuest.phase, 'proposal');
  const leader = knights.find(({ id }) => id === startedQuest.leaderID);
  const spectator = await connect('avalon', questRoom);
  const config = await play(questRoom, knights[0], 'setActionSeconds', 17);
  assert.equal(config.actionSeconds, 17);
  const { actionClock: leaderClock } = await gameState(leader, questRoom);
  assert.equal(leaderClock.label, '选择远征队伍');
  assert.ok(leaderClock.endsAt > Date.now());
  const spectatorQuest = await gameState(spectator, questRoom);
  assert.equal(spectatorQuest.actionClock, null);
  assert.ok(spectator.state.G.players.every((player) => !player.role));
  for (const player of knights) {
    await sync(player, questRoom);
    assert.ok(player.state.G.players.find(({ id }) => id === player.id).role);
    assert.ok(
      player.state.G.players.every(({ id, role }) => id === player.id || !role),
    );
  }
  const goodKnight = knights.find(
    ({ id, state }) =>
      state.G.players.find((player) => player.id === id)?.alignment === 'good',
  );
  const evilKnight = knights.find(
    ({ id, state }) =>
      state.G.players.find((player) => player.id === id)?.alignment === 'evil',
  );
  const team = [goodKnight.id, evilKnight.id];
  await play(questRoom, leader, 'proposeTeam', team);
  const voterA = knights[0];
  const voterB = knights[1];
  const { actionClock: clockA } = await gameState(voterA, questRoom);
  const { actionClock: clockB } = await gameState(voterB, questRoom);
  assert.equal(clockA.label, '组队表决');
  assert.equal(clockB.label, '组队表决');
  const submitted = await play(
    questRoom,
    voterA,
    'voteTeam',
    voterA !== evilKnight,
    0,
  );
  assert.equal(submitted.actionClock, null);
  const waitingVoter = await gameState(voterB, questRoom);
  assert.deepEqual(waitingVoter.actionClock, clockB);
  for (const player of knights.slice(1)) {
    await play(questRoom, player, 'voteTeam', player !== evilKnight, 0);
  }
  const activeQuest = await gameState(knights[0], questRoom);
  assert.equal(activeQuest.phase, 'quest');
  await play(questRoom, goodKnight, 'quest', true, 1);
  const midway = await sync(spectator, questRoom);
  assert.equal(midway.state.G.questVoteCount, 1);
  assert.deepEqual(midway.state.G.questVotes, {});
  assert.equal(midway.state.G.history.length, 0);
  const lastQuest = midway.log.findLast(
    ({ action }) => action.payload.type === 'quest',
  );
  assert.equal(lastQuest.action.payload.args, null);
  const completed = await play(questRoom, evilKnight, 'quest', false, 1);
  assert.equal(completed.history[0].success, false);
  const revealed = await gameState(spectator, questRoom);
  assert.equal(revealed.history[0].successfulCards, 1);
  assert.equal(revealed.history[0].failedCards, 1);
  assert.equal(revealed.history[0].ballots, undefined);
  assert.equal(revealed.teamVotesHistory[0].votes[evilKnight.id], false);
  assert.equal(revealed.teamVotesHistory[0].votes[goodKnight.id], true);
  const nextLeader = completed.leaderID;
  await play(questRoom, knights[0], 'setActionSeconds', 1);
  const timedOut = await waitForState(
    spectator,
    (G) => G.timeoutCounts?.[nextLeader] === 1,
  );
  assert.equal(timedOut.phase, 'proposal');
  const refreshedQuest = await gameState(spectator, questRoom);
  assert.equal(refreshedQuest.timeoutCounts[nextLeader], 1);
  await request(
    '/games/avalon/create',
    {
      numPlayers: 5,
      setupData: { mode: 'all_star' },
    },
    400,
  );
  const { matchID: aiRoom } = await request('/games/avalon/create', {
    numPlayers: 5,
    unlisted: true,
    setupData: { mode: 'lancelot' },
  });
  const aiPath = '/games/avalon/' + aiRoom;
  const human = await request(aiPath + '/join', {
    playerID: '0',
    playerName: 'AI 测试房主',
  });
  const session = await connect('avalon', aiRoom, human);
  await request(aiPath + '/start-ai', { credentials: 'invalid' }, 403);
  await request(aiPath + '/start-ai', { credentials: human.playerCredentials });
  await request(aiPath + '/join', { playerName: '禁止替换 AI 座位' }, 409);
  const aiStarted = await waitForState(session, (G) =>
    ['proposal', 'voting'].includes(G.phase),
  );
  assert.equal(aiStarted.config.mode, 'lancelot');
  assert.deepEqual(aiStarted.bots, ['1', '2', '3', '4']);
  assert.equal(aiStarted.players.filter((player) => player.role).length, 1);
  if (aiStarted.phase === 'proposal' && aiStarted.leaderID === '0') {
    await play(aiRoom, session, 'proposeTeam', ['0', '1']);
  }
  const botVoted = await waitForState(
    session,
    (G) => G.phase === 'voting' && G.voteCount > 0,
  );
  assert.equal(botVoted.hasVoted, false);
  console.log(
    '游戏入口、并发入座、宝石采集、结算后再来一局、阿瓦隆秘密远征、双兰配置和 AI 开局已验证。',
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    sockets.forEach((socket) => socket.disconnect());
  });
