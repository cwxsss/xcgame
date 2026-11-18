import { DBManager } from '@/db';
import { IAvatar } from '@/user/avatars/abstract';
import { commonAvatars } from '@/user/avatars/common';
import { ArgumentOfCallback } from '@avalon/types';
import { achievementsAvatars } from '@/user/avatars/achievements';
import { PREMIUM_AVATAR_IDS } from '@avalon/types/user/avatars';

const premiumAvatars: IAvatar[] = PREMIUM_AVATAR_IDS.map((id) => ({
  id,
  premium: true,
  isAvailableForUser: ({ premium }) => premium === true,
}));

export class AvatarsManager {
  dbManager: DBManager;
  avatars: IAvatar[] = [...commonAvatars, ...premiumAvatars, ...achievementsAvatars];

  constructor(dbManager: DBManager) {
    this.dbManager = dbManager;
  }

  async getAvailableAvatarsForUser(_userID: string): Promise<ArgumentOfCallback<'getUserAvatars'>> {
    return this.avatars.map(({ id }) => ({ id, available: true }));
  }

  async updateUserAvatar(userID: string, avatarID: string): Promise<ArgumentOfCallback<'updateUserAvatar'>> {
    const avatar = this.avatars.find((el) => el.id === avatarID);

    if (!avatar) {
      return { error: 'avatarNotExist' };
    }

    await this.dbManager.updateUserAvatar(userID, avatarID);

    return true;
  }
}
