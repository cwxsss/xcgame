import { createHash } from 'node:crypto';

export function replayMatchID(matchID) {
  return 'replay-' + createHash('sha256').update(matchID).digest('hex');
}
