import {
  updateClocks,
  actionClockView,
  setActionSeconds,
} from './action-clock';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import {
  roleAlignment,
  resolveAvalonOptions,
  QUEST_SIZE_TABLE,
} from './avalon-options';

const ids = (count) =>
  Array.from({ length: count }, (_, index) => String(index));

const playerIndex = (G, playerID) =>
  G.players.findIndex((player) => player.id === String(playerID));

const isSeat = (G, playerID) => playerIndex(G, playerID) !== -1;

const allReady = (G) =>
  G.ready.length > 0 &&
  G.ready.length === G.players.length &&
  G.ready.every(Boolean);

const configOf = (G) => {
  if (G.config) return G.config;
  try {
    return resolveAvalonOptions(undefined, G.players.length);
  } catch (_error) {
    return {
      mode: 'classic',
      roles: [],
      lady: false,
      dice: false,
      earlyAssassin: false,
      leaderOnTeam: true,
    };
  }
};

const continuingAssassinationPhases = new Set([
  'proposal',
  'voting',
  'quest',
  'fate',
  'lancelot',
  'lancelot-switch',
  'LANCELOT_SWITCH',
  'lady',
  'lady-lake',
  'LADY_LAKE',
]);

export const canAssassinAct = (G, playerID) => {
  const assassin = G.players?.find((player) => player.id === String(playerID));
  if (assassin?.role !== 'assassin' || G.phase === 'finished') return false;
  if (G.phase === 'assassination') return true;
  if (G.assassinStrikeUsed) return false;
  const config = configOf(G);
  const early =
    config.earlyAssassin &&
    ['proposal', 'voting', 'quest', 'fate', 'lady'].includes(G.phase);
  const afterThreeQuests =
    (G.history?.length ?? 0) >= 3 && continuingAssassinationPhases.has(G.phase);
  return early || afterThreeQuests;
};

const finish = (G, winner, reason) => ({
  ...G,
  phase: 'finished',
  status: 'finished',
  winner,
  message: reason,
});

const nextID = (G, playerID, offset = 1) => {
  const count = G.players.length;
  const index = playerIndex(G, playerID);
  return G.players[(index + offset + count) % count].id;
};

const previousID = (G, playerID) => nextID(G, playerID, -1);

const alignmentOf = (G, player) =>
  roleAlignment(player.role, Boolean(G.lancelotSwitched));

// Shared role clues are based on the opening Lancelot alignments. A fate card
// announces whether a swap happened, while the public player view never
// reveals which Lancelot seat changed sides.
const knowledgeAlignmentOf = (G, player) =>
  isLancelot(player.role)
    ? roleAlignment(player.role, false)
    : alignmentOf(G, player);

const isLancelot = (role) =>
  role === 'good-lancelot' || role === 'evil-lancelot';

const publicPlayers = ({ G, playerID }) => {
  const viewer = G.players.find((player) => player.id === String(playerID));
  const viewerRole = viewer?.role;
  const viewerAlignment = viewer ? alignmentOf(G, viewer) : null;
  const revealRoles = G.phase === 'finished';
  const seesMerlin = viewerRole === 'merlin';
  const seesLancelots = isLancelot(viewerRole);
  const seesEvil =
    viewerAlignment === 'evil' && viewerRole !== 'oberon' && !seesLancelots;
  return G.players.map((player) => {
    const visible = {
      id: player.id,
      name: player.name,
      ready: G.ready[Number(player.id)] === true,
    };
    const targetAlignment = alignmentOf(G, player);
    const knownAlignment = knowledgeAlignmentOf(G, player);
    if (revealRoles || player.id === String(playerID)) {
      visible.role = player.role;
      visible.alignment = targetAlignment;
    } else if (
      seesMerlin &&
      knownAlignment === 'evil' &&
      player.role !== 'mordred'
    ) {
      visible.knownEvil = true;
    } else if (
      seesEvil &&
      knownAlignment === 'evil' &&
      player.role !== 'oberon'
    ) {
      visible.knownEvil = true;
    } else if (seesLancelots && isLancelot(player.role)) {
      visible.knownLancelot = true;
    } else if (
      viewerRole === 'percival' &&
      (player.role === 'merlin' || player.role === 'morgana')
    ) {
      visible.percivalHint = true;
    }
    return visible;
  });
};

