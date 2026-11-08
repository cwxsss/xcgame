// 阿瓦隆线上法官与移动端客户端核心驱动脚本

document.addEventListener('DOMContentLoaded', () => {
  // 初始化 Lucide 图标
  if (window.lucide) {
    window.lucide.createIcons();
  }

  const socket = io();

  // 本地客户端状态
  let currentRoom = null;
  let metaInfo = null;
  let selectedAvatar = '🧙';
  let mySelectedTeamCandidates = []; // 队长暂存选中的队员 ID

  // --- 1. 获取全局配置元数据 ---
  fetch('/api/meta')
    .then(res => res.json())
    .then(data => {
      metaInfo = data;
      // 检查 URL 是否带 roomId 与密码 pwd
      const urlParams = new URLSearchParams(window.location.search);
      const urlRoomId = urlParams.get('room');
      const urlPwd = urlParams.get('pwd');
      if (urlRoomId) {
        document.getElementById('input-join-room-id').value = urlRoomId.toUpperCase();
      }
      if (urlPwd) {
        document.getElementById('input-room-password').value = urlPwd;
      }
    })
    .catch(err => console.error('Fetch meta failed:', err));

  // --- 2. 界面元素缓存 ---
  const views = {
    login: document.getElementById('view-login'),
    lobby: document.getElementById('view-lobby'),
    diceRoll: document.getElementById('view-dice-roll'),
    gamePlay: document.getElementById('view-game-play'),
    gameOver: document.getElementById('view-game-over')
  };

  const steps = {
    lancelotSwitch: document.getElementById('step-lancelot-switch'),
    teamSelect: document.getElementById('step-team-select'),
    teamVote: document.getElementById('step-team-vote'),
    teamResult: document.getElementById('step-team-result'),
    questVote: document.getElementById('step-quest-vote'),
    questResult: document.getElementById('step-quest-result'),
    ladyLake: document.getElementById('step-lady-lake'),
    assassination: document.getElementById('step-assassination')
  };

  const gameHeader = document.getElementById('game-header');
  const speechBanner = document.getElementById('speech-banner');

  // --- 3. 视图切换路由 ---
  function showView(viewKey) {
    Object.keys(views).forEach(k => {
      if (k === viewKey) {
        views[k].classList.remove('hidden');
      } else {
        views[k].classList.add('hidden');
      }
    });

    if (viewKey === 'login') {
      gameHeader.classList.add('hidden');
      speechBanner.classList.add('hidden');
    } else {
      gameHeader.classList.remove('hidden');
    }
  }

  function showGameStep(stepKey) {
    Object.keys(steps).forEach(k => {
      if (k === stepKey) {
        steps[k].classList.remove('hidden');
      } else {
        steps[k].classList.add('hidden');
      }
    });
  }

  // --- 4. 头像挑选器 ---
  document.querySelectorAll('.avatar-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.avatar-option').forEach(b => {
        b.classList.remove('border-amber-400');
        b.classList.add('border-transparent');
      });
      btn.classList.remove('border-transparent');
      btn.classList.add('border-amber-400');
      selectedAvatar = btn.dataset.avatar;
      window.soundFx.click();
    });
  });

  // --- 5. 登录 / 创建 / 加入房间 ---
  const inputPlayerName = document.getElementById('input-player-name');
  const inputJoinRoomId = document.getElementById('input-join-room-id');
  const inputCustomRoomId = document.getElementById('input-custom-room-id');

  // 严禁包含身份名称的关键字
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

  function validateNickname(name) {
    if (!name || name.trim().length === 0) {
      return { valid: false, message: '请输入玩家昵称！' };
    }
    const clean = name.trim();
    if (clean.length > 12) {
      return { valid: false, message: '玩家昵称长度不能超过 12 个字符！' };
    }
    const lower = clean.toLowerCase();
    for (const kw of FORBIDDEN_ROLE_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) {
        return { valid: false, message: `昵称中不能包含身份名称【${kw}】，请使用其他昵称！` };
      }
    }
    return { valid: true };
  }

  // 记住本地昵称
  const savedName = localStorage.getItem('avalon_player_name');
  if (savedName) inputPlayerName.value = savedName;

  document.getElementById('btn-create-room').addEventListener('click', () => {
    const rawName = inputPlayerName.value.trim();
    const name = rawName || '领主';
    const check = validateNickname(name);
    if (!check.valid) {
      return alert(check.message);
    }

    const customRoomId = inputCustomRoomId ? inputCustomRoomId.value.trim().toUpperCase() : '';
    localStorage.setItem('avalon_player_name', name);
    window.soundFx.click();
    socket.emit('create_room', { playerName: name, avatar: selectedAvatar, customRoomId });
  });

  document.getElementById('btn-join-room').addEventListener('click', () => {
    const rawName = inputPlayerName.value.trim();
    const name = rawName || '骑士';
    const check = validateNickname(name);
    if (!check.valid) {
      return alert(check.message);
    }

    const roomId = inputJoinRoomId.value.trim().toUpperCase();
    if (!roomId) {
      return alert('请输入房间号');
    }
    localStorage.setItem('avalon_player_name', name);
    window.soundFx.click();
    socket.emit('join_room', { roomId, playerName: name, avatar: selectedAvatar });
  });

  // --- 6. 核心监听：房间最新状态广播 ---
  socket.on('room_state_update', roomData => {
    currentRoom = roomData;
    renderAll(roomData);
  });

  socket.on('action_error', ({ message }) => {
    alert(`提示: ${message}`);
  });

  // --- 7. 全局统一渲染 ---
  function renderAll(room) {
    // 顶部状态栏
    document.getElementById('header-room-id').textContent = room.roomId;
    document.getElementById('score-good').textContent = room.state.scores.good;
    document.getElementById('score-evil').textContent = room.state.scores.evil;

    // 渲染5轮指示点与当前轮数高亮
    renderRoundIndicators(room);

    // 渲染车票连倒指示器
    renderAttemptIndicators(room.state.attemptCount);

    // 渲染发言横幅
    renderSpeechBanner(room);

    // 渲染当前玩家机密身份卡
    renderMyIdentityModal(room);

    // 渲染线下物理座次弹窗（若打开中则实时更新）
    renderSeatModal(room);

    // 渲染历史票型弹窗（若打开中则实时更新）
    renderVoteHistoryModal(room);

    // 根据不同阶段切到对应主视图
    const phase = room.phase;

    if (phase === 'LOBBY') {
      showView('lobby');
      renderLobby(room);
    } else if (phase === 'DICE_ROLL') {
      showView('diceRoll');
      renderDiceRoll(room);
    } else if (phase === 'GAME_OVER') {
      showView('gameOver');
      renderGameOver(room);
    } else {
      // 游戏对局中各个环节
      showView('gamePlay');
      renderGamePlay(room);
    }

    // 重新渲染新插入的 Lucide 图标
    if (window.lucide) window.lucide.createIcons();
  }

  // --- 8. 轮次与连倒渲染 ---
  function renderRoundIndicators(room) {
    const dots = document.querySelectorAll('.quest-dot');
    dots.forEach((dot, idx) => {
      const rNum = idx + 1;
      const roundHist = room.state.roundHistory[idx];
      const capacity = room.config.questCapacities[idx] || 2;
      const isTwoFails = (rNum === 4 && room.config.twoFailsOnRound4);

      dot.textContent = `${capacity}${isTwoFails ? '*' : ''}`;

      if (roundHist) {
        if (roundHist.isSuccess) {
          dot.className = 'quest-dot w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px] shadow-sm shadow-blue-500/50';
        } else {
          dot.className = 'quest-dot w-6 h-6 rounded-full bg-red-600 text-white font-bold flex items-center justify-center text-[10px] shadow-sm shadow-red-500/50';
        }
      } else if (rNum === room.state.currentRound) {
        dot.className = 'quest-dot w-6 h-6 rounded-full border-2 border-amber-400 bg-slate-800 text-amber-300 font-bold flex items-center justify-center text-[10px] animate-pulse';
      } else {
        dot.className = 'quest-dot w-6 h-6 rounded-full border border-slate-700 bg-slate-800/80 text-slate-500 flex items-center justify-center text-[10px]';
      }
    });
  }

  function renderAttemptIndicators(attempts) {
    const dots = document.getElementById('attempt-indicator').children;
    for (let i = 0; i < dots.length; i++) {
      if (i < attempts) {
        dots[i].className = 'w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50';
      } else {
        dots[i].className = i === 4
          ? 'w-2.5 h-2.5 rounded-full bg-red-950 border border-red-500/40'
          : 'w-2.5 h-2.5 rounded-full bg-slate-700';
      }
    }
  }

  // --- 9. 发言系统横幅渲染 ---
  let lastTimeLeft = 60;
  function renderSpeechBanner(room) {
    const sp = room.state.speech;
    if (!sp || !sp.active) {
      speechBanner.classList.add('hidden');
      return;
    }

    speechBanner.classList.remove('hidden');
    const speaker = room.players.find(p => p.id === sp.speakerId);
    document.getElementById('speech-speaker-name').innerHTML = speaker
      ? `<span>${speaker.avatar}</span> <span>${speaker.name}</span> <span class="text-xs text-amber-300/80 font-normal">(${speaker.seatNumber}号位)</span>`
      : '未知';

    const timerDisp = document.getElementById('speech-timer-display');
    timerDisp.textContent = sp.timeLeft;

    // 最后5秒滴答声
    if (sp.timeLeft <= 5 && sp.timeLeft > 0 && sp.timeLeft !== lastTimeLeft && !sp.isPaused) {
      window.soundFx.tick();
    }
    lastTimeLeft = sp.timeLeft;

    // 自己过麦控制
    const btnPass = document.getElementById('btn-self-pass');
    if (room.self && room.self.id === sp.speakerId) {
      btnPass.classList.remove('hidden');
    } else {
      btnPass.classList.add('hidden');
    }

    // 房主控制条
    const hostBar = document.getElementById('host-speech-bar');
    if (room.isHost) {
      hostBar.classList.remove('hidden');
      document.getElementById('btn-host-speech-pause').textContent = sp.isPaused ? '继续' : '暂停';
    } else {
      hostBar.classList.add('hidden');
    }
  }

  // 发言控制绑定
  document.getElementById('btn-self-pass').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('speech_pass');
  });
  document.getElementById('btn-host-speech-prev').addEventListener('click', () => socket.emit('speech_control', { action: 'prev' }));
  document.getElementById('btn-host-speech-pause').addEventListener('click', () => socket.emit('speech_control', { action: 'pause' }));
  document.getElementById('btn-host-speech-reset').addEventListener('click', () => socket.emit('speech_control', { action: 'reset' }));
  document.getElementById('btn-host-speech-next').addEventListener('click', () => socket.emit('speech_control', { action: 'next' }));
  document.getElementById('btn-host-speech-stop').addEventListener('click', () => socket.emit('speech_control', { action: 'stop' }));

  // 发起发言
  document.getElementById('btn-trigger-speech').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('start_speech', { mode: 'clockwise' });
  });

  // --- 10. 大厅渲染 (LOBBY) ---
  function renderLobby(room) {
    document.getElementById('lobby-room-code').textContent = room.roomId;
    document.getElementById('lobby-player-count-badge').textContent = `${room.players.length} 人`;

    // 渲染玩家席位
    const listEl = document.getElementById('lobby-players-list');
    listEl.innerHTML = '';
    room.players.forEach(p => {
      const card = document.createElement('div');
      const isMe = room.self && room.self.id === p.id;
      card.className = `p-2.5 rounded-xl border flex items-center gap-2 ${
        isMe ? 'bg-amber-500/10 border-amber-400' : 'bg-slate-800/80 border-slate-700'
      }`;
      card.innerHTML = `
        <div class="text-xl">${p.avatar}</div>
        <div class="truncate flex-1">
          <div class="font-bold text-slate-200 truncate flex items-center gap-1">
            <span>${p.name}</span>
            ${p.isHost ? '<span class="text-[9px] bg-amber-500/20 text-amber-300 px-1 rounded">房主</span>' : ''}
            ${isMe ? '<span class="text-[9px] bg-blue-500/20 text-blue-300 px-1 rounded">我</span>' : ''}
          </div>
          <span class="text-[10px] text-slate-400">${p.seatNumber} 号座位</span>
        </div>
      `;
      listEl.appendChild(card);
    });

    // 房主控制面板
    const hostPanel = document.getElementById('host-config-panel');
    const hostStart = document.getElementById('host-start-container');
    const guestHint = document.getElementById('guest-waiting-hint');

    if (room.isHost) {
      hostPanel.classList.remove('hidden');
      hostStart.classList.remove('hidden');
      guestHint.classList.add('hidden');
      updateLobbyConfigUI(room.config, room.players.length);
    } else {
      hostPanel.classList.add('hidden');
      hostStart.classList.add('hidden');
      guestHint.classList.remove('hidden');
    }
  }

  // 房主配置界面同步
  let localLobbyConfig = null;
  function updateLobbyConfigUI(cfg, playerCount) {
    localLobbyConfig = JSON.parse(JSON.stringify(cfg));

    // 同步玩法预设高亮
    const activePreset = cfg.presetMode || (cfg.isCustomized ? 'custom' : 'classic');
    document.querySelectorAll('.preset-btn').forEach(btn => {
      if (btn.dataset.preset === activePreset) {
        btn.className = 'preset-btn p-1.5 rounded-lg border border-amber-400 bg-amber-500/10 text-amber-300 font-bold';
      } else {
        btn.className = 'preset-btn p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 font-normal';
      }
    });

    const presetNames = {
      classic: '经典标准局',
      lancelot: '双兰变节 · 命运互换',
      mordred: '暗影首领 · 莫德雷德',
      oberon: '独狼之乱 · 奥伯伦',
      all_star: '诸神乱斗 · 全拓展',
      custom: '自由自定义'
    };
    const presetBadge = document.getElementById('current-preset-badge');
    if (presetBadge) {
      presetBadge.textContent = presetNames[activePreset] || activePreset;
    }

    // 角色勾选状态
    document.getElementById('cfg-role-percival').checked = cfg.roles.includes('percival');
    document.getElementById('cfg-role-good-lancelot').checked = cfg.roles.includes('good_lancelot');
    document.getElementById('cfg-role-morgana').checked = cfg.roles.includes('morgana');
    document.getElementById('cfg-role-mordred').checked = cfg.roles.includes('mordred');
    document.getElementById('cfg-role-oberon').checked = cfg.roles.includes('oberon');
    document.getElementById('cfg-role-evil-lancelot').checked = cfg.roles.includes('evil_lancelot');

    const loyalCount = cfg.roles.filter(r => r === 'loyal').length;
    document.getElementById('loyal-count-text').textContent = loyalCount;

    const minionCount = cfg.roles.filter(r => r === 'minion').length;
    document.getElementById('minion-count-text').textContent = minionCount;

    document.getElementById('cfg-lady-lake').checked = cfg.enableLadyOfLake;
    document.getElementById('cfg-two-fails-r4').checked = cfg.twoFailsOnRound4;
    const cfgEarlyAssassinate = document.getElementById('cfg-early-assassination');
    if (cfgEarlyAssassinate) {
      cfgEarlyAssassinate.checked = (cfg.allowEarlyAssassination !== false);
    }
    document.getElementById('cfg-speech-time').value = cfg.speechTimeLimit || 60;

    // 数量汇总对比
    const summary = document.getElementById('role-count-summary');
    summary.textContent = `已选角色 ${cfg.roles.length} / 玩家 ${playerCount}`;
    if (cfg.roles.length === playerCount && playerCount >= 5) {
      summary.className = 'text-[10px] text-emerald-400 font-mono font-bold';
      document.getElementById('btn-host-start-game').disabled = false;
      document.getElementById('start-game-error-hint').classList.add('hidden');
    } else {
      summary.className = 'text-[10px] text-rose-400 font-mono font-bold';
      document.getElementById('start-game-error-hint').classList.remove('hidden');
      document.getElementById('start-game-error-hint').textContent = playerCount < 5
        ? '至少需要 5 名玩家入座'
        : `角色数 (${cfg.roles.length}) 与玩家数 (${playerCount}) 不一致`;
    }
  }

  // 绑定房主大厅配置事件
  function getRolesFromUI() {
    const roles = ['merlin', 'assassin'];
    if (document.getElementById('cfg-role-percival').checked) roles.push('percival');
    if (document.getElementById('cfg-role-good-lancelot').checked) roles.push('good_lancelot');
    if (document.getElementById('cfg-role-morgana').checked) roles.push('morgana');
    if (document.getElementById('cfg-role-mordred').checked) roles.push('mordred');
    if (document.getElementById('cfg-role-oberon').checked) roles.push('oberon');
    if (document.getElementById('cfg-role-evil-lancelot').checked) roles.push('evil_lancelot');

    const loyalCount = parseInt(document.getElementById('loyal-count-text').textContent) || 0;
    for (let i = 0; i < loyalCount; i++) roles.push('loyal');

    const minionCount = parseInt(document.getElementById('minion-count-text').textContent) || 0;
    for (let i = 0; i < minionCount; i++) roles.push('minion');

    return roles;
  }

  function emitConfigChange() {
    if (!currentRoom || !currentRoom.isHost) return;
    const roles = getRolesFromUI();
    const cfgEarly = document.getElementById('cfg-early-assassination');
    const config = {
      roles,
      allowEarlyAssassination: cfgEarly ? cfgEarly.checked : true,
      enableLadyOfLake: document.getElementById('cfg-lady-lake').checked,
      twoFailsOnRound4: document.getElementById('cfg-two-fails-r4').checked,
      speechTimeLimit: parseInt(document.getElementById('cfg-speech-time').value) || 60
    };
    socket.emit('update_config', config);
  }

  // 点击玩法预设即刻计算并刷新下方正义阵营与邪恶阵营的人选
  function applyPresetToUI(presetKey) {
    const rawCount = currentRoom && currentRoom.players ? currentRoom.players.length : 1;
    const pCount = Math.max(5, Math.min(10, rawCount));

    const rules = (metaInfo && metaInfo.defaultRules && metaInfo.defaultRules[pCount])
      ? metaInfo.defaultRules[pCount]
      : { good: 3, evil: 2 };

    let roles = [];
    let enableLady = false;
    let enableLance = false;

    if (presetKey === 'classic') {
      const good = ['merlin'];
      if (rules.good >= 2) good.push('percival');
      while (good.length < rules.good) good.push('loyal');
      const evil = ['assassin'];
      if (rules.evil >= 2) evil.push('morgana');
      if (rules.evil >= 3) evil.push('mordred');
      if (rules.evil >= 4) evil.push('oberon');
      roles = [...good, ...evil];
    } else if (presetKey === 'lancelot') {
      enableLance = true;
      const good = ['merlin', 'good_lancelot'];
      while (good.length < rules.good) good.push('loyal');
      const evil = ['assassin', 'evil_lancelot'];
      if (rules.evil >= 3) evil.push('morgana');
      if (rules.evil >= 4) evil.push('mordred');
      roles = [...good, ...evil];
    } else if (presetKey === 'mordred') {
      enableLady = true;
      const good = ['merlin'];
      if (rules.good >= 2) good.push('percival');
      while (good.length < rules.good) good.push('loyal');
      const evil = ['assassin', 'mordred'];
      if (rules.evil >= 3) evil.push('morgana');
      if (rules.evil >= 4) evil.push('oberon');
      roles = [...good, ...evil];
    } else if (presetKey === 'oberon') {
      const good = ['merlin'];
      if (rules.good >= 2) good.push('percival');
      while (good.length < rules.good) good.push('loyal');
      const evil = ['assassin', 'oberon'];
      if (rules.evil >= 3) evil.push('morgana');
      if (rules.evil >= 4) evil.push('mordred');
      roles = [...good, ...evil];
    } else if (presetKey === 'all_star') {
      enableLance = true;
      enableLady = true;
      const good = ['merlin', 'percival', 'good_lancelot'];
      while (good.length < rules.good) good.push('loyal');
      const evil = ['assassin', 'evil_lancelot', 'morgana'];
      if (rules.evil >= 4) evil.push('mordred');
      roles = [...good.slice(0, rules.good), ...evil.slice(0, rules.evil)];
    }

    const cfg = {
      presetMode: presetKey,
      isCustomized: false,
      roles,
      enableLadyOfLake: enableLady,
      enableLancelot: enableLance,
      twoFailsOnRound4: (pCount >= 7),
      speechTimeLimit: parseInt(document.getElementById('cfg-speech-time').value) || 60,
      allowEarlyAssassination: true
    };

    updateLobbyConfigUI(cfg, rawCount);
  }

  // 玩法预设点击一键配置
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.dataset.preset;
      if (presetKey === 'custom') return; // 点击自定义不强制重置
      window.soundFx.click();
      applyPresetToUI(presetKey);
      socket.emit('apply_preset', { presetKey });
    });
  });

  const btnResetRec = document.getElementById('btn-reset-recommended');
  if (btnResetRec) {
    btnResetRec.addEventListener('click', () => {
      window.soundFx.click();
      applyPresetToUI('classic');
      socket.emit('reset_recommended_config');
    });
  }

  document.querySelectorAll('.role-checkbox, #cfg-early-assassination, #cfg-lady-lake, #cfg-two-fails-r4, #cfg-speech-time').forEach(el => {
    el.addEventListener('change', emitConfigChange);
  });

  document.getElementById('btn-loyal-plus').addEventListener('click', () => {
    const el = document.getElementById('loyal-count-text');
    el.textContent = parseInt(el.textContent) + 1;
    emitConfigChange();
  });
  document.getElementById('btn-loyal-minus').addEventListener('click', () => {
    const el = document.getElementById('loyal-count-text');
    el.textContent = Math.max(0, parseInt(el.textContent) - 1);
    emitConfigChange();
  });

  document.getElementById('btn-minion-plus').addEventListener('click', () => {
    const el = document.getElementById('minion-count-text');
    el.textContent = parseInt(el.textContent) + 1;
    emitConfigChange();
  });
  document.getElementById('btn-minion-minus').addEventListener('click', () => {
    const el = document.getElementById('minion-count-text');
    el.textContent = Math.max(0, parseInt(el.textContent) - 1);
    emitConfigChange();
  });

  document.getElementById('btn-apply-config').addEventListener('click', () => {
    window.soundFx.click();
    emitConfigChange();
  });

  document.getElementById('btn-host-start-game').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('start_role_assignment');
  });

  // --- 11. 掷骰子选先手发车队长渲染 (DICE_ROLL - 核心需求) ---
  const diceCube = document.getElementById('main-dice-cube');
  const btnRollDice = document.getElementById('btn-roll-dice');
  const myDiceResultText = document.getElementById('my-dice-result-text');
  const driveActionContainer = document.getElementById('dice-drive-action-container');
  const btnWinnerDrive = document.getElementById('btn-winner-start-drive');
  const btnHostForceDrive = document.getElementById('btn-host-force-drive');
  const waitingDriverText = document.getElementById('dice-waiting-driver-text');
  const driverNameSpan = document.getElementById('dice-driver-name');

  function renderDiceRoll(room) {
    const rolls = room.state.diceRolls || {};
    const winners = room.state.diceWinners || [];
    const myId = room.self ? room.self.id : null;
    const hasMyRolled = rolls[myId] !== undefined;

    // 个人投掷状态
    if (hasMyRolled) {
      btnRollDice.classList.add('hidden');
      myDiceResultText.classList.remove('hidden');
      myDiceResultText.textContent = `🎯 您的骰子点数: ${rolls[myId]} 点！`;
      setDiceCubeFace(rolls[myId]);
    } else {
      btnRollDice.classList.remove('hidden');
      myDiceResultText.classList.add('hidden');
    }

    // 房主控制按键
    const hostControls = document.getElementById('host-dice-controls');
    const btnRerollTie = document.getElementById('btn-host-reroll-tie');
    if (room.isHost) {
      hostControls.classList.remove('hidden');
      if (winners.length > 1) {
        btnRerollTie.classList.remove('hidden');
      } else {
        btnRerollTie.classList.add('hidden');
      }
    } else {
      hostControls.classList.add('hidden');
    }

    // 渲染排行榜
    const sb = document.getElementById('dice-scoreboard');
    sb.innerHTML = '';
    room.players.forEach(p => {
      const val = rolls[p.id];
      const isWinner = winners.includes(p.id);
      const row = document.createElement('div');
      row.className = `p-2 rounded-lg flex items-center justify-between ${
        isWinner ? 'bg-amber-500/20 border border-amber-400/60 font-bold' : 'bg-slate-800/60'
      }`;
      row.innerHTML = `
        <div class="flex items-center gap-1.5 truncate">
          <span>${p.avatar}</span>
          <span class="truncate text-slate-200">${p.name} (${p.seatNumber}号)</span>
        </div>
        <div class="font-mono text-sm">
          ${val !== undefined ? `<b class="${isWinner ? 'text-amber-300' : 'text-slate-300'}">${val} 点 🎲</b>` : '<span class="text-slate-500 text-xs">摇掷中...</span>'}
        </div>
      `;
      sb.appendChild(row);
    });

    // 唯一胜出者冠冕展示与发车操作按键 (胜出车主或房主点击发车，杜绝任何卡死性能问题)
    const winnerCard = document.getElementById('dice-winner-card');
    if (winners.length === 1) {
      const winId = winners[0];
      const winPlayer = room.players.find(p => p.id === winId);
      const isMeWinner = myId === winId;

      winnerCard.classList.remove('hidden');
      document.getElementById('dice-winner-text').textContent = `👑 恭喜 ${winPlayer ? winPlayer.name : ''} (${winPlayer ? winPlayer.seatNumber : ''}号位) 投出最高点数，荣获第 1 任发车队长！`;

      if (driveActionContainer) driveActionContainer.classList.remove('hidden');

      if (isMeWinner) {
        if (btnWinnerDrive) btnWinnerDrive.classList.remove('hidden');
        if (waitingDriverText) waitingDriverText.classList.add('hidden');
      } else {
        if (btnWinnerDrive) btnWinnerDrive.classList.add('hidden');
        if (waitingDriverText) {
          waitingDriverText.classList.remove('hidden');
          if (driverNameSpan) {
            driverNameSpan.textContent = winPlayer ? `${winPlayer.name} (${winPlayer.seatNumber}号位)` : '车主';
          }
        }
      }

      if (room.isHost) {
        if (btnHostForceDrive) btnHostForceDrive.classList.remove('hidden');
      } else {
        if (btnHostForceDrive) btnHostForceDrive.classList.add('hidden');
      }
    } else {
      winnerCard.classList.add('hidden');
      if (driveActionContainer) driveActionContainer.classList.add('hidden');
      if (btnWinnerDrive) btnWinnerDrive.classList.add('hidden');
      if (btnHostForceDrive) btnHostForceDrive.classList.add('hidden');
      if (waitingDriverText) waitingDriverText.classList.add('hidden');
    }
  }

  // 3D 骰子旋转视角控制
  function setDiceCubeFace(val) {
    if (!diceCube) return;
    const angles = {
      1: 'rotateY(0deg) rotateX(0deg)',
      2: 'rotateY(-90deg)',
      3: 'rotateY(-180deg)',
      4: 'rotateY(90deg)',
      5: 'rotateX(-90deg)',
      6: 'rotateX(90deg)'
    };
    diceCube.style.transform = angles[val] || 'rotateY(0deg)';
  }

  btnRollDice.addEventListener('click', () => {
    btnRollDice.disabled = true;
    diceCube.classList.add('dice-rolling');
    window.soundFx.rollDice();
    socket.emit('roll_dice');
  });

  socket.on('dice_rolled', ({ value }) => {
    setTimeout(() => {
      diceCube.classList.remove('dice-rolling');
      setDiceCubeFace(value);
      btnRollDice.disabled = false;
    }, 700);
  });

  document.getElementById('btn-host-roll-all').addEventListener('click', () => {
    window.soundFx.rollDice();
    socket.emit('roll_all_dice');
  });

  document.getElementById('btn-host-reroll-tie').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('reroll_tied_dice');
  });

  if (btnWinnerDrive) {
    btnWinnerDrive.addEventListener('click', () => {
      window.soundFx.click();
      socket.emit('start_drive');
    });
  }

  if (btnHostForceDrive) {
    btnHostForceDrive.addEventListener('click', () => {
      window.soundFx.click();
      socket.emit('start_drive');
    });
  }

  // --- 13. 游戏对决主界面渲染 (GAME_PLAY) ---
  function renderGamePlay(room) {
    const leader = room.currentLeader;
    document.getElementById('play-leader-name').textContent = leader ? leader.name : '--';
    document.getElementById('play-leader-badge').textContent = leader ? `(${leader.seatNumber}号位)` : '';

    // 渲染发车后常驻成功/失败状态栏 (包含展开查看谁投了成功票、谁投了失败票)
    renderPersistentVoteBar(room);

    // 渲染刺客/房主专属蓝方三胜前提前拍刀刺杀入口
    renderEarlyAssassinationBar(room);

    const phase = room.phase;

    if (phase === 'LANCELOT_SWITCH') {
      showGameStep('lancelotSwitch');
      renderLancelotSwitch(room);
    } else if (phase === 'TEAM_SELECT') {
      showGameStep('teamSelect');
      renderTeamSelect(room);
    } else if (phase === 'TEAM_VOTE') {
      showGameStep('teamVote');
      renderTeamVote(room);
    } else if (phase === 'TEAM_RESULT') {
      showGameStep('teamResult');
      renderTeamResult(room);
    } else if (phase === 'QUEST_VOTE') {
      showGameStep('questVote');
      renderQuestVote(room);
    } else if (phase === 'QUEST_RESULT') {
      showGameStep('questResult');
      renderQuestResult(room);
    } else if (phase === 'LADY_LAKE') {
      showGameStep('ladyLake');
      renderLadyLake(room);
    } else if (phase === 'ASSASSINATION') {
      showGameStep('assassination');
      renderAssassination(room);
    }
  }

  // --- 0. 兰斯洛特命运抽牌渲染 (LANCELOT_SWITCH) ---
  function renderLancelotSwitch(room) {
    const roundTitle = document.getElementById('lancelot-round-title');
    roundTitle.textContent = `抽取第 ${room.state.currentRound} 轮命运之牌`;

    const cardDisplay = document.getElementById('lancelot-card-display');
    const cardIcon = document.getElementById('lancelot-card-icon');
    const cardLabel = document.getElementById('lancelot-card-label');
    const btnDraw = document.getElementById('btn-draw-lancelot');
    const btnProceed = document.getElementById('btn-proceed-lancelot');
    const alertBox = document.getElementById('my-lancelot-switch-alert');
    const alertText = document.getElementById('my-lancelot-alert-text');

    const draw = room.state.currentLancelotDraw;

    if (!draw) {
      // 待抽牌状态
      cardDisplay.className = 'w-36 h-48 mx-auto rounded-2xl bg-gradient-to-br from-indigo-950 via-purple-900 to-slate-900 border-2 border-purple-400/60 shadow-2xl flex flex-col items-center justify-center p-3 text-center';
      cardIcon.textContent = '🎴';
      cardLabel.textContent = '待翻开命运卡';
      cardLabel.className = 'mt-2 text-sm font-black text-purple-200';

      btnDraw.classList.remove('hidden');
      btnProceed.classList.add('hidden');
      alertBox.classList.add('hidden');
    } else {
      // 已抽牌公布状态
      btnDraw.classList.add('hidden');
      btnProceed.classList.remove('hidden');

      if (draw.switched) {
        // 抽中转换
        cardDisplay.className = 'w-36 h-48 mx-auto rounded-2xl bg-gradient-to-br from-rose-900 via-purple-900 to-indigo-900 border-2 border-rose-400 shadow-2xl flex flex-col items-center justify-center p-3 text-center animate-pulse';
        cardIcon.textContent = '🔄';
        cardLabel.textContent = '阵营对调！(Switch)';
        cardLabel.className = 'mt-2 text-sm font-black text-rose-300';
      } else {
        // 未转换
        cardDisplay.className = 'w-36 h-48 mx-auto rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-500 shadow-xl flex flex-col items-center justify-center p-3 text-center';
        cardIcon.textContent = '🛡️';
        cardLabel.textContent = '保持原样 (No Switch)';
        cardLabel.className = 'mt-2 text-sm font-black text-slate-300';
      }

      // 如果当前玩家是兰斯洛特，弹出个性化阵营变更警报
      const myRole = room.self ? room.self.role : null;
      if (myRole === 'good_lancelot' || myRole === 'evil_lancelot') {
        alertBox.classList.remove('hidden');
        const effTeam = room.vision ? room.vision.team : (room.self ? room.self.effectiveTeam : 'good');
        if (effTeam === 'evil') {
          alertText.textContent = '🚨 你的阵营已变为【邪恶阵营 (红方)】！请协助红方破坏任务！';
          alertBox.className = 'p-3 bg-red-950/80 border border-red-500 rounded-xl text-center text-red-200';
        } else {
          alertText.textContent = '🛡️ 你的阵营已变为【正义阵营 (蓝方)】！请协助好人守护正义！';
          alertBox.className = 'p-3 bg-blue-950/80 border border-blue-500 rounded-xl text-center text-blue-200';
        }
      } else {
        alertBox.classList.add('hidden');
      }
    }
  }

  document.getElementById('btn-draw-lancelot').addEventListener('click', () => {
    window.soundFx.rollDice();
    socket.emit('draw_lancelot');
  });

  document.getElementById('btn-proceed-lancelot').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('proceed_lancelot');
  });

  // --- A. 队长组队出征 (TEAM_SELECT) ---
  function renderTeamSelect(room) {
    const isLeader = room.self && room.self.isLeader;
    const leader = room.currentLeader;
    const needed = room.config.questCapacities[room.state.currentRound - 1] || 2;
    // 核心规则：车长是必须要上车的。如果是两个人，那么车长占1位，只需要再选择一个人即可
    const neededOthers = Math.max(1, needed - 1);

    // 候选池中仅保留除车长以外的其他玩家
    if (leader) {
      mySelectedTeamCandidates = mySelectedTeamCandidates.filter(id => id !== leader.id);
    }

    const badge = document.getElementById('select-need-count-badge');
    if (badge) {
      badge.textContent = `出征需 ${needed} 人 (车长已上车，需再选 ${neededOthers} 人，已选 ${mySelectedTeamCandidates.length})`;
    }

    const guideText = document.getElementById('team-select-guide-text');
    if (isLeader) {
      guideText.textContent = `你是本轮发车车长！按规则你必须在出征队伍中（已锁定上车），请从其他队员中挑选 ${neededOthers} 人出征（共 ${needed} 人）`;
      guideText.className = 'text-xs text-amber-300 font-bold';
    } else {
      guideText.textContent = `发车车长【${leader ? leader.name : ''}】正在挑选其他 ${neededOthers} 名队员出征（车长锁定出征，共 ${needed} 人）...`;
      guideText.className = 'text-xs text-slate-400';
    }

    const list = document.getElementById('team-candidates-list');
    list.innerHTML = '';

    room.players.forEach(p => {
      const isLeaderPlayer = (leader && p.id === leader.id);
      const isSelected = mySelectedTeamCandidates.includes(p.id);
      const card = document.createElement('button');
      card.type = 'button';

      if (isLeaderPlayer) {
        // 车长本人卡片：按规则必须出征，自动常驻高亮已上车状态
        card.className = 'p-2.5 rounded-xl border flex items-center justify-between text-left bg-amber-500/10 border-amber-400/80 text-amber-200 shadow-sm ring-1 ring-amber-400/40';
        card.innerHTML = `
          <div class="flex items-center gap-2 truncate">
            <span class="text-lg">${p.avatar}</span>
            <div class="truncate">
              <div class="flex items-center gap-1">
                <span class="font-bold text-xs truncate text-amber-300">${p.name}</span>
                <span class="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">👑 车长本人</span>
              </div>
              <span class="text-[10px] text-emerald-400 font-bold block">${p.seatNumber}号位 · 规则要求车长必上车 (已锁定)</span>
            </div>
          </div>
          <div class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 font-bold shrink-0">
            ✓ 必上车
          </div>
        `;
        if (isLeader) {
          card.addEventListener('click', () => {
            alert('车长按规则必须在出征队伍中，已自动锁定，无需操作！只需再挑选其他队员即可。');
          });
        }
      } else {
        // 其他队员卡片：支持车长勾选
        card.className = `p-2.5 rounded-xl border flex items-center justify-between text-left transition-all ${
          isSelected
            ? 'bg-indigo-600/30 border-indigo-400 text-white shadow-md ring-1 ring-indigo-400'
            : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700/60'
        } ${!isLeader ? 'cursor-default' : 'active:scale-95'}`;

        card.innerHTML = `
          <div class="flex items-center gap-2 truncate">
            <span class="text-lg">${p.avatar}</span>
            <div class="truncate">
              <span class="font-bold text-xs truncate text-white">${p.name}</span>
              <span class="text-[10px] text-slate-400 block">${p.seatNumber}号位</span>
            </div>
          </div>
          <div>
            ${isSelected ? '🛡️' : '⚪'}
          </div>
        `;

        if (isLeader) {
          card.addEventListener('click', () => {
            window.soundFx.click();
            if (isSelected) {
              mySelectedTeamCandidates = mySelectedTeamCandidates.filter(id => id !== p.id);
            } else {
              if (mySelectedTeamCandidates.length < neededOthers) {
                mySelectedTeamCandidates.push(p.id);
              } else {
                // 自动替换最早选中的队员
                mySelectedTeamCandidates.shift();
                mySelectedTeamCandidates.push(p.id);
              }
            }
            renderTeamSelect(room);
          });
        }
      }

      list.appendChild(card);
    });

    const proposeBox = document.getElementById('leader-propose-box');
    const submitBtn = document.getElementById('btn-leader-submit-team');
    if (isLeader) {
      proposeBox.classList.remove('hidden');
      const isReady = (mySelectedTeamCandidates.length === neededOthers);
      submitBtn.disabled = !isReady;
      if (isReady) {
        submitBtn.textContent = `🚀 确认出征阵容 (共${needed}人: 车长 + 已选${mySelectedTeamCandidates.length}人)`;
        submitBtn.className = 'w-full bg-gradient-to-r from-indigo-600 to-blue-600 active:scale-[0.98] text-white font-bold py-3 rounded-xl shadow-lg text-sm';
      } else {
        submitBtn.textContent = `请再选择 ${neededOthers - mySelectedTeamCandidates.length} 名队员 (共需${needed}人出征)`;
        submitBtn.className = 'w-full bg-slate-800 text-slate-500 font-bold py-3 rounded-xl text-sm cursor-not-allowed';
      }
    } else {
      proposeBox.classList.add('hidden');
    }
  }

  document.getElementById('btn-leader-submit-team').addEventListener('click', () => {
    if (!currentRoom || !currentRoom.currentLeader) return;
    const leaderId = currentRoom.currentLeader.id;
    window.soundFx.click();
    // 提交出征名单：车长本人强制包含在内
    const fullTeam = [leaderId, ...mySelectedTeamCandidates];
    socket.emit('propose_team', { selectedPlayerIds: fullTeam });
  });

  // --- B. 车票公开表决 (TEAM_VOTE) ---
  function renderTeamVote(room) {
    const badges = document.getElementById('vote-proposed-team-badges');
    badges.innerHTML = '';
    room.state.proposedTeam.forEach(id => {
      const p = room.players.find(x => x.id === id);
      const span = document.createElement('span');
      span.className = 'px-2 py-1 rounded-lg bg-indigo-500/20 border border-indigo-400/40 text-indigo-300 text-xs';
      span.textContent = p ? `${p.avatar} ${p.name}` : id;
      badges.appendChild(span);
    });

    // 统计投票进度
    const votedCount = room.players.filter(p => p.hasVotedTeam).length;
    document.getElementById('team-voted-count-text').textContent = `已投票: ${votedCount} / ${room.players.length} 人`;

    // 检查自己是否已投
    const myPlayer = room.players.find(p => p.id === (room.self ? room.self.id : ''));
    const hasVoted = myPlayer ? myPlayer.hasVotedTeam : false;

    const voteBtns = document.getElementById('team-vote-buttons');
    const votedStatus = document.getElementById('team-voted-status');
    if (hasVoted) {
      voteBtns.classList.add('hidden');
      votedStatus.classList.remove('hidden');
    } else {
      voteBtns.classList.remove('hidden');
      votedStatus.classList.add('hidden');
    }
  }

  document.getElementById('btn-vote-approve').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('cast_team_vote', { vote: 'approve' });
  });
  document.getElementById('btn-vote-reject').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('cast_team_vote', { vote: 'reject' });
  });

  // --- C. 车票表决公布 (TEAM_RESULT - 谁投的票清晰亮堂双栏公示) ---
  function renderTeamResult(room) {
    const lastVote = room.state.lastTeamVoteResult || {};
    let approvers = lastVote.approvers || [];
    let rejecters = lastVote.rejecters || [];

    // 容错兜底：若 lastTeamVoteResult 尚未初始化，从 teamVoteResult 与 players 提取
    if (approvers.length === 0 && rejecters.length === 0 && room.state.teamVoteResult) {
      const votes = room.state.teamVoteResult;
      room.players.forEach(p => {
        const v = votes[p.id];
        const info = { id: p.id, name: p.name, seatNumber: p.seatNumber, avatar: p.avatar, vote: v };
        if (v === 'approve') approvers.push(info);
        else if (v === 'reject') rejecters.push(info);
      });
    }

    const passed = approvers.length > rejecters.length;
    const badge = document.getElementById('team-result-badge');
    const title = document.getElementById('team-result-title');

    if (passed) {
      badge.textContent = `车票通过 (${approvers.length} 赞成 vs ${rejecters.length} 反对)`;
      badge.className = 'inline-block px-4 py-1 rounded-full text-xs font-black text-white bg-emerald-600 shadow-md';
      title.textContent = '车票通过！队伍即将出征暗投';
    } else {
      badge.textContent = `车票被否决 (${approvers.length} 赞成 vs ${rejecters.length} 反对)`;
      badge.className = 'inline-block px-4 py-1 rounded-full text-xs font-black text-white bg-rose-600 shadow-md';
      title.textContent = `车票流票！队长顺延 (连倒 ${room.state.attemptCount}/5)`;
    }

    // 更新数量统计徽标
    const badgeApprovers = document.getElementById('badge-count-approvers');
    if (badgeApprovers) badgeApprovers.textContent = `${approvers.length}人`;
    const badgeRejecters = document.getElementById('badge-count-rejecters');
    if (badgeRejecters) badgeRejecters.textContent = `${rejecters.length}人`;

    // 渲染赞成玩家名单 (投赞成玩家专区)
    const approversContainer = document.getElementById('list-approvers-container');
    if (approversContainer) {
      approversContainer.innerHTML = '';
      if (approvers.length === 0) {
        approversContainer.innerHTML = '<p class="col-span-2 text-slate-400 text-xs text-center py-2">无玩家投赞成</p>';
      } else {
        approvers.forEach(p => {
          const item = document.createElement('div');
          item.className = 'bg-emerald-900/60 border border-emerald-500/50 rounded-xl p-2 flex items-center justify-between text-xs shadow-sm';
          item.innerHTML = `
            <div class="flex items-center gap-1.5 truncate">
              <span class="text-base">${p.avatar || '👤'}</span>
              <div class="truncate">
                <span class="font-bold text-white truncate block leading-tight">${p.name}</span>
                <span class="text-[10px] text-emerald-300 font-mono">${p.seatNumber}号位</span>
              </div>
            </div>
            <span class="font-bold text-emerald-300 shrink-0 text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30">🛡️ 赞成</span>
          `;
          approversContainer.appendChild(item);
        });
      }
    }

    // 渲染反对玩家名单 (投反对玩家专区)
    const rejectersContainer = document.getElementById('list-rejecters-container');
    if (rejectersContainer) {
      rejectersContainer.innerHTML = '';
      if (rejecters.length === 0) {
        rejectersContainer.innerHTML = '<p class="col-span-2 text-slate-400 text-xs text-center py-2">全票赞成！无反对</p>';
      } else {
        rejecters.forEach(p => {
          const item = document.createElement('div');
          item.className = 'bg-rose-900/60 border border-rose-500/50 rounded-xl p-2 flex items-center justify-between text-xs shadow-sm';
          item.innerHTML = `
            <div class="flex items-center gap-1.5 truncate">
              <span class="text-base">${p.avatar || '👤'}</span>
              <div class="truncate">
                <span class="font-bold text-white truncate block leading-tight">${p.name}</span>
                <span class="text-[10px] text-rose-300 font-mono">${p.seatNumber}号位</span>
              </div>
            </div>
            <span class="font-bold text-rose-300 shrink-0 text-xs px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30">🚫 反对</span>
          `;
          rejectersContainer.appendChild(item);
        });
      }
    }
  }

  document.getElementById('btn-proceed-team-result').addEventListener('click', () => {
    window.soundFx.click();
    mySelectedTeamCandidates = []; // 清空之前的提议
    socket.emit('proceed_team_result');
  });

  // --- D. 任务暗投 (QUEST_VOTE) ---
  function renderQuestVote(room) {
    const isMember = room.self && room.self.isInProposedTeam;
    const myPlayer = room.players.find(p => p.id === (room.self ? room.self.id : ''));
    const hasVoted = myPlayer ? myPlayer.hasVotedQuest : false;

    const voterPanel = document.getElementById('quest-voter-panel');
    const spectatorPanel = document.getElementById('quest-spectator-panel');
    const doneStatus = document.getElementById('quest-voted-done');
    const warning = document.getElementById('good-player-warning');

    if (isMember) {
      spectatorPanel.classList.add('hidden');
      if (hasVoted) {
        voterPanel.classList.add('hidden');
        doneStatus.classList.remove('hidden');
      } else {
        voterPanel.classList.remove('hidden');
        doneStatus.classList.add('hidden');

        // 好人禁用失败按键
        const isGood = room.vision && room.vision.team === 'good';
        const failBtn = document.getElementById('btn-quest-fail');
        if (isGood) {
          failBtn.disabled = true;
          failBtn.className = 'bg-slate-800 text-slate-500 font-black py-4 rounded-2xl flex flex-col items-center justify-center gap-1 cursor-not-allowed opacity-50';
          warning.classList.remove('hidden');
        } else {
          failBtn.disabled = false;
          failBtn.className = 'bg-gradient-to-b from-red-600 to-red-800 active:scale-95 text-white font-black py-4 rounded-2xl shadow-lg flex flex-col items-center justify-center gap-1';
          warning.classList.add('hidden');
        }
      }
    } else {
      voterPanel.classList.add('hidden');
      doneStatus.classList.add('hidden');
      spectatorPanel.classList.remove('hidden');
    }
  }

  document.getElementById('btn-quest-success').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('cast_quest_vote', { vote: 'success' });
  });
  document.getElementById('btn-quest-fail').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('cast_quest_vote', { vote: 'fail' });
  });

  // --- E. 任务结果揭晓 (QUEST_RESULT) ---
  function renderQuestResult(room) {
    const results = room.state.questVotesResult || [];
    const fails = results.filter(v => v === 'fail').length;
    const successes = results.filter(v => v === 'success').length;

    const isRound4TwoFails = (room.state.currentRound === 4 && room.config.twoFailsOnRound4);
    const isSuccess = fails < (isRound4TwoFails ? 2 : 1);

    const badge = document.getElementById('quest-outcome-badge');
    if (isSuccess) {
      badge.textContent = '🎉 任务大获成功！正义阵营得 1 分';
      badge.className = 'inline-block px-4 py-1.5 rounded-full text-sm font-black text-white bg-blue-600 shadow-lg';
      window.soundFx.success();
    } else {
      badge.textContent = '💀 任务惨遭破坏！邪恶阵营得 1 分';
      badge.className = 'inline-block px-4 py-1.5 rounded-full text-sm font-black text-white bg-red-600 shadow-lg';
      window.soundFx.failure();
    }

    const cardsContainer = document.getElementById('quest-cards-reveal');
    cardsContainer.innerHTML = '';
    results.forEach(v => {
      const card = document.createElement('div');
      card.className = `w-14 h-20 rounded-xl border flex flex-col items-center justify-center shadow-lg font-bold text-xs ${
        v === 'success' ? 'bg-blue-600/30 border-blue-400 text-blue-200' : 'bg-red-600/30 border-red-500 text-red-200'
      }`;
      card.innerHTML = `
        <span class="text-2xl">${v === 'success' ? '✨' : '💀'}</span>
        <span class="mt-1">${v === 'success' ? '成功' : '失败'}</span>
      `;
      cardsContainer.appendChild(card);
    });

    document.getElementById('quest-result-summary-text').textContent =
      `共计: ${successes} 张成功，${fails} 张失败 ${isRound4TwoFails ? '(第4轮需2张失败才判负)' : ''}`;
  }

  document.getElementById('btn-proceed-quest-result').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('proceed_quest_result');
  });

  // --- F. 湖中仙女 (LADY_LAKE) ---
  function renderLadyLake(room) {
    const isLadyHolder = room.self && room.self.hasLady;
    const guide = document.getElementById('lady-holder-guide-text');
    const selector = document.getElementById('lady-target-selector');

    const holderPlayer = room.players.find(p => p.id === room.state.ladyHolder);

    if (isLadyHolder) {
      guide.textContent = '您当前持有湖中仙女！请选择一名未被验视过的玩家查验阵营：';
      selector.classList.remove('hidden');

      const list = document.getElementById('lady-candidates-list');
      list.innerHTML = '';
      room.players.forEach(p => {
        if (p.id !== room.self.id && !room.state.ladyUsedPlayers.includes(p.id)) {
          const btn = document.createElement('button');
          btn.className = 'p-2 bg-slate-800 hover:bg-slate-700 active:scale-95 border border-cyan-500/40 rounded-xl text-left';
          btn.innerHTML = `<span class="font-bold text-xs text-white">${p.name}</span> <span class="text-[10px] text-slate-400">(${p.seatNumber}号)</span>`;
          btn.addEventListener('click', () => {
            window.soundFx.click();
            socket.emit('use_lady', { targetId: p.id });
          });
          list.appendChild(btn);
        }
      });
    } else {
      guide.textContent = `湖中仙女当前持有者【${holderPlayer ? holderPlayer.name : ''}】正在验视他人...`;
      selector.classList.add('hidden');
    }
  }

  socket.on('lady_result_private', ({ targetName, resultText }) => {
    const resBox = document.getElementById('lady-result-box');
    resBox.classList.remove('hidden');
    document.getElementById('lady-result-content').textContent = `【${targetName}】真实身份属于：${resultText}`;
  });

  document.getElementById('btn-finish-lady').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('finish_lady');
  });

  // --- G. 刺客刺杀 (ASSASSINATION) ---
  function renderAssassination(room) {
    const isAssassin = room.self && room.self.role === 'assassin';
    const actionBox = document.getElementById('assassin-action-box');
    const waitBox = document.getElementById('assassin-wait-box');

    if (isAssassin) {
      actionBox.classList.remove('hidden');
      waitBox.classList.add('hidden');

      const list = document.getElementById('assassin-targets-list');
      list.innerHTML = '';
      room.players.forEach(p => {
        // 刺客不刺杀自己
        if (p.id !== room.self.id) {
          const btn = document.createElement('button');
          btn.className = 'p-2.5 bg-red-950/50 hover:bg-red-900 border border-red-500 rounded-xl text-left active:scale-95';
          btn.innerHTML = `
            <div class="font-bold text-xs text-white">${p.name}</div>
            <div class="text-[10px] text-red-300">座位号: ${p.seatNumber}</div>
          `;
          btn.addEventListener('click', () => {
            if (confirm(`确定要刺杀【${p.name}】吗？`)) {
              window.soundFx.click();
              socket.emit('assassinate', { targetId: p.id });
            }
          });
          list.appendChild(btn);
        }
      });
    } else {
      actionBox.classList.add('hidden');
      waitBox.classList.remove('hidden');
    }
  }

  // --- 14. 游戏结束与全景复盘 (GAME_OVER) ---
  function renderGameOver(room) {
    const isGood = room.state.winner === 'good';
    document.getElementById('game-over-icon').textContent = isGood ? '👑' : '🗡️';
    document.getElementById('game-over-title').textContent = isGood ? '正义阵营最终胜利！' : '邪恶阵营翻盘获胜！';
    document.getElementById('game-over-title').className = `text-2xl font-black ${isGood ? 'text-blue-400' : 'text-red-400'}`;
    document.getElementById('game-over-reason').textContent = room.state.winReason || '';

    // 全员揭秘
    const rolesList = document.getElementById('game-over-roles-list');
    rolesList.innerHTML = '';
    room.players.forEach(p => {
      const def = metaInfo ? metaInfo.roles[p.role] : { name: p.role, badge: '⚔️', team: 'good' };
      const item = document.createElement('div');
      item.className = `p-2 rounded-xl border flex items-center gap-2 ${
        def.team === 'good' ? 'bg-blue-950/40 border-blue-500/40' : 'bg-red-950/40 border-red-500/40'
      }`;
      item.innerHTML = `
        <span class="text-xl">${def.badge}</span>
        <div class="truncate">
          <div class="font-bold text-xs text-white truncate">${p.name}</div>
          <div class="text-[10px] ${def.team === 'good' ? 'text-blue-300' : 'text-red-300'}">${def.name}</div>
        </div>
      `;
      rolesList.appendChild(item);
    });

    // 历史出征记录
    const histList = document.getElementById('game-over-history-list');
    histList.innerHTML = '';
    room.state.roundHistory.forEach(h => {
      const row = document.createElement('div');
      row.className = `p-2 rounded-lg border flex items-center justify-between ${
        h.isSuccess ? 'bg-blue-950/20 border-blue-600/30 text-blue-300' : 'bg-red-950/20 border-red-600/30 text-red-300'
      }`;
      row.innerHTML = `
        <span>第 ${h.round} 轮任务 (${h.isSuccess ? '成功' : '失败'})</span>
        <span class="font-mono text-[10px]">${h.successCount}成 / ${h.failCount}败</span>
      `;
      histList.appendChild(row);
    });

    // 房主重置
    const hostReset = document.getElementById('host-reset-container');
    if (room.isHost) {
      hostReset.classList.remove('hidden');
    } else {
      hostReset.classList.add('hidden');
    }
  }

  document.getElementById('btn-reset-game').addEventListener('click', () => {
    window.soundFx.click();
    socket.emit('reset_game');
  });

  // --- 15. 个人专属身份卡防窥弹窗 ---
  const modalIdentity = document.getElementById('modal-identity');
  const peepContainer = document.getElementById('peep-container');
  const btnHoldPeep = document.getElementById('btn-hold-peep');

  function openIdentityModal() {
    modalIdentity.classList.remove('hidden');
    peepContainer.classList.remove('peep-clear');
    peepContainer.classList.add('peep-blur');
  }

  document.getElementById('btn-toggle-id-modal').addEventListener('click', openIdentityModal);
  const btnQuickView = document.getElementById('btn-quick-view-id');
  if (btnQuickView) {
    btnQuickView.addEventListener('click', openIdentityModal);
  }

  document.getElementById('btn-close-id-modal').addEventListener('click', () => {
    modalIdentity.classList.add('hidden');
  });

  // 长按防窥交互 (支持触屏 touch 与 鼠标 mouse)
  function startPeep() {
    peepContainer.classList.remove('peep-blur');
    peepContainer.classList.add('peep-clear');
  }
  function stopPeep() {
    peepContainer.classList.remove('peep-clear');
    peepContainer.classList.add('peep-blur');
  }

  btnHoldPeep.addEventListener('touchstart', e => { e.preventDefault(); startPeep(); });
  btnHoldPeep.addEventListener('touchend', e => { e.preventDefault(); stopPeep(); });
  btnHoldPeep.addEventListener('mousedown', startPeep);
  btnHoldPeep.addEventListener('mouseup', stopPeep);
  btnHoldPeep.addEventListener('mouseleave', stopPeep);

  function renderMyIdentityModal(room) {
    const vis = room.vision;
    if (!vis || !vis.roleId) return;

    document.getElementById('my-role-badge').textContent = vis.badge;
    document.getElementById('my-role-name').textContent = vis.roleName;
    document.getElementById('my-role-desc').textContent = vis.desc;

    const tag = document.getElementById('my-team-tag');
    let teamHtml = '';
    if (vis.team === 'good') {
      teamHtml = '<span class="text-[10px] px-1.5 py-0.5 rounded font-bold bg-blue-600/30 text-blue-300 border border-blue-500/40">正义阵营 (蓝方)</span>';
    } else {
      teamHtml = '<span class="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-600/30 text-red-300 border border-red-500/40">邪恶阵营 (红方)</span>';
    }

    if (vis.isLancelot && vis.isLancelotSwitched) {
      teamHtml += ' <span class="text-[9px] px-1 py-0.5 rounded bg-purple-600/40 text-purple-200 border border-purple-400 font-bold animate-pulse">🔄 阵营已互换</span>';
    }
    tag.innerHTML = teamHtml;

    // 专属夜间视野情报列表
    const vList = document.getElementById('my-vision-list');
    vList.innerHTML = '';
    if (vis.visiblePlayers && vis.visiblePlayers.length > 0) {
      vis.visiblePlayers.forEach(vp => {
        const item = document.createElement('div');
        item.className = 'p-1.5 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center justify-between text-xs';
        item.innerHTML = `
          <div>
            <span class="font-bold text-slate-200">${vp.name}</span>
            <span class="text-[10px] text-slate-400">(${vp.seatNumber}号位)</span>
          </div>
          <div class="text-right">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${
              vp.tagType === 'evil' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
            }">${vp.tag}</span>
            <div class="text-[9px] text-slate-500 mt-0.5">${vp.note || ''}</div>
          </div>
        `;
        vList.appendChild(item);
      });
    } else {
      vList.innerHTML = '<p class="text-slate-500 text-[11px]">您目前没有额外的特殊视野信息，依靠推理守护胜利！</p>';
    }
  }

  // --- 16. 二维码与规则弹窗 ---
  const modalQr = document.getElementById('modal-qrcode');
  const modalRules = document.getElementById('modal-rules-help');

  function openQrModal() {
    modalQr.classList.remove('hidden');
    const roomId = currentRoom ? currentRoom.roomId : '';
    const origin = window.location.origin;
    const directUrl = `${origin}/?room=${roomId}`;
    document.getElementById('qr-direct-url').textContent = directUrl;

    fetch(`/api/qrcode?text=${encodeURIComponent(directUrl)}`)
      .then(res => res.json())
      .then(d => {
        document.getElementById('qr-image').src = d.dataUrl;
      });
  }

  document.getElementById('btn-show-qr').addEventListener('click', openQrModal);
  document.getElementById('btn-lobby-qr').addEventListener('click', openQrModal);
  document.getElementById('btn-close-qr-modal').addEventListener('click', () => modalQr.classList.add('hidden'));

  document.getElementById('btn-open-rules').addEventListener('click', () => modalRules.classList.remove('hidden'));
  document.getElementById('btn-close-rules-modal').addEventListener('click', () => modalRules.classList.add('hidden'));

  // --- 17. 线下物理座次选择与对调弹窗 ---
  const modalSeatPicker = document.getElementById('modal-seat-picker');
  const btnToggleSeatModal = document.getElementById('btn-toggle-seat-modal');
  const btnCloseSeatModal = document.getElementById('btn-close-seat-modal');
  const btnConfirmSeatDone = document.getElementById('btn-confirm-seat-done');
  const seatPickerGrid = document.getElementById('seat-picker-grid');
  const currentMySeatBadge = document.getElementById('current-my-seat-badge');

  function openSeatModal() {
    if (!currentRoom) return;
    modalSeatPicker.classList.remove('hidden');
    renderSeatModal(currentRoom);
  }

  function closeSeatModal() {
    modalSeatPicker.classList.add('hidden');
  }

  if (btnToggleSeatModal) btnToggleSeatModal.addEventListener('click', openSeatModal);
  if (btnCloseSeatModal) btnCloseSeatModal.addEventListener('click', closeSeatModal);
  if (btnConfirmSeatDone) btnConfirmSeatDone.addEventListener('click', closeSeatModal);

  function renderSeatModal(room) {
    if (!modalSeatPicker || modalSeatPicker.classList.contains('hidden')) return;
    if (!room || !room.players) return;

    const mySeat = room.self ? room.self.seatNumber : null;
    if (currentMySeatBadge) {
      currentMySeatBadge.textContent = mySeat ? `${mySeat} 号位` : '未入座';
    }

    if (!seatPickerGrid) return;
    seatPickerGrid.innerHTML = '';
    const totalSeats = room.players.length;

    for (let s = 1; s <= totalSeats; s++) {
      const occ = room.players.find(p => p.seatNumber === s);
      const isMySeat = (s === mySeat);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `p-2.5 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
        isMySeat
          ? 'bg-amber-500/20 border-amber-400 text-amber-200 shadow-md ring-1 ring-amber-400'
          : 'bg-slate-800/90 border-slate-700 text-slate-300 hover:bg-slate-700/80 active:scale-95'
      }`;

      card.innerHTML = `
        <div class="flex items-center gap-1 font-mono font-bold text-xs mb-1">
          <span class="w-5 h-5 rounded-full ${isMySeat ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-700 text-slate-300'} flex items-center justify-center text-[10px]">${s}</span>
          <span>${s}号位</span>
        </div>
        <div class="flex items-center gap-1 text-sm my-0.5 truncate max-w-full">
          <span>${occ ? occ.avatar : '🪑'}</span>
          <span class="font-bold truncate text-xs text-white">${occ ? occ.name : '空闲'}</span>
        </div>
        <span class="text-[10px] mt-1 ${isMySeat ? 'text-amber-300 font-bold' : 'text-slate-400'}">
          ${isMySeat ? '当前我的位置' : occ ? '点击与其对调' : '点击入座'}
        </span>
      `;

      if (!isMySeat) {
        card.addEventListener('click', () => {
          window.soundFx.click();
          socket.emit('change_seat', { seatNumber: s });
        });
      }

      seatPickerGrid.appendChild(card);
    }
  }

  // --- 18. 常驻发车投票结果栏与明细折叠控制 ---
  let isPvDetailExpanded = true;
  const btnTogglePvDetail = document.getElementById('btn-toggle-pv-detail');
  const pvDetailContainer = document.getElementById('pv-detail-container');
  const pvToggleLabel = document.getElementById('pv-toggle-label');
  const pvChevron = document.getElementById('pv-chevron');

  if (btnTogglePvDetail) {
    btnTogglePvDetail.addEventListener('click', () => {
      isPvDetailExpanded = !isPvDetailExpanded;
      if (isPvDetailExpanded) {
        if (pvDetailContainer) pvDetailContainer.classList.remove('hidden');
        if (pvToggleLabel) pvToggleLabel.textContent = '收起名单';
        if (pvChevron) pvChevron.style.transform = 'rotate(180deg)';
      } else {
        if (pvDetailContainer) pvDetailContainer.classList.add('hidden');
        if (pvToggleLabel) pvToggleLabel.textContent = '展开名单';
        if (pvChevron) pvChevron.style.transform = 'rotate(0deg)';
      }
    });
  }

  function renderPersistentVoteBar(room) {
    const bar = document.getElementById('persistent-vote-bar');
    if (!bar) return;

    const lastRes = room.state.lastTeamVoteResult;
    // 若尚未进行过任何发车投票，隐藏常驻栏
    if (!lastRes) {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');

    const icon = document.getElementById('pv-status-icon');
    const badge = document.getElementById('pv-outcome-badge');
    const summary = document.getElementById('pv-summary-text');

    if (lastRes.passed) {
      if (icon) icon.textContent = '🛡️';
      if (badge) {
        badge.textContent = `发车成功 (车票通过 · ${lastRes.approveCount}赞成 vs ${lastRes.rejectCount}反对)`;
        badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-black text-white bg-emerald-600 shadow-sm';
      }
    } else {
      if (icon) icon.textContent = '🚫';
      if (badge) {
        badge.textContent = `发车失败 (车票流票 · ${lastRes.approveCount}赞成 vs ${lastRes.rejectCount}反对)`;
        badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-black text-white bg-rose-600 shadow-sm';
      }
    }

    const proposedNames = lastRes.proposedTeam ? lastRes.proposedTeam.map(t => `${t.name}(${t.seatNumber}号)`).join('、') : '';
    if (summary) {
      summary.textContent = `第 ${lastRes.round} 轮 · 队长【${lastRes.leader ? lastRes.leader.name : ''}】提议: ${proposedNames}`;
    }

    const appCount = document.getElementById('pv-approvers-count');
    const rejCount = document.getElementById('pv-rejecters-count');
    if (appCount) appCount.textContent = `${lastRes.approvers.length}人`;
    if (rejCount) rejCount.textContent = `${lastRes.rejecters.length}人`;

    // 渲染投成功票（赞成发车）玩家
    const approversList = document.getElementById('pv-approvers-list');
    if (approversList) {
      approversList.innerHTML = '';
      if (lastRes.approvers.length === 0) {
        approversList.innerHTML = '<span class="text-slate-500 text-[10px] col-span-2">无玩家投成功票</span>';
      } else {
        lastRes.approvers.forEach(p => {
          const item = document.createElement('div');
          item.className = 'bg-emerald-900/60 border border-emerald-500/50 rounded-lg px-2 py-1 flex items-center justify-between text-xs';
          item.innerHTML = `
            <div class="flex items-center gap-1 truncate">
              <span>${p.avatar || '👤'}</span>
              <span class="font-bold text-white truncate">${p.name}</span>
              <span class="text-[10px] text-emerald-300 font-mono">(${p.seatNumber}号)</span>
            </div>
            <span class="text-[10px] font-bold text-emerald-300 ml-1 shrink-0">🛡️成功票</span>
          `;
          approversList.appendChild(item);
        });
      }
    }

    // 渲染投失败票（反对发车）玩家
    const rejectersList = document.getElementById('pv-rejecters-list');
    if (rejectersList) {
      rejectersList.innerHTML = '';
      if (lastRes.rejecters.length === 0) {
        rejectersList.innerHTML = '<span class="text-slate-500 text-[10px] col-span-2">全票发车成功！无失败票</span>';
      } else {
        lastRes.rejecters.forEach(p => {
          const item = document.createElement('div');
          item.className = 'bg-rose-900/60 border border-rose-500/50 rounded-lg px-2 py-1 flex items-center justify-between text-xs';
          item.innerHTML = `
            <div class="flex items-center gap-1 truncate">
              <span>${p.avatar || '👤'}</span>
              <span class="font-bold text-white truncate">${p.name}</span>
              <span class="text-[10px] text-rose-300 font-mono">(${p.seatNumber}号)</span>
            </div>
            <span class="text-[10px] font-bold text-rose-300 ml-1 shrink-0">🚫失败票</span>
          `;
          rejectersList.appendChild(item);
        });
      }
    }
  }

  // --- 19. 蓝方三胜前随时拍刀刺杀入口渲染与控制 ---
  const earlyBar = document.getElementById('early-assassination-bar');
  const btnTriggerEarlyAssassinate = document.getElementById('btn-trigger-early-assassinate');

  if (btnTriggerEarlyAssassinate) {
    btnTriggerEarlyAssassinate.addEventListener('click', () => {
      if (confirm('确定要提前亮出刺客身份，拍刀刺杀梅林吗？\n\n🎯 若命中梅林：邪恶阵营翻盘获胜！\n❌ 若刺杀错误：正义阵营立即获得胜利！')) {
        window.soundFx.click();
        socket.emit('trigger_early_assassination');
      }
    });
  }

  function renderEarlyAssassinationBar(room) {
    if (!earlyBar) return;
    // 严格限制：只有真实身份为刺客的玩家本人，才能在界面上看到并使用【立即拍刀】按钮！梅林及其他角色严禁显示
    const isAssassin = room.self && room.self.role === 'assassin';
    const canEarly = (room.config.allowEarlyAssassination !== false) &&
      isAssassin &&
      room.phase !== 'GAME_OVER' &&
      room.phase !== 'ASSASSINATION' &&
      room.phase !== 'LOBBY' &&
      room.phase !== 'DICE_ROLL';

    if (canEarly) {
      earlyBar.classList.remove('hidden');
    } else {
      earlyBar.classList.add('hidden');
    }
  }

  // --- 20. 随时随地查看的【历史票型明细弹窗】 ---
  const modalVoteHistory = document.getElementById('modal-vote-history');
  const btnOpenVoteHistory = document.getElementById('btn-open-vote-history');
  const btnCloseVoteHistoryModal = document.getElementById('btn-close-vote-history-modal');
  const voteHistoryContainer = document.getElementById('vote-history-container');

  function openVoteHistoryModal() {
    if (!currentRoom) return;
    modalVoteHistory.classList.remove('hidden');
    renderVoteHistoryModal(currentRoom);
  }

  function closeVoteHistoryModal() {
    modalVoteHistory.classList.add('hidden');
  }

  if (btnOpenVoteHistory) btnOpenVoteHistory.addEventListener('click', openVoteHistoryModal);
  if (btnCloseVoteHistoryModal) btnCloseVoteHistoryModal.addEventListener('click', closeVoteHistoryModal);

  function renderVoteHistoryModal(room) {
    if (!modalVoteHistory || modalVoteHistory.classList.contains('hidden')) return;
    if (!room || !voteHistoryContainer) return;

    voteHistoryContainer.innerHTML = '';
    const history = room.state.teamVoteHistory || [];

    if (history.length === 0) {
      voteHistoryContainer.innerHTML = `
        <div class="py-8 text-center text-slate-400 space-y-2">
          <div class="text-3xl">🗳️</div>
          <p class="font-bold text-white">暂无发车表决记录</p>
          <p class="text-[10px] text-slate-500">首轮队长提议并发车表决后，详细的成功/失败票型名单将永久留存并展示在此</p>
        </div>
      `;
      return;
    }

    // 倒序展示（最新发车在最上面）
    [...history].reverse().forEach(record => {
      const card = document.createElement('div');
      const passed = record.passed;
      card.className = `p-3 rounded-xl border ${
        passed ? 'bg-emerald-950/40 border-emerald-500/40' : 'bg-rose-950/40 border-rose-500/40'
      } space-y-2`;

      const proposedNames = record.proposedTeam ? record.proposedTeam.map(t => `${t.name}(${t.seatNumber}号)`).join('、') : '';

      card.innerHTML = `
        <div class="flex items-center justify-between border-b border-slate-700/60 pb-1.5">
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-white text-xs">第 ${record.round} 轮 · 第 ${record.attempt} 次发车</span>
            <span class="px-2 py-0.2 rounded-full text-[10px] font-black ${
              passed ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
            }">
              ${passed ? '发车成功' : '发车失败'}
            </span>
          </div>
          <span class="font-mono text-[10px] text-slate-400">${record.approveCount}赞成 / ${record.rejectCount}反对</span>
        </div>

        <div class="text-[11px] text-slate-300">
          <span class="text-amber-400 font-bold">队长【${record.leader ? record.leader.name : ''}】提议:</span>
          <span>${proposedNames}</span>
        </div>

        <div class="grid grid-cols-2 gap-2 pt-1 text-xs">
          <!-- 投成功票 (赞成) -->
          <div class="bg-emerald-950/60 border border-emerald-500/30 rounded-lg p-2 space-y-1">
            <span class="text-[10px] font-bold text-emerald-300 block">🛡️ 投成功票 (${record.approvers.length}人):</span>
            <div class="space-y-0.5 text-[11px]">
              ${record.approvers.length === 0 ? '<span class="text-slate-500 text-[10px]">无</span>' : record.approvers.map(a => `
                <div class="text-emerald-200 truncate flex items-center justify-between">
                  <span>${a.avatar || '👤'} ${a.name}</span>
                  <span class="text-[9px] text-emerald-400 font-mono">(${a.seatNumber}号)</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- 投失败票 (反对) -->
          <div class="bg-rose-950/60 border border-rose-500/30 rounded-lg p-2 space-y-1">
            <span class="text-[10px] font-bold text-rose-300 block">🚫 投失败票 (${record.rejecters.length}人):</span>
            <div class="space-y-0.5 text-[11px]">
              ${record.rejecters.length === 0 ? '<span class="text-slate-500 text-[10px]">无</span>' : record.rejecters.map(r => `
                <div class="text-rose-200 truncate flex items-center justify-between">
                  <span>${r.avatar || '👤'} ${r.name}</span>
                  <span class="text-[9px] text-rose-400 font-mono">(${r.seatNumber}号)</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;

      voteHistoryContainer.appendChild(card);
    });
  }
});
