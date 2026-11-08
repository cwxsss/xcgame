const { ALIGNMENT, ROLES, DEFAULT_RULES, GAME_PHASES, PRESET_MODES, checkPlayerNameValidity } = require('./constants');
const { calculatePlayerVision } = require('./VisionCalculator');

class AvalonGame {
  constructor(roomId, hostId, hostName, hostAvatar = '🧙') {
    this.roomId = roomId;
    this.hostId = hostId;
    this.createdAt = Date.now();

    // 玩家列表 (按加入或指定座位号排序)
    this.players = [];

    // 房间配置
    this.config = {
      playerCount: 5,
      presetMode: 'classic',    // 当前应用的玩法预设 ('classic', 'lancelot', 'mordred', 'oberon', 'all_star', 'custom')
      isCustomized: false,      // 是否被房主手动自定义过，若为true则人数变动绝不覆盖角色
      // 默认开启的角色配置 (5人经典标准局: 3好2坏)
      roles: ['merlin', 'percival', 'loyal', 'assassin', 'morgana'],
      enableLadyOfLake: false,  // 湖中仙女
      enableLancelot: false,    // 兰斯洛特互换身份开关
      speechTimeLimit: 60,      // 发言限时（秒）
      twoFailsOnRound4: false,  // 第4轮双失败
      questCapacities: [2, 3, 2, 3, 3], // 5人标准出征人数 (第1轮2人、第2轮3人、第3轮2人、第4轮3人、第5轮3人)
      allowEarlyAssassination: true // 默认开启蓝方三胜前刺杀 (刺客随时拍刀)
    };

    // 游戏阶段
    this.phase = GAME_PHASES.LOBBY;

    // 实时游戏核心状态
    this.state = {
      currentRound: 1,          // 第 1 ~ 5 轮
      leaderIndex: 0,           // 当前队长索引
      attemptCount: 0,          // 连倒次数 (0~5)
      proposedTeam: [],         // 队长提议的出征队员 ID 列表
      teamVotes: {},            // 车票公开投票 { [playerId]: 'approve' | 'reject' }
      lastTeamVoteResult: null, // 最近一次车票公投详细公开结果（谁投了赞成、谁投了反对）
      teamVoteHistory: [],      // 所有车票公投历史记录矩阵
      questVotes: [],           // 任务暗投结果 ['success', 'fail'] (打乱公布)
      questPlayerIds: [],       // 哪些队员已暗投
      roundHistory: [],         // 历史局数总结
      scores: { good: 0, evil: 0 },
      winner: null,             // 'good' | 'evil'
      winReason: '',
      assassinTarget: null,

      // 骰子比拼数据（决定首发司机）
      diceRolls: {},            // { [playerId]: number }
      diceWinners: [],          // 最高点数者玩家 IDs

      // 湖中仙女数据
      ladyHolder: null,         // 当前持有者 ID
      ladyHistory: [],          // [{ from, to, result }]
      ladyUsedPlayers: [],      // 已被验过的人

      // 兰斯洛特阵营转换数据
      lancelotSwitched: false,  // 当前善恶兰斯洛特是否处于互换状态
      lancelotDeck: [],         // 命运牌堆 ['switch', 'no_switch', ...]
      lancelotHistory: [],      // [{ round, card, switched }]
      currentLancelotDraw: null,// 当前轮抽牌结果

      // 发言系统状态
      speech: {
        active: false,
        mode: 'clockwise',      // 'clockwise' | 'counter-clockwise' | 'free'
        speakerId: null,
        speakerIndex: 0,
        order: [],              // 玩家 ID 列表
        timeLeft: 60,
        isPaused: false
      }
    };

    // 添加房主为第一个玩家
    this.addPlayer(hostId, hostName, hostAvatar);
  }

  // --- 玩家管理 ---

