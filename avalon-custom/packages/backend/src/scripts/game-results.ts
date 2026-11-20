import type { StartedRoomState, VisualGameState } from '@avalon/types';
import { DBManager } from '@/db';
import { roomModel } from '@/db/models';
import { updateTrueSkillForGame } from './updateTrueSkillRatings';
import { drainRatingOperations, setGameCompletionHandler } from './rating-operations';

/** The archive is the durable outbox; memory only covers a failed initial insert. */
type PendingArchive = {
  state: StartedRoomState;
  version: number;
};
type SubmitWaiter = {
  version: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};

export class GameResultWorker {
  private pending = new Map<string, PendingArchive>();
  private waiters = new Map<string, SubmitWaiter[]>();
  private nextVersion = 0;
  private running?: Promise<void>;
  private archiveRunning?: Promise<void>;
  constructor(
    private db: DBManager,
    achievements: (game: VisualGameState, sequence: number) => Promise<void>,
  ) {
    setGameCompletionHandler(async (game, sequence) => {
      await achievements(game, sequence);
    });
  }
  submit(state: StartedRoomState): Promise<void> {
    const version = ++this.nextVersion;
    this.pending.set(state.roomID, { state: structuredClone(state), version });
    const promise = new Promise<void>((resolve, reject) => {
      const roomWaiters = this.waiters.get(state.roomID) ?? [];
      roomWaiters.push({ version, resolve, reject });
      this.waiters.set(state.roomID, roomWaiters);
    });
    // The caller observes failures through the room-specific promise below.
    void this.flushArchives().catch(() => undefined);
    void this.flush().catch(() => undefined);
    return promise;
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    let succeeded = false;
    const running = this.run()
      .then(() => {
        succeeded = true;
      })
      .finally(() => {
        if (this.running === running) this.running = undefined;
        // A submission can arrive in the tiny window after run() checked the
        // queue but before its promise is cleared. Do not leave it stranded.
        if (!succeeded || !this.pending.size) return;
        void this.flush().catch(() => undefined);
      });
    this.running = running;
    return running;
  }
  /** Persist only the in-memory archive queue, without waiting for ratings. */
  flushArchives(): Promise<void> {
    if (this.archiveRunning) return this.archiveRunning;
    let succeeded = false;
    const running = this.runArchives()
      .then(() => {
        succeeded = true;
      })
      .finally(() => {
        if (this.archiveRunning === running) this.archiveRunning = undefined;
        if (succeeded && this.pending.size) void this.flushArchives().catch(() => undefined);
      });
    this.archiveRunning = running;
    return running;
  }
  private async run() {
    do {
      await this.flushArchives();
      await drainRatingOperations();
      const pending = await roomModel
        .find({ completionPending: true }, { roomID: 1, startAt: 1, players: 1, game: 1 })
        .sort({ _id: 1 })
        .limit(20)
        .maxTimeMS(10000)
        .lean();
      for (const state of pending) {
        await this.db.updateLastGameDate(
          state.players.map((p) => p.id),
          new Date(state.startAt),
        );
        await updateTrueSkillForGame(state.game);
        await roomModel.updateOne({ roomID: state.roomID }, { $set: { completionPending: false } });
      }
    } while (this.pending.size);
  }
  private async runArchives() {
    while (this.pending.size) {
      // Snapshot entries so a submission during a write remains a distinct
      // queue item and cannot be deleted by the earlier write's cleanup.
      const batch = [...this.pending.entries()];
      for (const [id, entry] of batch) {
        try {
          await this.db.saveRoomToDB(entry.state);
        } catch (error) {
          this.rejectWaitersForVersion(id, entry.version, error);
          throw error;
        }
        if (this.pending.get(id) === entry) this.pending.delete(id);
        this.resolveWaitersForVersion(id, entry.version);
      }
    }
  }
  private resolveWaitersForVersion(id: string, version: number) {
    const roomWaiters = this.waiters.get(id);
    if (!roomWaiters) return;
    const remaining: SubmitWaiter[] = [];
    for (const waiter of roomWaiters) {
      if (waiter.version <= version) waiter.resolve();
      else remaining.push(waiter);
    }
    if (remaining.length) this.waiters.set(id, remaining);
    else this.waiters.delete(id);
  }
  private rejectWaitersForVersion(id: string, version: number, error: unknown) {
    const roomWaiters = this.waiters.get(id);
    if (!roomWaiters) return;
    const remaining: SubmitWaiter[] = [];
    for (const waiter of roomWaiters) {
      if (waiter.version === version) waiter.reject(error);
      else remaining.push(waiter);
    }
    if (remaining.length) this.waiters.set(id, remaining);
    else this.waiters.delete(id);
  }
}
