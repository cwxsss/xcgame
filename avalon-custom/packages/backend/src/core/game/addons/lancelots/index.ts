import { IGameAddon } from '@/core/game/addons/interface';
import { Game } from '@/core/game';
import type { TSwitchesArray } from '@/core/game/addons/lancelots/interface';
import { SwitchLancelotsHistory } from '@/core/game/addons/lancelots/switch-lancelots';
import { of } from 'rxjs';

export class LancelotsAddon implements IGameAddon {
  addonName = 'lancelots';
  switches: TSwitchesArray;
  pointer: number = 0;
  game: Game;

  constructor(game: Game) {
    this.game = game;
    this.switches = this.game.runtime.shuffle([true, true, false, false, false]);
  }

  beforeSelectTeam() {
    const configuredRounds = this.game.features.customRules?.lancelotSwitchRounds;
    const switchRounds = configuredRounds?.length ? configuredRounds : [3, 4, 5];
    const currentQuest = this.game.round + 1;
    if (this.game.turn === 0 && switchRounds.includes(currentQuest) && this.pointer < this.switches.length) {
      this.game.stage = 'switchLancelots';
      const currentSwitch = this.switches[this.pointer];
      const goodLancelot = this.game.players.find((player) => player.role.selfRole === 'goodLancelot')!;
      const evilLancelot = this.game.players.find((player) => player.role.selfRole === 'evilLancelot')!;

      const switchLancelots = new SwitchLancelotsHistory(goodLancelot, evilLancelot, this.pointer, this.switches);

      this.game.history.push(switchLancelots);

      if (currentSwitch) {
        goodLancelot.role.role = 'evilLancelot';
        goodLancelot.role.selfRole = 'evilLancelot';
        goodLancelot.role.loyalty = 'evil';
        evilLancelot.role.role = 'goodLancelot';
        evilLancelot.role.selfRole = 'goodLancelot';
        evilLancelot.role.loyalty = 'good';
        this.updateRolesVisibility();
      }

      this.game.stateObserver.gameStateChanged();
      this.pointer += 1;
    }

    return of(true);
  }

  updateRolesVisibility() {
    if (this.game.features.customRules?.hideLancelotIdentities) {
      // Keep every observer's opening Lancelot clues stable. Each Lancelot
      // still sees their own new role, while the public fate history carries
      // only the fact that a swap occurred.
      this.game.players
        .filter((player) => player.role.role === 'goodLancelot' || player.role.role === 'evilLancelot')
        .forEach((player) => {
          this.game.updateVisibleRolesState(player.userID, { [player.userID]: player.role.selfRole });
        });
      return;
    }

    Object.entries(this.game.visibleRolesState).forEach(([id, value]) => {
      Object.entries(value).forEach(([targetId, role]) => {
        if (role === 'evilLancelot') {
          this.game.updateVisibleRolesState(id, { [targetId]: 'goodLancelot' });
        }

        if (role === 'goodLancelot') {
          this.game.updateVisibleRolesState(id, { [targetId]: 'evilLancelot' });
        }
      });
    });
  }
}
