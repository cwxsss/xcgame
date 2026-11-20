import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { bodyParser } from '@koa/bodyparser';
import { INVALID_MOVE } from 'boardgame.io/core';
import { createMatch } from 'boardgame.io/internal';
import { Master } from 'boardgame.io/master';
import { Origins, Server, SocketIO } from 'boardgame.io/server';
import { Avalon } from './src/tabletop/avalon';
import { chooseAvalonBotMove } from './src/tabletop/avalon-bots';
import { Splendor } from './src/tabletop/splendor';
import { chooseSplendorBotMove } from './src/tabletop/splendor-bots';
import { registerTabletopVoice } from './tabletop-voice';
import { registerTabletopAccess } from './tabletop-access';
import { replayMatchID } from './tabletop-rematch';
import {
  consumeSeatRecovery,
  issueSeatRecovery,
} from './tabletop-seat-recovery';

const isWaiting = (gameName, G) =>
  gameName === 'avalon' ? G.phase === 'waiting' : !G.started;

function fillBots(gameName) {
  return {
    client: false,
    move({ G, playerID }, seats) {
      if (
        !isWaiting(gameName, G) ||
        playerID !== '0' ||
        G.bots?.length ||
        !Array.isArray(seats) ||
        !seats.length ||
        new Set(seats).size !== seats.length ||
        seats.some(
          (id) => id === '0' || !G.players.some((player) => player.id === id),
        )
      ) {
        return INVALID_MOVE;
      }
      G.bots = seats;
      G.ready[0] = true;
      for (const seat of seats) G.ready[Number(seat)] = true;
      if (gameName === 'avalon')
        G.message = 'AI 已补齐空位。真人都准备后自动开局。';
    },
  };
}

const games = [
  {
    ...Splendor,
    phases: {
      ...Splendor.phases,
      lobby: {
        ...Splendor.phases.lobby,
        moves: {
          ...Splendor.phases.lobby.moves,
          fillBots: fillBots('splendor'),
        },
      },
    },
  },
  {
    ...Avalon,
    moves: {
      ...Avalon.moves,
      fillBots: fillBots('avalon'),
      syncSeats: {
        client: false,
        noLimit: true,
        ignoreStaleStateID: true,
        move({ G, playerID }, seats) {
          if (
            String(playerID) !== '0' ||
            G.phase !== 'waiting' ||
            !Array.isArray(seats) ||
            seats.some((id) => !/^\d+$/.test(String(id)))
          )
            return INVALID_MOVE;
          const ready = [...G.ready];
          for (const id of seats) ready[Number(id)] = false;
          return { ...G, ready };
        },
      },
    },
  },
];

const roomCode = /^[A-Za-z0-9_-]{1,80}$/;
const roomTimers = new Map();
// Recovery codes are short-lived secrets. Keep only their digests in this
// process so boardgame.io's public socket metadata can never expose them.
const seatRecoveryRecords = new Map();

function activeSeatRecoveryRecords(matchID, now = Date.now()) {
  const records = seatRecoveryRecords.get(matchID);
  if (!records) return {};
  const active = Object.fromEntries(
    Object.entries(records).filter(([, record]) => record?.expiresAt > now),
  );
  if (Object.keys(active).length) seatRecoveryRecords.set(matchID, active);
  else seatRecoveryRecords.delete(matchID);
  return active;
}

setInterval(() => {
  const now = Date.now();
  for (const matchID of seatRecoveryRecords.keys()) {
    activeSeatRecoveryRecords(matchID, now);
  }
}, 60_000).unref();

function runGameMove(gameName, matchID, state, { playerID, name, args = [] }) {
  const master = new Master(
    games.find(({ name }) => name === gameName),
    server.db,
    server.transport.createTransportAPI(matchID),
  );
  return master.onUpdate(
    {
      type: 'MAKE_MOVE',
      payload: { type: name, args, playerID },
    },
    state._stateID,
    matchID,
    playerID,
  );
}

function botMove(gameName, state) {
  const { G } = state;
  if (!G.bots?.length || state.ctx.gameover) return null;
  if (isWaiting(gameName, G) && G.ready.every(Boolean))
    return { playerID: '0', name: 'startGame' };
  if (gameName === 'splendor') return chooseSplendorBotMove(state);
  return chooseAvalonBotMove(G, (playerID) =>
    Avalon.playerView({ G, ctx: state.ctx, playerID }),
  );
}

