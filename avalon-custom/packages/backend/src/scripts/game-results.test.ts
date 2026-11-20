import type { StartedRoomState } from '@avalon/types';
import type { DBManager } from '@/db';
import { roomModel } from '@/db/models';
import * as ratingOperations from './rating-operations';
import { GameResultWorker } from './game-results';

jest.mock('@/db/models', () => ({
  roomModel: {
    find: jest.fn(),
  },
}));

jest.mock('./updateTrueSkillRatings', () => ({
  updateTrueSkillForGame: jest.fn(),
}));

jest.mock('./rating-operations', () => ({
  drainRatingOperations: jest.fn(),
  setGameCompletionHandler: jest.fn(),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function state(roomID: string) {
  return { roomID } as unknown as StartedRoomState;
}

function configureRoomQuery() {
  const query = {
    sort: jest.fn(),
    limit: jest.fn(),
    maxTimeMS: jest.fn(),
    lean: jest.fn().mockResolvedValue([]),
  };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.maxTimeMS.mockReturnValue(query);
  (roomModel.find as unknown as jest.Mock).mockReturnValue(query);
}

beforeEach(() => {
  jest.clearAllMocks();
  configureRoomQuery();
  (ratingOperations.drainRatingOperations as jest.Mock).mockResolvedValue(undefined);
});

test('a submission during an active flush is archived before its promise resolves', async () => {
  const firstRating = deferred();
  const ratingStarted = deferred();
  (ratingOperations.drainRatingOperations as jest.Mock).mockImplementationOnce(async () => {
    ratingStarted.resolve();
    await firstRating.promise;
  });
  const saveRoomToDB = jest.fn().mockResolvedValue(undefined);
  const worker = new GameResultWorker({ saveRoomToDB } as unknown as DBManager, async () => {});

  const first = worker.submit(state('first'));
  await ratingStarted.promise;
  const second = worker.submit(state('second'));

  await worker.flushArchives();
  await first;
  await second;

  expect(saveRoomToDB.mock.calls.map(([saved]) => saved.roomID)).toEqual(['first', 'second']);
  firstRating.resolve();
  await worker.flush();
});

test('flushArchives persists pending submissions without waiting for rating processing', async () => {
  const firstRating = deferred();
  const ratingStarted = deferred();
  (ratingOperations.drainRatingOperations as jest.Mock).mockImplementationOnce(async () => {
    ratingStarted.resolve();
    await firstRating.promise;
  });
  const saveRoomToDB = jest.fn().mockResolvedValue(undefined);
  const worker = new GameResultWorker({ saveRoomToDB } as unknown as DBManager, async () => {});

  const first = worker.submit(state('first'));
  await ratingStarted.promise;
  const second = worker.submit(state('second'));

  await worker.flushArchives();
  expect(saveRoomToDB.mock.calls.map(([saved]) => saved.roomID)).toEqual(['first', 'second']);

  await Promise.all([first, second]);
  firstRating.resolve();
  await worker.flush();
});

test('rating failure does not reject another room archive already being written', async () => {
  const ratingFailure = deferred();
  const ratingStarted = deferred();
  (ratingOperations.drainRatingOperations as jest.Mock).mockImplementationOnce(async () => {
    ratingStarted.resolve();
    await ratingFailure.promise;
    throw Error('rating failed');
  });
  const secondSave = deferred();
  const secondSaveStarted = deferred();
  const saveRoomToDB = jest.fn().mockImplementation(async (saved: StartedRoomState) => {
    if (saved.roomID === 'second') {
      secondSaveStarted.resolve();
      await secondSave.promise;
    }
  });
  const worker = new GameResultWorker({ saveRoomToDB } as unknown as DBManager, async () => {});

  const first = worker.submit(state('first'));
  await ratingStarted.promise;
  const second = worker.submit(state('second'));
  await secondSaveStarted.promise;
  ratingFailure.resolve();
  await expect(worker.flush()).rejects.toThrow('rating failed');

  secondSave.resolve();
  await Promise.all([first, second]);
});
