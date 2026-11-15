import { INVALID_MOVE } from 'boardgame.io/core';

const secondsFor = (G) =>
  G.actionSeconds ?? (G.timer?.durationMs ?? 60000) / 1000;

export function updateClocks(G, { label, seats, key }) {
  const now = Date.now();
  const current = G.actionClocks;
  const counts = { ...G.timeoutCounts };
  const marked = new Set(current?.marked);
  for (const [id, deadline] of Object.entries(current?.deadlines ?? {})) {
    if (deadline > now || marked.has(id)) continue;
    marked.add(id);
    counts[id] = Math.min(5, (counts[id] ?? 0) + 1);
  }
  const sameStep = current?.key === key;
  const previous = sameStep && !G.resetActionClocks ? current.deadlines : {};
  const endsAt = now + secondsFor(G) * 1000;
  const deadlines = Object.fromEntries(
    seats
      .filter((id) => id != null && !G.bots?.includes(id))
      .map((id) => [id, previous[id] ?? endsAt]),
  );
  return {
    ...G,
    timeoutCounts: counts,
    resetActionClocks: false,
    actionClocks: {
      key,
      label,
      deadlines,
      marked: sameStep ? [...marked] : [],
    },
  };
}

export function actionClockView(G, playerID) {
  const endsAt = G.actionClocks?.deadlines[playerID];
  return {
    actionSeconds: secondsFor(G),
    actionClock: endsAt ? { label: G.actionClocks.label, endsAt } : null,
  };
}

export const setActionSeconds = {
  client: false,
  noLimit: true,
  ignoreStaleStateID: true,
  move({ G, playerID }, seconds) {
    if (
      playerID !== '0' ||
      G.phase === 'finished' ||
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > 3600
    )
      return INVALID_MOVE;
    G.actionSeconds = seconds;
    G.resetActionClocks = true;
  },
};
