const assert = require('node:assert/strict');

require(
  require.resolve('@babel/register', {
    paths: [require.resolve('@babel/node/package.json')],
  }),
)({
  extensions: ['.js', '.ts'],
  presets: ['@babel/preset-env'],
});

const { InitializeGame } = require('../src/core/initialize');
const { CreateGameReducer } = require('../src/core/reducer');
const { makeMove } = require('../src/core/action-creators');
const { Splendor } = require('../examples/react-web/src/tabletop/splendor');

const reducer = CreateGameReducer({ game: Splendor });
let state = InitializeGame({ game: Splendor, numPlayers: 2 });

const move = (name, playerID, args) => {
  state = reducer(state, makeMove(name, args, playerID));
  return state;
};

move('readyUp', '0');
move('readyUp', '1');
move('startGame', '0');
assert.equal(state.G.started, true);
assert.equal(state.ctx.currentPlayer, '0');

state = {
  ...state,
  G: {
    ...state.G,
    actionClocks: {
      ...state.G.actionClocks,
      deadlines: { ...state.G.actionClocks.deadlines, 0: Date.now() - 1 },
    },
  },
};
move('markActionTimeouts', '0');
assert.equal(state.ctx.currentPlayer, '1');
assert.equal(state.G.timeoutCounts['0'], 1);
assert.equal(state.G.afkPlayers.includes('0'), false);

// A real action clears the acting player's own timeout streak.
state = {
  ...state,
  G: { ...state.G, timeoutCounts: { ...state.G.timeoutCounts, 1: 2 } },
};
move('takeGems', '1', [['white', 'blue', 'green']]);
assert.equal(state.G.timeoutCounts['1'], 0);

// The third consecutive timeout removes the seat from future turn order and
// returns all of that player's coloured and gold tokens to the bank.
state = {
  ...state,
  G: {
    ...state.G,
    players: state.G.players.map((player) =>
      player.id === '0'
        ? { ...player, tokens: { ...player.tokens, white: 2, gold: 1 } }
        : player,
    ),
  },
};
for (let turn = 0; turn < 4 && (state.G.timeoutCounts['0'] ?? 0) < 3; turn++) {
  if (state.ctx.currentPlayer === '1') {
    move('takeGems', '1', [['red', 'black', 'white']]);
    continue;
  }
  state = {
    ...state,
    G: {
      ...state.G,
      actionClocks: {
        ...state.G.actionClocks,
        deadlines: {
          ...state.G.actionClocks.deadlines,
          [state.ctx.currentPlayer]: Date.now() - 1,
        },
      },
    },
  };
  move('markActionTimeouts', '0');
}
assert.equal(state.G.timeoutCounts['0'], 3);
assert.deepEqual(state.G.afkPlayers, ['0']);
assert.deepEqual(state.ctx.playOrder, ['1']);
assert.equal(state.G.players[0].tokens.white, 0);
assert.equal(state.G.players[0].tokens.gold, 0);

// A timeout while the mandatory return step is pending is resolved
// deterministically without blocking the next player.
let pendingReturn = InitializeGame({ game: Splendor, numPlayers: 2 });
const pendingReducer = CreateGameReducer({ game: Splendor });
const pendingMove = (name, playerID, args) => {
  pendingReturn = pendingReducer(pendingReturn, makeMove(name, args, playerID));
};
pendingMove('readyUp', '0');
pendingMove('readyUp', '1');
pendingMove('startGame', '0');
pendingReturn = {
  ...pendingReturn,
  G: {
    ...pendingReturn.G,
    pending: 'return',
    players: pendingReturn.G.players.map((player) =>
      player.id === '0'
        ? { ...player, tokens: { ...player.tokens, white: 11 } }
        : player,
    ),
    actionClocks: {
      ...pendingReturn.G.actionClocks,
      deadlines: {
        ...pendingReturn.G.actionClocks.deadlines,
        0: Date.now() - 1,
      },
    },
  },
};
pendingMove('markActionTimeouts', '0');
assert.equal(pendingReturn.G.pending, null);
assert.equal(pendingReturn.G.players[0].tokens.white, 10);
assert.equal(pendingReturn.ctx.currentPlayer, '1');

for (let count = 1; count <= 3; count++) {
  state = {
    ...state,
    G: {
      ...state.G,
      actionClocks: {
        ...state.G.actionClocks,
        deadlines: { 1: Date.now() - 1 },
      },
    },
  };
  const before = state._stateID;
  move('reserveCard', '1', [1, 0]);
  assert.equal(state._stateID, before);
  move('markActionTimeouts', '1');
  assert.equal(state.G.timeoutCounts['1'], count);
}
assert.deepEqual(state.G.afkPlayers, ['0', '1']);
assert.deepEqual(state.ctx.gameover.winners, []);
assert.ok(
  state.G.players.every((player) =>
    Object.values(player.tokens).every((count) => count === 0),
  ),
);
const { afkPlayers: discarded, ...legacy } = pendingReturn.G;
const legacyPlayer = pendingReturn.ctx.currentPlayer;
pendingReturn = {
  ...pendingReturn,
  G: {
    ...legacy,
    timeoutCounts: { [legacyPlayer]: 5 },
    actionClocks: {
      ...legacy.actionClocks,
      deadlines: { [legacyPlayer]: Date.now() - 1 },
      marked: [legacyPlayer],
    },
  },
};
pendingMove('markActionTimeouts', legacyPlayer);
assert.equal(pendingReturn.G.timeoutCounts[legacyPlayer], 1);
assert.deepEqual(pendingReturn.G.afkPlayers, []);
assert.notEqual(pendingReturn.ctx.currentPlayer, legacyPlayer);
console.log('splendor timeout smoke passed');