function nextDeadline(gameName, G) {
  const legacySplendor = gameName === 'splendor' && G.afkPlayers == null;
  const clocks = G.actionClocks;
  return Math.min(
    ...Object.entries(clocks?.deadlines ?? {})
      .filter(([id]) => legacySplendor || !clocks.marked?.includes(id))
      .map(([, deadline]) => deadline),
  );
}

function scheduleRoom(gameName, matchID, delay = 400) {
  const due = Date.now() + delay;
  const previous = roomTimers.get(matchID);
  if (previous?.due <= due) return;
  if (previous) clearTimeout(previous.timer);
  const timer = setTimeout(async () => {
    roomTimers.delete(matchID);
    try {
      await server.transport.getMatchQueue(matchID).add(async () => {
        let { state } = await server.db.fetch(matchID, { state: true });
        if (!state || state.ctx.gameover) return;
        const move =
          nextDeadline(gameName, state.G) <= Date.now()
            ? {
                playerID:
                  gameName === 'splendor' ? state.ctx.currentPlayer : '0',
                name: 'markActionTimeouts',
              }
            : botMove(gameName, state);
        if (move) {
          const before = state._stateID;
          await runGameMove(gameName, matchID, state, move);
          ({ state } = await server.db.fetch(matchID, { state: true }));
          if (!state || state.ctx.gameover || state._stateID <= before) return;
        }
        const delay = Math.min(
          nextDeadline(gameName, state.G) - Date.now(),
          botMove(gameName, state) ? 400 : Infinity,
        );
        if (Number.isFinite(delay))
          scheduleRoom(gameName, matchID, Math.max(1, delay));
      });
    } catch (error) {
      console.error('Could not advance game room:', error);
    }
  }, delay);
  roomTimers.set(matchID, { timer, due });
}

class TabletopTransport extends SocketIO {
  deleteMatchQueue(matchID) {
    const queue = this.perMatchQueue.get(matchID);
    if (!queue) return;
    void queue.onIdle().then(() => {
      if (
        this.perMatchQueue.get(matchID) === queue &&
        !this.roomInfo.has(matchID) &&
        !queue.pending &&
        !queue.size
      ) {
        super.deleteMatchQueue(matchID);
      }
    });
  }

  init(app, registeredGames, origins) {
    super.init(app, registeredGames, origins);
    for (const game of registeredGames) {
      this.io.of('/' + game.name).use((socket, next) => {
        socket.use(async ([event, ...args], accept) => {
          if (event !== 'sync' && event !== 'update') return;
          const matchID = event === 'sync' ? args[0] : args[2];
          if (typeof matchID !== 'string' || !roomCode.test(matchID)) return;
          if (
            event === 'update' &&
            (args[0]?.type !== 'MAKE_MOVE' ||
              ['fillBots', 'markActionTimeouts', 'syncSeats'].includes(
                args[0].payload?.type,
              ) ||
              typeof args[3] !== 'string' ||
              args[0].payload?.playerID !== args[3])
          )
            return;
          try {
            const { metadata } = await app.context.db.fetch(matchID, {
              metadata: true,
            });
            if (metadata?.gameName === game.name) {
              accept();
              scheduleRoom(game.name, matchID);
            }
          } catch (error) {
            console.error('Could not load room:', error);
          }
        });
        next();
      });
    }
  }
}

const server = Server({
  games,
  transport: new TabletopTransport({ notifyInvalidSeat: true }),
  origins: process.env.BOARDGAME_ORIGIN
    ? [process.env.BOARDGAME_ORIGIN]
    : [Origins.LOCALHOST],
  authenticateCredentials: (credentials, seat) =>
    Boolean(
      credentials && seat?.credentials && credentials === seat.credentials,
    ),
});
const tabletopVoiceService = registerTabletopVoice(server.transport.io, server.db);
registerTabletopAccess(server);
const webRoot = resolve(
  process.env.BOARDGAME_WEB_ROOT || resolve(__dirname, 'dist/tabletop'),
);
const matchPath =
  /^\/games\/(splendor|avalon)\/([A-Za-z0-9_-]{1,80})(?:\/([^/]+))?$/;
const listPath = /^\/games(?:\/(splendor|avalon))?$/;
const parseRoomRequest = bodyParser({
  enableTypes: ['json'],
  jsonLimit: '2kb',
});

