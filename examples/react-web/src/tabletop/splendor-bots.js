import { COLORS, RESOURCES } from './splendor-data';
import { eligibleNobles, paymentFor, totalTokens } from './splendor';

// This module deliberately only chooses moves. The server remains responsible
// for scheduling the move and applying the authoritative game rules.

const asNumber = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const playerFor = (G, playerID) =>
  G?.players?.find((player) => String(player.id) === String(playerID));

const cardsOnTable = (G, player) => {
  const cards = [];
  (G?.tiers ?? []).forEach((tier, tierIndex) => {
    if (!Array.isArray(tier)) return;
    tier.forEach((card, index) => {
      if (card)
        cards.push({ card, source: 'market', tier: tierIndex + 1, index });
    });
  });
  (player?.reserved ?? []).forEach((card, index) => {
    if (card) cards.push({ card, source: 'reserved', tier: null, index });
  });
  return cards;
};

const costOf = (card) =>
  COLORS.reduce((sum, color) => sum + asNumber(card?.requirements?.[color]), 0);

const bonusOf = (player, color) => asNumber(player?.bonuses?.[color]);
const tokenOf = (player, color) => asNumber(player?.tokens?.[color]);

const missingFor = (player, card) =>
  Object.fromEntries(
    COLORS.map((color) => [
      color,
      Math.max(
        0,
        asNumber(card?.requirements?.[color]) -
          bonusOf(player, color) -
          tokenOf(player, color),
      ),
    ]),
  );

const missingTotal = (missing) =>
  COLORS.reduce((sum, color) => sum + asNumber(missing[color]), 0);

const cardScore = (player, card, G, forTarget = false) => {
  const missing = missingFor(player, card);
  const shortfall = missingTotal(missing);
  const points = asNumber(card?.points);
  const tier = asNumber(card?.tier);
  const nobles = (G?.nobles ?? []).reduce((sum, noble) => {
    const progress = COLORS.reduce((inner, color) => {
      const required = asNumber(noble.requirements?.[color]);
      if (!required) return inner;
      const after = bonusOf(player, color) + (card?.color === color ? 1 : 0);
      return inner + Math.min(after, required) / required;
    }, 0);
    return sum + progress;
  }, 0);

  if (forTarget) {
    // Keep a cheap, reachable development card ahead of an impressive card
    // that would make the bot repeatedly collect unrelated gems.
    return (
      points * 12 + tier * 2 + nobles * 5 - shortfall * 3 - costOf(card) * 0.15
    );
  }
  return points * 100 + tier * 5 + nobles * 8 - costOf(card) * 0.2;
};

const bestCard = (player, G, predicate, forTarget = false) => {
  const candidates = cardsOnTable(G, player).filter(({ card }) =>
    predicate(card),
  );
  candidates.sort(
    (left, right) =>
      cardScore(player, right.card, G, forTarget) -
      cardScore(player, left.card, G, forTarget),
  );
  return candidates[0] ?? null;
};

const resourceDemand = (player, G) => {
  const demand = Object.fromEntries(COLORS.map((color) => [color, 0]));
  cardsOnTable(G, player).forEach(({ card }) => {
    const weight = 1 + asNumber(card.points) * 2;
    COLORS.forEach((color) => {
      const missing = Math.max(
        0,
        asNumber(card.requirements?.[color]) - bonusOf(player, color),
      );
      demand[color] += missing * weight;
    });
  });
  return demand;
};

const returnGems = (player, G) => {
  const excess = Math.max(0, totalTokens(player.tokens) - 10);
  if (!excess) return [];

  const demand = resourceDemand(player, G);
  const counts = Object.fromEntries(
    RESOURCES.map((color) => [color, tokenOf(player, color)]),
  );
  const chosen = [];
  while (chosen.length < excess) {
    const available = RESOURCES.filter((color) => counts[color] > 0);
    if (available.length === 0) break;
    available.sort((left, right) => {
      // Gold is the flexible wild resource and is therefore retained unless
      // all coloured tokens are more valuable to keep.
      const leftScore = left === 'gold' ? 1000 : demand[left];
      const rightScore = right === 'gold' ? 1000 : demand[right];
      return leftScore - rightScore || counts[right] - counts[left];
    });
    const color = available[0];
    chosen.push(color);
    counts[color]--;
  }
  return chosen;
};

const gemValue = (color, target, player, G) => {
  const targetMissing = target ? missingFor(player, target.card)[color] : 0;
  const demand = resourceDemand(player, G)[color];
  return targetMissing * 100 + demand;
};

