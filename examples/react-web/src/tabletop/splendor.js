import { ActivePlayers, INVALID_MOVE, TurnOrder } from 'boardgame.io/core';
import { COLORS, RESOURCES, DECKS, NOBLES } from './splendor-data';
import {
  actionClockView,
  setActionSeconds,
  updateClocks,
} from './action-clock';

const tokens = (count = 0) => ({
  ...Object.fromEntries(COLORS.map((color) => [color, count])),
  gold: 0,
});

export const totalTokens = (pouch) =>
  RESOURCES.reduce((sum, color) => sum + pouch[color], 0);

export function paymentFor(player, card) {
  const payment = tokens();
  for (const color of COLORS) {
    const cost = Math.max(
      0,
      (card.requirements[color] ?? 0) - player.bonuses[color],
    );
    payment[color] = Math.min(cost, player.tokens[color]);
    payment.gold += cost - payment[color];
  }
  return payment.gold <= player.tokens.gold ? payment : null;
}

export const eligibleNobles = (player, nobles) =>
  nobles.filter((noble) =>
    COLORS.every(
      (color) => player.bonuses[color] >= (noble.requirements[color] ?? 0),
    ),
  );

function initialState({ ctx }) {
  const count = ctx.numPlayers;
  return {
    started: false,
    ready: Array(count).fill(false),
    tokens: { ...tokens({ 2: 4, 3: 5, 4: 7 }[count]), gold: 5 },
    decks: [[], [], []],
    tiers: [[], [], []],
    nobles: [],
    players: Array.from({ length: count }, (_, index) => ({
      id: String(index),
      points: 0,
      tokens: tokens(),
      bonuses: tokens(),
      cards: [],
      reserved: [],
      nobles: [],
    })),
    pending: null,
    finalRound: false,
    finished: false,
    actionSeconds: 60,
  };
}

function updateSplendorActionClocks({ G, ctx }) {
  const finished = G.finished === true;
  const label =
    G.pending === 'return'
      ? '归还宝石'
      : G.pending === 'noble'
        ? '选择贵族'
        : '回合操作';
  const playerID = ctx.currentPlayer;
  return updateClocks(G, {
    label: finished ? null : label,
    seats: finished || playerID == null ? [] : [playerID],
    key: [ctx.turn, playerID, G.pending ?? 'action', finished].join(':'),
  });
}

function removeMarketCard(G, tier, index) {
  const [card] = G.tiers[tier - 1].splice(index, 1);
  const replacement = G.decks[tier - 1].pop();
  if (replacement) G.tiers[tier - 1].splice(index, 0, replacement);
  return card;
}

function receiveNoble(G, player, noble) {
  G.nobles.splice(
    G.nobles.findIndex(({ id }) => id === noble.id),
    1,
  );
  player.nobles.push(noble);
  player.points += noble.points;
}

function finishTurn({ G, ctx, events, playerID }) {
  G.pending = null;
  const player = G.players[Number(playerID)];
  if (player.points >= 15) G.finalRound = true;
  if (G.finalRound && playerID === ctx.playOrder.at(-1)) {
    G.finished = true;
  } else {
    events.endTurn();
  }
}

function finishAction(context) {
  const { G, playerID } = context;
  const player = G.players[Number(playerID)];
  if (totalTokens(player.tokens) > 10) {
    G.pending = 'return';
    return;
  }
  const nobles = eligibleNobles(player, G.nobles);
  if (nobles.length > 1) {
    G.pending = 'noble';
    return;
  }
  if (nobles.length === 1) receiveNoble(G, player, nobles[0]);
  finishTurn(context);
}

const readyUp = {
  client: false,
  ignoreStaleStateID: true,
  move({ G, playerID }) {
    if (!G.players[Number(playerID)] || G.ready[Number(playerID)])
      return INVALID_MOVE;
    G.ready[Number(playerID)] = true;
  },
};

const startGame = {
  client: false,
  move({ G, playerID, random, events }) {
    if (playerID !== '0' || !G.ready.every(Boolean)) return INVALID_MOVE;
    G.started = true;
    G.decks = DECKS.map((deck) => random.Shuffle(deck));
    G.tiers = G.decks.map((deck) => deck.splice(0, 4));
    G.nobles = random.Shuffle(NOBLES).slice(0, G.players.length + 1);
    events.endPhase();
  },
};

