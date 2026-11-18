import { Game } from '@/core/game';
import type { GameOptions } from '@avalon/types';

const makeGame = (customRules: GameOptions['features']['customRules']) =>
  new Game(
    ['1', '2', '3', '4', '5', '6', '7'],
    {
      roles: { goodLancelot: 1, evilLancelot: 1 },
      addons: {},
      features: { customRules },
    },
    { gameStateChanged: () => undefined },
  );

describe('custom Lancelot timing and privacy', () => {
  test('draws fate only on configured quests', () => {
    const game = makeGame({ lancelotSwitchRounds: [4] });
    game.addons.lancelots!.switches = [true, false, false, false, false];

    game.round = 2;
    game.moveVote(true);
    expect(game.history).toHaveLength(0);

    game.round = 3;
    game.moveVote(true);
    expect(game.history.at(-1)?.type).toBe('switchLancelots');
  });

  test('keeps opening Lancelot clues for other players after a swap', () => {
    const game = makeGame({ lancelotSwitchRounds: [3], hideLancelotIdentities: true });
    game.addons.lancelots!.switches = [true, false, false, false, false];
    const originalEvil = game.players.find((player) => player.role.selfRole === 'evilLancelot')!;
    const observer = game.players.find((player) => player.role.role === 'minion')!;

    game.round = 2;
    game.moveVote(true);

    expect(game.visibleRolesState[observer.userID][originalEvil.userID]).toBe('evilLancelot');
    expect(game.visibleRolesState[originalEvil.userID][originalEvil.userID]).toBe('goodLancelot');
  });
});
