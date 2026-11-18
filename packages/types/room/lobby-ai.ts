import { aiPlayerCounts } from './ai-player-counts';

export function lobbyAiSizes(humans: number, _premium: boolean) {
  if (!Number.isInteger(humans) || humans < 1) return [];
  return aiPlayerCounts
    .filter((playerCount) => playerCount > humans)
    .map((playerCount) => ({
      playerCount,
      botCount: playerCount - humans,
      requiresPremium: false,
    }));
}
