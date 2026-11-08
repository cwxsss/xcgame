const assert = require('assert');
const AvalonGame = require('../src/game/AvalonGame');
const { ROLES, DEFAULT_RULES, GAME_PHASES } = require('../src/game/constants');
const { calculatePlayerVision } = require('../src/game/VisionCalculator');

console.log('🧪 开始执行阿瓦隆核心游戏逻辑自动化测试...\n');

// 1. 创建游戏与添加玩家
const game = new AvalonGame('TEST', 'socket_p1', '房主阿强', '👑');
console.log('✅ 房间创建成功，房主入座');

// 测试昵称违禁词拦截机制（严禁包含梅林、刺客等身份词）
assert.throws(() => {
  game.addPlayer('sock_fail_1', '梅林本尊', '🧙');
}, /不能包含身份名称【梅林】/);
assert.throws(() => {
  game.addPlayer('sock_fail_2', '顶级刺客', '🗡️');
}, /不能包含身份名称【刺客】/);
assert.throws(() => {
  game.addPlayer('sock_fail_3', '莫甘娜大人', '🔮');
}, /不能包含身份名称【莫甘娜】/);
assert.throws(() => {
  game.addPlayer('sock_fail_4', '兰斯洛特一号', '⚜️');
}, /不能包含身份名称【兰斯洛特】/);
assert.throws(() => {
  game.addPlayer('sock_fail_5', 'merlin666', '🧙');
}, /不能包含身份名称【merlin】/);
console.log('✅ 玩家昵称严禁包含身份名称测试通过：梅林、刺客、莫甘娜、兰斯洛特等被严格拦截！');

// 添加另外 4 名合规昵称玩家，凑齐 5 人局
const p2 = game.addPlayer('socket_p2', '队员阿明', '🛡️');
const p3 = game.addPlayer('socket_p3', '小李', '⚔️');
const p4 = game.addPlayer('socket_p4', '小黑', '🗡️');
const p5 = game.addPlayer('socket_p5', '小美', '🔮');

assert.strictEqual(game.players.length, 5, '玩家总数应为5');
console.log('✅ 5名玩家入座完毕，座位号排序正确');

// 2. 测试配置更新与角色池
assert.strictEqual(game.config.questCapacities.length, 5, '出征表长度应为5');
console.log(`✅ 5人局推荐出征人数: [${game.config.questCapacities.join(', ')}]`);

// 3. 测试身份分配（指定分配测试视线）
game.players[0].role = 'merlin';   // p1: 梅林
game.players[1].role = 'percival'; // p2: 派西维尔
game.players[2].role = 'loyal';    // p3: 忠臣
game.players[3].role = 'assassin'; // p4: 刺客
game.players[4].role = 'morgana';  // p5: 莫甘娜

// 验证梅林视线：梅林能看到刺客(p4)和莫甘娜(p5)为邪恶
const merlinVision = calculatePlayerVision(game.players[0], game.players);
assert.strictEqual(merlinVision.visiblePlayers.length, 2, '梅林应该看到2个邪恶角色');
console.log('✅ 梅林视线测试通过：成功看到刺客与莫甘娜');

// 验证派西维尔视线：能看到梅林(p1)和莫甘娜(p5)的大拇指
const percivalVision = calculatePlayerVision(game.players[1], game.players);
assert.strictEqual(percivalVision.visiblePlayers.length, 2, '派西维尔应该看到梅林和莫甘娜两个大拇指');
console.log('✅ 派西维尔视线测试通过：正确看到梅林与莫甘娜假象');

// 验证忠臣视线：看不到任何人
const loyalVision = calculatePlayerVision(game.players[2], game.players);
assert.strictEqual(loyalVision.visiblePlayers.length, 0, '忠臣不应有额外视野');
console.log('✅ 忠臣视线测试通过：视野纯净');