const takeGems = (player, G, target) => {
  const bank = G?.tokens ?? {};
  const available = COLORS.filter((color) => asNumber(bank[color]) > 0);
  if (available.length === 0) return null;

  const value = (color) => gemValue(color, target, player, G);
  const choices = [];
  const distinctCount = Math.min(available.length, 3);

  // The rules require exactly min(number of available colours, 3) distinct
  // colours; enumerate the small (at most 10) combination set to stay legal.
  const addCombinations = (start, picked) => {
    if (picked.length === distinctCount) {
      choices.push([...picked]);
      return;
    }
    for (let index = start; index < available.length; index++) {
      addCombinations(index + 1, [...picked, available[index]]);
    }
  };
  addCombinations(0, []);

  // Or take two of one colour when at least four are in the bank.
  COLORS.forEach((color) => {
    if (asNumber(bank[color]) >= 4) choices.push([color, color]);
  });

  choices.sort(
    (left, right) =>
      right.reduce((sum, color) => sum + value(color), 0) -
      left.reduce((sum, color) => sum + value(color), 0),
  );
  return choices[0] ?? null;
};

const reserveCandidate = (player, G) => {
  if ((player?.reserved?.length ?? 0) >= 3) return null;
  const visible = cardsOnTable(G, player).filter(
    ({ source }) => source === 'market',
  );
  if (visible.length > 0) {
    visible.sort(
      (left, right) =>
        cardScore(player, right.card, G, true) -
        cardScore(player, left.card, G, true),
    );
    const candidate = visible[0];
    return {
      name: 'reserveCard',
      args: [candidate.tier, candidate.index],
    };
  }
  const decks = Array.isArray(G?.decks) ? G.decks : [];
  const tier = decks.findIndex(
    (deck) => Array.isArray(deck) && deck.length > 0,
  );
  if (tier === -1) return null;
  return { name: 'reserveCard', args: [tier + 1, -1] };
};

const canPass = (player, G) => {
  const noColourTokens = COLORS.every(
    (color) => asNumber(G?.tokens?.[color]) <= 0,
  );
  const noReserveOptions =
    (player?.reserved?.length ?? 0) >= 3 ||
    (!(G?.decks ?? []).some((deck) => Array.isArray(deck) && deck.length > 0) &&
      !(G?.tiers ?? []).some((tier) => Array.isArray(tier) && tier.length > 0));
  const noAffordable = !cardsOnTable(G, player).some(({ card }) =>
    paymentFor(player, card),
  );
  return noColourTokens && noReserveOptions && noAffordable;
};

const botIDs = (G) => {
  if (Array.isArray(G?.bots)) return G.bots.map(String);
  if (typeof G?.bots === 'string')
    return G.bots
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  if (G?.bots && typeof G.bots === 'object') {
    return Object.entries(G.bots)
      .filter(([, enabled]) => enabled)
      .map(([id]) => String(id));
  }
  return [];
};

export function chooseSplendorBotMove(state) {
  const G = state?.G ?? state;
  const ctx = state?.ctx ?? {};
  if (!G?.players?.length || G.finished) return null;

  const bots = new Set(botIDs(G));
  if (bots.size === 0) return null;

  // Lobby turns are active for every player. Let each bot ready itself, and
  // allow a bot in seat 0 to start once every seat is ready.
  if (!G.started) {
    const seat = [...bots].find((id) => !G.ready?.[Number(id)]);
    if (seat != null) return { playerID: seat, name: 'readyUp', args: [] };
    if (G.ready?.every(Boolean) && bots.has('0')) {
      return { playerID: '0', name: 'startGame', args: [] };
    }
    return null;
  }

  const playerID = String(ctx.currentPlayer ?? '');
  if (!bots.has(playerID)) return null;
  const player = playerFor(G, playerID);
  if (!player) return null;

  if (G.pending === 'return') {
    return { playerID, name: 'returnGems', args: [returnGems(player, G)] };
  }
  if (G.pending === 'noble') {
    const noble = eligibleNobles(player, G.nobles ?? [])[0];
    if (!noble) return null;
    const index = G.nobles.findIndex(({ id }) => id === noble.id);
    return index === -1
      ? null
      : { playerID, name: 'claimNoble', args: [index] };
  }
  if (G.pending) return null;

  const affordable = bestCard(player, G, (card) => paymentFor(player, card));
  if (affordable) {
    return {
      playerID,
      name: 'buyCard',
      args:
        affordable.source === 'reserved'
          ? ['reserved', null, affordable.index]
          : ['market', affordable.tier, affordable.index],
    };
  }

  const target = bestCard(player, G, () => true, true);
  const gems = takeGems(player, G, target);
  if (gems) return { playerID, name: 'takeGems', args: [gems] };

  const reserve = reserveCandidate(player, G);
  if (reserve) return { playerID, ...reserve };
  if (canPass(player, G)) return { playerID, name: 'passTurn', args: [] };
  return null;
}
