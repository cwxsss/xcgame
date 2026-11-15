/**
 * Server-side decisions for seats marked as bots.
 *
 * This module is deliberately pure. The caller invokes the returned move with
 * the bot's credentials and asks again after the resulting state is persisted.
 * A null result means that the next decision belongs to a human player.
 */

const BOT_PHASES = {
  dice: new Set(['dice', 'dice-roll', 'DICE_ROLL']),
  proposal: new Set(['proposal', 'team-select', 'TEAM_SELECT']),
  voting: new Set(['voting', 'team-vote', 'TEAM_VOTE']),
  quest: new Set(['quest', 'quest-vote', 'QUEST_VOTE']),
  lady: new Set(['lady', 'lady-lake', 'LADY_LAKE']),
  assassination: new Set(['assassination', 'ASSASSINATION']),
};

const asID = (value) => String(value);

const seatIDs = (G) =>
  (Array.isArray(G?.players) ? G.players : []).map((player, index) =>
    asID(player?.id ?? index),
  );

const botIDs = (G) => new Set((Array.isArray(G?.bots) ? G.bots : []).map(asID));

const playerFor = (G, id) =>
  (Array.isArray(G?.players) ? G.players : []).find(
    (player, index) => asID(player?.id ?? index) === asID(id),
  );

const phaseIs = (G, phase) => BOT_PHASES[phase].has(G?.phase);

const hasOwn = (value, key) =>
  value != null && Object.prototype.hasOwnProperty.call(value, key);

const previousProposalNumber = (G) => {
  if (Number.isInteger(G?.proposalNumber)) return G.proposalNumber;
  return Array.isArray(G?.teamVotesHistory) ? G.teamVotesHistory.length : 0;
};

const pendingBot = (G, pending) => {
  const bots = botIDs(G);
  return seatIDs(G).find((id) => bots.has(id) && pending(id));
};

const move = (playerID, name, ...args) => ({ playerID, name, args });

const roleIsEvil = (player) => player?.alignment === 'evil';

function knownEvil(view, id) {
  return Boolean(playerFor(view, id)?.knownEvil);
}

function chooseProposal(G, playerID, view) {
  const size = Number(G.questSizes?.[G.questIndex]);
  if (!Number.isInteger(size) || size < 1) return null;
  const leaderID = asID(G.leaderID ?? G.leader);
  const ids = seatIDs(G);
  const leaderOnTeam =
    G.config?.leaderOnTeam === true || G.rules?.leaderOnTeam === true;
  const ordered = [leaderID, ...ids.filter((id) => id !== leaderID)];
  const me = playerFor(G, playerID);
  const evil = roleIsEvil(me);
  const candidates = ordered.filter((id) => {
    return evil ? knownEvil(view, id) || id === playerID : !knownEvil(view, id);
  });
  let team = candidates.slice(0, size);
  if (leaderOnTeam && !team.includes(leaderID)) {
    team = [leaderID, ...team].slice(0, size);
  }
  for (const id of ordered) {
    if (team.length >= size) break;
    if (!team.includes(id)) team.push(id);
  }
  return team.length === size ? team : null;
}

function chooseVote(G, playerID, view) {
  const proposal = (G.proposal || G.proposedTeam || []).map(asID);
  if (!proposal.length) return null;
  const me = playerFor(G, playerID);
  const evil = roleIsEvil(me);
  const proposalHasEvil = proposal.some(
    (id) => knownEvil(view, id) || (evil && id === playerID),
  );
  const approve = evil
    ? proposalHasEvil
    : !proposalHasEvil || G.rejectedVotes >= 3;
  return [approve, previousProposalNumber(G)];
}

function chooseQuest(G, playerID) {
  const me = playerFor(G, playerID);
  // Good players cannot submit a failure card. Evil players fail the mission
  // whenever they are on the team, which makes the test mode deterministic.
  return [!roleIsEvil(me), previousProposalNumber(G)];
}

function chooseLadyTarget(G, playerID) {
  const used = new Set(
    (G.ladyUsedPlayers || G.ladyHistory || []).map((entry) =>
      asID(entry?.to ?? entry?.target ?? entry),
    ),
  );
  const holder = asID(G.ladyHolder ?? G.lady?.holder ?? playerID);
  return seatIDs(G).find((id) => id !== holder && !used.has(id)) ?? null;
}

/**
 * Return the next server move for one pending bot, or null when a human must
 * make the next decision. The caller should invoke one result at a time.
 */
export function chooseAvalonBotMove(G, viewFor) {
  if (
    !G ||
    !Array.isArray(G.players) ||
    !Array.isArray(G.bots) ||
    G.bots.length === 0
  )
    return null;
  const phase = G.phase;

  if (phaseIs(G, 'dice')) {
    const rolls = G.diceRolls || G.dice || {};
    const tied = G.diceWinners ?? [];
    const id = pendingBot(
      G,
      (playerID) =>
        !hasOwn(rolls, playerID) &&
        (tied.length < 2 || tied.includes(playerID)),
    );
    return id == null ? null : move(id, 'rollDice');
  }

  if (phase === 'fate') {
    return botIDs(G).has(G.leaderID) ? move(G.leaderID, 'drawFate') : null;
  }

  if (phaseIs(G, 'proposal')) {
    const leaderID = asID(G.leaderID ?? G.leader);
    if (!botIDs(G).has(leaderID) || G.proposal) return null;
    const team = chooseProposal(G, leaderID, viewFor(leaderID));
    return team ? move(leaderID, 'proposeTeam', team) : null;
  }

  if (phaseIs(G, 'voting')) {
    const votes = G.votes || {};
    const id = pendingBot(G, (playerID) => !hasOwn(votes, playerID));
    if (id == null) return null;
    const args = chooseVote(G, id, viewFor(id));
    return args ? move(id, 'voteTeam', ...args) : null;
  }

  if (phaseIs(G, 'quest')) {
    const questTeam = (G.proposal || G.proposedTeam || []).map(asID);
    const votes = G.questVotes || {};
    const id = questTeam.find(
      (playerID) => botIDs(G).has(playerID) && !hasOwn(votes, playerID),
    );
    if (id == null) return null;
    return move(id, 'quest', ...chooseQuest(G, id));
  }

  if (phaseIs(G, 'lady')) {
    const holder = asID(G.ladyHolder ?? G.lady?.holder ?? '');
    if (!botIDs(G).has(holder) || G.ladyResult || G.lady?.result) return null;
    const target = chooseLadyTarget(G, holder);
    return target ? move(holder, 'useLady', target) : null;
  }

  if (phaseIs(G, 'assassination')) {
    const assassin = (G.players || []).find(
      (player, index) =>
        botIDs(G).has(asID(player?.id ?? index)) &&
        ['assassin', 'assassin_role'].includes(player?.role),
    );
    if (!assassin) return null;
    const assassinID = asID(assassin.id);
    const targets = seatIDs(G).filter((id) => id !== assassinID);
    const view = viewFor(assassinID);
    const target = targets.find((id) => !knownEvil(view, id)) ?? targets[0];
    return target ? move(assassinID, 'assassinate', target) : null;
  }

  return null;
}

export { BOT_PHASES };
