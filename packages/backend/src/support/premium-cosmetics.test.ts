import { AvatarsManager } from '@/user/avatars';
import { StickersManager } from '@/stickers';
import type { DBManager } from '@/db';
import { DEFAULT_STICKER_FAVORITES } from '@avalon/types';

let total = 0;
let features: Record<string, unknown> = {};
let savedAvatar = 'servant';
jest.mock('@/support/repository', () => ({ supportTotalCents: async () => total }));
jest.mock('@/db/models', () => ({
  roomModel: {
    find: () => ({
      maxTimeMS: () => ({
        lean: () => ({
          cursor: () => ({
            [Symbol.asyncIterator]: async function* () {
              yield* [];
            },
            close: async () => {},
          }),
        }),
      }),
    }),
  },
  userAchievementModel: { find: () => ({ lean: async () => [] }) },
  userFeaturesModel: {
    findOne: () => ({ lean: async () => features }),
    updateOne: async (_query: unknown, update: { $set: Record<string, unknown> }) => {
      features = { ...features, ...update.$set };
    },
  },
}));
const db = {
  getUserByID: async () => ({ id: 'player', registrationDate: new Date() }),
  getUserFeatures: async () => features,
  getUserCompletedAchievements: async () => [],
  updateUserAvatar: async (_id: string, avatar: string) => {
    savedAvatar = avatar;
  },
} as unknown as DBManager;

test('all listed avatars are available to guests and can be equipped', async () => {
  const manager = new AvatarsManager(db);
  const avatars = await manager.getAvailableAvatarsForUser('player');
  expect(Array.isArray(avatars)).toBe(true);
  if (!Array.isArray(avatars)) throw Error('Avatar list missing');
  expect(avatars).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'lady_of_lake' })]));
  for (const avatar of avatars) {
    expect(avatar.available).toBe(true);
    expect(await manager.updateUserAvatar('player', avatar.id)).toBe(true);
  }
});

beforeEach(() => {
  total = 0;
  features = {};
  savedAvatar = 'servant';
});

test.each(['guest', 'paid', 'manual'])('%s players can use all former Premium cosmetics', async (mode) => {
  total = mode === 'paid' ? 1000 : 0;
  features = { showPremiumBadge: false, ...(mode === 'manual' ? { premiumGrantedAt: new Date() } : {}) };
  const avatars = new AvatarsManager(db);
  for (const id of ['premium/puppeteer', 'premium/eclipse-queen']) {
    expect(await avatars.updateUserAvatar('player', id)).toBe(true);
    expect(savedAvatar).toBe(id);
  }
  const stickers = new StickersManager();
  expect((await stickers.collection('player')).stickers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'mordred-puppet', available: true }),
      expect.objectContaining({ id: 'morgana-violin', available: true }),
    ]),
  );
  expect(await stickers.preferences('player', ['morgana-violin'], false)).toMatchObject({
    favorites: ['morgana-violin'],
  });
  let delivered = false;
  expect(
    await stickers.authorizeSend('player', 'morgana-violin', () => {
      delivered = true;
    }),
  ).toBe(true);
  expect(delivered).toBe(true);
});

test('payment changes preserve free cosmetics and favorites', async () => {
  total = 1000;
  features = { favoriteStickers: ['servant-yes', 'mordred-puppet'] };
  const manager = new StickersManager();
  expect((await manager.collection('player')).favorites).toEqual(['servant-yes', 'mordred-puppet']);
  total = 999;
  expect((await manager.collection('player')).favorites).toEqual(['servant-yes', 'mordred-puppet']);
  expect(await new AvatarsManager(db).updateUserAvatar('player', 'premium/eclipse-queen')).toBe(true);
});

test('premium stickers never enter a new player’s starter favorites', () => {
  expect(DEFAULT_STICKER_FAVORITES).not.toContain('mordred-puppet');
  expect(DEFAULT_STICKER_FAVORITES).not.toContain('morgana-violin');
});

test('sticker delivery failure is awaited and does not consume the send cooldown', async () => {
  const stickers = new StickersManager();
  await expect(
    stickers.authorizeSend('player', 'servant-yes', async () => {
      throw Error('database unavailable');
    }),
  ).rejects.toThrow('database unavailable');
  let delivered = false;
  expect(
    await stickers.authorizeSend('player', 'servant-yes', async () => {
      delivered = true;
    }),
  ).toBe(true);
  expect(delivered).toBe(true);
});