async function rematch(ctx, matchID) {
  const { metadata, state } = await server.db.fetch(matchID, {
    metadata: true,
    state: true,
  });
  if (metadata?.gameName !== 'splendor' || !state) ctx.throw(404);
  const { playerID, credentials } = ctx.request.body ?? {};
  if (
    typeof playerID !== 'string' ||
    !/^[0-3]$/.test(playerID) ||
    !(await server.auth.authenticateCredentials({
      playerID,
      credentials,
      metadata,
    }))
  ) {
    ctx.throw(403);
  }
  if (!state.ctx.gameover) ctx.throw(409);

  const nextMatchID = replayMatchID(matchID);
  let { metadata: nextMatch } = await server.db.fetch(nextMatchID, {
    metadata: true,
  });
  if (!nextMatch) {
    const { metadata: nextMetadata, initialState } = createMatch({
      game: games.find(({ name }) => name === 'splendor'),
      numPlayers: state.ctx.numPlayers,
      unlisted: true,
    });
    for (const [id, seat] of Object.entries(metadata.players)) {
      if (seat.credentials) {
        nextMetadata.players[id] = {
          ...nextMetadata.players[id],
          name: seat.name,
          credentials: randomUUID(),
        };
      }
    }
    const bots = state.G.bots ?? [];
    initialState.G = {
      ...initialState.G,
      actionSeconds: state.G.actionSeconds ?? 60,
      bots,
      ready: initialState.G.ready.map((_, index) =>
        bots.includes(String(index)),
      ),
    };
    await server.db.createMatch(nextMatchID, {
      metadata: nextMetadata,
      initialState,
    });
    nextMatch = nextMetadata;
  }

  const seat = nextMatch.players[playerID];
  if (!seat?.credentials) ctx.throw(403);
  ctx.body = {
    matchID: nextMatchID,
    playerID,
    playerCredentials: seat.credentials,
  };
}

const publicMatchData = (matchID, metadata, state) => ({
  ...metadata,
  matchID,
  seatingOpen:
    metadata.gameName === 'avalon' &&
    state?.G?.phase === 'waiting' &&
    !state.G.bots?.length,
  players: Object.values(metadata.players).map((player) => {
    const { credentials, ...publicPlayer } = player;
    return publicPlayer;
  }),
});

function clearSeatMetadata(seat) {
  const cleared = { ...seat };
  delete cleared.name;
  delete cleared.credentials;
  delete cleared.isConnected;
  delete cleared.data;
  return cleared;
}

async function seatAvalon(ctx, matchID) {
  const { playerID, credentials, targetID } = ctx.request.body ?? {};
  if (
    typeof playerID !== 'string' ||
    !/^\d+$/.test(playerID) ||
    (credentials !== undefined && typeof credentials !== 'string') ||
    !(targetID === null || typeof targetID === 'string') ||
    (typeof targetID === 'string' && !/^\d+$/.test(targetID))
  )
    ctx.throw(400, 'playerID, credentials and targetID are invalid');

  const { metadata, state } = await server.db.fetch(matchID, {
    metadata: true,
    state: true,
  });
  if (metadata?.gameName !== 'avalon' || !state) ctx.throw(404);
  if (!isWaiting('avalon', state.G) || state.G.bots?.length)
    ctx.throw(409, '游戏已经开始，不能调整座位');

  const current = metadata.players[playerID];
  if (!current) ctx.throw(404, 'Player ' + playerID + ' not found');
  if (
    !(await server.auth.authenticateCredentials({
      playerID,
      credentials,
      metadata,
    }))
  )
    ctx.throw(403, 'Invalid credentials');

  // Seat 0 remains the room owner. startGame, AI fill and the lobby controls
  // intentionally use this stable identity for host-only operations.
  if (playerID === '0' && targetID !== '0') ctx.throw(409, '房主固定在1号位');
  if (targetID === playerID) {
    ctx.body = { playerID, playerCredentials: credentials };
    return;
  }

  const touchedSeats = [playerID];
  const nextMetadata = {
    ...metadata,
    players: { ...metadata.players },
  };
  let result;
  if (targetID === null) {
    nextMetadata.players[playerID] = clearSeatMetadata(current);
  } else {
    const target = metadata.players[targetID];
    if (!target) ctx.throw(404, 'Player ' + targetID + ' not found');
    if (target.name || target.credentials) ctx.throw(409, '目标座位已被占用');
    touchedSeats.push(targetID);
    const playerCredentials = await server.auth.generateCredentials(ctx);
    const moved = {
      ...target,
      name: current.name,
      credentials: playerCredentials,
    };
    if (current.data !== undefined) moved.data = current.data;
    delete moved.isConnected;
    nextMetadata.players[playerID] = clearSeatMetadata(current);
    nextMetadata.players[targetID] = moved;
    result = { playerID: targetID, playerCredentials };
  }

  try {
    await server.db.setMetadata(matchID, nextMetadata);
    const moveResult = await runGameMove('avalon', matchID, state, {
      playerID: '0',
      name: 'syncSeats',
      args: [touchedSeats],
    });
    if (moveResult?.error) throw new Error(moveResult.error);
  } catch (error) {
    await server.db.setMetadata(matchID, metadata);
    throw error;
  }
  const { metadata: updatedMetadata, state: updatedState } =
    await server.db.fetch(matchID, { metadata: true, state: true });
  server.transport.createTransportAPI(matchID).sendAll({
    type: 'matchData',
    args: [
      matchID,
      publicMatchData(matchID, updatedMetadata ?? nextMetadata, updatedState)
        .players,
    ],
  });
  ctx.body = result ?? { ok: true };
}