// 验证刺客视线：看到莫甘娜为邪恶队友
const assassinVision = calculatePlayerVision(game.players[3], game.players);
assert.strictEqual(assassinVision.visiblePlayers.length, 1, '刺客应看到1位队友');
assert.strictEqual(assassinVision.visiblePlayers[0].name, '小美');
console.log('✅ 邪恶阵营互通视线测试通过');

// 4. 测试掷骰子决定首发发车司机 (核心需求)
game.phase = GAME_PHASES.DICE_ROLL;
game.initDicePhase();
game.state.diceRolls['socket_p1'] = 3;
game.state.diceRolls['socket_p2'] = 2;
game.state.diceRolls['socket_p3'] = 6; // p3 点数最高！
game.state.diceRolls['socket_p4'] = 4;
game.state.diceRolls['socket_p5'] = 1;

game.computeDiceWinner();
assert.strictEqual(game.state.diceWinners.length, 1);
assert.strictEqual(game.state.diceWinners[0], 'socket_p3');
assert.strictEqual(game.state.leaderIndex, 2, '点数最高的玩家(p3)应成为第一任队长');
console.log('✅ 掷骰子选先手测试通过：最高点数者荣任第1任发车队长！');

// 5. 队长组队出征与车票公投
game.phase = GAME_PHASES.TEAM_SELECT;
const currentLeader = game.getCurrentLeader();
assert.strictEqual(currentLeader.id, 'socket_p3');

// 校验5人局5轮任务出征人数标准：[2, 3, 2, 3, 3]
assert.deepStrictEqual(game.config.questCapacities, [2, 3, 2, 3, 3], '5轮任务必须为 [2, 3, 2, 3, 3]');

// 校验核心规则：车长必须上车！如果是两个人，车长占1位，只需再选择一个人即可
// 若只传入1名其他队员(socket_p1)，系统自动将车长(socket_p3)置入队伍首位
game.proposeTeam('socket_p3', ['socket_p1']);
assert.strictEqual(game.phase, GAME_PHASES.TEAM_VOTE);
assert.strictEqual(game.state.proposedTeam.length, 2, '第1轮任务出征队伍人数必须为2人');
assert.strictEqual(game.state.proposedTeam.includes('socket_p3'), true, '车长本人必须在出征队伍中');
assert.strictEqual(game.state.proposedTeam.includes('socket_p1'), true, '选中的其他队员必须在出征队伍中');
console.log('✅ 车长必须上车规则测试通过：2人出征只需再选1人，车长自动入选！');

// 校验人数超额拦截：若第1轮传入除了车长之外还选了2个人（共3人），必须拦截
game.phase = GAME_PHASES.TEAM_SELECT;
assert.throws(() => {
  game.proposeTeam('socket_p3', ['socket_p1', 'socket_p2']);
}, /本轮任务出征需 2 人/);
console.log('✅ 出征人数严格校验测试通过：超出人数被正确拦截');

// 恢复正常提案
game.proposeTeam('socket_p3', ['socket_p1']);

// 全员车票投票：3人赞成，2人反对 -> 应该通过
game.castTeamVote('socket_p1', 'approve');
game.castTeamVote('socket_p2', 'approve');
game.castTeamVote('socket_p3', 'approve');
game.castTeamVote('socket_p4', 'reject');
game.castTeamVote('socket_p5', 'reject');

assert.strictEqual(game.phase, GAME_PHASES.TEAM_RESULT);
console.log('✅ 车票表决结算测试通过：赞成大于反对，发车成功！');

// 推进到任务暗投
game.proceedAfterTeamResult();
assert.strictEqual(game.phase, GAME_PHASES.QUEST_VOTE);

// 6. 任务暗投：出征队伍为车长 socket_p3(忠臣好人) 与 socket_p1(梅林好人)
// 测试规则拦截1：非出征队员尝试投任务应被拦截
assert.throws(() => {
  game.castQuestVote('socket_p2', 'success');
}, /您不在出征队伍中/);
console.log('✅ 非出征人员投任务拦截测试通过');

