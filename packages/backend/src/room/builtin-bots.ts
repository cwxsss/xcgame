import type { GameManager } from '@/core/game-manager';
import type { GameOptions, TRoles, TAssassinateType } from '@avalon/types';

export type RoomBotConfig = { id: string; role?: TRoles };

/**
 * A deliberately deterministic local opponent. It uses the same public game
 * methods as a human client, so server-side validation and history remain the
 * source of truth. It is not the paid Codex/AI service.
 */
export class BuiltinBotRunner {
  private scheduled = false;
  private stopped = false;

  constructor(private readonly manager: GameManager, private readonly botIDs: Set<string>) {}

  schedule(): void {
    if (this.stopped || this.scheduled) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      if (!this.stopped) this.pump();
    };
    const timer = setTimeout(run, 0);
    timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
  }

  private pump(): void {
    const game = this.manager.game;
    if (game.stage === 'end') return;

    // Bound each turn to keep a malformed configuration from starving the
    // event loop. A state change schedules another pass.
    for (let i = 0; i < 100; i += 1) {
      const before = `${game.stage}:${game.turn}:${game.round}:${game.history.length}`;
      if (game.stage === 'selectTeam') this.selectTeam();
      else if (game.stage === 'votingForTeam') this.voteTeam();
      else if (game.stage === 'onMission') this.playMission();
      else if (game.stage === 'assassinate') this.assassinate();
      else break; // Addons with private intermediate stages require a human.
      const after = `${game.stage}:${game.turn}:${game.round}:${game.history.length}`;
      if (before === after) break;
    }
  }

  private selectTeam(): void {
    const game = this.manager.game;
    const leader = game.leader;
    if (!leader || !this.botIDs.has(leader.userID) || !leader.features.waitForAction) return;
    const count = game.currentMission.data.settings.players;
    // Only use this bot's visibility map. The server knows every role, but a
    // local bot must not gain an oracle advantage over a human player.
    const chosen = game.players
      .slice()
      .sort(
        (a, b) =>
          Number(game.getVisibleRoleState(leader.userID, a.userID) === 'evil') -
          Number(game.getVisibleRoleState(leader.userID, b.userID) === 'evil'),
      )
      .slice(0, count);
    if (game.features.customRules?.leaderOnTeam && !chosen.includes(leader)) {
      chosen[chosen.length - 1] = leader;
    }
    chosen.forEach((p) => this.manager.callGameMethods(leader.userID, { method: 'selectPlayer', playerID: p.userID }));
    this.manager.callGameMethods(leader.userID, { method: 'sentSelectedPlayers' });
  }

  private voteTeam(): void {
    const game = this.manager.game;
    game.players
      .filter((p) => this.botIDs.has(p.userID) && p.features.waitForAction)
      .forEach((p) => {
        try {
          this.manager.callGameMethods(p.userID, { method: 'voteForMission', option: 'approve' });
        } catch {
          // A human may have completed the vote in the same tick.
        }
      });
  }

  private playMission(): void {
    const game = this.manager.game;
    game.players
      .filter((p) => this.botIDs.has(p.userID) && p.features.isSent && p.features.waitForAction)
      .forEach((p) => {
        const result = p.role.loyalty === 'evil' ? 'fail' : 'success';
        try {
          this.manager.callGameMethods(p.userID, { method: 'actionOnMission', result });
        } catch {
          // The final card can advance the game while the list is iterated.
        }
      });
  }

  private assassinate(): void {
    const game = this.manager.game;
    const assassin = game.players.find((p) => this.botIDs.has(p.userID) && p.features.isAssassin && p.features.waitForAction);
    const addon = game.addons.assassin;
    if (!assassin || !addon) return;
    const type = ((addon.progressData?.type || Object.keys(addon.options)[0]) as TAssassinateType | undefined);
    if (!type) return;
    const targetRole = addon.progressData?.possibleTargets?.[0] || 'merlin';
    const target = game.players.find((p) => p.userID !== assassin.userID);
    if (!target) return;
    try {
      this.manager.callGameMethods(assassin.userID, { method: 'selectPlayer', playerID: target.userID });
      this.manager.callGameMethods(assassin.userID, { method: 'assassinate', type, customRole: targetRole });
    } catch {
      // Unsupported custom target stages are intentionally left for a human;
      // room validation prevents the common unsupported addon combinations.
    }
  }
}

export function validateBuiltinBotOptions(options: GameOptions): void {
  const unsupported = Object.entries(options.addons)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  if (unsupported.length) {
    throw new Error(`Built-in AI does not support addons: ${unsupported.join(', ')}`);
  }
  const unsupportedRoles = ['witch', 'cleric', 'revealer', 'tristan', 'isolde'] as const;
  const enabled = unsupportedRoles.filter((role) => Boolean(options.roles[role]));
  if (enabled.length) throw new Error(`Built-in AI does not support roles: ${enabled.join(', ')}`);
}