async function createSplendorSeatRecovery(ctx, matchID) {
  const { playerID, credentials } = ctx.request.body ?? {};
  if (
    typeof playerID !== 'string' ||
    !/^\d+$/.test(playerID) ||
    typeof credentials !== 'string' ||
    credentials.length > 256
  )
    ctx.throw(400, 'playerID and credentials are invalid');

  const { metadata, state } = await server.db.fetch(matchID, {
    metadata: true,
    state: true,
  });
  if (metadata?.gameName !== 'splendor' || !state) ctx.throw(404);
  const player = metadata.players[playerID];
  if (
    !player?.name ||
    !(await server.auth.authenticateCredentials({
      playerID,
      credentials,
      metadata,
    }))
  )
    ctx.throw(403, 'Invalid credentials');

  const issued = issueSeatRecovery(
    { ...metadata, _seatRecovery: activeSeatRecoveryRecords(matchID) },
    playerID,
    credentials,
  );
  if (!issued) ctx.throw(500, '无法生成回座码');
  seatRecoveryRecords.set(matchID, issued.metadata._seatRecovery);
  ctx.body = {
    playerID,
    recoveryCode: issued.recoveryCode,
    expiresAt: issued.expiresAt,
  };
}

async function recoverSplendorSeat(ctx, matchID) {
  const { recoveryCode } = ctx.request.body ?? {};
  if (typeof recoveryCode !== 'string' || recoveryCode.length > 64)
    ctx.throw(400, 'recoveryCode is invalid');
  const { metadata, state } = await server.db.fetch(matchID, {
    metadata: true,
    state: true,
  });
  if (metadata?.gameName !== 'splendor' || !state) ctx.throw(404);
  const playerCredentials = await server.auth.generateCredentials(ctx);
  const consumed = consumeSeatRecovery(
    { ...metadata, _seatRecovery: activeSeatRecoveryRecords(matchID) },
    recoveryCode,
    playerCredentials,
  );
  if (!consumed) ctx.throw(403, '回座码无效或已过期');
  const previousCredentials = metadata.players?.[consumed.playerID]?.credentials;
  const { _seatRecovery, ...nextMetadata } = consumed.metadata;
  await server.db.setMetadata(matchID, nextMetadata);
  if (typeof previousCredentials === 'string') {
    server.transport.revokePlayer(matchID, consumed.playerID, previousCredentials);
    tabletopVoiceService.disconnectPlayer(
      'splendor',
      matchID,
      consumed.playerID,
      previousCredentials,
    );
  }
  if (Object.keys(_seatRecovery).length) seatRecoveryRecords.set(matchID, _seatRecovery);
  else seatRecoveryRecords.delete(matchID);
  const updated = await server.db.fetch(matchID, {
    metadata: true,
    state: true,
  });
  server.transport.createTransportAPI(matchID).sendAll({
    type: 'matchData',
    args: [
      matchID,
      publicMatchData(matchID, updated.metadata ?? nextMetadata, updated.state)
        .players,
    ],
  });
  ctx.body = {
    playerID: consumed.playerID,
    playerCredentials,
  };
}