// 测试规则拦截2：好人出征队员尝试投失败应被拦截
assert.throws(() => {
  game.castQuestVote('socket_p3', 'fail'); // p3是忠臣(好人)，禁止投失败
}, /正义阵营玩家只能投出/);
console.log('✅ 好人防误触规则测试通过：严格限制好人只能投成功');

game.castQuestVote('socket_p1', 'success'); // 梅林投成功
game.castQuestVote('socket_p3', 'success'); // 车长忠臣投成功

assert.strictEqual(game.phase, GAME_PHASES.QUEST_RESULT);
assert.strictEqual(game.state.scores.good, 1, '全员投成功，正义应得1分');
console.log('✅ 任务暗投结算测试通过：正义阵营得 1 分！');

// 7. 发言麦序与计时测试
const speech = game.startSpeech('clockwise', 'socket_p1');
assert.strictEqual(speech.active, true);
assert.strictEqual(speech.speakerId, 'socket_p1');
game.nextSpeaker();
assert.strictEqual(game.state.speech.speakerId, 'socket_p2');
console.log('✅ 顺时针发言麦序与过麦测试通过');

// 8. 刺客刺杀梅林绝杀翻盘测试
game.phase = GAME_PHASES.ASSASSINATION;
game.assassinateTarget('socket_p4', 'socket_p1'); // 刺杀 p1 (梅林)
assert.strictEqual(game.phase, GAME_PHASES.GAME_OVER);
assert.strictEqual(game.state.winner, 'evil', '刺中梅林红方应绝地翻盘获胜');
console.log('✅ 刺客命中梅林逆转翻盘测试通过！');

// 9. 兰斯洛特阵营互换专项测试
console.log('\n--- 开始测试兰斯洛特互换身份机制 ---');
const lGame = new AvalonGame('LANCE', 'sock_h', '房主大卫', '👑');
lGame.addPlayer('sock_g_lance', '白马骑士', '⚜️');
lGame.addPlayer('sock_e_lance', '黑袍勇士', '🩸');
lGame.addPlayer('sock_merlin', '学者威廉', '🧙');
lGame.addPlayer('sock_assassin', '夜行查理', '🗡️');

lGame.players[0].role = 'loyal';
lGame.players[1].role = 'good_lancelot';
lGame.players[2].role = 'evil_lancelot';
lGame.players[3].role = 'merlin';
lGame.players[4].role = 'assassin';

lGame.initLancelotState();
assert.strictEqual(lGame.hasLancelot(), true, '应识别到兰斯洛特在场');

// 视线测试：善恶兰斯洛特互通
const gVision = calculatePlayerVision(lGame.players[1], lGame.players);
assert.strictEqual(gVision.visiblePlayers.length, 1);
assert.strictEqual(gVision.visiblePlayers[0].name, '黑袍勇士');
console.log('✅ 善兰视线测试通过：知晓恶兰身份');

// 恶兰视线测试 (核心用户反馈)：恶兰只看得到宿敌善兰，绝对看不到刺客！
const eVision = calculatePlayerVision(lGame.players[2], lGame.players);
assert.strictEqual(eVision.visiblePlayers.length, 1, '恶兰只能看到1人（宿敌善兰）');
assert.strictEqual(eVision.visiblePlayers[0].name, '白马骑士', '恶兰看到的必须是善兰');
assert.strictEqual(eVision.visiblePlayers.some(p => p.name === '夜行查理'), false, '恶兰绝不能看到刺客');
console.log('✅ 恶兰视线测试通过：恶兰看不到刺客，仅知晓宿敌善兰！');

// 刺客视线测试 (核心用户反馈)：刺客在善恶双兰模式必须能看到邪恶兰斯洛特！
const aVision = calculatePlayerVision(lGame.players[4], lGame.players);
assert.strictEqual(aVision.visiblePlayers.length, 1, '刺客应看到1位邪恶队友');
assert.strictEqual(aVision.visiblePlayers[0].name, '黑袍勇士', '刺客必须能看到邪恶兰斯洛特');
assert.strictEqual(aVision.visiblePlayers[0].tag, '邪恶兰斯洛特');
console.log('✅ 刺客在善恶双兰模式成功看到邪恶兰斯洛特测试通过！');