const privateVision = (G, playerID) => {
  const viewer = G.players.find((player) => player.id === String(playerID));
  if (!viewer) return [];
  return G.players
    .filter((player) => player.id !== viewer.id)
    .filter((player) => {
      const knownAlignment = knowledgeAlignmentOf(G, player);
      if (viewer.role === 'merlin')
        return knownAlignment === 'evil' && player.role !== 'mordred';
      if (viewer.role === 'percival')
        return player.role === 'merlin' || player.role === 'morgana';
      if (isLancelot(viewer.role)) return isLancelot(player.role);
      if (alignmentOf(G, viewer) === 'evil' && viewer.role !== 'oberon') {
        return knownAlignment === 'evil' && player.role !== 'oberon';
      }
      return false;
    })
    .map((player) => {
      if (viewer.role === 'percival')
        return { id: player.id, role: 'merlin-or-morgana' };
      if (isLancelot(viewer.role))
        return { id: player.id, role: 'other-lancelot' };
      return { id: player.id, role: 'evil-alignment' };
    });
};

const resetRound = (G, leaderID, questIndex) => ({
  ...G,
  phase: 'proposal',
  questIndex,
  leaderID,
  proposal: null,
  votes: {},
  questVotes: {},
  rejectedVotes: 0,
  pendingFate: false,
  pendingLady: false,
});

const beginNextQuest = (G, completedQuest) => {
  const config = configOf(G);
  const nextQuest = completedQuest + 1;
  const round = resetRound(G, nextID(G, G.leaderID), nextQuest);
  const hasLancelots =
    G.players.some((player) => player.role === 'good-lancelot') &&
    G.players.some((player) => player.role === 'evil-lancelot');
  const hasFate =
    (config.lancelot ?? hasLancelots) &&
    hasLancelots &&
    nextQuest >= 2 &&
    nextQuest <= 4;
  const hasLady = config.lady && completedQuest >= 1 && completedQuest <= 3;
  if (hasFate)
    return {
      ...round,
      phase: 'fate',
      pendingFate: true,
      message: '当前队长请抽取命运牌，决定是否交换两位兰斯洛特。',
    };
  if (hasLady)
    return {
      ...round,
      phase: 'lady',
      pendingLady: true,
      ladyResult: null,
      message: '湖中女士请查验一名尚未被查验的玩家。',
    };
  return { ...round, message: '请由当前队长提议远征队。' };
};

const startAfterFate = (G, completedQuest) => {
  const config = configOf(G);
  if (config.lady && completedQuest >= 1 && completedQuest <= 3) {
    return {
      ...G,
      phase: 'lady',
      pendingFate: false,
      pendingLady: true,
      ladyResult: null,
      message: '湖中女士请查验一名尚未被查验的玩家。',
    };
  }
  return {
    ...G,
    phase: 'proposal',
    pendingFate: false,
    message: '请由当前队长提议远征队。',
  };
};

function pendingAction(G) {
  const seats = G.players.map(({ id }) => id);
  switch (G.phase) {
    case 'dice':
      return [
        '掷骰子',
        (G.diceEligible?.length ? G.diceEligible : seats).filter(
          (id) => !Object.hasOwn(G.diceRolls, id),
        ),
      ];
    case 'proposal':
      return ['选择远征队伍', [G.leaderID]];
    case 'voting':
      return ['组队表决', seats.filter((id) => !Object.hasOwn(G.votes, id))];
    case 'quest':
      return [
        '提交远征票',
        G.proposal.filter((id) => !Object.hasOwn(G.questVotes, id)),
      ];
    case 'fate':
      return ['抽取命运牌', [G.leaderID]];
    case 'lady':
      return ['湖中仙女验人', [G.ladyHolder]];
    case 'assassination':
      return [
        '选择刺杀目标',
        G.players.filter(({ role }) => role === 'assassin').map(({ id }) => id),
      ];
    default:
      return [null, []];
  }
}

