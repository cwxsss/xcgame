/*
 * Focused, deterministic checks for the optional Avalon modes.
 * Run with the repository's Babel runtime:
 *   pnpm exec babel-node scripts/verify-avalon-modes.js
 */

import assert from 'node:assert/strict';
import {
  Avalon,
  canAssassinAct,
} from '../examples/react-web/src/tabletop/avalon.js';
import { resolveAvalonOptions } from '../examples/react-web/src/tabletop/avalon-options.js';

const identityRandom = {
  Shuffle: (value) => [...value],
  D6: () => 6,
  Die: (sides) => sides,
};

const stateFor = (numPlayers, setupData) =>
  Avalon.setup(
    {
      ctx: { numPlayers },
    },
    setupData,
  );

const readyState = (G) => ({
  ...G,
  ready: G.ready.map(() => true),
});

const run = (move, G, playerID, ...args) =>
  move.move({ G, playerID, random: identityRandom }, ...args);

function testOptions() {
  const options = resolveAvalonOptions(
    {
      mode: 'lancelot',
      dice: true,
      lady: true,
      earlyAssassin: true,
    },
    7,
  );
  assert.equal(options.lancelot, true);
  assert.equal(options.dice, true);
  assert.equal(options.lady, true);
  assert.equal(options.earlyAssassin, true);
  assert.ok(options.roles.includes('good-lancelot'));
  assert.ok(options.roles.includes('evil-lancelot'));
}

function testTiedDiceReroll() {
  let G = readyState(stateFor(5, { mode: 'base', dice: true }));
  G = run(Avalon.moves.startGame, G, '0');
  assert.equal(G.phase, 'dice');

  for (const player of G.diceEligible) {
    G = run(Avalon.moves.rollDice, G, player);
  }
  assert.equal(G.phase, 'dice');
  assert.equal(G.diceRound, 1);
  assert.deepEqual(G.diceEligible, ['0', '1', '2', '3', '4']);
  assert.deepEqual(G.diceRolls, {});

  let roll = 1;
  const rerollRandom = { ...identityRandom, D6: () => roll++ };
  for (const player of G.diceEligible) {
    G = Avalon.moves.rollDice.move({
      G,
      playerID: player,
      random: rerollRandom,
    });
  }
  assert.equal(G.phase, 'proposal');
  assert.equal(G.leaderID, '4');
}

function testPlayerViewPrivacy() {
  const G = {
    ...readyState(stateFor(5, { mode: 'lancelot', dice: true, lady: true })),
    phase: 'proposal',
    players: [
      { id: '0', name: '梅林候选', role: 'merlin', alignment: 'good' },
      { id: '1', name: '坏人', role: 'mordred', alignment: 'evil' },
      { id: '2', name: '兰', role: 'good-lancelot', alignment: 'good' },
      { id: '3', name: '恶兰', role: 'evil-lancelot', alignment: 'evil' },
      { id: '4', name: '梅林', role: 'merlin', alignment: 'good' },
    ],
    fateDeck: ['switch'],
    ladyHistory: [
      { viewer: '0', target: '1', alignment: 'evil', role: 'mordred' },
    ],
    ladyResult: {
      viewer: '0',
      target: '1',
      alignment: 'evil',
      role: 'mordred',
    },
  };
  const merlin = Avalon.playerView({ G, playerID: '0' });
  const other = Avalon.playerView({ G, playerID: '4' });
  assert.equal('fateDeck' in merlin, false);
  assert.equal('ladyHistory' in merlin, false);
  assert.equal(merlin.ladyResult.viewer, '0');
  assert.equal('role' in merlin.ladyResult, false);
  assert.equal(other.ladyResult, null);
  assert.equal(
    merlin.players.find(({ id }) => id === '1').knownEvil,
    undefined,
  );
  assert.equal(merlin.players.find(({ id }) => id === '3').knownEvil, true);
  assert.equal(other.players.find(({ id }) => id === '1').knownEvil, undefined);
}

