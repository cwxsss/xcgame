const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

require(
  require.resolve('@babel/register', {
    paths: [require.resolve('@babel/node/package.json')],
  }),
)({
  extensions: ['.js', '.jsx', '.ts'],
  presets: ['@babel/preset-env', '@babel/preset-react'],
});

const { InitializeGame } = require('../src/core/initialize');
const { CreateGameReducer } = require('../src/core/reducer');
const { makeMove } = require('../src/core/action-creators');
const { Splendor } = require('../examples/react-web/src/tabletop/splendor');
const {
  rankSplendorScores,
} = require('../examples/react-web/src/tabletop/splendor-result');
const { replayMatchID } = require('../examples/react-web/tabletop-rematch');
const {
  SEAT_RECOVERY_TTL_MS,
  consumeSeatRecovery,
  issueSeatRecovery,
} = require('../examples/react-web/tabletop-seat-recovery');

function newRoom(numPlayers = 2) {
  const reducer = CreateGameReducer({ game: Splendor });
  let state = InitializeGame({ game: Splendor, numPlayers });
  const move = (name, playerID, args) => {
    state = reducer(state, makeMove(name, args, playerID));
    return state;
  };
  move('readyUp', '0');
  for (let playerID = 1; playerID < numPlayers; playerID++)
    move('readyUp', String(playerID));
  move('startGame', '0');
  return {
    get state() {
      return state;
    },
    set state(next) {
      state = next;
    },
    move,
  };
}

function expire(state, playerID) {
  return {
    ...state,
    G: {
      ...state.G,
      actionClocks: {
        ...state.G.actionClocks,
        deadlines: {
          ...state.G.actionClocks.deadlines,
          [playerID]: Date.now() - 1,
        },
      },
    },
  };
}

function testThreeTimeoutsReturnTokensAndSkipSeat() {
  const room = newRoom();
  room.state = {
    ...room.state,
    G: {
      ...room.state.G,
      players: room.state.G.players.map((player) =>
        player.id === '0'
          ? {
              ...player,
              tokens: { ...player.tokens, white: 2, gold: 1 },
            }
          : player,
      ),
    },
  };
  const bankBefore = room.state.G.tokens.white;
  for (let timeout = 1; timeout <= 3; timeout++) {
    room.state = expire(room.state, '0');
    room.move('markActionTimeouts', '0');
    assert.equal(room.state.G.timeoutCounts['0'], timeout);
    if (timeout < 3) {
      assert.equal(room.state.ctx.currentPlayer, '1');
      room.move('takeGems', '1', [['red', 'black', 'blue']]);
      assert.equal(room.state.ctx.currentPlayer, '0');
    }
  }
  assert.deepEqual(room.state.G.afkPlayers, ['0']);
  assert.deepEqual(room.state.ctx.playOrder, ['1']);
  assert.equal(room.state.G.players[0].tokens.white, 0);
  assert.equal(room.state.G.players[0].tokens.gold, 0);
  assert.equal(room.state.G.tokens.white, bankBefore + 2);
}

function testThreeWayTieUsesCompetitionRanks() {
  const scores = rankSplendorScores([
    { playerID: '0', points: 15, cards: 5 },
    { playerID: '1', points: 15, cards: 5 },
    { playerID: '2', points: 15, cards: 5 },
    { playerID: '3', points: 12, cards: 6 },
  ]);
  assert.deepEqual(
    scores.map(({ playerID, rank }) => [playerID, rank]),
    [
      ['0', 1],
      ['1', 1],
      ['2', 1],
      ['3', 4],
    ],
  );
}

function testSkippedPlayersDoNotWinTie() {
  const scores = rankSplendorScores(
    [
      { playerID: '0', points: 15, cards: 5 },
      { playerID: '1', points: 15, cards: 5 },
      { playerID: '2', points: 12, cards: 6 },
    ],
    ['0'],
  );
  assert.deepEqual(
    scores.map(({ playerID, rank, skipped }) => [playerID, rank, skipped]),
    [
      ['1', 1, false],
      ['2', 2, false],
      ['0', '—', true],
    ],
  );
}

function testSplendorEndIfReturnsAllThreeWinners() {
  const result = Splendor.endIf({
    G: {
      finished: true,
      afkPlayers: [],
      players: [
        { id: '0', points: 15, cards: [{ id: 'a' }] },
        { id: '1', points: 15, cards: [{ id: 'b' }] },
        { id: '2', points: 15, cards: [{ id: 'c' }] },
      ],
    },
  });
  assert.deepEqual(result.winners, ['0', '1', '2']);
}

