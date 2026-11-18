import type { GameOptionsRoles, GameOptionsAddons, GameOptionsFeatures } from '@avalon/types';

export interface OptionsDraft {
  roles: GameOptionsRoles;
  addons?: GameOptionsAddons;
  features?: GameOptionsFeatures;
  /** Optional fork-owned rules bag. Kept here so the UI can round-trip newer server options. */
  customRules?: Record<string, boolean | number[]>;
}

/**
 * Stable UI defaults for fork-owned rules. The server treats absent values as
 * disabled; keeping this shape in the editor exposes every switch on old rooms
 * and lets the next update round-trip through `features`.
 */
export const defaultCustomRules = {
  leaderOnTeam: false,
  twoFailsOnRounds4And5: false,
  lancelotSwitchRounds: [] as number[],
  hideQuestCards: false,
  hideLancelotIdentities: false,
};

export function copyOptions<T>(options: T): T {
  return JSON.parse(JSON.stringify(options));
}

export function roleRequirement(role: keyof GameOptionsRoles, roles: GameOptionsRoles) {
  if ((role === 'merlin' && roles.merlinPure) || (role === 'merlinPure' && roles.merlin)) {
    return 'alternativeMerlin';
  }
  const hasMerlin = Boolean(roles.merlin || roles.merlinPure);
  if (role === 'morgana') {
    if (!hasMerlin) return 'requiresMerlinPercival';
    if (!roles.percival) return 'requiresPercival';
  }
  if ((role === 'assassin' || role === 'percival' || role === 'mordred') && !hasMerlin) return 'requiresMerlin';
  if (role === 'guinevere' && !roles.goodLancelot) return 'requiresLancelots';
  return undefined;
}

// Both checkboxes and counters follow the same dependency rules.
export function setRoleCount(roles: GameOptionsRoles, role: keyof GameOptionsRoles, count: number) {
  if (count > 0 && roleRequirement(role, roles)) return;
  roles[role] = Math.max(0, Math.floor(count));
  if (role === 'tristan') roles.isolde = roles.tristan;
  if (role === 'isolde') roles.tristan = roles.isolde;
  if (role === 'goodLancelot' || role === 'evilLancelot') {
    roles.goodLancelot = roles.evilLancelot = roles[role];
    if (!roles[role]) roles.guinevere = 0;
  }
  if (role === 'percival' && !roles.percival) roles.morgana = 0;
  if ((role === 'merlin' || role === 'merlinPure') && !roles.merlin && !roles.merlinPure) {
    roles.percival = roles.morgana = roles.mordred = 0;
    if (roles.assassin) roles.assassin = 0;
  }
}
