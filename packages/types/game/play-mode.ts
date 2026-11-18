import type { GameOptionsCustomRules } from './options';

export type PlayMode = 'classic' | 'custom';

export function playModeRules(mode: PlayMode): GameOptionsCustomRules {
  const privacy = { hideQuestCards: true, hideLancelotIdentities: true };

  return mode === 'custom'
    ? { ...privacy, twoFailsOnRounds4And5: true, lancelotSwitchRounds: [3, 4, 5] }
    : privacy;
}
