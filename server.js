const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');

const AvalonGame = require('./src/game/AvalonGame');
const { ROLES, DEFAULT_RULES, GAME_PHASES, PRESET_MODES, FORBIDDEN_ROLE_KEYWORDS, checkPlayerNameValidity } = require('./src/game/constants');
const { getLocalIpAddress } = require('./src/network/ipHelper');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

let PORT = parseInt(process.env.PORT, 10) || 3000;
const localIp = getLocalIpAddress();

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 全局房间存储 Map: roomId -> AvalonGame
const rooms = new Map();

// API: 角色字典与默认配置参考
app.get('/api/meta', (req, res) => {
  res.json({
    roles: ROLES,
    defaultRules: DEFAULT_RULES,
    presetModes: PRESET_MODES,
    forbiddenRoleKeywords: FORBIDDEN_ROLE_KEYWORDS,
    localIp,
    port: PORT
  });
});

// API: 动态生成二维码
app.get('/api/qrcode', async (req, res) => {
  try {
    const text = req.query.text || `http://${localIp}:${PORT}`;
    const dataUrl = await QRCode.toDataURL(text, { margin: 1, width: 280 });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// 广播指定房间的状态给所有玩家（根据每个玩家专属视线脱敏派发）
function broadcastRoomState(room) {
  room.players.forEach(p => {
    const view = room.getPlayerView(p.id);
    io.to(p.id).emit('room_state_update', view);
  });
}

// 统一的发言倒计时心跳循环
setInterval(() => {
  rooms.forEach(room => {
    if (room.state.speech && room.state.speech.active && !room.state.speech.isPaused) {
      room.state.speech.timeLeft -= 1;
      if (room.state.speech.timeLeft <= 0) {
        // 时间到，自动过麦给下一位
        room.nextSpeaker();
      }
      broadcastRoomState(room);
    }
  });
}, 1000);

// 生成 4 位大写字母/数字房间号
function generateRoomId() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(id) ? generateRoomId() : id;
}

// --- Socket.IO 事件路由 ---

io.on('connection', socket => {
  let currentRoomId = null;

  // 1. 创建房间（支持房主自定义房间号）
  socket.on('create_room', ({ playerName, avatar, customRoomId }) => {
    try {
      const pName = (playerName || '领主').trim();
      const nameCheck = checkPlayerNameValidity(pName);
      if (!nameCheck.valid) {
        return socket.emit('action_error', { message: nameCheck.message });
      }

      let roomId = '';
      const trimmedCustom = (customRoomId || '').trim().toUpperCase();

      if (trimmedCustom) {
        // 校验自定义房间号格式 (2~10位英文字母或数字)
        if (!/^[A-Z0-9_-]{2,10}$/.test(trimmedCustom)) {
          return socket.emit('action_error', { message: '自定义房间号仅限 2~10 位字母或数字！' });
        }
        if (rooms.has(trimmedCustom)) {
          return socket.emit('action_error', { message: `房间号【${trimmedCustom}】已被占用，请换一个！` });
        }
        roomId = trimmedCustom;
      } else {
        // 未填写自定义房间号，系统自动生成 4 位随机房间号
        roomId = generateRoomId();
      }

      const game = new AvalonGame(roomId, socket.id, pName, avatar || '👑');
      rooms.set(roomId, game);
      currentRoomId = roomId;
      socket.join(roomId);

      socket.emit('room_created', { roomId });
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 2. 加入房间
  socket.on('join_room', ({ roomId, playerName, avatar }) => {
    try {
      const pName = (playerName || '').trim();
      if (!pName) {
        return socket.emit('action_error', { message: '请输入玩家昵称后再加入房间！' });
      }
      const nameCheck = checkPlayerNameValidity(pName);
      if (!nameCheck.valid) {
        return socket.emit('action_error', { message: nameCheck.message });
      }

      const idUpper = (roomId || '').trim().toUpperCase();
      const game = rooms.get(idUpper);
      if (!game) {
        return socket.emit('action_error', { message: `房间【${idUpper}】不存在，请核对房间号！` });
      }

      currentRoomId = idUpper;
      socket.join(idUpper);

      // 检查是否已在房间中（重连）
      const existingPlayer = game.players.find(p => p.id === socket.id || p.name === pName);
      if (existingPlayer) {
        existingPlayer.id = socket.id;
        existingPlayer.isOnline = true;
      } else {
        game.addPlayer(socket.id, pName, avatar || '⚔️');
      }

      socket.emit('room_joined', { roomId: idUpper });
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 3. 一键切换玩法预设
  socket.on('apply_preset', ({ presetKey }) => {
    const game = rooms.get(currentRoomId);
    if (!game || game.hostId !== socket.id) return;
    try {
      game.applyPresetMode(presetKey);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 3.1 恢复默认人数推荐配置
  socket.on('reset_recommended_config', () => {
    const game = rooms.get(currentRoomId);
    if (!game || game.hostId !== socket.id) return;
    try {
      game.resetToRecommendedConfig();
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 3.2 修改房间自定义配置 (角色、湖中仙女等)
  socket.on('update_config', config => {
    const game = rooms.get(currentRoomId);
    if (!game || game.hostId !== socket.id) return;
    try {
      game.updateConfig(config);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 4. 房主启动角色分配
  socket.on('start_role_assignment', () => {
    const game = rooms.get(currentRoomId);
    if (!game || game.hostId !== socket.id) return;
    try {
      game.startRoleAssignment();
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 4.1 玩家自选/调整线下物理座位号 (1 ~ N)
  socket.on('change_seat', ({ seatNumber }) => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.changeSeatNumber(socket.id, seatNumber);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 5. 玩家自选认领角色
  socket.on('claim_role', ({ roleId }) => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.claimRole(socket.id, roleId);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 6. 掷骰子选先手 (用户核心需求)
  socket.on('roll_dice', () => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      const val = game.rollDice(socket.id);
      socket.emit('dice_rolled', { value: val });
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 房主一键全员摇骰子
  socket.on('roll_all_dice', () => {
    const game = rooms.get(currentRoomId);
    if (!game || game.hostId !== socket.id) return;
    try {
      game.rollAllRemainingDice();
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 骰子平局重投
  socket.on('reroll_tied_dice', () => {
    const game = rooms.get(currentRoomId);
    if (!game || game.hostId !== socket.id) return;
    try {
      game.rerollTiedPlayers();
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 6.2 骰子点数最大者（或房主）点击立即发车！
  socket.on('start_drive', () => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.startDrive(socket.id);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 7. 队长组队出征提议
  socket.on('propose_team', ({ selectedPlayerIds }) => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.proposeTeam(socket.id, selectedPlayerIds);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 8. 车票公开表决
  socket.on('cast_team_vote', ({ vote }) => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.castTeamVote(socket.id, vote);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 9. 车票结果展示后继续
  socket.on('proceed_team_result', () => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.proceedAfterTeamResult();
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 10. 任务暗投
  socket.on('cast_quest_vote', ({ vote }) => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.castQuestVote(socket.id, vote);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 11. 任务结果展示后继续
  socket.on('proceed_quest_result', () => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.proceedAfterQuestResult();
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 11.5 兰斯洛特命运抽牌
  socket.on('draw_lancelot', () => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.drawLancelotCard();
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  socket.on('proceed_lancelot', () => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    if (game.hostId === socket.id || (game.getCurrentLeader() && game.getCurrentLeader().id === socket.id)) {
      game.proceedAfterLancelotSwitch();
      broadcastRoomState(game);
    }
  });

  // 12. 湖中仙女验人
  socket.on('use_lady', ({ targetId }) => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      const result = game.useLadyOfLake(socket.id, targetId);
      socket.emit('lady_result_private', result);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  socket.on('finish_lady', () => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    if (game.hostId === socket.id || game.state.ladyHolder === socket.id) {
      game.finishLadyPhase();
      broadcastRoomState(game);
    }
  });

  // 12.5 刺客提前拍刀刺杀 (默认蓝方三胜前刺杀)
  socket.on('trigger_early_assassination', () => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.triggerEarlyAssassination(socket.id);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 13. 刺客刺杀梅林
  socket.on('assassinate', ({ targetId }) => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.assassinateTarget(socket.id, targetId);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  // 14. 发言系统控制
  socket.on('start_speech', ({ mode, startPlayerId }) => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    try {
      game.startSpeech(mode, startPlayerId);
      broadcastRoomState(game);
    } catch (err) {
      socket.emit('action_error', { message: err.message });
    }
  });

  socket.on('speech_pass', () => {
    const game = rooms.get(currentRoomId);
    if (!game) return;
    // 当前发言者或房主均可点“过麦”
    if (game.state.speech.speakerId === socket.id || game.hostId === socket.id) {
      game.nextSpeaker();
      broadcastRoomState(game);
    }
  });

  socket.on('speech_control', ({ action }) => {
    const game = rooms.get(currentRoomId);
    if (!game || game.hostId !== socket.id) return;
    if (action === 'pause') game.toggleSpeechPause();
    else if (action === 'reset') game.resetSpeechTimer();
    else if (action === 'prev') game.prevSpeaker();
    else if (action === 'next') game.nextSpeaker();
    else if (action === 'stop') game.stopSpeechTimer();
    broadcastRoomState(game);
  });

  // 15. 再来一局 / 重置
  socket.on('reset_game', () => {
    const game = rooms.get(currentRoomId);
    if (!game || game.hostId !== socket.id) return;
    game.resetGame();
    broadcastRoomState(game);
  });

  // 16. 断线处理
  socket.on('disconnect', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const game = rooms.get(currentRoomId);
      const player = game.players.find(p => p.id === socket.id);
      if (player) {
        if (game.phase === GAME_PHASES.LOBBY) {
          game.removePlayer(socket.id);
          if (game.players.length === 0) {
            rooms.delete(currentRoomId);
            return;
          }
        } else {
          // 游戏中标记离线，保留席位以便刷新重连
          player.isOnline = false;
        }
        broadcastRoomState(game);
      }
    }
  });
});

function startListening(port) {
  server.listen(port, '0.0.0.0', () => {
    PORT = port;
    console.log(`\n======================================================`);
    console.log(`🏰 阿瓦隆线下法官与线上联机系统已就绪！`);
    console.log(`💻 本机访问地址:   http://localhost:${PORT}`);
    console.log(`📱 手机局域网访问: http://${localIp}:${PORT}`);
    console.log(`🎲 所有人用同一WiFi下的手机浏览器打开上述地址即可直接加入！`);
    console.log(`======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
      console.warn(`⚠️ 端口 ${port} 被占用或无权限，尝试使用端口 ${port + 1}...`);
      setTimeout(() => {
        startListening(port + 1);
      }, 500);
    } else {
      console.error('Server error:', err);
    }
  });
}

startListening(PORT);
