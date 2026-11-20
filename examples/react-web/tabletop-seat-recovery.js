import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// The code is deliberately short enough to type on a phone, but never stored
// in room metadata. Only its SHA-256 digest is kept server-side.
export const SEAT_RECOVERY_TTL_MS = 10 * 60 * 1000;

const recoveryCodePattern = /^[A-F0-9]{10}$/;

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function sameDigest(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftDigest = Buffer.from(left, 'hex');
  const rightDigest = Buffer.from(right, 'hex');
  return (
    leftDigest.length === rightDigest.length &&
    timingSafeEqual(leftDigest, rightDigest)
  );
}

export function normalizeSeatRecoveryCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return recoveryCodePattern.test(code) ? code : null;
}

export function hashSeatRecoveryCode(code) {
  const normalized = normalizeSeatRecoveryCode(code);
  return normalized ? digest(normalized).toString('hex') : null;
}

function hashCredentials(credentials) {
  return typeof credentials === 'string'
    ? digest(credentials).toString('hex')
    : null;
}

export function createSeatRecoveryCode() {
  return randomBytes(5).toString('hex').toUpperCase();
}

export function issueSeatRecovery(
  metadata,
  playerID,
  credentials,
  code = createSeatRecoveryCode(),
  now = Date.now(),
) {
  const normalized = normalizeSeatRecoveryCode(code);
  const credentialDigest = hashCredentials(credentials);
  if (!normalized || !credentialDigest) return null;
  const expiresAt = now + SEAT_RECOVERY_TTL_MS;
  const records =
    metadata?._seatRecovery && typeof metadata._seatRecovery === 'object'
      ? metadata._seatRecovery
      : {};
  return {
    metadata: {
      ...metadata,
      _seatRecovery: {
        ...records,
        [String(playerID)]: {
          codeHash: hashSeatRecoveryCode(normalized),
          credentialsHash: credentialDigest,
          expiresAt,
        },
      },
    },
    recoveryCode: normalized,
    expiresAt,
  };
}

/**
 * Consume a code and rotate the seat credential in one metadata transition.
 * The caller must persist the returned metadata while holding the room queue.
 */
export function consumeSeatRecovery(
  metadata,
  recoveryCode,
  nextCredentials,
  now = Date.now(),
) {
  const codeHash = hashSeatRecoveryCode(recoveryCode);
  if (!codeHash || typeof nextCredentials !== 'string') return null;
  const records = metadata?._seatRecovery;
  if (!records || typeof records !== 'object') return null;
  const entry = Object.entries(records).find(([, record]) =>
    sameDigest(record?.codeHash, codeHash),
  );
  if (!entry) return null;
  const [playerID, record] = entry;
  const player = metadata.players?.[playerID];
  if (
    !player?.credentials ||
    !sameDigest(record.credentialsHash, hashCredentials(player.credentials)) ||
    !Number.isFinite(record.expiresAt) ||
    record.expiresAt <= now
  )
    return null;

  const players = {
    ...metadata.players,
    [playerID]: { ...player, credentials: nextCredentials },
  };
  const nextRecords = { ...records };
  delete nextRecords[playerID];
  return {
    playerID,
    metadata: { ...metadata, players, _seatRecovery: nextRecords },
  };
}
