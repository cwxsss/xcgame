import type { ChatMessage, GameOptions, RoomBot } from '@avalon/types';
import type { GameRecoverySnapshot } from '@/core/game-manager';

/**
 * Private, versioned representation of a room that has not started yet.
 *
 * This is intentionally separate from StartedRoomState: a waiting room is
 * operational state, not a game result, and must never be exposed through the
 * public history collection.  Keep the version on the document so a future
 * schema change can be migrated or ignored without guessing its shape.
 */
export const WAITING_ROOM_SNAPSHOT_VERSION = 1 as const;
export const WAITING_ROOM_SNAPSHOT_COLLECTION = 'waiting_room_snapshots';

export type WaitingRoomSnapshot = {
  snapshotVersion: typeof WAITING_ROOM_SNAPSHOT_VERSION;
  kind: 'waiting';
  roomID: string;
  stage: 'created' | 'locked';
  leaderID: string;
  players: string[];
  options: GameOptions;
  roomBots: RoomBot[];
  chat: ChatMessage[];
  createAt: string;
  updatedAt: Date;
  /** The ordinary room TTL, preserved across a backend restart. */
  expiresAt: Date;
};

export type StartedRoomSnapshot = Omit<WaitingRoomSnapshot, 'kind' | 'stage' | 'options'> & {
  kind: 'started';
  stage: 'started';
  options: GameOptions;
  startAt: string;
  gameRecovery: GameRecoverySnapshot;
};

export type RoomSnapshot = WaitingRoomSnapshot | StartedRoomSnapshot;
export type WaitingRoomSnapshotDocument = RoomSnapshot & { _id?: unknown };

const idPattern = /^[a-zA-Z0-9-]{1,80}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is Date | string {
  return (value instanceof Date || typeof value === 'string') && !Number.isNaN(new Date(value).getTime());
}

/**
 * Validate only the snapshot envelope and bounded collections.  Options and
 * chat entries are written by the live Room and remain opaque here; they are
 * validated again by Room when an operation uses them.
 */
export function parseRoomSnapshot(value: unknown): RoomSnapshot | null {
  if (!isRecord(value) || value.snapshotVersion !== WAITING_ROOM_SNAPSHOT_VERSION) return null;
  if (
    typeof value.roomID !== 'string' ||
    !idPattern.test(value.roomID) ||
    (value.kind !== 'waiting' && value.kind !== 'started') ||
    (value.stage !== 'created' && value.stage !== 'locked' && value.stage !== 'started') ||
    typeof value.leaderID !== 'string' ||
    !idPattern.test(value.leaderID) ||
    !Array.isArray(value.players) ||
    value.players.length < 1 ||
    value.players.length > 10 ||
    !value.players.every((id): id is string => typeof id === 'string' && idPattern.test(id)) ||
    new Set(value.players).size !== value.players.length ||
    !value.players.includes(value.leaderID) ||
    !isRecord(value.options) ||
    !Array.isArray(value.roomBots) ||
    value.roomBots.length > 9 ||
    !value.roomBots.every(
      (bot) =>
        isRecord(bot) &&
        typeof bot.id === 'string' &&
        idPattern.test(bot.id) &&
        (bot.role === undefined || typeof bot.role === 'string'),
    ) ||
    !Array.isArray(value.chat) ||
    value.chat.length > 1000 ||
    !validDate(value.createAt) ||
    !validDate(value.updatedAt) ||
    !validDate(value.expiresAt)
  )
    return null;

  const roomBots = value.roomBots as RoomBot[];
  if (new Set(roomBots.map((bot) => bot.id)).size !== roomBots.length) return null;
  // GameOptions is a TypeScript shape with optional fields; the envelope check
  // above deliberately accepts an object while keeping the cast explicit.
  const options = value.options as unknown as GameOptions;

  if (value.kind === 'started' && (!validDate(value.startAt) || !isRecord(value.gameRecovery))) return null;
  if (value.kind === 'started') {
    const recovery = value.gameRecovery as Record<string, unknown>;
    if (
      recovery.version !== 1 ||
      typeof recovery.seed !== 'string' ||
      !/^[a-f0-9]{64}$/.test(recovery.seed) ||
      typeof recovery.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(recovery.fingerprint) ||
      !Number.isFinite(recovery.startTime) ||
      !Array.isArray(recovery.players) ||
      !recovery.players.every((id) => typeof id === 'string' && idPattern.test(id)) ||
      !Array.isArray(recovery.actions) ||
      recovery.players.length !== value.players.length ||
      [...recovery.players].sort().join('\u0000') !== [...(value.players as string[])].sort().join('\u0000')
    )
      return null;
  }

  const expiresAt = new Date(value.expiresAt as Date | string);
  if (expiresAt.getTime() <= Date.now()) return null;

  const base = {
    snapshotVersion: WAITING_ROOM_SNAPSHOT_VERSION,
    kind: value.kind,
    roomID: value.roomID,
    stage: value.stage,
    leaderID: value.leaderID,
    players: [...value.players] as string[],
    options,
    roomBots: roomBots.map((bot) => ({ id: bot.id, ...(bot.role ? { role: bot.role } : {}) })),
    chat: [...value.chat] as ChatMessage[],
    createAt: new Date(value.createAt as Date | string).toISOString(),
    updatedAt: new Date(value.updatedAt as Date | string),
    expiresAt,
  };

  if (value.kind === 'started') {
    const gameRecovery = value.gameRecovery as GameRecoverySnapshot;
    if (gameRecovery.version !== 1 || gameRecovery.fingerprint === undefined || gameRecovery.seed === undefined)
      return null;
    return {
      ...base,
      kind: 'started',
      stage: 'started',
      options,
      startAt: new Date(value.startAt as Date | string).toISOString(),
      gameRecovery,
    };
  }

  if (base.stage !== 'created' && base.stage !== 'locked') return null;
  return { ...base, kind: 'waiting', stage: base.stage };
}

export const parseWaitingRoomSnapshot = (value: unknown): WaitingRoomSnapshot | null => {
  const snapshot = parseRoomSnapshot(value);
  return snapshot?.kind === 'waiting' ? snapshot : null;
};

export const parseStartedRoomSnapshot = (value: unknown): StartedRoomSnapshot | null => {
  const snapshot = parseRoomSnapshot(value);
  return snapshot?.kind === 'started' ? snapshot : null;
};