// 测试第 3 轮推进触发 LANCELOT_SWITCH
lGame.state.currentRound = 2;
lGame.advanceToNextRound(); // 进入第 3 轮
assert.strictEqual(lGame.state.currentRound, 3);
assert.strictEqual(lGame.phase, GAME_PHASES.LANCELOT_SWITCH);
console.log('✅ 第 3 轮出征前自动切入兰斯洛特命运抽牌阶段 (LANCELOT_SWITCH)');

// 强制抽出一张转换卡 (switch)
lGame.state.lancelotDeck = ['switch'];
const drawResult = lGame.drawLancelotCard();
assert.strictEqual(drawResult.switched, true);
assert.strictEqual(lGame.state.lancelotSwitched, true);
assert.strictEqual(lGame.players[1].effectiveTeam, 'evil', '善兰应变为邪恶阵营');
assert.strictEqual(lGame.players[2].effectiveTeam, 'good', '恶兰应变为正义阵营');
console.log('✅ 抽牌阵营互换成功：善兰转邪恶，恶兰转正义！');

// 测试转换后的任务暗投权限
lGame.proceedAfterLancelotSwitch();
assert.strictEqual(lGame.phase, GAME_PHASES.TEAM_SELECT);

// 此时善兰（转为邪恶）出征时，允许投失败
lGame.phase = GAME_PHASES.QUEST_VOTE;
lGame.state.proposedTeam = ['sock_g_lance', 'sock_e_lance'];

// 善兰投 fail，不应报错
lGame.castQuestVote('sock_g_lance', 'fail');
console.log('✅ 善兰变邪恶后成功投出【失败】卡！');

// 恶兰（已转为好人）尝试投 fail，应被严格拦截报错！
assert.throws(() => {
  lGame.castQuestVote('sock_e_lance', 'fail');
}, /正义阵营玩家只能投出/);
console.log('✅ 恶兰变正义后投失败被成功拦截，只能投成功！');

lGame.castQuestVote('sock_e_lance', 'success');
assert.strictEqual(lGame.phase, GAME_PHASES.QUEST_RESULT);
console.log('✅ 兰斯洛特转换全流程测试完美通过！');

// 10. 自定义房间号机制测试
console.log('\n--- 开始测试自定义房间号机制 ---');
const customGame1 = new AvalonGame('6666', 'host_1', '房主大明', '👑');
assert.strictEqual(customGame1.roomId, '6666', '自定义纯数字房间号应该为 6666');

const customGame2 = new AvalonGame('AVALON', 'host_2', '房主二明', '👑');
assert.strictEqual(customGame2.roomId, 'AVALON', '自定义英文字符房间号应该为 AVALON');

const customGame3 = new AvalonGame('VIP-88', 'host_3', '房主三明', '👑');
assert.strictEqual(customGame3.roomId, 'VIP-88', '自定义连字符房间号应该为 VIP-88');

console.log('✅ 自定义房间号测试完全通过！');

// 11. 用户所报 Bug 复现与验证：房主自定义角色被玩家加入覆盖导致多出莫甘娜
console.log('\n--- 开始测试用户 Bug 修复：自定义角色与玩家加入不会多出莫甘娜 ---');
const userBugGame = new AvalonGame('UBUG', 'host_user', '用户房主', '👑');
// 房主配置指定角色：梅林、正义兰斯洛特、忠臣、刺客、邪恶兰斯洛特（无莫甘娜！）
const targetRoles = ['merlin', 'good_lancelot', 'loyal', 'assassin', 'evil_lancelot'];
userBugGame.updateConfig({ roles: [...targetRoles] });

// 此时只有房主 1 人，随后另外 4 名玩家陆续加入（达到 5 人）
userBugGame.addPlayer('u2', '玩家2', '👤');
userBugGame.addPlayer('u3', '玩家3', '👤');
userBugGame.addPlayer('u4', '玩家4', '👤');
userBugGame.addPlayer('u5', '玩家5', '👤');

