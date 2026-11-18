import { TOptionalRoles } from './roles';

import { prop } from '@typegoose/typegoose';

// Типы для таймеров
export class TimerConfig {
  @prop()
  public duration?: number;

  @prop()
  public enabled?: boolean;
}

export class TimerDurations {
  @prop({ type: () => TimerConfig, _id: false })
  public selectTeam?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public firstSelectTeam?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public votingForTeam?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public onMission?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public assassinate?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public checkLoyalty?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public announceLoyalty?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public revealLoyalty?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public giveExcalibur?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public useExcalibur?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public discardMissionCard?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public giveCard?: TimerConfig;

  @prop({ type: () => TimerConfig, _id: false })
  public witchAbility?: TimerConfig;
}

// Validation type helper
type CheckRoleKeys<T> = keyof T extends TOptionalRoles
  ? TOptionalRoles extends keyof T
    ? T
    : 'Missing properties in class: ' & Exclude<TOptionalRoles, keyof T>
  : 'Extra properties in class: ' & Exclude<keyof T, TOptionalRoles>;

export class GameOptionsRoles implements CheckRoleKeys<GameOptionsRoles> {
  @prop()
  public assassin?: number;

  @prop()
  public merlin?: number;

  @prop()
  public percival?: number;

  @prop()
  public merlinPure?: number;

  @prop()
  public tristan?: number;

  @prop()
  public isolde?: number;

  @prop()
  public goodLancelot?: number;

  @prop()
  public guinevere?: number;

  @prop()
  public troublemaker?: number;

  @prop()
  public cleric?: number;

  @prop()
  public morgana?: number;

  @prop()
  public oberon?: number;

  @prop()
  public wraith?: number;

  @prop()
  public mordred?: number;

  @prop()
  public evilLancelot?: number;

  @prop()
  public trickster?: number;

  @prop()
  public lunatic?: number;

  @prop()
  public brute?: number;

  @prop()
  public witch?: number;

  @prop()
  public revealer?: number;
}

export class GameOptionsAddons {
  @prop()
  public trapper?: boolean;

  @prop()
  public ladyOfLake?: boolean;

  @prop()
  public ladyOfSea?: boolean;

  @prop()
  public excalibur?: boolean;

  @prop()
  public plotCards?: boolean;
}

/**
 * Optional house rules used by the custom Avalon table.
 *
 * Every property is optional so persisted rooms created before these rules
 * existed keep their original behavior when loaded.
 */
export class GameOptionsCustomRules {
  /** Deprecated historical setting. New games select the first leader automatically. */
  @prop()
  public diceFirstLeader?: boolean;

  /** The leader must be included in every proposed team. */
  @prop()
  public leaderOnTeam?: boolean;

  /** Deprecated historical setting. New games use the standard assassination timing. */
  @prop()
  public earlyAssassin?: boolean;

  /** Require two Fail cards on quests four and five, regardless of player count. */
  @prop()
  public twoFailsOnRounds4And5?: boolean;

  /** One-based quest numbers at which the Lancelot fate card is drawn. */
  @prop({ type: () => [Number] })
  public lancelotSwitchRounds?: number[];

  /** Do not expose individual quest cards before the game ends. */
  @prop()
  public hideQuestCards?: boolean;

  /** Keep Lancelot identities at their opening alignment after a swap. */
  @prop()
  public hideLancelotIdentities?: boolean;
}

export class GameOptionsFeatures {
  @prop()
  public anonymousVoting?: boolean;

  @prop()
  public hiddenHistory?: boolean;

  @prop()
  public displayIndex?: boolean;

  @prop()
  public lookingForPlayers?: boolean;

  @prop()
  public useCustomTimer?: boolean;

  @prop()
  public wtfMode?: boolean;

  @prop({ type: () => TimerDurations, _id: false })
  public timerDurations?: TimerDurations;

  @prop({ type: () => GameOptionsCustomRules, _id: false })
  public customRules?: GameOptionsCustomRules;
}

export class GameOptions {
  @prop({ required: true, type: () => GameOptionsRoles, _id: false })
  public roles!: GameOptionsRoles;

  @prop({ required: true, type: () => GameOptionsAddons, _id: false })
  public addons!: GameOptionsAddons;

  @prop({ required: true, type: () => GameOptionsFeatures, _id: false })
  public features!: GameOptionsFeatures;
}
