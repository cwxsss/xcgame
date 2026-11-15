export const AVALON_MODES = {
  base: { name: '基础局', detail: '梅林、刺客、忠臣和爪牙。' },
  classic: {
    name: '经典标准局',
    detail: '派西维尔需要在梅林与莫甘娜之间辨认真身。',
  },
  lancelot: { name: '双兰命运局', detail: '第 3、4、5 轮可能抽到阵营互换。' },
  mordred: {
    name: '莫德雷德局',
    detail: '莫德雷德躲过梅林的视线，启用湖中仙女。',
    lady: true,
  },
  oberon: { name: '孤狼奥伯伦局', detail: '奥伯伦与其他邪恶玩家互不相认。' },
  all_star: {
    name: '诸神乱斗',
    detail: '双兰、派西维尔、莫甘娜、莫德雷德与湖中仙女同场。',
    lady: true,
    min: 10,
  },
  custom: { name: '自定义阵容', detail: '选择额外角色和对局规则。' },
};
export const AVALON_ROLE_OPTIONS = {
  percival: '派西维尔',
  morgana: '莫甘娜',
  mordred: '莫德雷德',
  oberon: '奥伯伦',
  lancelot: '善恶双兰',
};
export const QUEST_SIZE_TABLE = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};
const evilSeats = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };
const evilRoles = ['assassin', 'minion', 'morgana', 'mordred', 'oberon'];

export function roleAlignment(role, switched = false) {
  if (!role) return null;
  if (role === 'good-lancelot') return switched ? 'evil' : 'good';
  if (role === 'evil-lancelot') return switched ? 'good' : 'evil';
  return evilRoles.includes(role) ? 'evil' : 'good';
}

function presetRoles(mode, capacity) {
  switch (mode) {
    case 'classic':
      return [
        'percival',
        ...['morgana', 'mordred', 'oberon'].slice(0, capacity - 1),
      ];
    case 'lancelot':
      return ['lancelot', ...['morgana', 'mordred'].slice(0, capacity - 2)];
    case 'mordred':
      return [
        'percival',
        ...['mordred', 'morgana', 'oberon'].slice(0, capacity - 1),
      ];
    case 'oberon':
      return [
        'percival',
        ...['oberon', 'morgana', 'mordred'].slice(0, capacity - 1),
      ];
    case 'all_star':
      return ['percival', 'lancelot', 'morgana', 'mordred'];
    default:
      return [];
  }
}

function buildAvalonRoles(selected, numPlayers) {
  const evil = ['assassin'];
  const good = ['merlin'];
  for (const role of selected) {
    if (role === 'lancelot') {
      good.push('good-lancelot');
      evil.push('evil-lancelot');
    } else if (role === 'percival') {
      good.push(role);
    } else {
      evil.push(role);
    }
  }
  const evilCount = evilSeats[numPlayers];
  if (evil.length > evilCount || good.length > numPlayers - evilCount) {
    throw new Error('所选角色超过该人数的阵营席位，请减少角色或增加人数。');
  }
  return [
    ...good,
    ...Array(numPlayers - evilCount - good.length).fill('loyal-servant'),
    ...evil,
    ...Array(evilCount - evil.length).fill('minion'),
  ];
}

export function resolveAvalonOptions(setupData = {}, numPlayers) {
  if (!Object.hasOwn(evilSeats, numPlayers) || !Number.isInteger(numPlayers)) {
    throw new Error('阿瓦隆需要 5 到 10 名玩家。');
  }
  if (!setupData || typeof setupData !== 'object' || Array.isArray(setupData)) {
    throw new Error('无效的阿瓦隆玩法配置。');
  }
  const { mode = 'base', customRoles = [] } = setupData;
  if (typeof mode !== 'string' || !Object.hasOwn(AVALON_MODES, mode)) {
    throw new Error('请选择有效的阿瓦隆模式。');
  }
  const preset = AVALON_MODES[mode];
  if (numPlayers < (preset.min ?? 5))
    throw new Error(preset.name + '需要 ' + preset.min + ' 人。');
  if (
    !Array.isArray(customRoles) ||
    new Set(customRoles).size !== customRoles.length ||
    customRoles.some(
      (role) =>
        typeof role !== 'string' || !Object.hasOwn(AVALON_ROLE_OPTIONS, role),
    )
  ) {
    throw new Error('无效的自定义角色列表。');
  }
  const selected =
    mode === 'custom' ? customRoles : presetRoles(mode, evilSeats[numPlayers]);
  const roles = buildAvalonRoles(selected, numPlayers);
  const options = { mode, roles, lancelot: roles.includes('good-lancelot') };
  for (const key of ['lady', 'dice', 'earlyAssassin', 'leaderOnTeam']) {
    if (setupData[key] !== undefined && typeof setupData[key] !== 'boolean') {
      throw new Error('无效的阿瓦隆规则选项。');
    }
    options[key] = setupData[key] ?? preset[key] ?? false;
  }
  return options;
}