const playMoves = {
  takeGems(context, chosen) {
    const { G, playerID } = context;
    if (
      G.pending ||
      !Array.isArray(chosen) ||
      !chosen.length ||
      chosen.length > 3 ||
      chosen.some((color) => !COLORS.includes(color))
    )
      return INVALID_MOVE;
    const unique = [...new Set(chosen)];
    const available = COLORS.filter((color) => G.tokens[color] > 0).length;
    const singleColor = chosen.length === 2 && unique.length === 1;
    const distinct =
      chosen.length === unique.length &&
      chosen.length === Math.min(available, 3);
    if (!distinct && !singleColor) return INVALID_MOVE;
    if (unique.some((color) => G.tokens[color] < (singleColor ? 4 : 1)))
      return INVALID_MOVE;
    const player = G.players[Number(playerID)];
    for (const color of chosen) {
      G.tokens[color]--;
      player.tokens[color]++;
    }
    finishAction(context);
  },

  returnGems(context, chosen) {
    const { G, playerID } = context;
    const player = G.players[Number(playerID)];
    if (
      G.pending !== 'return' ||
      !Array.isArray(chosen) ||
      chosen.length !== totalTokens(player.tokens) - 10 ||
      chosen.some((color) => !RESOURCES.includes(color))
    )
      return INVALID_MOVE;
    const returned = tokens();
    for (const color of chosen) returned[color]++;
    if (RESOURCES.some((color) => returned[color] > player.tokens[color]))
      return INVALID_MOVE;
    for (const color of RESOURCES) {
      player.tokens[color] -= returned[color];
      G.tokens[color] += returned[color];
    }
    finishAction(context);
  },

  reserveCard(context, tier, index) {
    const { G, playerID } = context;
    if (
      G.pending ||
      !Number.isInteger(tier) ||
      !G.decks[tier - 1] ||
      !Number.isInteger(index) ||
      index < -1
    )
      return INVALID_MOVE;
    const player = G.players[Number(playerID)];
    if (player.reserved.length >= 3) return INVALID_MOVE;
    if (index === -1 ? !G.decks[tier - 1].length : !G.tiers[tier - 1][index])
      return INVALID_MOVE;
    const card =
      index === -1 ? G.decks[tier - 1].pop() : removeMarketCard(G, tier, index);
    player.reserved.push(card);
    if (G.tokens.gold > 0) {
      G.tokens.gold--;
      player.tokens.gold++;
    }
    finishAction(context);
  },

  buyCard(context, source, tier, index) {
    const { G, playerID } = context;
    if (G.pending || !Number.isInteger(index) || index < 0) return INVALID_MOVE;
    const player = G.players[Number(playerID)];
    const card =
      source === 'market' && Number.isInteger(tier)
        ? G.tiers[tier - 1]?.[index]
        : source === 'reserved'
          ? player.reserved[index]
          : null;
    if (!card) return INVALID_MOVE;
    const payment = paymentFor(player, card);
    if (!payment) return INVALID_MOVE;
    for (const color of RESOURCES) {
      player.tokens[color] -= payment[color];
      G.tokens[color] += payment[color];
    }
    player.points += card.points;
    player.bonuses[card.color]++;
    player.cards.push(card);
    if (source === 'reserved') player.reserved.splice(index, 1);
    else removeMarketCard(G, tier, index);
    finishAction(context);
  },

  claimNoble(context, index) {
    const { G, playerID } = context;
    const player = G.players[Number(playerID)];
    const noble = G.nobles[index];
    if (
      G.pending !== 'noble' ||
      !Number.isInteger(index) ||
      !noble ||
      !eligibleNobles(player, [noble]).length
    )
      return INVALID_MOVE;
    receiveNoble(G, player, noble);
    finishTurn(context);
  },

  passTurn(context) {
    const { G, playerID } = context;
    const player = G.players[Number(playerID)];
    if (
      G.pending ||
      COLORS.some((color) => G.tokens[color] > 0) ||
      (player.reserved.length < 3 &&
        (G.decks.some((deck) => deck.length) ||
          G.tiers.some((tier) => tier.length))) ||
      [...G.tiers.flat(), ...player.reserved].some((card) =>
        paymentFor(player, card),
      )
    )
      return INVALID_MOVE;
    finishAction(context);
  },
};

export const Splendor = {
  name: 'splendor',
  minPlayers: 2,
  maxPlayers: 4,
  disableUndo: true,
  setup: initialState,
  phases: {
    lobby: {
      start: true,
      next: 'play',
      turn: { activePlayers: ActivePlayers.ALL },
      moves: { readyUp, startGame, setActionSeconds },
    },
    play: {
      turn: {
        order: TurnOrder.RESET,
        onBegin: updateSplendorActionClocks,
        onMove: updateSplendorActionClocks,
      },
      moves: {
        ...Object.fromEntries(
          Object.entries(playMoves).map(([name, move]) => [
            name,
            { move, client: false },
          ]),
        ),
        markActionTimeouts: {
          client: false,
          noLimit: true,
          move: ({ G }) => G,
        },
      },
    },
  },
  endIf({ G }) {
    if (!G.finished) return;
    const scores = G.players
      .map((player) => ({
        playerID: player.id,
        points: player.points,
        cards: player.cards.length,
      }))
      .sort((a, b) => b.points - a.points || a.cards - b.cards);
    const winners = scores
      .filter(
        (score) =>
          score.points === scores[0].points && score.cards === scores[0].cards,
      )
      .map(({ playerID }) => playerID);
    return { winners, scores };
  },
  playerView({ G, playerID }) {
    const {
      actionClocks: _actionClocks,
      resetActionClocks: _resetActionClocks,
      ...publicState
    } = G;
    return {
      ...publicState,
      decks: G.decks.map((deck) => ({ count: deck.length })),
      players: G.players.map((player) => ({
        ...player,
        reserved: player.id === playerID ? player.reserved : [],
        reservedCount: player.reserved.length,
      })),
      ...(G.finished ? { actionClock: null } : actionClockView(G, playerID)),
    };
  },
};
