
import {
  TRoles,
  GameSettings,
  GameOptions,
  GameRoles,
  TEvilRoles,
  TGoodRoles,
  evilRolesImportance,
  goodRolesImportance,
} from '@avalon/types';

import type { Character } from '@/core/roles';

import type { Game } from '@/core/game';

import roles from '@/core/roles';

type TGenerateRolesResult = {
  characters: Character[];
  roles: GameRoles;
};

/**
 * Validate role-only dependencies before a game is generated.  Assassin is a
 * real seat in the Evil roster, so it must be explicitly configured and can
 * never be duplicated.  Merlin (or Merlin Pure) is required because the
 * built-in assassination addon targets that role.
 */
export function validateRoleOptions(options: GameOptions): void {
  const assassinCount = options.roles.assassin || 0;
  if (assassinCount > 1) {
    throw new Error('Only one assassin role can be selected');
  }
  if (assassinCount > 0 && !options.roles.merlin && !options.roles.merlinPure) {
    throw new Error('Assassin requires Merlin or Merlin Pure');
  }
}

/**
 * Generate roles for game
 */
export function generateRolesForGame(settings: GameSettings, options: GameOptions, game: Game): TGenerateRolesResult {
  validateRoleOptions(options);
  const gameRoles: Character[] = [];

  const loyalty = { ...settings.players };

  // Roles that cannot be duplicated in wtf-mode
  const disabledForDuplication = ['witch', 'goodLancelot', 'evilLancelot', 'assassin'];

  Object.entries(options.roles).forEach((role) => {
    const [roleName, inGame] = <[TRoles, number]>role;

    // If wtf-mode is enabled and this role can be duplicated, use the count from options
    // Otherwise, ensure only one instance of the role is created (for non-wtf mode or disabled roles)
    const count = options.features.wtfMode && !disabledForDuplication.includes(roleName) ? inGame : Math.min(inGame, 1);

    for (let i = 0; i < count; i += 1) {
      const character = new roles[roleName](game);
      gameRoles.push(new roles[roleName](game));
      loyalty[character.loyalty] -= 1;
    }
  });

  if (loyalty.evil < 0 || loyalty.good < 0) {
    throw new Error(`It is not possible to create a game with selected roles`);
  }

  for (let i = 0; i < loyalty.evil; i += 1) {
    gameRoles.push(new roles.minion(game));
  }

  for (let i = 0; i < loyalty.good; i += 1) {
    gameRoles.push(new roles.servant(game));
  }

  const characters = game.runtime.shuffle(gameRoles);

  return {
    characters,
    roles: calculateRolesForView(characters),
  };
}

/**
 * Generate roles view in info section
 */
export function calculateRolesForView(characters: Character[]): GameRoles {
  const rolesInGame = characters.reduce<GameRoles>(
    (acc, el) => {
      if (el.loyalty === 'evil') {
        const loyalty = acc[el.loyalty];
        const role = <TEvilRoles>el.role;
        loyalty.push(role);
      } else {
        const loyalty = acc[el.loyalty];
        const role = <TGoodRoles>el.role;
        loyalty.push(role);
      }

      return acc;
    },
    { evil: [], good: [] },
  );

  rolesInGame.good.sort((a, b) => goodRolesImportance[a] - goodRolesImportance[b]);
  rolesInGame.evil.sort((a, b) => evilRolesImportance[a] - evilRolesImportance[b]);

  return rolesInGame;
}