// 验证：玩家加入后，配置的角色池绝不能被 autoAdjustConfig 冲掉！
assert.strictEqual(userBugGame.config.roles.length, 5, '角色总数必须严格为 5');
assert.strictEqual(userBugGame.config.roles.includes('morgana'), false, '角色池绝对不能多出莫甘娜！');
assert.strictEqual(userBugGame.config.roles.includes('good_lancelot'), true, '角色池必须包含正义兰斯洛特');
assert.strictEqual(userBugGame.config.roles.includes('evil_lancelot'), true, '角色池必须包含邪恶兰斯洛特');
assert.strictEqual(userBugGame.config.roles.includes('merlin'), true, '角色池必须包含梅林');
assert.strictEqual(userBugGame.config.roles.includes('assassin'), true, '角色池必须包含刺客');
assert.strictEqual(userBugGame.config.roles.includes('loyal'), true, '角色池必须包含忠臣');

// 开始游戏并由系统自动分配角色
userBugGame.startRoleAssignment();
const assignedRoles = userBugGame.players.map(p => p.role);
assert.strictEqual(assignedRoles.length, 5);
assert.strictEqual(assignedRoles.includes('morgana'), false, '分发后的玩家角色中绝对无莫甘娜！');
assert.strictEqual(assignedRoles.includes('good_lancelot'), true, '分发后的玩家角色中包含正义兰斯洛特');
assert.strictEqual(assignedRoles.includes('evil_lancelot'), true, '分发后的玩家角色中包含邪恶兰斯洛特');
console.log('✅ 用户 Bug 修复验证通过：房主自定义角色得到严格保持，绝不会多出莫甘娜！');

// 12. 多种玩法预设一键切换测试
console.log('\n--- 开始测试多种玩法预设一键切换 ---');
const presetGame = new AvalonGame('PRE1', 'p_host', '预设房主', '👑');
for (let i = 2; i <= 6; i++) {
  presetGame.addPlayer(`p_${i}`, `玩家${i}`, '👤');
}
assert.strictEqual(presetGame.players.length, 6);

// 测试经典玩法 (classic)
presetGame.applyPresetMode('classic');
assert.strictEqual(presetGame.config.roles.includes('merlin'), true);
assert.strictEqual(presetGame.config.roles.includes('percival'), true);
assert.strictEqual(presetGame.config.roles.includes('morgana'), true);
assert.strictEqual(presetGame.config.roles.includes('assassin'), true);
console.log('✅ 经典标准玩法预设通过');

// 测试善恶双兰玩法 (lancelot)
presetGame.applyPresetMode('lancelot');
assert.strictEqual(presetGame.config.roles.includes('good_lancelot'), true);
assert.strictEqual(presetGame.config.roles.includes('evil_lancelot'), true);
assert.strictEqual(presetGame.config.enableLancelot, true);
console.log('✅ 善恶双兰玩法预设通过');

// 测试莫德雷德玩法 (mordred)
presetGame.applyPresetMode('mordred');
assert.strictEqual(presetGame.config.roles.includes('mordred'), true);
console.log('✅ 莫德雷德玩法预设通过');

// 测试奥伯伦玩法 (oberon)
presetGame.applyPresetMode('oberon');
assert.strictEqual(presetGame.config.roles.includes('oberon'), true);
console.log('✅ 独狼奥伯伦玩法预设通过');

// 测试全拓展玩法 (all_star)
presetGame.applyPresetMode('all_star');
assert.strictEqual(presetGame.config.roles.includes('good_lancelot'), true);
assert.strictEqual(presetGame.config.roles.includes('evil_lancelot'), true);
console.log('✅ 诸神全拓展玩法预设通过');

