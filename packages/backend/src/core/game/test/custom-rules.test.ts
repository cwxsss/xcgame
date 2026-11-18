import { Game } from '@/core/game';
import { GameTestHelper } from '@/core/game/test/helpers';
import { Mission } from '@/core/game/history/mission';
import type { GameOptions } from '@avalon/types';

const ids = ['1', '2', '3', '4', '5', '6', '7'];
const options = (customRules: Record<string, unknown> = {}): GameOptions => ({
  roles: {},
  addons: {},
  features: { customRules } as GameOptions['features'],
});

describe('custom Avalon rules', () => {
  test('requires the leader to be on the proposed team when enabled', () => {
    const game = new Game(ids, options({ leaderOnTeam: true }), { gameStateChanged: () => undefined });
    const nonLeaders = game.players.filter((player) => player !== game.leader).slice(0, 2);
    nonLeaders.forEach((player) => game.selectPlayer(game.leader.userID, player.userID));

    expect(() => game.sentSelectedPlayers(game.leader.userID)).toThrow(/leader/i);
  });

  test('uses two failures for both final missions when enabled', () => {
    const game = new Game(ids, options({ twoFailsOnRounds4And5: true }), { gameStateChanged: () => undefined });

    expect(game.settings.missions[3].failsRequired).toBe(2);
    expect(game.settings.missions[4].failsRequired).toBe(2);
  });

  test('automatically selects a first leader even with a legacy dice setting', () => {
    const game = new Game(ids, options({ diceFirstLeader: true }), { gameStateChanged: () => undefined });
    expect(game.stage).toBe('selectTeam');
    expect(game.players.filter((player) => player.features.isLeader)).toEqual([game.leader]);
    expect(game.leader.features.waitForAction).toBe(true);
  });

  test('a dedicated assassin can strike only after three successful quests, even with an old early setting', () => {
    const helper = new GameTestHelper(7, { ...options({ earlyAssassin: true }), roles: { merlin: 1, assassin: 1 } });
    const { game } = helper;
    const assassin = game.players.find((player) => player.role.selfRole === 'assassin')!;
    expect(assassin.features.isAssassin).toBe(true);

    for (let mission = 0; mission < 3; mission += 1) {
      expect(() => game.addons.assassin!.assassinate(assassin.userID, 'merlin')).toThrow(/stage/);
      helper.selectPlayersOnMission().sentSelectedPlayers().makeVotes().makeActions();
    }

    expect(game.stage).toBe('assassinate');
    helper.pickRole('merlin', true);
    expect(game.result?.winner).toBe('evil');
  });

  test('keeps quest action cards aggregate-only when privacy is enabled', () => {
    const helper = new GameTestHelper(7, options({ hideQuestCards: true }));
    helper.selectPlayersOnMission().sentSelectedPlayers().makeVotes().makeActions();

    const mission = helper.game.history.find((element): element is Mission => element.type === 'mission');
    expect(mission).toBeDefined();
    const state = mission!.dataForManager({ game: helper.game, userID: '1' });
    expect(state.actions?.every((action) => !('value' in action))).toBe(true);
  });

  test('does not pick another evil role when no assassin was enabled', () => {
    const helper = new GameTestHelper(5, { ...options({ earlyAssassin: true }), roles: { merlin: 1 } });
    for (let mission = 0; mission < 3; mission += 1) {
      helper.selectPlayersOnMission().sentSelectedPlayers().makeVotes().makeActions();
    }
    expect(helper.game.stage).toBe('end');
    expect(helper.game.result?.winner).toBe('good');
  });
});