  addPlayer(id, name, avatar = '👤') {
    if (this.players.some(p => p.id === id)) return;
    if (this.players.length >= 10 && this.phase === GAME_PHASES.LOBBY) {
      throw new Error('房间人数已达上限（10人）');
    }

    // 核心校验：玩家昵称严禁包含游戏角色身份名称（如梅林、刺客等）
    const nameCheck = checkPlayerNameValidity(name);
    if (!nameCheck.valid) {
      throw new Error(nameCheck.message);
    }

    const seatNumber = this.players.length + 1;
    const player = {
      id,
      name,
      avatar,
      seatNumber,
      role: null,
      isOnline: true,
      ready: false
    };
    this.players.push(player);
    this.autoAdjustConfig();
    return player;
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.players.splice(idx, 1);
      // 重新排序座位号
      this.players.forEach((p, i) => { p.seatNumber = i + 1; });
      if (this.hostId === id && this.players.length > 0) {
        this.hostId = this.players[0].id;
      }
      this.autoAdjustConfig();
    }
  }

  // 玩家调整/认领自己的真实物理座位号 (1 ~ N)
  changeSeatNumber(playerId, newSeatNumber) {
    const seatNum = parseInt(newSeatNumber, 10);
    if (isNaN(seatNum) || seatNum < 1 || seatNum > this.players.length) {
      throw new Error(`座位号必须在 1 到 ${this.players.length} 之间`);
    }

    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('玩家不存在');
    if (player.seatNumber === seatNum) return; // 座位没变

    const oldSeatNumber = player.seatNumber;
    // 检查目标座位是否已有玩家，若有则对调两人的座位号
    const occupyingPlayer = this.players.find(p => p.seatNumber === seatNum);
    if (occupyingPlayer) {
      occupyingPlayer.seatNumber = oldSeatNumber;
    }
    player.seatNumber = seatNum;

    // 重新按座位号升序排布 players 数组，保证顺时针轮转完全与线下实际座次精确匹配
    this.players.sort((a, b) => a.seatNumber - b.seatNumber);

    // 如果队长已经确定，重新校准队长索引
    if (this.state.diceWinners && this.state.diceWinners.length === 1) {
      const leaderIdx = this.players.findIndex(p => p.id === this.state.diceWinners[0]);
      if (leaderIdx !== -1) this.state.leaderIndex = leaderIdx;
    }

    return { oldSeat: oldSeatNumber, newSeat: seatNum };
  }

  // 当人数变化或切换预设时，智能更新出征人数表与预设角色池
  autoAdjustConfig(force = false) {
    const rawCount = this.players.length;
    // 若房间人数不足5人（如房主刚建房配置阶段），按基准5人局规格计算预设角色池与出征表
    const count = Math.max(5, Math.min(10, rawCount));
    this.config.playerCount = rawCount >= 5 ? rawCount : 5;
    const def = DEFAULT_RULES[count];
    this.config.questCapacities = [...def.quests];
    this.config.twoFailsOnRound4 = def.twoFailsOnRound4;

    // 仅当房主尚未自定义角色、或者显式强制重置/点击玩法预设时，使用预设规则填充角色池
    // 避免新玩家入座时覆盖房主精心配置的 roles（如自定义善恶兰斯洛特）
    if (this.phase === GAME_PHASES.LOBBY && (!this.config.isCustomized || force)) {
      const presetKey = this.config.presetMode || 'classic';
      const preset = PRESET_MODES[presetKey] || PRESET_MODES.classic;
      this.config.roles = preset.buildRoles(def.good, def.evil);
      this.config.enableLancelot = !!preset.enableLancelot;
      this.config.enableLadyOfLake = !!preset.enableLadyOfLake;
    }
  }

  // 应用特定玩法预设（一键切换经典、兰斯洛特、莫德雷德、奥伯伦、全拓展等）
  applyPresetMode(presetKey) {
    if (this.phase !== GAME_PHASES.LOBBY) {
      throw new Error('游戏进行中无法更改玩法预设');
    }
    const preset = PRESET_MODES[presetKey];
    if (!preset) throw new Error(`未知的玩法预设: ${presetKey}`);

    this.config.presetMode = presetKey;
    this.config.isCustomized = false; // 切换预设时重置自定义标记
    this.autoAdjustConfig(true); // 强制刷新角色
  }

  // 恢复当前人数的标准推荐角色配置
  resetToRecommendedConfig() {
    this.config.presetMode = 'classic';
    this.config.isCustomized = false;
    this.autoAdjustConfig(true);
  }

  // 更新房间设置（房主自定义微调勾选角色）
  updateConfig(newConfig) {
    if (this.phase !== GAME_PHASES.LOBBY) {
      throw new Error('游戏进行中无法更改配置');
    }
    // 标记为用户手动自定义，防止后续新玩家入座时 autoAdjustConfig 覆盖
    this.config = {
      ...this.config,
      ...newConfig,
      isCustomized: true,
      presetMode: 'custom'
    };
    // 智能同步兰斯洛特开关：若自定义角色包含善兰或恶兰，自动开启兰斯洛特换阵营逻辑
    if (this.config.roles) {
      this.config.enableLancelot = this.config.roles.includes('good_lancelot') || this.config.roles.includes('evil_lancelot');
    }
  }

  // --- 身份分配 (系统自动随机洗牌分配) ---

  startRoleAssignment() {
    if (this.players.length < 5) {
      throw new Error('阿瓦隆至少需要 5 名玩家');
    }
    if (this.config.roles.length !== this.players.length) {
      throw new Error(`配置的角色数量 (${this.config.roles.length}) 与实际玩家人数 (${this.players.length}) 不一致！`);
    }

    // 确保出征人数表精准对应当前人数规则 (5人局: [2, 3, 2, 3, 3])
    const countRules = DEFAULT_RULES[this.players.length] || DEFAULT_RULES[5];
    this.config.questCapacities = [...countRules.quests];
    this.config.twoFailsOnRound4 = countRules.twoFailsOnRound4;

    // 系统直接随机洗牌分配角色给每个玩家
    const shuffledRoles = [...this.config.roles].sort(() => Math.random() - 0.5);
    this.players.forEach((p, idx) => {
      p.role = shuffledRoles[idx];
      p.effectiveTeam = ROLES[p.role].team;
      p.isLancelotSwitched = false;
    });
    this.initLancelotState();

    // 角色分发完毕，直接进入掷骰子环节决定首位发车队长！
    this.phase = GAME_PHASES.DICE_ROLL;
    this.initDicePhase();
  }

  hasLancelot() {
    return this.players.some(p => p.role === 'good_lancelot' || p.role === 'evil_lancelot');
  }

  initLancelotState() {
    this.players.forEach(p => {
      if (p.role) {
        p.effectiveTeam = ROLES[p.role].team;
        p.isLancelotSwitched = false;
      }
    });
    // 兰斯洛特官方经典 7 张命运牌：2 张 switch, 5 张 no_switch
    const deck = ['switch', 'switch', 'no_switch', 'no_switch', 'no_switch', 'no_switch', 'no_switch'];
    this.state.lancelotDeck = deck.sort(() => Math.random() - 0.5);
    this.state.lancelotSwitched = false;
    this.state.lancelotHistory = [];
    this.state.currentLancelotDraw = null;
  }

  // 手动认领角色
  claimRole(playerId, roleId) {
    if (this.phase !== GAME_PHASES.ROLE_SELECTION) {
      throw new Error('当前不在角色选择阶段');
    }
    // 检查池中该角色剩余数量
    const totalAllowed = this.config.roles.filter(r => r === roleId).length;
    const currentClaimed = this.players.filter(p => p.role === roleId).length;
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('玩家不存在');

    if (player.role === roleId) {
      // 取消认领
      player.role = null;
      return;
    }

    if (currentClaimed >= totalAllowed) {
      throw new Error('该角色已被认领完毕');
    }

    player.role = roleId;

    // 检查是否所有人都选好了角色
    const allClaimed = this.players.every(p => p.role !== null);
    if (allClaimed) {
      this.initLancelotState();
      this.phase = GAME_PHASES.DICE_ROLL;
      this.initDicePhase();
    }
  }

  // --- 掷骰子决定首发发车司机 (核心需求) ---

  initDicePhase() {
    this.state.diceRolls = {};
    this.state.diceWinners = [];
  }

  rollDice(playerId) {
    if (this.phase !== GAME_PHASES.DICE_ROLL) {
      throw new Error('当前不是掷骰子环节');
    }
    if (this.state.diceRolls[playerId]) {
      throw new Error('您已经投掷过骰子了');
    }

    const val = Math.floor(Math.random() * 6) + 1; // 1 ~ 6
    this.state.diceRolls[playerId] = val;

    // 检查是否全员都投掷完毕
    const allRolled = this.players.every(p => this.state.diceRolls[p.id] !== undefined);
    if (allRolled) {
      this.computeDiceWinner();
    }
    return val;
  }

  // 房主也可以一键为所有未投玩家摇骰子
  rollAllRemainingDice() {
    this.players.forEach(p => {
      if (!this.state.diceRolls[p.id]) {
        this.state.diceRolls[p.id] = Math.floor(Math.random() * 6) + 1;
      }
    });
    this.computeDiceWinner();
  }

  computeDiceWinner() {
    let max = -1;
    let winners = [];
    this.players.forEach(p => {
      const val = this.state.diceRolls[p.id] || 0;
      if (val > max) {
        max = val;
        winners = [p.id];
      } else if (val === max) {
        winners.push(p.id);
      }
    });

    this.state.diceWinners = winners;

    if (winners.length === 1) {
      // 唯一最高点！直接确定队长
      const leaderIndex = this.players.findIndex(p => p.id === winners[0]);
      this.state.leaderIndex = leaderIndex;

      // 如果启用了湖中仙女，通常发给队长右侧（即最后发言的上一位玩家）
      if (this.config.enableLadyOfLake) {
        const ladyIndex = (leaderIndex - 1 + this.players.length) % this.players.length;
        this.state.ladyHolder = this.players[ladyIndex].id;
      }
      // 不再使用异步延迟，由掷出最高点数的车主（或房主）点击【立即发车】按钮进入选人，彻底消除卡死！
    } else {
      // 平局（多名玩家点数相同最高），保持在 DICE_ROLL，等待平局加投
    }
  }

  // 掷出最高点数的车主（或房主）确认点击发车，进入出征选人环节
  startDrive(operatorId) {
    if (this.phase !== GAME_PHASES.DICE_ROLL) {
      throw new Error('当前不是发车准备阶段');
    }
    if (!this.state.diceWinners || this.state.diceWinners.length !== 1) {
      throw new Error('尚未投出唯一最高点车主，无法发车');
    }
    const winnerId = this.state.diceWinners[0];
    if (operatorId !== winnerId && operatorId !== this.hostId) {
      throw new Error('只有发车车主或房主可以点击开启发车！');
    }

    this.phase = GAME_PHASES.TEAM_SELECT;
  }

  // 针对最高分并列玩家重投
  rerollTiedPlayers() {
    const winners = [...this.state.diceWinners];
    // 清除并列者的投掷点数
    winners.forEach(id => {
      delete this.state.diceRolls[id];
    });
    this.state.diceWinners = [];
  }

  // 房主强制指定某个玩家首发队长
  forceSetLeader(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      this.state.leaderIndex = idx;
      if (this.phase === GAME_PHASES.DICE_ROLL) {
        this.phase = GAME_PHASES.TEAM_SELECT;
      }
    }
  }

  // --- 兰斯洛特阵营互换抽牌 ---

  prepareLancelotSwitchPhase() {
    this.phase = GAME_PHASES.LANCELOT_SWITCH;
    this.state.currentLancelotDraw = null;
  }

  drawLancelotCard() {
    if (this.phase !== GAME_PHASES.LANCELOT_SWITCH) {
      throw new Error('当前不在兰斯洛特命运抽牌阶段');
    }
    if (this.state.currentLancelotDraw) {
      return this.state.currentLancelotDraw;
    }

    if (!this.state.lancelotDeck || this.state.lancelotDeck.length === 0) {
      this.state.lancelotDeck = ['switch', 'switch', 'no_switch', 'no_switch', 'no_switch'].sort(() => Math.random() - 0.5);
    }

    const drawnCard = this.state.lancelotDeck.pop(); // 'switch' | 'no_switch'
    const isSwitchedNow = (drawnCard === 'switch');

    if (isSwitchedNow) {
      // 互换善恶兰斯洛特的当前阵营
      this.state.lancelotSwitched = !this.state.lancelotSwitched;
      this.players.forEach(p => {
        if (p.role === 'good_lancelot') {
          p.effectiveTeam = (p.effectiveTeam === ALIGNMENT.GOOD) ? ALIGNMENT.EVIL : ALIGNMENT.GOOD;
          p.isLancelotSwitched = !p.isLancelotSwitched;
        } else if (p.role === 'evil_lancelot') {
          p.effectiveTeam = (p.effectiveTeam === ALIGNMENT.EVIL) ? ALIGNMENT.GOOD : ALIGNMENT.EVIL;
          p.isLancelotSwitched = !p.isLancelotSwitched;
        }
      });
    }

    const drawResult = {
      round: this.state.currentRound,
      card: drawnCard,
      switched: isSwitchedNow,
      isCurrentlySwitched: this.state.lancelotSwitched,
      message: isSwitchedNow
        ? '🔄 抽到了【转换卡 (Switch)】！善恶兰斯洛特阵营即刻互换！'
        : '🛡️ 抽到了【不转换 (No Switch)】，双方兰斯洛特阵营保持原样。'
    };

    this.state.currentLancelotDraw = drawResult;
    this.state.lancelotHistory.push(drawResult);
    return drawResult;
  }

  proceedAfterLancelotSwitch() {
    if (this.phase !== GAME_PHASES.LANCELOT_SWITCH) return;
    this.phase = GAME_PHASES.TEAM_SELECT;
  }

  // --- 队长出征组队提议 ---

  proposeTeam(leaderId, selectedPlayerIds) {
    if (this.phase !== GAME_PHASES.TEAM_SELECT) {
      throw new Error('当前不是队长选人阶段');
    }
    const currentLeader = this.getCurrentLeader();
    if (currentLeader.id !== leaderId) {
      throw new Error('只有当前发车队长才能选人出征');
    }

    const neededCount = this.config.questCapacities[this.state.currentRound - 1];

    // 核心规则：车长是必须要上车的！如果是两个人，车长占1个，只需再选择一个人即可
    // 自动将车长与传入的队员组合并去重，确保车长必定在出征队伍中
    let finalTeam = Array.isArray(selectedPlayerIds) ? [...selectedPlayerIds] : [];
    if (!finalTeam.includes(leaderId)) {
      finalTeam = [leaderId, ...finalTeam];
    }
    finalTeam = [...new Set(finalTeam)];

    if (!finalTeam.includes(leaderId)) {
      throw new Error('按游戏规则发车车长必须在出征队伍中！');
    }

    if (finalTeam.length !== neededCount) {
      throw new Error(`本轮任务出征需 ${neededCount} 人（含车长本人必须上车，需再挑选 ${neededCount - 1} 人）`);
    }

    this.state.proposedTeam = finalTeam;
    this.state.teamVotes = {};
    this.phase = GAME_PHASES.TEAM_VOTE;
  }

  // --- 车票公开投票 (Team Approval Vote) ---

  castTeamVote(playerId, vote) {
    if (this.phase !== GAME_PHASES.TEAM_VOTE) {
      throw new Error('当前不在车票表决阶段');
    }
    if (vote !== 'approve' && vote !== 'reject') {
      throw new Error('无效的投票类型');
    }

    this.state.teamVotes[playerId] = vote;

    // 若所有玩家已完成投票，自动结算公开结果
    if (Object.keys(this.state.teamVotes).length === this.players.length) {
      this.resolveTeamVote();
    }
  }

  // 结算车票公投
  resolveTeamVote() {
    const approvers = [];
    const rejecters = [];
    this.players.forEach(p => {
      const v = this.state.teamVotes[p.id];
      const playerInfo = {
        id: p.id,
        name: p.name,
        seatNumber: p.seatNumber,
        avatar: p.avatar,
        vote: v
      };
      if (v === 'approve') {
        approvers.push(playerInfo);
      } else {
        rejecters.push(playerInfo);
      }
    });

    const approveCount = approvers.length;
    const rejectCount = rejecters.length;
    const passed = approveCount > rejectCount; // 赞成必须严格大于反对
    const currentLeader = this.getCurrentLeader();

    this.phase = GAME_PHASES.TEAM_RESULT;

    // 记录完整透明的谁投了票明细
    const voteRecord = {
      round: this.state.currentRound,
      attempt: this.state.attemptCount + 1,
      leader: { id: currentLeader.id, name: currentLeader.name, seatNumber: currentLeader.seatNumber, avatar: currentLeader.avatar },
      proposedTeam: this.state.proposedTeam.map(id => {
        const p = this.players.find(x => x.id === id);
        return { id, name: p ? p.name : '', seatNumber: p ? p.seatNumber : 0, avatar: p ? p.avatar : '👤' };
      }),
      votes: { ...this.state.teamVotes },
      approvers,
      rejecters,
      approveCount,
      rejectCount,
      passed
    };

    this.state.lastTeamVoteResult = voteRecord;
    this.state.teamVoteHistory.push(voteRecord);

    if (passed) {
      // 发车成功！重置连倒计数，准备执行任务暗投
      this.state.attemptCount = 0;
      this.state.questVotes = [];
      this.state.questPlayerIds = [];
    } else {
      // 流票/发车失败
      this.state.attemptCount += 1;
      if (this.state.attemptCount >= 5) {
        // 连倒5次，邪恶阵营直接获胜！
        this.finishGame(ALIGNMENT.EVIL, '车票连续被否决 5 次，红方邪恶势力直接获胜！');
        return;
      }
      // 队长顺延给下一位
      this.state.leaderIndex = (this.state.leaderIndex + 1) % this.players.length;
    }
  }

  // 车票结果展示后，房主或队长点击继续下一环节
  proceedAfterTeamResult() {
    if (this.phase !== GAME_PHASES.TEAM_RESULT) return;
    if (this.state.attemptCount > 0) {
      // 刚刚流票，重新进入下一位队长的选人提议
      this.state.proposedTeam = [];
      this.state.teamVotes = {};
      this.phase = GAME_PHASES.TEAM_SELECT;
    } else {
      // 刚刚通过，进入出征队员的任务暗投
      this.phase = GAME_PHASES.QUEST_VOTE;
    }
  }

  // --- 任务暗投 (Quest Secret Vote) ---

  castQuestVote(playerId, vote) {
    if (this.phase !== GAME_PHASES.QUEST_VOTE) {
      throw new Error('当前不在任务暗投阶段');
    }
    if (!this.state.proposedTeam.includes(playerId)) {
      throw new Error('您不在出征队伍中，无权执行任务');
    }
    if (this.state.questPlayerIds.includes(playerId)) {
      throw new Error('您已提交过任务卡');
    }

    const player = this.players.find(p => p.id === playerId);
    const roleDef = ROLES[player.role];
    const currentTeam = player.effectiveTeam || roleDef.team;

    // 规则校验：当前属于好人阵营的玩家必须投成功，禁止投失败（避免好人误点或被动违规）
    if (currentTeam === ALIGNMENT.GOOD && vote === 'fail') {
      throw new Error('正义阵营玩家只能投出【任务成功】！');
    }

    this.state.questVotes.push(vote);
    this.state.questPlayerIds.push(playerId);

    // 如果出征人员都投完了，自动结算
    if (this.state.questVotes.length === this.state.proposedTeam.length) {
      this.resolveQuestVote();
    }
  }

  // 结算任务暗投
  resolveQuestVote() {
    // 随机洗牌暗投卡片，彻底匿名打乱
    this.state.questVotes.sort(() => Math.random() - 0.5);

    const failCount = this.state.questVotes.filter(v => v === 'fail').length;
    const successCount = this.state.questVotes.filter(v => v === 'success').length;

    // 判定成败：如果处于第4轮且开启了双失败规则，需2张失败才判负
    const isRound4TwoFails = (this.state.currentRound === 4 && this.config.twoFailsOnRound4);
    const neededFails = isRound4TwoFails ? 2 : 1;
    const isSuccess = failCount < neededFails;

    if (isSuccess) {
      this.state.scores.good += 1;
    } else {
      this.state.scores.evil += 1;
    }

    this.phase = GAME_PHASES.QUEST_RESULT;

    // 记录轮次历史
    this.state.roundHistory.push({
      round: this.state.currentRound,
      proposedTeam: [...this.state.proposedTeam],
      successCount,
      failCount,
      isSuccess,
      isRound4TwoFails
    });
  }

  // 任务公布后，继续下一轮或进入结算/湖中仙女
  proceedAfterQuestResult() {
    if (this.phase !== GAME_PHASES.QUEST_RESULT) return;

    // 检查是否有阵营率先拿到 3 胜
    if (this.state.scores.evil >= 3) {
      this.finishGame(ALIGNMENT.EVIL, '邪恶阵营成功破坏了 3 次任务，邪恶势力获胜！');
      return;
    }

    if (this.state.scores.good >= 3) {
      // 好人拿下3胜，进入刺客刺杀梅林绝杀阶段！
      this.phase = GAME_PHASES.ASSASSINATION;
      return;
    }

    // 湖中仙女检查：第2、3、4轮结束后若开启湖中仙女
    if (this.config.enableLadyOfLake && [2, 3, 4].includes(this.state.currentRound)) {
      this.phase = GAME_PHASES.LADY_LAKE;
      return;
    }

    // 正常进入下一轮
    this.advanceToNextRound();
  }

  advanceToNextRound() {
    this.state.currentRound += 1;
    this.state.attemptCount = 0;
    this.state.proposedTeam = [];
    this.state.teamVotes = {};
    this.state.questVotes = [];
    this.state.questPlayerIds = [];
    // 队长顺延下一位
    this.state.leaderIndex = (this.state.leaderIndex + 1) % this.players.length;

    // 检查第3/4/5轮是否触发兰斯洛特命运抽牌
    if (this.hasLancelot() && [3, 4, 5].includes(this.state.currentRound)) {
      this.prepareLancelotSwitchPhase();
    } else {
      this.phase = GAME_PHASES.TEAM_SELECT;
    }
  }

  // --- 湖中仙女验人 ---

  useLadyOfLake(callerId, targetId) {
    if (this.phase !== GAME_PHASES.LADY_LAKE) {
      throw new Error('当前不是湖中仙女验人环节');
    }
    if (this.state.ladyHolder !== callerId) {
      throw new Error('只有当前持有湖中仙女的玩家才能验人');
    }
    if (callerId === targetId) {
      throw new Error('不能验视自己');
    }
    if (this.state.ladyUsedPlayers.includes(targetId)) {
      throw new Error('该玩家已经被湖中仙女验视过');
    }

    const targetPlayer = this.players.find(p => p.id === targetId);
    if (!targetPlayer) throw new Error('目标玩家不存在');

    const roleDef = ROLES[targetPlayer.role];
    const isGood = roleDef.team === ALIGNMENT.GOOD;
    const resultText = isGood ? '正义阵营（蓝方）' : '邪恶阵营（红方）';

    // 记录
    this.state.ladyHistory.push({
      round: this.state.currentRound,
      from: callerId,
      to: targetId,
      result: resultText,
      targetTeam: roleDef.team
    });
    this.state.ladyUsedPlayers.push(callerId); // 当前验人者也不能再被验
    this.state.ladyHolder = targetId; // 仙女传承给被验者

    return {
      targetName: targetPlayer.name,
      team: roleDef.team,
      resultText
    };
  }

  finishLadyPhase() {
    this.advanceToNextRound();
  }

  // --- 刺杀梅林 (包含默认蓝方三胜前随时拍刀刺杀) ---

  triggerEarlyAssassination(operatorId) {
    if (this.config.allowEarlyAssassination === false) {
      throw new Error('当前房间未开启蓝方三胜前刺杀规则');
    }
    if (this.phase === GAME_PHASES.LOBBY || this.phase === GAME_PHASES.ROLE_SELECTION || this.phase === GAME_PHASES.GAME_OVER) {
      throw new Error('当前游戏阶段无法发起刺杀');
    }
    const player = this.players.find(p => p.id === operatorId);
    if (!player) throw new Error('玩家不存在');

    // 核心规则：只有真实身份为刺客的玩家才可以立即拍刀发起刺杀！梅林、房主(若非刺客)均不能拍刀
    if (player.role !== 'assassin') {
      throw new Error('只有真实身份为刺客的玩家才可以立即拍刀发起刺杀！梅林及其他角色严禁拍刀。');
    }

    this.phase = GAME_PHASES.ASSASSINATION;
    this.stopSpeechTimer();
    return true;
  }

  assassinateTarget(assassinId, targetId) {
    if (this.phase !== GAME_PHASES.ASSASSINATION) {
      throw new Error('当前不在刺客刺杀环节');
    }
    const assassinPlayer = this.players.find(p => p.id === assassinId);
    if (!assassinPlayer || assassinPlayer.role !== 'assassin') {
      throw new Error('只有刺客才能执行刺杀');
    }

    const targetPlayer = this.players.find(p => p.id === targetId);
    if (!targetPlayer) throw new Error('刺杀目标不存在');

    this.state.assassinTarget = {
      id: targetPlayer.id,
      name: targetPlayer.name,
      seatNumber: targetPlayer.seatNumber,
      actualRole: targetPlayer.role
    };

    if (targetPlayer.role === 'merlin') {
      // 成功刺中梅林！邪恶绝地翻盘
      this.finishGame(ALIGNMENT.EVIL, `刺客精准命中了梅林【${targetPlayer.name}】，邪恶阵营绝地逆转翻盘获胜！`);
    } else {
      // 刺杀失败，好人阵营守护正义成功！
      this.finishGame(ALIGNMENT.GOOD, `刺客未能找到梅林（刺杀了【${ROLES[targetPlayer.role].name} - ${targetPlayer.name}】），正义阵营获得最终胜利！`);
    }
  }

  // --- 游戏结束 ---

  finishGame(winner, reason) {
    this.phase = GAME_PHASES.GAME_OVER;
    this.state.winner = winner;
    this.state.winReason = reason;
    this.stopSpeechTimer();
  }

  // 重置回到大厅重新开始
  resetGame() {
    this.phase = GAME_PHASES.LOBBY;
    this.stopSpeechTimer();
    this.state = {
      currentRound: 1,
      leaderIndex: 0,
      attemptCount: 0,
      proposedTeam: [],
      teamVotes: {},
      questVotes: [],
      questPlayerIds: [],
      roundHistory: [],
      scores: { good: 0, evil: 0 },
      winner: null,
      winReason: '',
      assassinTarget: null,
      diceRolls: {},
      diceWinners: [],
      ladyHolder: null,
      ladyHistory: [],
      ladyUsedPlayers: [],
      lancelotSwitched: false,
      lancelotDeck: [],
      lancelotHistory: [],
      currentLancelotDraw: null,
      speech: {
        active: false,
        mode: 'clockwise',
        speakerId: null,
        speakerIndex: 0,
        order: [],
        timeLeft: this.config.speechTimeLimit,
        isPaused: false
      }
    };
    this.players.forEach(p => {
      p.role = null;
      p.effectiveTeam = null;
      p.isLancelotSwitched = false;
    });
  }

  // --- 发言麦序与计时系统 ---

  startSpeech(mode = 'clockwise', startPlayerId = null) {
    this.stopSpeechTimer();
    let startIndex = 0;
    if (startPlayerId) {
      startIndex = this.players.findIndex(p => p.id === startPlayerId);
      if (startIndex === -1) startIndex = 0;
    } else {
      startIndex = this.state.leaderIndex; // 默认由队长开始
    }

    // 构造麦序
    const order = [];
    const count = this.players.length;
    for (let i = 0; i < count; i++) {
      const idx = mode === 'counter-clockwise'
        ? (startIndex - i + count) % count
        : (startIndex + i) % count;
      order.push(this.players[idx].id);
    }

    this.state.speech = {
      active: true,
      mode,
      speakerId: order[0],
      speakerIndex: 0,
      order,
      timeLeft: this.config.speechTimeLimit,
      isPaused: false
    };

    return this.state.speech;
  }

  nextSpeaker() {
    if (!this.state.speech.active) return null;
    const nextIdx = this.state.speech.speakerIndex + 1;
    if (nextIdx >= this.state.speech.order.length) {
      // 发言已轮完一圈
      this.state.speech.active = false;
      this.state.speech.speakerId = null;
      this.stopSpeechTimer();
      return null;
    }
    this.state.speech.speakerIndex = nextIdx;
    this.state.speech.speakerId = this.state.speech.order[nextIdx];
    this.state.speech.timeLeft = this.config.speechTimeLimit;
    return this.state.speech;
  }

  prevSpeaker() {
    if (!this.state.speech.active) return null;
    const prevIdx = Math.max(0, this.state.speech.speakerIndex - 1);
    this.state.speech.speakerIndex = prevIdx;
    this.state.speech.speakerId = this.state.speech.order[prevIdx];
    this.state.speech.timeLeft = this.config.speechTimeLimit;
    return this.state.speech;
  }

  toggleSpeechPause() {
    if (!this.state.speech.active) return;
    this.state.speech.isPaused = !this.state.speech.isPaused;
  }

  resetSpeechTimer() {
    if (!this.state.speech.active) return;
    this.state.speech.timeLeft = this.config.speechTimeLimit;
  }

  stopSpeechTimer() {
    this.state.speech.active = false;
  }

  // --- 辅助查询方法 ---

  getCurrentLeader() {
    if (!this.players.length) return null;
    return this.players[this.state.leaderIndex % this.players.length];
  }

  // 获取发给指定玩家的视图（包含专属视线与脱敏数据）
  getPlayerView(playerId) {
    const player = this.players.find(p => p.id === playerId);
    const vision = player ? calculatePlayerVision(player, this.players) : null;
    const currentLeader = this.getCurrentLeader();

    // 玩家脱敏列表：在游戏结束前不向前端暴露其他玩家的真实 role
    const sanitizedPlayers = this.players.map(p => {
      const isSelf = p.id === playerId;
      const isGameOver = this.phase === GAME_PHASES.GAME_OVER;
      return {
        id: p.id,
        name: p.name,
        seatNumber: p.seatNumber,
        avatar: p.avatar,
        isHost: p.id === this.hostId,
        isOnline: p.isOnline,
        // 只有自己或游戏结束复盘才展示真实角色
        role: (isSelf || isGameOver) ? p.role : undefined,
        hasRoleClaimed: p.role !== null,
        // 是否已投车票
        hasVotedTeam: this.state.teamVotes[p.id] !== undefined,
        // 是否已投暗投
        hasVotedQuest: this.state.questPlayerIds.includes(p.id),
        // 骰子点数
        dice: this.state.diceRolls[p.id]
      };
    });

    return {
      roomId: this.roomId,
      hostId: this.hostId,
      isHost: playerId === this.hostId,
      phase: this.phase,
      config: this.config,
      players: sanitizedPlayers,
      self: player ? {
        id: player.id,
        name: player.name,
        seatNumber: player.seatNumber,
        role: player.role,
        effectiveTeam: player.effectiveTeam,
        isLancelotSwitched: !!player.isLancelotSwitched,
        isLeader: currentLeader && currentLeader.id === player.id,
        isInProposedTeam: this.state.proposedTeam.includes(player.id),
        hasLady: this.state.ladyHolder === player.id
      } : null,
      vision, // 个人专属视线
      currentLeader: currentLeader ? {
        id: currentLeader.id,
        name: currentLeader.name,
        seatNumber: currentLeader.seatNumber
      } : null,
      state: {
        currentRound: this.state.currentRound,
        attemptCount: this.state.attemptCount,
        proposedTeam: this.state.proposedTeam,
        scores: this.state.scores,
        roundHistory: this.state.roundHistory,
        winner: this.state.winner,
        winReason: this.state.winReason,
        assassinTarget: this.state.assassinTarget,
        // 仅在公布结果或复盘时公开车票明细
        teamVoteResult: [GAME_PHASES.TEAM_RESULT, GAME_PHASES.GAME_OVER].includes(this.phase)
          ? this.state.teamVotes : null,
        lastTeamVoteResult: this.state.lastTeamVoteResult,
        teamVoteHistory: this.state.teamVoteHistory,
        // 任务暗投结果（打乱后）
        questVotesResult: [GAME_PHASES.QUEST_RESULT, GAME_PHASES.GAME_OVER].includes(this.phase)
          ? this.state.questVotes : null,
        // 骰子比拼
        diceRolls: this.state.diceRolls,
        diceWinners: this.state.diceWinners,
        // 仙女状态
        ladyHolder: this.state.ladyHolder,
        ladyUsedPlayers: this.state.ladyUsedPlayers,
        // 兰斯洛特转换状态
        hasLancelot: this.hasLancelot(),
        lancelotSwitched: this.state.lancelotSwitched,
        currentLancelotDraw: this.state.currentLancelotDraw,
        lancelotHistory: this.state.lancelotHistory,
        // 发言状态
        speech: this.state.speech
      }
    };
  }
}

module.exports = AvalonGame;
