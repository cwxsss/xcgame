import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { bodyParser } from '@koa/bodyparser';
import { INVALID_MOVE } from 'boardgame.io/core';
import { Master } from 'boardgame.io/master';
import { Origins, Server, SocketIO } from 'boardgame.io/server';
import { Avalon } from './src/tabletop/avalon';
import { chooseAvalonBotMove } from './src/tabletop/avalon-bots';
import { Splendor } from './src/tabletop/splendor';
import { chooseSplendorBotMove } from './src/tabletop/splendor-bots';
import { registerTabletopVoice } from './tabletop-voice';
import { registerTabletopAccess } from './tabletop-access';

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
  { ...Avalon, moves: { ...Avalon.moves, fillBots: fillBots('avalon') } },
];

const roomCode = /^[A-Za-z0-9_-]{1,80}$/;
const roomTimers = new Map();

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

function nextDeadline(G) {
  const clocks = G.actionClocks;
  return Math.min(
    ...Object.entries(clocks?.deadlines ?? {})
      .filter(([id]) => !clocks.marked?.includes(id))
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
          nextDeadline(state.G) <= Date.now()
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
          nextDeadline(state.G) - Date.now(),
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
              ['fillBots', 'markActionTimeouts'].includes(
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
  transport: new TabletopTransport(),
  origins: process.env.BOARDGAME_ORIGIN
    ? [process.env.BOARDGAME_ORIGIN]
    : [Origins.LOCALHOST],
  authenticateCredentials: (credentials, seat) =>
    Boolean(
      credentials && seat?.credentials && credentials === seat.credentials,
    ),
});
registerTabletopVoice(server.transport.io, server.db);
registerTabletopAccess(server);
const webRoot = resolve(
  process.env.BOARDGAME_WEB_ROOT || resolve(__dirname, 'dist/tabletop'),
);
const matchPath =
  /^\/games\/(splendor|avalon)\/([A-Za-z0-9_-]{1,80})(?:\/([^/]+))?$/;
const listPath = /^\/games(?:\/(splendor|avalon))?$/;
const parseAIRequest = bodyParser({ enableTypes: ['json'], jsonLimit: '2kb' });

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
        state: action === 'join',
      });
      if (metadata?.gameName !== gameName) ctx.throw(404);
      if (action === 'join' && state?.G.bots?.length) ctx.throw(409);
      await next();
    }

    // The game owns seat readiness and secret information for the entire match.
    // Keeping an occupied seat bound to its credentials also enables reconnects.
    if (ctx.method === 'POST' && action === 'join') {
      return server.transport.getMatchQueue(matchID).add(handleRoom);
    }
    if (ctx.method === 'POST' && action === 'start-ai') {
      return parseAIRequest(ctx, () =>
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
    if (ctx.method === 'GET' && !action) return handleRoom();
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
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
