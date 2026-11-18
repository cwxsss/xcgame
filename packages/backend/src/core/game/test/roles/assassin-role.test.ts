import { Game } from '@/core/game';

const ids = ['1', '2', '3', '4', '5', '6', '7'];

const options = (roles: Record<string, number>) => ({
  roles,
  addons: {},
  features: {},
});

describe('dedicated Assassin role', () => {
  test('uses one explicit Assassin seat instead of assigning a random evil player', () => {
    const game = new Game(ids, options({ merlin: 1, assassin: 1 }), { gameStateChanged: () => undefined });

    expect(game.players.filter((player) => player.role.role === 'assassin')).toHaveLength(1);
    expect(game.settings.roles.evil.filter((role) => role === 'assassin')).toHaveLength(1);
    expect(game.players.filter((player) => player.role.loyalty === 'evil')).toHaveLength(3);
    expect(game.players.find((player) => player.role.role === 'assassin')?.role.selfRole).toBe('assassin');
  });

  test('rejects an Assassin without Merlin and duplicate Assassin seats', () => {
    expect(() => new Game(ids, options({ assassin: 1 }), { gameStateChanged: () => undefined })).toThrow(/Merlin/i);
    expect(() => new Game(ids, options({ merlin: 1, assassin: 2 }), { gameStateChanged: () => undefined })).toThrow(
      /one assassin/i,
    );
  });
});