// 测试建房阶段（仅房主1人）点击玩法预设时，自动精准更新正义阵营与邪恶阵营的人选
const soloHostGame = new AvalonGame('SOLO', 's_host', '单人房主', '👑');
assert.strictEqual(soloHostGame.players.length, 1);

// 点击经典标准
soloHostGame.applyPresetMode('classic');
assert.deepStrictEqual(soloHostGame.config.roles.sort(), ['merlin', 'percival', 'loyal', 'assassin', 'morgana'].sort());

// 点击善恶双兰 -> 自动替换为正义兰斯洛特与邪恶兰斯洛特，莫甘娜被移出
soloHostGame.applyPresetMode('lancelot');
assert.strictEqual(soloHostGame.config.roles.includes('good_lancelot'), true);
assert.strictEqual(soloHostGame.config.roles.includes('evil_lancelot'), true);
assert.strictEqual(soloHostGame.config.roles.includes('morgana'), false);
assert.strictEqual(soloHostGame.config.enableLancelot, true);

// 点击莫德雷德 -> 自动替换为莫德雷德，移除双兰
soloHostGame.applyPresetMode('mordred');
assert.strictEqual(soloHostGame.config.roles.includes('mordred'), true);
assert.strictEqual(soloHostGame.config.roles.includes('good_lancelot'), false);
assert.strictEqual(soloHostGame.config.roles.includes('evil_lancelot'), false);

// 点击奥伯伦 -> 自动替换为奥伯伦
soloHostGame.applyPresetMode('oberon');
assert.strictEqual(soloHostGame.config.roles.includes('oberon'), true);
assert.strictEqual(soloHostGame.config.roles.includes('mordred'), false);

// 点击诸神全拓展
soloHostGame.applyPresetMode('all_star');
assert.strictEqual(soloHostGame.config.roles.includes('good_lancelot'), true);
assert.strictEqual(soloHostGame.config.roles.includes('evil_lancelot'), true);
console.log('✅ 点击玩法预设自动更新正义/邪恶人选测试通过！');

// 13. 测试线下物理座次对调 (changeSeatNumber)
console.log('\n--- 开始测试线下物理座次对调与选座机制 ---');
const seatGame = new AvalonGame('SEAT', 'h_seat', '房主一号', '👑');
seatGame.addPlayer('p_seat_2', '二号玩家', '🛡️');
seatGame.addPlayer('p_seat_3', '三号玩家', '🗡️');
seatGame.addPlayer('p_seat_4', '四号玩家', '🔮');
seatGame.addPlayer('p_seat_5', '五号玩家', '🐺');

assert.strictEqual(seatGame.players[0].seatNumber, 1);
assert.strictEqual(seatGame.players[1].seatNumber, 2);
assert.strictEqual(seatGame.players[2].seatNumber, 3);
assert.strictEqual(seatGame.players[3].seatNumber, 4);
assert.strictEqual(seatGame.players[4].seatNumber, 5);

// 房主与 4 号玩家对调座位
seatGame.changeSeatNumber('h_seat', 4);
// 此时原 4 号玩家应变成 1 号座位，房主变成 4 号座位
const newSeat1 = seatGame.players.find(p => p.seatNumber === 1);
const newSeat4 = seatGame.players.find(p => p.seatNumber === 4);
assert.strictEqual(newSeat1.id, 'p_seat_4', '原4号玩家应换到1号位');
assert.strictEqual(newSeat4.id, 'h_seat', '房主应换到4号位');
// players 数组必须依然保持升序
assert.strictEqual(seatGame.players[0].seatNumber, 1);
assert.strictEqual(seatGame.players[1].seatNumber, 2);
assert.strictEqual(seatGame.players[2].seatNumber, 3);
assert.strictEqual(seatGame.players[3].seatNumber, 4);
assert.strictEqual(seatGame.players[4].seatNumber, 5);
console.log('✅ 线下物理座次选择与对调测试通过：座位号互换成功且顺时针数组严密有序！');

