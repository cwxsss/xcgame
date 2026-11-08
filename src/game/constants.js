// 阿瓦隆游戏常量与预设规则配置

// 阵营定义
const ALIGNMENT = {
  GOOD: 'good', // 正义阵营（蓝方）
  EVIL: 'evil', // 邪恶阵营（红方）
};

// 角色详情定义
const ROLES = {
  // 正义角色
  merlin: {
    id: 'merlin',
    name: '梅林',
    team: ALIGNMENT.GOOD,
    desc: '正义阵营领袖。知道所有邪恶阵营（除莫德雷德），但必须隐藏自己，若蓝方胜利会被刺杀。',
    badge: '👑',
    color: '#3b82f6'
  },
  percival: {
    id: 'percival',
    name: '派西维尔',
    team: ALIGNMENT.GOOD,
    desc: '梅林的保镖。能看到梅林和莫甘娜，但不知道谁是谁，需要保护真正的梅林。',
    badge: '🛡️',
    color: '#60a5fa'
  },
  loyal: {
    id: 'loyal',
    name: '亚瑟的忠臣',
    team: ALIGNMENT.GOOD,
    desc: '普通的亚瑟忠臣。没有特殊视野，只知晓自己是正义的，靠逻辑与发言推理。',
    badge: '⚔️',
    color: '#93c5fd',
    multiple: true // 可以有多个
  },
  good_lancelot: {
    id: 'good_lancelot',
    name: '正义兰斯洛特',
    team: ALIGNMENT.GOOD,
    desc: '正义的圆桌骑士。与邪恶兰斯洛特互知身份。在第3/4/5轮可能因命运之牌发生阵营互换！',
    badge: '⚜️',
    color: '#38bdf8',
    isLancelot: true
  },

  // 邪恶角色
  assassin: {
    id: 'assassin',
    name: '刺客',
    team: ALIGNMENT.EVIL,
    desc: '邪恶阵营利刃。若蓝方获得3胜，刺客拥有最后刺杀机会，刺中梅林即可逆风翻盘。',
    badge: '🗡️',
    color: '#ef4444'
  },
  morgana: {
    id: 'morgana',
    name: '莫甘娜',
    team: ALIGNMENT.EVIL,
    desc: '邪恶女巫。伪装成梅林，在派西维尔眼里与梅林一模一样，迷惑好人。',
    badge: '🔮',
    color: '#dc2626'
  },
  mordred: {
    id: 'mordred',
    name: '莫德雷德',
    team: ALIGNMENT.EVIL,
    desc: '邪恶头领。梅林无法看到莫德雷德（莫德雷德在梅林视野中隐身）。',
    badge: '👹',
    color: '#b91c1c'
  },
  oberon: {
    id: 'oberon',
    name: '奥伯伦',
    team: ALIGNMENT.EVIL,
    desc: '邪恶孤狼。看不到其他红方队友，红方队友也看不到他，但梅林知道他是红方。',
    badge: '👁️‍🗨️',
    color: '#f87171'
  },
  minion: {
    id: 'minion',
    name: '莫德雷德的爪牙',
    team: ALIGNMENT.EVIL,
    desc: '普通邪恶爪牙。与除奥伯伦外的邪恶队友互通视野。',
    badge: '🐺',
    color: '#fca5a5',
    multiple: true
  },
  evil_lancelot: {
    id: 'evil_lancelot',
    name: '邪恶兰斯洛特',
    team: ALIGNMENT.EVIL,
    desc: '背叛的圆桌骑士。与正义兰斯洛特互知身份（梅林看他是红方）。第3/4/5轮可能因命运之牌发生阵营互换！',
    badge: '🩸',
    color: '#e11d48',
    isLancelot: true
  }
};

// 官方人数标准配置表 (5-10人)
// questMembers: 5轮任务每轮所需出征人数
// twoFailsOnRound4: 第4轮是否需要2张失败才判负
const DEFAULT_RULES = {
  5: { good: 3, evil: 2, quests: [2, 3, 2, 3, 3], twoFailsOnRound4: false },
  6: { good: 4, evil: 2, quests: [2, 3, 4, 3, 4], twoFailsOnRound4: false },
  7: { good: 4, evil: 3, quests: [2, 3, 3, 4, 4], twoFailsOnRound4: true },
  8: { good: 5, evil: 3, quests: [3, 4, 4, 5, 5], twoFailsOnRound4: true },
  9: { good: 6, evil: 3, quests: [3, 4, 4, 5, 5], twoFailsOnRound4: true },
  10: { good: 6, evil: 4, quests: [3, 4, 4, 5, 5], twoFailsOnRound4: true }
};

// 游戏阶段状态枚举
const GAME_PHASES = {
  LOBBY: 'LOBBY',                     // 等待大厅
  ROLE_SELECTION: 'ROLE_SELECTION',   // 角色自选或分配确认
  DICE_ROLL: 'DICE_ROLL',             // 掷骰子决定首发发车队长
  SPEECH: 'SPEECH',                   // 发言阶段（可随时开启或在队伍提议前）
  LANCELOT_SWITCH: 'LANCELOT_SWITCH', // 兰斯洛特命运之牌抽取（第3/4/5轮）
  TEAM_SELECT: 'TEAM_SELECT',         // 队长挑选出征人员
  TEAM_VOTE: 'TEAM_VOTE',             // 全员公开投票（赞成/反对发车）
  TEAM_RESULT: 'TEAM_RESULT',         // 车票投票结果公布
  QUEST_VOTE: 'QUEST_VOTE',           // 出征队员暗投任务
  QUEST_RESULT: 'QUEST_RESULT',       // 任务结果揭晓
  LADY_LAKE: 'LADY_LAKE',             // 湖中仙女验人
  ASSASSINATION: 'ASSASSINATION',     // 刺客刺杀梅林
  GAME_OVER: 'GAME_OVER'              // 游戏结束与复盘
};