function testAssassinKeepsOpeningLancelotKnowledge() {
  const G = {
    ...readyState(stateFor(5, { mode: 'lancelot' })),
    phase: 'proposal',
    lancelotSwitched: true,
    players: [
      { id: '0', name: '刺客', role: 'assassin', alignment: 'evil' },
      { id: '1', name: '原善兰', role: 'good-lancelot', alignment: 'evil' },
      { id: '2', name: '原恶兰', role: 'evil-lancelot', alignment: 'good' },
      { id: '3', name: '爪牙', role: 'minion', alignment: 'evil' },
      { id: '4', name: '梅林', role: 'merlin', alignment: 'good' },
    ],
  };
  const assassin = Avalon.playerView({ G, playerID: '0' });
  assert.equal(
    assassin.players.find(({ id }) => id === '1').knownEvil,
    undefined,
  );
  assert.equal(assassin.players.find(({ id }) => id === '2').knownEvil, true);
  assert.deepEqual(assassin.vision.map(({ id }) => id).sort(), ['2', '3']);

  const merlin = Avalon.playerView({ G, playerID: '4' });
  assert.equal(
    merlin.players.find(({ id }) => id === '1').knownEvil,
    undefined,
  );
  assert.equal(merlin.players.find(({ id }) => id === '2').knownEvil, true);
  const spectator = Avalon.playerView({ G, playerID: null });
  assert.equal(
    spectator.players.some(
      ({ knownEvil, knownLancelot }) => knownEvil || knownLancelot,
    ),
    false,
  );
}

function testAssassinCanActAfterThreeQuests() {
  const base = stateFor(5, { mode: 'lancelot' });
  const G = {
    ...base,
    phase: 'proposal',
    history: [
      { quest: 1, success: true, failedCards: 0 },
      { quest: 2, success: true, failedCards: 0 },
      { quest: 3, success: false, failedCards: 1 },
    ],
    players: base.players.map((player, index) => ({
      ...player,
      role: index === 0 ? 'assassin' : 'loyal-servant',
      alignment: index === 0 ? 'evil' : 'good',
    })),
  };
  assert.equal(canAssassinAct(G, '0'), true);
  assert.equal(canAssassinAct({ ...G, phase: 'waiting' }, '0'), false);
  assert.equal(canAssassinAct({ ...G, phase: 'finished' }, '0'), false);
  assert.equal(
    canAssassinAct({ ...G, history: G.history.slice(0, 2) }, '0'),
    false,
  );
  const result = Avalon.moves.assassinate.move(
    {
      G,
      playerID: '0',
    },
    '1',
  );
  assert.equal(result.phase, 'finished');
  assert.equal(result.winner, 'good');
  assert.deepEqual(result.assassinationResult, {
    assassinID: '0',
    targetID: '1',
    targetRole: 'loyal-servant',
  });

  const normal = {
    ...G,
    phase: 'assassination',
  };
  const normalResult = Avalon.moves.assassinate.move(
    { G: normal, playerID: '0' },
    '1',
  );
  assert.deepEqual(normalResult.assassinationResult, {
    assassinID: '0',
    targetID: '1',
    targetRole: 'loyal-servant',
  });
}

function testLadyAlignmentPrivacy() {
  const G = {
    ...stateFor(5, { mode: 'mordred', lady: true }),
    phase: 'lady',
    pendingLady: true,
    ladyHolder: '0',
    players: [
      { id: '0', role: 'loyal-servant', alignment: 'good' },
      { id: '1', role: 'mordred', alignment: 'evil' },
      { id: '2', role: 'assassin', alignment: 'evil' },
      { id: '3', role: 'merlin', alignment: 'good' },
      { id: '4', role: 'loyal-servant', alignment: 'good' },
    ],
  };
  const next = run(Avalon.moves.useLady, G, '0', '1');
  assert.equal(next.phase, 'proposal');
  assert.equal(next.ladyResult.alignment, 'evil');
  assert.equal(
    Avalon.playerView({ G: next, playerID: '0' }).ladyResult.alignment,
    'evil',
  );
  assert.equal(Avalon.playerView({ G: next, playerID: '3' }).ladyResult, null);
}

