import { Character } from '@/core/roles/abstract';
import type { TVisibility } from '@/core/roles/interface';
import type { TLoyalty, TRoles } from '@avalon/types';

/**
 * The dedicated Assassin is an actual Evil role, not a flag assigned to a
 * randomly selected Evil player.  The assassination addon marks this seat as
 * the executor when the game reaches its assassination stage.
 */
export class Assassin extends Character {
  role: TRoles = 'assassin';
  selfRole: TRoles = 'assassin';
  loyalty: TLoyalty = 'evil';

  visibility: TVisibility = {
    assassin: 'evil',
    minion: 'evil',
    morgana: 'evil',
    mordred: 'evil',
    lunatic: 'evil',
    trickster: 'evil',
    brute: 'evil',
    witch: 'evil',
    evilLancelot: 'evilLancelot',
    revealer: 'evil',
  };
}