// 常用经典与扩展玩法预设
const PRESET_MODES = {
  classic: {
    id: 'classic',
    name: '经典标准局',
    desc: '梅林 + 派西维尔 vs 刺客 + 莫甘娜。经典逻辑平衡对决。',
    icon: '👑',
    enableLancelot: false,
    enableLadyOfLake: false,
    buildRoles: (goodCount, evilCount) => {
      const good = ['merlin'];
      if (goodCount >= 2) good.push('percival');
      while (good.length < goodCount) good.push('loyal');

      const evil = ['assassin'];
      if (evilCount >= 2) evil.push('morgana');
      if (evilCount >= 3) evil.push('mordred');
      if (evilCount >= 4) evil.push('oberon');
      return [...good, ...evil];
    }
  },
  lancelot: {
    id: 'lancelot',
    name: '双兰变节 · 命运互换',
    desc: '善恶双兰斯洛特在场，第3/4/5轮出征前抽卡互换阵营！',
    icon: '⚜️',
    enableLancelot: true,
    enableLadyOfLake: false,
    buildRoles: (goodCount, evilCount) => {
      const good = ['merlin', 'good_lancelot'];
      while (good.length < goodCount) good.push('loyal');

      const evil = ['assassin', 'evil_lancelot'];
      if (evilCount >= 3) evil.push('morgana');
      if (evilCount >= 4) evil.push('mordred');
      return [...good, ...evil];
    }
  },
  mordred: {
    id: 'mordred',
    name: '暗影首领 · 莫德雷德',
    desc: '莫德雷德梅林看不见，极度考验好人排坑逻辑。',
    icon: '👹',
    enableLancelot: false,
    enableLadyOfLake: true,
    buildRoles: (goodCount, evilCount) => {
      const good = ['merlin'];
      if (goodCount >= 2) good.push('percival');
      while (good.length < goodCount) good.push('loyal');

      const evil = ['assassin', 'mordred'];
      if (evilCount >= 3) evil.push('morgana');
      if (evilCount >= 4) evil.push('oberon');
      return [...good, ...evil];
    }
  },
  oberon: {
    id: 'oberon',
    name: '独狼之乱 · 奥伯伦',
    desc: '奥伯伦红方互不相识，红方陷入视野盲区。',
    icon: '👁️',
    enableLancelot: false,
    enableLadyOfLake: false,
    buildRoles: (goodCount, evilCount) => {
      const good = ['merlin'];
      if (goodCount >= 2) good.push('percival');
      while (good.length < goodCount) good.push('loyal');

      const evil = ['assassin', 'oberon'];
      if (evilCount >= 3) evil.push('morgana');
      if (evilCount >= 4) evil.push('mordred');
      return [...good, ...evil];
    }
  },
  all_star: {
    id: 'all_star',
    name: '诸神乱斗 · 全拓展',
    desc: '梅林、派西维尔、双兰斯洛特、莫甘娜、莫德雷德乱斗！',
    icon: '🌟',
    enableLancelot: true,
    enableLadyOfLake: true,
    buildRoles: (goodCount, evilCount) => {
      const good = ['merlin', 'percival', 'good_lancelot'];
      while (good.length < goodCount) good.push('loyal');

      const evil = ['assassin', 'evil_lancelot', 'morgana'];
      if (evilCount >= 4) evil.push('mordred');
      return [...good.slice(0, goodCount), ...evil.slice(0, evilCount)];
    }
  }
};

// 严禁作为玩家昵称的角色身份关键字（中英文均不可包含）
const FORBIDDEN_ROLE_KEYWORDS = [
  '梅林', 'merlin',
  '派西维尔', '珀西瓦尔', '帕西瓦尔', '派西', 'percival',
  '忠臣', 'loyal',
  '刺客', 'assassin',
  '莫甘娜', 'morgana',
  '莫德雷德', 'mordred',
  '奥伯伦', 'oberon',
  '爪牙', 'minion',
  '兰斯洛特', '兰斯', 'lancelot',
  '仙女', 'lady'
];

/**
 * 校验玩家昵称是否有效且合规（严禁包含角色身份词）
 * @param {string} name 待检测的玩家昵称
 * @returns {{ valid: boolean, message?: string }} 校验结果
 */
function checkPlayerNameValidity(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: '玩家昵称不能为空！' };
  }
  const cleanName = name.trim();
  if (cleanName.length === 0) {
    return { valid: false, message: '玩家昵称不能为空！' };
  }
  if (cleanName.length > 12) {
    return { valid: false, message: '玩家昵称长度不能超过 12 个字符！' };
  }
  const lower = cleanName.toLowerCase();
  for (const kw of FORBIDDEN_ROLE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      return {
        valid: false,
        message: `昵称中不能包含身份名称【${kw}】，请使用其他昵称！`
      };
    }
  }
  return { valid: true };
}

module.exports = {
  ALIGNMENT,
  ROLES,
  DEFAULT_RULES,
  GAME_PHASES,
  PRESET_MODES,
  FORBIDDEN_ROLE_KEYWORDS,
  checkPlayerNameValidity
};