function updateActionClocks({ G }) {
  const [label, seats] = pendingAction(G);
  const key = [
    G.phase,
    G.questIndex,
    G.teamVotesHistory.length,
    G.diceRound,
    G.leaderID,
  ].join(':');
  return updateClocks(G, { label, seats, key });
}

const Avalon = {
  name: 'avalon',

  setup: ({ ctx }, setupData) => {
    const count = Math.max(0, Math.min(10, Number(ctx.numPlayers)));
    let config;
    try {
      config = resolveAvalonOptions(setupData, count);
    } catch (_error) {
      config = resolveAvalonOptions(undefined, count);
    }
    return {
      status: 'waiting',
      phase: 'waiting',
      config,
      players: ids(count).map((id) => ({
        id,
        name: `玩家 ${Number(id) + 1}`,
        role: null,
        alignment: null,
      })),
      ready: Array(count).fill(false),
      leaderID: '0',
      questIndex: 0,
      questSizes: QUEST_SIZE_TABLE[count] || [],
      proposal: null,
      votes: {},
      questVotes: {},
      teamVotesHistory: [],
      rejectedVotes: 0,
      failedQuests: 0,
      successfulQuests: 0,
      history: [],
      winner: null,
      diceRolls: {},
      diceRound: 0,
      diceWinners: [],
      fateDeck: ['switch', 'switch', 'no_switch', 'no_switch', 'no_switch'],
      fateHistory: [],
      lancelotSwitched: false,
      pendingFate: false,
      ladyHolder: null,
      ladyUsedPlayers: [],
      ladyHistory: [],
      ladyResult: null,
      pendingLady: false,
      diceEligible: [],
      assassinStrikeUsed: false,
      message: '所有玩家准备后，由 1 号玩家开始游戏。',
    };
  },

  validateSetupData: (setupData, numPlayers) => {
    if (!Number.isInteger(numPlayers) || numPlayers < 5 || numPlayers > 10)
      return '阿瓦隆需要 5 到 10 名玩家。';
    if (
      setupData !== undefined &&
      (setupData === null || typeof setupData !== 'object')
    )
      return '阿瓦隆的 setupData 必须是对象或省略。';
    try {
      resolveAvalonOptions(setupData, numPlayers);
    } catch (error) {
      return error.message;
    }
    return undefined;
  },

  disableUndo: true,
  turn: { activePlayers: ActivePlayers.ALL, onMove: updateActionClocks },

  moves: {
    markActionTimeouts: {
      client: false,
      noLimit: true,
      move: ({ G }) => G,
    },
    setActionSeconds,
    readyUp: {
      move: ({ G, playerID }) => {
        if (
          G.phase !== 'waiting' ||
          !isSeat(G, playerID) ||
          G.ready[Number(playerID)] === true
        )
          return INVALID_MOVE;
        const ready = [...G.ready];
        ready[Number(playerID)] = true;
        return { ...G, ready, message: '等待所有玩家准备。' };
      },
      ignoreStaleStateID: true,
      client: false,
    },

    startGame: {
      move: ({ G, playerID, random }) => {
        if (
          G.phase !== 'waiting' ||
          String(playerID) !== '0' ||
          !allReady(G) ||
          !G.questSizes.length
        )
          return INVALID_MOVE;
        const config = configOf(G);
        const shuffledRoles = random.Shuffle(config.roles);
        const shuffledSeats = random.Shuffle(
          G.players.map((player) => player.id),
        );
        const players = G.players.map((player, index) => {
          const role = shuffledRoles[index];
          return { ...player, role, alignment: roleAlignment(role, false) };
        });
        const leaderID = shuffledSeats[0];
        return {
          ...G,
          config,
          players,
          leaderID,
          phase: config.dice ? 'dice' : 'proposal',
          status: 'playing',
          diceRolls: {},
          diceRound: 0,
          diceWinners: [],
          diceEligible: players.map((player) => player.id),
          ladyHolder: config.lady ? previousID(G, leaderID) : null,
          ladyUsedPlayers: config.lady ? [previousID(G, leaderID)] : [],
          message: config.dice
            ? '所有玩家请掷骰子，点数最高者成为首任队长。'
            : '请由当前队长提议远征队。',
        };
      },
      client: false,
    },

    rollDice: {
      move: ({ G, playerID, random }) => {
        const config = configOf(G);
        const eligible = G.diceEligible?.length
          ? G.diceEligible
          : G.players.map((player) => player.id);
        if (
          !config.dice ||
          G.phase !== 'dice' ||
          !eligible.includes(String(playerID)) ||
          G.diceRolls[String(playerID)] != null
        )
          return INVALID_MOVE;
        const diceRolls = { ...G.diceRolls, [String(playerID)]: random.D6() };
        if (Object.keys(diceRolls).length < eligible.length)
          return { ...G, diceRolls };
        const highest = Math.max(...Object.values(diceRolls));
        const winners = eligible.filter((id) => diceRolls[id] === highest);
        if (winners.length > 1)
          return {
            ...G,
            diceRolls: {},
            diceRound: G.diceRound + 1,
            diceWinners: winners,
            diceEligible: winners,
            message: `骰子平局（${highest} 点），平局玩家请重新掷骰子。`,
          };
        const leaderID = winners[0];
        return {
          ...G,
          phase: 'proposal',
          leaderID,
          diceRolls,
          diceWinners: winners,
          diceEligible: winners,
          ladyHolder: config.lady ? previousID(G, leaderID) : G.ladyHolder,
          ladyUsedPlayers: config.lady ? [previousID(G, leaderID)] : [],
          message: '骰子结果已确定，请由当前队长提议远征队。',
        };
      },
      ignoreStaleStateID: true,
      client: false,
    },

    proposeTeam: ({ G, playerID }, team) => {
      const config = configOf(G);
      if (
        G.phase !== 'proposal' ||
        String(playerID) !== G.leaderID ||
        !Array.isArray(team)
      )
        return INVALID_MOVE;
      const normalized = [...new Set(team.map(String))];
      const size = G.questSizes[G.questIndex];
      if (normalized.length !== size || normalized.some((id) => !isSeat(G, id)))
        return INVALID_MOVE;
      if (config.leaderOnTeam && !normalized.includes(String(playerID)))
        return INVALID_MOVE;
      return {
        ...G,
        phase: 'voting',
        proposal: normalized,
        votes: {},
        message: '所有玩家请投票决定是否批准远征队。',
      };
    },

    voteTeam: {
      move: ({ G, playerID }, approve, proposalNumber) => {
        if (
          proposalNumber !== G.teamVotesHistory.length ||
          G.phase !== 'voting' ||
          !isSeat(G, playerID) ||
          typeof approve !== 'boolean' ||
          G.votes[String(playerID)] !== undefined
        )
          return INVALID_MOVE;
        const votes = { ...G.votes, [String(playerID)]: approve };
        if (Object.keys(votes).length < G.players.length)
          return { ...G, votes };
        const approved =
          Object.values(votes).filter(Boolean).length > G.players.length / 2;
        const teamVotesHistory = [
          ...G.teamVotesHistory,
          { quest: G.questIndex + 1, team: G.proposal, approved, votes },
        ];
        if (!approved) {
          const rejectedVotes = G.rejectedVotes + 1;
          if (rejectedVotes >= 5)
            return finish(
              { ...G, teamVotesHistory },
              'evil',
              '连续五次否决远征队，邪恶阵营获胜。',
            );
          return {
            ...G,
            phase: 'proposal',
            votes: {},
            proposal: null,
            rejectedVotes,
            teamVotesHistory,
            leaderID: nextID(G, G.leaderID),
            message: '远征队被否决，队长标记已顺时针移交。',
          };
        }
        return {
          ...G,
          phase: 'quest',
          votes,
          teamVotesHistory,
          questVotes: {},
          rejectedVotes: 0,
          message: '远征队成员请秘密选择成功或失败。',
        };
      },
      redact: true,
      ignoreStaleStateID: true,
      client: false,
    },

    quest: {
      move: ({ G, playerID }, succeed, proposalNumber) => {
        if (
          proposalNumber !== G.teamVotesHistory.length ||
          G.phase !== 'quest' ||
          !G.proposal?.includes(String(playerID)) ||
          typeof succeed !== 'boolean' ||
          G.questVotes[String(playerID)] !== undefined
        )
          return INVALID_MOVE;
        const player = G.players[playerIndex(G, playerID)];
        if (alignmentOf(G, player) === 'good' && !succeed) return INVALID_MOVE;
        const questVotes = { ...G.questVotes, [String(playerID)]: succeed };
        if (Object.keys(questVotes).length < G.proposal.length)
          return { ...G, questVotes };
        const failed = Object.values(questVotes).filter(
          (value) => !value,
        ).length;
        const requiredFails = G.questIndex >= 3 ? 2 : 1;
        const success = failed < requiredFails;
        const history = [
          ...G.history,
          {
            quest: G.questIndex + 1,
            team: G.proposal,
            success,
            failedCards: failed,
            successfulCards: G.proposal.length - failed,
            requiredFails,
          },
        ];
        const successfulQuests = G.successfulQuests + (success ? 1 : 0);
        const failedQuests = G.failedQuests + (success ? 0 : 1);
        const settled = {
          ...G,
          history,
          successfulQuests,
          failedQuests,
          questVotes: {},
        };
        if (failedQuests >= 3)
          return finish(settled, 'evil', '三次远征失败，邪恶阵营获胜。');
        if (successfulQuests >= 3)
          return {
            ...settled,
            phase: 'assassination',
            message: '善良阵营完成三次远征，刺客请刺杀梅林。',
          };
        return {
          ...beginNextQuest(settled, G.questIndex),
          history,
          successfulQuests,
          failedQuests,
        };
      },
      redact: true,
      ignoreStaleStateID: true,
      client: false,
    },

    drawFate: {
      move: ({ G, playerID, random }) => {
        const config = configOf(G);
        if (
          G.phase !== 'fate' ||
          !G.pendingFate ||
          String(playerID) !== G.leaderID ||
          !config.lancelot
        )
          return INVALID_MOVE;
        const deck = [...(G.fateDeck || [])];
        const index = deck.length ? random.Die(deck.length) - 1 : 0;
        const card = deck.length ? deck.splice(index, 1)[0] : 'no_switch';
        const switched =
          card === 'switch' ? !G.lancelotSwitched : G.lancelotSwitched;
        const fateHistory = [
          ...(G.fateHistory || []),
          { quest: G.questIndex + 1, card },
        ];
        const players = G.players.map((player) => ({
          ...player,
          alignment: roleAlignment(player.role, switched),
        }));
        return startAfterFate(
          {
            ...G,
            fateDeck: deck,
            fateHistory,
            lancelotSwitched: switched,
            players,
          },
          G.questIndex,
        );
      },
      client: false,
    },

    useLady: {
      move: ({ G, playerID }, targetID) => {
        const config = configOf(G);
        const target = String(targetID);
        if (
          G.phase !== 'lady' ||
          !G.pendingLady ||
          !config.lady ||
          String(playerID) !== String(G.ladyHolder) ||
          !isSeat(G, target) ||
          target === String(playerID) ||
          (G.ladyUsedPlayers || []).includes(target)
        )
          return INVALID_MOVE;
        const targetPlayer = G.players[playerIndex(G, target)];
        const ladyResult = {
          viewer: String(playerID),
          target,
          alignment: alignmentOf(G, targetPlayer),
        };
        return {
          ...G,
          phase: 'proposal',
          pendingLady: false,
          ladyHolder: target,
          ladyUsedPlayers: [...(G.ladyUsedPlayers || []), target],
          ladyHistory: [...(G.ladyHistory || []), ladyResult],
          ladyResult,
          message: '湖中女士查验完成，请由当前队长提议远征队。',
        };
      },
      client: false,
    },

    assassinate: {
      move: ({ G, playerID }, targetID) => {
        const target = String(targetID);
        const normal = G.phase === 'assassination';
        if (
          !canAssassinAct(G, playerID) ||
          !isSeat(G, target) ||
          target === String(playerID)
        )
          return INVALID_MOVE;
        const targetPlayer = G.players[playerIndex(G, target)];
        const hit = targetPlayer.role === 'merlin';
        const assassinationResult = {
          assassinID: String(playerID),
          targetID: target,
          targetRole: targetPlayer.role,
        };
        if (normal)
          return finish(
            { ...G, assassinationResult },
            hit ? 'evil' : 'good',
            hit
              ? '刺客成功找出梅林，邪恶阵营获胜。'
              : '刺客刺杀失败，善良阵营获胜。',
          );
        return finish(
          { ...G, assassinStrikeUsed: true, assassinationResult },
          hit ? 'evil' : 'good',
          hit
            ? '刺客提前找出梅林，邪恶阵营获胜。'
            : '提前刺杀未命中，善良阵营获胜。',
        );
      },
      client: false,
    },
  },

  playerView: (context) => ({
    ...(() => {
      const {
        players: _players,
        votes: _votes,
        questVotes: _questVotes,
        fateDeck: _fateDeck,
        ladyHistory: _ladyHistory,
        ladyResult: _ladyResult,
        timer: _timer,
        actionClocks: _actionClocks,
        resetActionClocks: _resetActionClocks,
        ...publicState
      } = context.G;
      return publicState;
    })(),
    history: context.G.history.map(
      ({
        quest,
        team,
        success,
        failedCards,
        successfulCards,
        requiredFails,
      }) => ({
        quest,
        team,
        success,
        failedCards,
        successfulCards: successfulCards ?? team.length - failedCards,
        requiredFails:
          requiredFails ??
          (quest === 4 && context.G.players.length >= 7 ? 2 : 1),
      }),
    ),
    players: publicPlayers(context),
    ...actionClockView(context.G, context.playerID),
    votes: {},
    questVotes: {},
    vision: privateVision(context.G, context.playerID),
    ladyResult: (() => {
      const result = context.G.ladyHistory?.findLast(
        ({ viewer }) => viewer === context.playerID,
      );
      return result
        ? {
            viewer: result.viewer,
            target: result.target,
            alignment: result.alignment,
          }
        : null;
    })(),
    hasVoted:
      context.playerID != null &&
      Object.prototype.hasOwnProperty.call(
        context.G.votes || {},
        String(context.playerID),
      ),
    hasQuestVoted:
      context.playerID != null &&
      Object.prototype.hasOwnProperty.call(
        context.G.questVotes || {},
        String(context.playerID),
      ),
    voteCount: Object.keys(context.G.votes || {}).length,
    questVoteCount: Object.keys(context.G.questVotes || {}).length,
  }),

  endIf: ({ G }) => (G.winner ? { winner: G.winner } : undefined),
};

Avalon.minPlayers = 5;
Avalon.maxPlayers = 10;

export { Avalon };
export default Avalon;
