export function rankSplendorScores(scores = [], skippedPlayers = []) {
  const skipped = new Set(skippedPlayers.map(String));
  const ordered = [...scores].sort((a, b) => {
    const aSkipped = skipped.has(String(a.playerID));
    const bSkipped = skipped.has(String(b.playerID));
    return (
      Number(aSkipped) - Number(bSkipped) ||
      b.points - a.points ||
      a.cards - b.cards
    );
  });

  return ordered.map((score, index) => {
    const isSkipped = skipped.has(String(score.playerID));
    const firstMatchingIndex = ordered.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex <= index &&
        !skipped.has(String(candidate.playerID)) &&
        candidate.points === score.points &&
        candidate.cards === score.cards,
    );
    return {
      ...score,
      rank: isSkipped ? '—' : firstMatchingIndex + 1,
      skipped: isSkipped,
    };
  });
}