function testFateWithoutDice() {
  const G = {
    ...stateFor(5, { mode: 'lancelot', dice: false }),
    phase: 'quest',
    questIndex: 1,
    successfulQuests: 1,
    proposal: ['0'],
    teamVotesHistory: [{ quest: 1, approved: true, team: ['0'], votes: {} }],
    players: [
      { id: '0', role: 'good-lancelot', alignment: 'good' },
      { id: '1', role: 'evil-lancelot', alignment: 'evil' },
      { id: '2', role: 'merlin', alignment: 'good' },
      { id: '3', role: 'assassin', alignment: 'evil' },
      { id: '4', role: 'loyal-servant', alignment: 'good' },
    ],
  };
  const next = run(Avalon.moves.quest, G, '0', true, 1);
  assert.equal(next.phase, 'fate');
  const drawn = Avalon.moves.drawFate.move({
    G: next,
    playerID: next.leaderID,
    random: { Die: () => 1 },
  });
  assert.equal(drawn.phase, 'proposal');
  assert.equal(drawn.lancelotSwitched, true);
  assert.equal(drawn.players[0].alignment, 'evil');
  assert.equal(drawn.players[1].alignment, 'good');
  assert.deepEqual(
    Avalon.playerView({ G: drawn, playerID: null }).fateHistory,
    [{ quest: 3, card: 'switch' }],
  );
  const unchanged = run(
    Avalon.moves.drawFate,
    { ...next, fateDeck: ['no_switch'] },
    next.leaderID,
  );
  assert.equal(unchanged.lancelotSwitched, false);
  assert.deepEqual(
    Avalon.playerView({ G: unchanged, playerID: null }).fateHistory,
    [{ quest: 3, card: 'no_switch' }],
  );
}

function testLegacyClassicFlow() {
  let G = readyState(stateFor(5));
  G = run(Avalon.moves.startGame, G, '0');
  assert.equal(G.config.mode, 'base');
  assert.equal(G.phase, 'proposal');
  assert.equal(
    G.players.some(({ role }) => role === 'good-lancelot'),
    false,
  );
  assert.equal(G.fateDeck.length, 5);
}

function testTimeoutBadgeCap() {
  let G = {
    ...stateFor(5),
    phase: 'proposal',
    timeoutCounts: { 0: 4 },
    actionClocks: { deadlines: { 0: 1 }, marked: [] },
  };
  G = Avalon.turn.onMove({ G });
  assert.equal(G.timeoutCounts['0'], 5);
  G = Avalon.turn.onMove({
    G: {
      ...G,
      actionClocks: { ...G.actionClocks, deadlines: { 0: 1 }, marked: [] },
    },
  });
  assert.equal(G.timeoutCounts['0'], 5);
  assert.equal(G.timeoutCounts['1'], undefined);
}

function testLateQuestThresholdAndAnonymousResults() {
  for (const playerCount of [5, 7, 10]) {
    for (const quest of [4, 5]) {
      for (const failedCards of [1, 2]) {
        const initial = stateFor(playerCount);
        const team = initial.players.slice(0, initial.questSizes[quest - 1]);
        let G = {
          ...initial,
          phase: 'quest',
          questIndex: quest - 1,
          successfulQuests: 2,
          failedQuests: quest - 3,
          proposal: team.map(({ id }) => id),
          players: initial.players.map((player, index) => ({
            ...player,
            role: index < 2 ? 'assassin' : 'loyal-servant',
            alignment: index < 2 ? 'evil' : 'good',
          })),
        };
        for (const [index, { id }] of team.entries()) {
          G = run(Avalon.moves.quest, G, id, index >= failedCards, 0);
        }
        const result = G.history[0];
        assert.equal(result.requiredFails, 2);
        assert.equal(result.success, failedCards === 1);
        assert.equal(result.successfulCards, team.length - failedCards);
        assert.equal(result.failedCards, failedCards);
        assert.equal('ballots' in result, false);
      }
    }
  }
  const G = {
    ...stateFor(5),
    history: [
      {
        quest: 4,
        team: ['0', '1'],
        success: false,
        failedCards: 1,
        ballots: { 0: true, 1: false },
      },
    ],
  };
  for (const playerID of [null, '0', '1']) {
    const result = Avalon.playerView({ G, playerID }).history[0];
    assert.equal('ballots' in result, false);
    assert.equal(result.successfulCards, 1);
    assert.equal(result.requiredFails, 1);
    assert.equal(result.success, false);
  }
}

testLateQuestThresholdAndAnonymousResults();
testTimeoutBadgeCap();
testOptions();
testTiedDiceReroll();
testPlayerViewPrivacy();
testAssassinKeepsOpeningLancelotKnowledge();
testAssassinCanActAfterThreeQuests();
testLadyAlignmentPrivacy();
testFateWithoutDice();
testLegacyClassicFlow();
console.log('avalon-modes-verification-ok');