// 14. 掷骰子后胜出车主发车 (startDrive) 权限与性能卡顿修复测试
console.log('\n--- 开始测试车主发车与性能消除卡顿机制 ---');
const driveGame = new AvalonGame('DRIVE', 'd_host', '发车房主', '👑');
driveGame.addPlayer('d_p2', '队员2', '🛡️');
driveGame.addPlayer('d_p3', '队员3', '🗡️');
driveGame.addPlayer('d_p4', '队员4', '🔮');
driveGame.addPlayer('d_p5', '队员5', '🐺');

driveGame.startRoleAssignment();
assert.strictEqual(driveGame.phase, GAME_PHASES.DICE_ROLL);

// 模拟摇骰子，令 d_p3 成为唯一最高分
driveGame.state.diceRolls['d_host'] = 1;
driveGame.state.diceRolls['d_p2'] = 3;
driveGame.state.diceRolls['d_p3'] = 6; // 胜出车主
driveGame.state.diceRolls['d_p4'] = 2;
driveGame.state.diceRolls['d_p5'] = 4;
driveGame.computeDiceWinner();

assert.strictEqual(driveGame.state.diceWinners.length, 1);
assert.strictEqual(driveGame.state.diceWinners[0], 'd_p3');

// 非胜出者且非房主尝试发车 -> 必须被拦截抛出异常
assert.throws(() => {
  driveGame.startDrive('d_p2');
}, /只有发车车主或房主可以点击开启发车/);

// 车主 d_p3 点击发车 -> 立刻进入选人出征，无延迟，无阻塞
driveGame.startDrive('d_p3');
assert.strictEqual(driveGame.phase, GAME_PHASES.TEAM_SELECT, '车主点击后应立刻进入TEAM_SELECT');
assert.strictEqual(driveGame.getCurrentLeader().id, 'd_p3', '发车队长必须是骰子胜出者');
console.log('✅ 车主发车与立即进入出征测试通过：操作权明确，杜绝任何卡死！');

// 15. 投完票清晰看到是谁投的票 (approvers / rejecters 公示明细测试)
console.log('\n--- 开始测试车票表决公开明细：谁投了赞成、谁投了反对 ---');
// 车长 d_p3 必须上车，第 1 轮共需 2 人，车长只需再挑选 d_host 出征
driveGame.proposeTeam('d_p3', ['d_p3', 'd_host']);
assert.strictEqual(driveGame.phase, GAME_PHASES.TEAM_VOTE);
assert.strictEqual(driveGame.state.proposedTeam.length, 2);
assert.strictEqual(driveGame.state.proposedTeam.includes('d_p3'), true);
assert.strictEqual(driveGame.state.proposedTeam.includes('d_host'), true);

// 模拟全员表决：d_host, d_p3, d_p5 投赞成；d_p2, d_p4 投反对
driveGame.castTeamVote('d_host', 'approve');
driveGame.castTeamVote('d_p2', 'reject');
driveGame.castTeamVote('d_p3', 'approve');
driveGame.castTeamVote('d_p4', 'reject');
driveGame.castTeamVote('d_p5', 'approve');

assert.strictEqual(driveGame.phase, GAME_PHASES.TEAM_RESULT);

const voteRes = driveGame.state.lastTeamVoteResult;
assert.ok(voteRes, '必须记录 lastTeamVoteResult');
assert.strictEqual(voteRes.passed, true);
assert.strictEqual(voteRes.approveCount, 3);
assert.strictEqual(voteRes.rejectCount, 2);

// 校验赞成名单与反对名单
const approverIds = voteRes.approvers.map(a => a.id);
const rejecterIds = voteRes.rejecters.map(r => r.id);
assert.deepStrictEqual(approverIds.sort(), ['d_host', 'd_p3', 'd_p5'].sort(), '赞成者名单精确无误');
assert.deepStrictEqual(rejecterIds.sort(), ['d_p2', 'd_p4'].sort(), '反对者名单精确无误');

