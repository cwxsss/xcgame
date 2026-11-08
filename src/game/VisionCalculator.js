// 阿瓦隆夜间专属视线计算器
const { ROLES, ALIGNMENT } = require('./constants');

/**
 * 为单个玩家计算他在夜晚能看到的信息
 * @param {Object} player 当前玩家 { id, name, seatNumber, role, effectiveTeam, isLancelotSwitched }
 * @param {Array} allPlayers 房间所有玩家列表
 * @returns {Object} 视线情报数据
 */
function calculatePlayerVision(player, allPlayers) {
  if (!player.role) {
    return { roleInfo: null, visiblePlayers: [] };
  }

  const roleDef = ROLES[player.role];
  const currentTeam = player.effectiveTeam || roleDef.team;

  const vision = {
    roleId: player.role,
    roleName: roleDef.name,
    team: currentTeam,
    originalTeam: roleDef.team,
    isLancelot: !!roleDef.isLancelot,
    isLancelotSwitched: !!player.isLancelotSwitched,
    desc: roleDef.desc,
    badge: roleDef.badge,
    visiblePlayers: [] // [{ seatNumber, name, tag, note }]
  };

  // 1. 兰斯洛特互看视线：善恶兰斯洛特知晓对方
  if (roleDef.isLancelot) {
    allPlayers.forEach(p => {
      if (p.id !== player.id && p.role) {
        const pDef = ROLES[p.role];
        if (pDef.isLancelot) {
          vision.visiblePlayers.push({
            id: p.id,
            seatNumber: p.seatNumber,
            name: p.name,
            tag: '宿敌兰斯洛特',
            tagType: 'mystic',
            note: '与你命运相系的另一位兰斯洛特骑士'
          });
        }
      }
    });
  }

  // 2. 梅林视野：看得到所有邪恶（除莫德雷德）
  // 恶兰在初始即属于邪恶，梅林能看到；若未转换梅林能看到恶兰
  if (player.role === 'merlin') {
    allPlayers.forEach(p => {
      if (p.id !== player.id && p.role) {
        const pDef = ROLES[p.role];
        const pEffectiveTeam = p.effectiveTeam || pDef.team;
        if (pEffectiveTeam === ALIGNMENT.EVIL && p.role !== 'mordred') {
          vision.visiblePlayers.push({
            id: p.id,
            seatNumber: p.seatNumber,
            name: p.name,
            tag: '邪恶阵营',
            tagType: 'evil',
            note: '梅林眼中显露的红方人员'
          });
        }
      }
    });
  }

  // 3. 派西维尔视野：看得到梅林和莫甘娜（不知道谁是谁）
  else if (player.role === 'percival') {
    allPlayers.forEach(p => {
      if (p.id !== player.id && p.role) {
        if (p.role === 'merlin' || p.role === 'morgana') {
          vision.visiblePlayers.push({
            id: p.id,
            seatNumber: p.seatNumber,
            name: p.name,
            tag: '梅林 / 莫甘娜',
            tagType: 'mystic',
            note: '在你的眼中显现为梅林假象，需辨别真伪'
          });
        }
      }
    });
  }

  // 4. 邪恶阵营视野：邪恶队友互通视野（除孤狼奥伯伦与恶兰本人外）
  // 刺客、莫甘娜、莫德雷德等邪恶阵营能看到邪恶兰斯洛特；
  // 但邪恶兰斯洛特本人看不到刺客等邪恶队友（恶兰只能看到宿敌善兰）
  if (roleDef.team === ALIGNMENT.EVIL && player.role !== 'oberon' && player.role !== 'evil_lancelot') {
    allPlayers.forEach(p => {
      if (p.id !== player.id && p.role) {
        const pDef = ROLES[p.role];
        // 邪恶队友互看，奥伯伦不参与互看；邪恶兰斯洛特在初始阶段属于红方，能被刺客等队友看到
        if (pDef.team === ALIGNMENT.EVIL && p.role !== 'oberon') {
          // 避免重复添加（例如若某角色已有条目）
          const alreadyAdded = vision.visiblePlayers.some(vp => vp.id === p.id);
          if (!alreadyAdded) {
            const isEvilLance = (p.role === 'evil_lancelot');
            vision.visiblePlayers.push({
              id: p.id,
              seatNumber: p.seatNumber,
              name: p.name,
              tag: isEvilLance ? '邪恶兰斯洛特' : '邪恶队友',
              tagType: 'evil',
              note: `队友角色: ${pDef.name}${isEvilLance ? ' (可能中途因命运之牌发生互换)' : ''}`
            });
          }
        }
      }
    });
  }

  return vision;
}

module.exports = {
  calculatePlayerVision
};