function testRematchIDsCanBeChainedWithoutReusingTheRoom() {
  const first = replayMatchID('finished-room');
  const second = replayMatchID(first);
  assert.match(first, /^replay-[a-f0-9]{64}$/);
  assert.match(second, /^replay-[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(replayMatchID('finished-room'), first);
}

function testReservedCardCanBeBoughtWithGold() {
  const room = newRoom();
  const { G } = room.state;
  const card = {
    id: 'test-reserved-card',
    tier: 1,
    points: 1,
    color: 'blue',
    requirements: { white: 2 },
  };
  room.state = {
    ...room.state,
    G: {
      ...G,
      tiers: [[card, ...G.tiers[0].slice(1)], ...G.tiers.slice(1)],
      tokens: { ...G.tokens, white: G.tokens.white - 1 },
      players: [
        { ...G.players[0], tokens: { ...G.players[0].tokens, white: 1 } },
        G.players[1],
      ],
    },
  };
  room.move('reserveCard', '0', [1, 0]);
  assert.equal(room.state.G.players[0].reserved[0].id, card.id);
  assert.equal(room.state.G.players[0].tokens.gold, 1);
  room.move('takeGems', '1', [['black', 'green', 'red']]);
  room.move('buyCard', '0', ['reserved', 1, 0]);
  const player = room.state.G.players[0];
  assert.equal(player.reserved.length, 0);
  assert.equal(player.cards[0].id, card.id);
  assert.equal(player.bonuses.blue, 1);
  assert.equal(player.lastPurchase.payment.white, 1);
  assert.equal(player.lastPurchase.payment.gold, 1);
  assert.equal(room.state.G.tokens.white, G.tokens.white);
  assert.equal(room.state.G.tokens.gold, G.tokens.gold);
}

function testNarrowBuyReserveActionFitsAt360And390() {
  const css = readFileSync(
    path.resolve(
      __dirname,
      '../examples/react-web/src/tabletop/splendor-mobile.css',
    ),
    'utf8',
  );
  assert.match(
    css,
    /\.splendor-mobile-confirm-row\s*\{[\s\S]*?min-width:\s*0;/,
  );
  assert.match(
    css,
    /\.splendor-mobile-confirm-row button\s*\{[\s\S]*?flex:\s*0 0 clamp\(48px,\s*16vw,\s*64px\);/,
  );
  assert.match(
    css,
    /\.splendor-mobile-confirm-row\.is-card-action[\s\S]*?\.splendor-mobile-cost-token\s*\{[\s\S]*?min-width:\s*17px;/,
  );
  for (const viewport of [360, 390]) {
    const buttonWidth = Math.min(64, Math.max(48, viewport * 0.16));
    const buttonsAndGaps = buttonWidth * 3 + 12;
    assert.ok(
      buttonsAndGaps < viewport - 12,
      `card actions overflow at ${viewport}px`,
    );
  }
}

function testSeatRecoveryRotatesCredentialsAndCannotBeReplayed() {
  const issued = issueSeatRecovery(
    {
      gameName: 'splendor',
      players: { 0: { id: 0, name: '玩家', credentials: 'old-secret' } },
    },
    '0',
    'old-secret',
    'ABCDEF0123',
    1000,
  );
  assert.ok(issued);
  assert.equal(issued.expiresAt, 1000 + SEAT_RECOVERY_TTL_MS);
  const consumed = consumeSeatRecovery(
    issued.metadata,
    issued.recoveryCode,
    'new-secret',
    1001,
  );
  assert.equal(consumed.playerID, '0');
  assert.equal(consumed.metadata.players[0].credentials, 'new-secret');
  assert.equal(
    consumeSeatRecovery(
      consumed.metadata,
      issued.recoveryCode,
      'third-secret',
      1002,
    ),
    null,
  );
}

function testSeatRecoveryRejectsRotatedCredentialsAndExpiredCodes() {
  const issued = issueSeatRecovery(
    {
      gameName: 'splendor',
      players: { 1: { id: 1, name: '玩家', credentials: 'old-secret' } },
    },
    '1',
    'old-secret',
    '0123456789',
    1000,
  );
  assert.equal(
    consumeSeatRecovery(
      {
        ...issued.metadata,
        players: {
          1: { ...issued.metadata.players[1], credentials: 'rotated' },
        },
      },
      issued.recoveryCode,
      'new-secret',
      1001,
    ),
    null,
  );
  assert.equal(
    consumeSeatRecovery(
      issued.metadata,
      issued.recoveryCode,
      'new-secret',
      issued.expiresAt,
    ),
    null,
  );
}

testThreeTimeoutsReturnTokensAndSkipSeat();
testThreeWayTieUsesCompetitionRanks();
testSkippedPlayersDoNotWinTie();
testSplendorEndIfReturnsAllThreeWinners();
testRematchIDsCanBeChainedWithoutReusingTheRoom();
testReservedCardCanBeBoughtWithGold();
testNarrowBuyReserveActionFitsAt360And390();
testSeatRecoveryRotatesCredentialsAndCannotBeReplayed();
testSeatRecoveryRejectsRotatedCredentialsAndExpiredCodes();
console.log('splendor regression checks passed');