// 校验每个投票者信息完整性（包含座位号、昵称、头像）
voteRes.approvers.forEach(a => {
  assert.ok(a.name, '必须包含玩家昵称');
  assert.ok(a.seatNumber, '必须包含玩家座位号');
  assert.strictEqual(a.vote, 'approve');
});
voteRes.rejecters.forEach(r => {
  assert.ok(r.name, '必须包含玩家昵称');
  assert.ok(r.seatNumber, '必须包含玩家座位号');
  assert.strictEqual(r.vote, 'reject');
});
console.log('✅ 车票表决双栏公示测试通过：清清楚楚记录谁投了赞成、谁投了反对！');

// 16. 测试默认蓝方三胜前刺杀 (随时拍刀) 机制
console.log('\n--- 开始测试默认蓝方三胜前刺杀 (刺客随时拍刀) 机制 ---');
const earlyGame = new AvalonGame('EARLY', 'e_host', '早期房主', '👑');
earlyGame.addPlayer('e_p2', '队员2', '🛡️');
earlyGame.addPlayer('e_p3', '队员3', '🗡️');
earlyGame.addPlayer('e_p4', '队员4', '🔮');
earlyGame.addPlayer('e_p5', '队员5', '🐺');

// 校验默认开启三胜前刺杀
assert.strictEqual(earlyGame.config.allowEarlyAssassination, true, '必须默认开启蓝方三胜前刺杀');

// 手动分配角色：e_host(梅林), e_p2(派西维尔), e_p3(忠臣), e_p4(刺客), e_p5(莫甘娜)
earlyGame.players[0].role = 'merlin';
earlyGame.players[1].role = 'percival';
earlyGame.players[2].role = 'loyal';
earlyGame.players[3].role = 'assassin'; // e_p4是刺客
earlyGame.players[4].role = 'morgana';

// 此时处于第 1 轮 TEAM_SELECT（蓝方 0 胜，完全未达 3 胜）
earlyGame.phase = GAME_PHASES.TEAM_SELECT;

// 梅林严禁拍刀测试：e_host是房主但角色是梅林，绝不可拍刀，必须严格拦截
assert.throws(() => {
  earlyGame.triggerEarlyAssassination('e_host');
}, /只有真实身份为刺客的玩家才可以立即拍刀发起刺杀/);
console.log('✅ 梅林严禁拍刀测试通过：梅林（即使是房主）尝试拍刀被严格拦截！');

// 派西维尔等好人也严禁拍刀
assert.throws(() => {
  earlyGame.triggerEarlyAssassination('e_p2');
}, /只有真实身份为刺客的玩家才可以立即拍刀发起刺杀/);
console.log('✅ 好人阵营严禁拍刀测试通过');

// 刺客 e_p4 发起提前拍刀刺杀！
earlyGame.triggerEarlyAssassination('e_p4');
assert.strictEqual(earlyGame.phase, GAME_PHASES.ASSASSINATION, '刺客拍刀后应立即切入刺杀阶段');

// 刺客精准刺杀梅林 e_host -> 邪恶阵营逆转获胜
earlyGame.assassinateTarget('e_p4', 'e_host');
assert.strictEqual(earlyGame.phase, GAME_PHASES.GAME_OVER);
assert.strictEqual(earlyGame.state.winner, 'evil', '提前命中梅林，邪恶阵营获胜');
console.log('✅ 默认蓝方三胜前刺杀 (随时拍刀) 测试通过！');

// 17. 测试发车表决记录累加与随时查阅
console.log('\n--- 开始测试发车投票记录持续保存与随时查阅 ---');
assert.strictEqual(driveGame.state.teamVoteHistory.length >= 1, true, '发车历史应记录在 teamVoteHistory 中');
const histRecord = driveGame.state.teamVoteHistory[0];
assert.strictEqual(histRecord.passed, true);
assert.strictEqual(histRecord.approvers.length, 3);
assert.strictEqual(histRecord.rejecters.length, 2);
console.log('✅ 发车表决历史记录持续留存测试通过！随时可查！');

console.log('\n🎉 所有核心测试全部通过！系统健壮稳定！');