server.app.use(async (ctx, next) => {
  let pathname;
  try {
    pathname = decodeURIComponent(ctx.path);
  } catch {
    ctx.throw(400);
  }
  if (pathname.includes('\0')) ctx.throw(400);

  if (/^\/games(?:\/|$)/i.test(pathname)) {
    ctx.set('Cache-Control', 'no-store');
    if (pathname !== ctx.path) ctx.throw(404);
    if (ctx.method === 'GET' && listPath.test(pathname)) return next();

    const route = matchPath.exec(pathname);
    if (!route) ctx.throw(404);
    const [, gameName, matchID, action] = route;
    if (ctx.method === 'POST' && matchID === 'create' && !action) return next();

    async function handleRoom() {
      const { metadata, state } = await server.db.fetch(matchID, {
        metadata: true,
        state: action === 'join' || (ctx.method === 'GET' && !action),
      });
      if (metadata?.gameName !== gameName) ctx.throw(404);
      if (action === 'join' && state?.G.bots?.length) ctx.throw(409);
      if (
        action === 'join' &&
        gameName === 'avalon' &&
        !isWaiting(gameName, state?.G)
      )
        ctx.throw(409, '游戏已经开始，不能加入');
      await next();
    }

    // The game owns seat readiness and secret information for the entire match.
    // Keeping an occupied seat bound to its credentials also enables reconnects.
    if (ctx.method === 'POST' && action === 'join') {
      return server.transport.getMatchQueue(matchID).add(handleRoom);
    }
    if (ctx.method === 'POST' && gameName === 'avalon' && action === 'seat') {
      return parseRoomRequest(ctx, () =>
        server.transport
          .getMatchQueue(matchID)
          .add(() => seatAvalon(ctx, matchID)),
      );
    }
    if (
      ctx.method === 'POST' &&
      gameName === 'splendor' &&
      action === 'seat-recovery-code'
    ) {
      return parseRoomRequest(ctx, () =>
        server.transport
          .getMatchQueue(matchID)
          .add(() => createSplendorSeatRecovery(ctx, matchID)),
      );
    }
    if (
      ctx.method === 'POST' &&
      gameName === 'splendor' &&
      action === 'recover-seat'
    ) {
      return parseRoomRequest(ctx, () =>
        server.transport
          .getMatchQueue(matchID)
          .add(() => recoverSplendorSeat(ctx, matchID)),
      );
    }
    if (
      ctx.method === 'POST' &&
      gameName === 'splendor' &&
      action === 'rematch'
    ) {
      return parseRoomRequest(ctx, () =>
        server.transport
          .getMatchQueue(matchID)
          .add(() => rematch(ctx, matchID)),
      );
    }
    if (ctx.method === 'POST' && action === 'start-ai') {
      return parseRoomRequest(ctx, () =>
        server.transport.getMatchQueue(matchID).add(async () => {
          const { metadata, state } = await server.db.fetch(matchID, {
            metadata: true,
            state: true,
          });
          if (metadata?.gameName !== gameName || !state) ctx.throw(404);
          const playerID = '0';
          const credentials = ctx.request.body?.credentials;
          if (
            !(await server.auth.authenticateCredentials({
              playerID,
              credentials,
              metadata,
            }))
          )
            ctx.throw(403);
          if (!isWaiting(gameName, state.G)) ctx.throw(409);
          if (!state.G.bots?.length) {
            const empty = Object.values(metadata.players)
              .filter((seat) => !seat.credentials)
              .map((seat) => String(seat.id));
            if (!empty.length) ctx.throw(409);
            await runGameMove(gameName, matchID, state, {
              playerID,
              name: 'fillBots',
              args: [empty],
            });
            const { state: updated } = await server.db.fetch(matchID, {
              state: true,
            });
            if (updated?.G.bots?.length !== empty.length) ctx.throw(409);
          }
          scheduleRoom(gameName, matchID);
          ctx.body = { ok: true };
        }),
      );
    }
    if (ctx.method === 'GET' && !action) {
      const { metadata, state } = await server.db.fetch(matchID, {
        metadata: true,
        state: true,
      });
      if (metadata?.gameName !== gameName) ctx.throw(404);
      ctx.body = publicMatchData(matchID, metadata, state);
      return;
    }
    ctx.throw(404);
  }

  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return next();
  const file = resolve(
    webRoot,
    '.' + (pathname === '/' ? '/index.html' : pathname),
  );
  if (!file.startsWith(webRoot + sep)) return next();
  const info = await stat(file).catch((error) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  if (!info?.isFile()) return next();
  ctx.type = extname(file) || 'application/octet-stream';
  ctx.length = info.size;
  ctx.set(
    'Cache-Control',
    basename(file) === 'index.html' ? 'no-cache' : 'public, max-age=86400',
  );
  if (ctx.method === 'GET') ctx.body = createReadStream(file);
  else ctx.status = 200;
});

server
  .run({
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 8000),
  })
  .then(async () => {
    const matches = await server.db.listMatches({
      gameName: 'splendor',
      where: { isGameover: false },
    });
    for (const matchID of matches) {
      const { state } = await server.db.fetch(matchID, { state: true });
      if (state?.G.started && state.G.afkPlayers != null) {
        scheduleRoom('splendor', matchID);
      }
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
