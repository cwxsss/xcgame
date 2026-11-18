import { ActionTimer } from './ActionTimer';
import { canAssassinAct } from './avalon';
import React, { useEffect, useState } from 'react';
import './tabletop.css';
import './avalon-mobile.css';

const phases = {
  waiting: '等待准备',
  dice: '掷骰决定队长',
  'dice-roll': '掷骰决定队长',
  DICE_ROLL: '掷骰决定队长',
  proposal: '队长组队',
  voting: '全员表决',
  quest: '执行远征',
  lady: '湖中仙女',
  'lady-lake': '湖中仙女',
  LADY_LAKE: '湖中仙女',
  fate: '双兰命运牌',
  lancelot: '双兰命运牌',
  'lancelot-switch': '双兰命运牌',
  LANCELOT_SWITCH: '双兰命运牌',
  assassination: '刺客行动',
  'early-assassination': '提前刺杀',
  early_assassination: '提前刺杀',
  finished: '游戏结束',
};

const roles = {
  merlin: '梅林',
  percival: '派西维尔',
  assassin: '刺客',
  minion: '莫德雷德的爪牙',
  morgana: '莫甘娜',
  mordred: '莫德雷德',
  oberon: '奥伯伦',
  'loyal-servant': '亚瑟的忠臣',
  'good-lancelot': '兰斯洛特（善良）',
  'evil-lancelot': '兰斯洛特（邪恶）',
  'merlin-or-morgana': '梅林或莫甘娜',
  'other-lancelot': '另一位兰斯洛特',
  'evil-alignment': '邪恶阵营',
};

// The portrait atlas is intentionally limited to exact, revealed roles.  Do
// not map the partial clues used during a live game (for example
// `merlin-or-morgana`) to an image, since that would disclose an identity.
const rolePortraitSlots = {
  merlin: [0, 0],
  percival: [1, 0],
  'loyal-servant': [2, 0],
  'good-lancelot': [3, 0],
  assassin: [0, 1],
  minion: [1, 1],
  morgana: [2, 1],
  mordred: [3, 1],
  oberon: [0, 2],
  'evil-lancelot': [1, 2],
};

function RolePortrait({ role, className = '' }) {
  const slot = rolePortraitSlots[role];
  if (!slot) return null;
  return (
    <span
      className={`avalon-role-portrait ${className}`.trim()}
      style={{
        '--portrait-position-x': `${slot[0] * 33.333333}%`,
        '--portrait-position-y': `${slot[1] * 50}%`,
      }}
      aria-hidden="true"
    />
  );
}

const modeLabels = {
  base: '基础局',
  classic: '经典标准局',
  lancelot: '双兰命运局',
  mordred: '莫德雷德局',
  oberon: '孤狼奥伯伦局',
  all_star: '诸神乱斗',
  custom: '自定义阵容',
};

const modeDetails = {
  classic: '派西维尔需要在梅林与莫甘娜之间辨认真身。',
  lancelot: '远征期间可能抽取命运牌，改变双兰的阵营。',
  mordred: '莫德雷德躲过梅林的视线，并启用湖中仙女。',
  oberon: '奥伯伦与其他邪恶玩家互不相认。',
  all_star: '双兰、派西维尔、莫甘娜、莫德雷德与湖中仙女同场。',
};

const idOf = (value) => (value == null ? '' : String(value));

function visionLabel(role, lancelot) {
  if (lancelot && role === 'evil-alignment') return '开局属于邪恶阵营';
  return roles[role] || '未知身份线索';
}

export function AvalonBoard({
  G,
  moves,
  playerID,
  matchData,
  isActive,
  isConnected,
  onStartWithAI,
  startingWithAI = false,
}) {
  const [team, setTeam] = useState([]);
  const [showIdentity, setShowIdentity] = useState(false);
  const [ladyTarget, setLadyTarget] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const { phase, questIndex, leaderID } = G;
  const players = Array.isArray(G.players) ? G.players : [];
  const me = players.find(({ id }) => idOf(id) === idOf(playerID));
  const config = G.config || G.rules || {};
  const size = G.questSizes?.[questIndex];
  const canAct = isActive && isConnected;
  const earlyAssassinEnabled =
    G.earlyAssassin === true || config.earlyAssassin === true;
  const dicePhase = ['dice', 'dice-roll', 'DICE_ROLL'].includes(phase);
  const ladyPhase = ['lady', 'lady-lake', 'LADY_LAKE'].includes(phase);
  const fatePhase = [
    'fate',
    'lancelot',
    'lancelot-switch',
    'LANCELOT_SWITCH',
  ].includes(phase);
  const canUseAssassination = canAssassinAct(G, playerID);
  const canSelect =
    phase === 'proposal' && idOf(playerID) === idOf(leaderID) && canAct;
  const onQuest = G.proposal?.map(idOf).includes(idOf(playerID));
  const bots = new Set((G.bots || []).map(idOf));
  const mode = G.mode || G.presetMode || config.mode;
  const modeName = G.modeName || config.modeName || modeLabels[mode] || mode;
  const modeDetail = G.modeDetail || config.modeDetail || modeDetails[mode];
  const leaderOnTeam = G.leaderOnTeam === true || config.leaderOnTeam === true;
  const selectedTeam = team.map(idOf);
  const leaderSelected = selectedTeam.includes(idOf(leaderID));
  const diceRolls = G.diceRolls || G.dice || {};
  const myRoll = Array.isArray(diceRolls)
    ? diceRolls[Number(playerID)]
    : diceRolls?.[idOf(playerID)];
  const diceWinners = (G.diceWinners || G.dice?.winners || []).map(idOf);
  const canRoll =
    myRoll == null &&
    (!G.diceEligible?.length || G.diceEligible.includes(idOf(playerID)));
  const ladyHolder = idOf(G.ladyHolder ?? G.lady?.holder);
  const ladyResult = G.ladyResult ?? G.lady?.result;
  const ladyViewer = idOf(
    ladyResult && typeof ladyResult === 'object' ? ladyResult.viewer : '',
  );
  const canSeeLadyResult =
    showIdentity &&
    Boolean(ladyResult) &&
    (ladyViewer === idOf(playerID) ||
      (!ladyViewer && (!ladyHolder || ladyHolder === idOf(playerID))));
  const ladyAlignment =
    ladyResult && typeof ladyResult === 'object'
      ? ladyResult.alignment || ladyResult.result
      : ladyResult;
  const ladyUsed = new Set(
    (G.ladyUsedPlayers || G.ladyHistory || []).map((entry) =>
      idOf(
        typeof entry === 'object' ? (entry.targetID ?? entry.target) : entry,
      ),
    ),
  );
  const fateHistory = G.fateHistory || [];
  const hasEmptySeats = players.some(
    (player) =>
      !matchData?.find(({ id: seat }) => idOf(seat) === idOf(player.id))
        ?.name && !bots.has(idOf(player.id)),
  );
  const isHost = idOf(playerID) === '0';
  const canUseAI =
    phase === 'waiting' &&
    isHost &&
    canAct &&
    Boolean(onStartWithAI) &&
    hasEmptySeats;
  const extraRules = [
    G.diceEnabled || config.dice ? '掷骰子选首发队长' : null,
    G.ladyEnabled || config.lady ? '湖中仙女' : null,
    G.lancelotEnabled || config.lancelot ? '双兰命运牌' : null,
    earlyAssassinEnabled ? '提前刺杀' : null,
    leaderOnTeam ? '队长必须随队出征' : null,
  ].filter(Boolean);

  const name = (id) =>
    G.bots?.includes(idOf(id))
      ? `AI ${Number(id) + 1}`
      : (matchData?.find(({ id: seat }) => idOf(seat) === idOf(id))?.name ??
        `座位 ${Number(id) + 1}`);
  const occupied = (id) =>
    Boolean(matchData?.find(({ id: seat }) => idOf(seat) === idOf(id))?.name);

  useEffect(() => {
    setTeam([]);
    setLadyTarget('');
  }, [phase, questIndex, leaderID]);

  async function startWithAI() {
    setAiBusy(true);
    setAiError('');
    try {
      await onStartWithAI();
    } catch (error) {
      setAiError(error?.message || 'AI 补位失败，请稍后重试。');
    } finally {
      setAiBusy(false);
    }
  }

  function select(id) {
    setTeam((current) => {
      const key = idOf(id);
      return current.map(idOf).includes(key)
        ? current.filter((entry) => idOf(entry) !== key)
        : [...current, id];
    });
  }

  const assassinationMove = moves.assassinate;
  const fateMove = moves.drawFate;
  const canLady =
    ladyPhase && canAct && (!ladyHolder || ladyHolder === idOf(playerID));
  const canDrawFate = fatePhase && canAct && idOf(playerID) === idOf(leaderID);

  return (
    <div className="tabletop-shell avalon-board avalon-mobile">
      <div className="avalon-desktop">
        <div className="tabletop-status">
          <span
            className={`tabletop-pill ${isConnected ? 'is-live' : 'is-warn'}`}
          >
            {isConnected ? '在线' : '连接中断，正在重连'}
          </span>
          <span className="tabletop-pill">{phases[phase] || phase}</span>
        </div>
        <ActionTimer
          clock={G.actionClock}
          actionSeconds={G.actionSeconds}
          isHost={isHost && phase !== 'finished'}
          canAct={canAct}
          setActionSeconds={moves.setActionSeconds}
        />
        {(mode || extraRules.length > 0) && (
          <section className="avalon-mode-strip" aria-label="本局规则">
            <strong>{modeName || '自定义规则'}</strong>
            {modeDetail && <span>{modeDetail}</span>}
            {extraRules.map((rule) => (
              <span key={rule}>{rule}</span>
            ))}
          </section>
        )}
        {me?.role && (
          <section
            className={`avalon-secret ${showIdentity ? 'is-revealed' : ''}`}
          >
            <div
              className={`avalon-secret-copy ${showIdentity ? 'has-portrait' : ''}`}
            >
              {showIdentity && (
                <RolePortrait
                  role={me.role}
                  className="avalon-role-portrait-large"
                />
              )}
              <strong>你的身份</strong>
              <span aria-live="polite">
                {showIdentity
                  ? `${roles[me.role] || me.role} · ${me.alignment === 'evil' ? '邪恶' : '善良'}阵营`
                  : '身份已隐藏'}
              </span>
            </div>
            <button
              className="tabletop-button secondary"
              type="button"
              onClick={() => setShowIdentity((value) => !value)}
              aria-pressed={showIdentity}
            >
              {showIdentity ? '隐藏身份' : '查看身份'}
            </button>
          </section>
        )}
        {showIdentity && Array.isArray(G.vision) && G.vision.length > 0 && (
          <section className="avalon-vision" aria-label="你的私密视野">
            <strong>你的私密视野</strong>
            <span>只有你能看到这些身份线索。</span>
            <ul>
              {G.vision.map((entry) => (
                <li key={entry.id}>
                  {name(entry.id)}：{visionLabel(entry.role, config.lancelot)}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="tabletop-grid">
          <section className="tabletop-card avalon-table-card">
            <h2>玩家席位</h2>
            <div
              className="avalon-table"
              style={{ '--seat-count': players.length || 1 }}
            >
              <div className="avalon-table-center" aria-live="polite">
                <strong>{phases[phase] || phase}</strong>
                <span>
                  远征 {Math.min(questIndex + 1, G.questSizes?.length || 5)}/
                  {G.questSizes?.length || 5}
                </span>
                <div className="avalon-table-quests" aria-label="五轮远征概览">
                  {G.questSizes.map((count, index) => {
                    const round = index + 1;
                    const result = G.history.find(
                      ({ quest }) => quest === round,
                    );
                    const status = result
                      ? result.success
                        ? '成功'
                        : '失败'
                      : index === questIndex &&
                          phase !== 'waiting' &&
                          phase !== 'finished'
                        ? '当前'
                        : '待开始';
                    return (
                      <span
                        key={round}
                        data-status={status}
                        aria-label={`第 ${round} 轮 · ${count} 人 · ${status}`}
                      >
                        {result ? (result.success ? '✓' : '×') : count}
                      </span>
                    );
                  })}
                </div>
                {G.proposal?.length > 0 && (
                  <small>当前队伍 {G.proposal.length} 人</small>
                )}
              </div>
              {players.map((player, index) => {
                const { id } = player;
                const selected =
                  selectedTeam.includes(idOf(id)) ||
                  G.proposal?.map(idOf).includes(idOf(id));
                const isLeader =
                  phase !== 'waiting' && idOf(id) === idOf(leaderID);
                const canAssassinate =
                  canUseAssassination &&
                  idOf(id) !== idOf(playerID) &&
                  Boolean(assassinationMove);
                return (
                  <div
                    key={id}
                    className={`avalon-player ${isLeader ? 'is-leader' : ''} ${idOf(id) === idOf(playerID) ? 'is-you' : ''} ${selected ? 'is-selected' : ''}`}
                    style={{
                      '--seat-angle': `${(index / Math.max(players.length, 1)) * 360 - 90}deg`,
                      '--seat-angle-reverse': `${90 - (index / Math.max(players.length, 1)) * 360}deg`,
                    }}
                  >
                    <div className="avalon-player-name">
                      {phase === 'finished' &&
                      player.role &&
                      rolePortraitSlots[player.role] ? (
                        <RolePortrait
                          role={player.role}
                          className="avalon-role-portrait-seat"
                        />
                      ) : (
                        <span className="avalon-seat-avatar" aria-hidden="true">
                          {name(id).slice(0, 1)}
                        </span>
                      )}
                      {name(id)}
                      {idOf(id) === idOf(playerID) ? '（你）' : ''}
                    </div>
                    <div className="avalon-player-meta">
                      {bots.has(idOf(id)) && 'AI 玩家 · '}
                      {phase === 'waiting' &&
                        (player.ready
                          ? '已准备'
                          : occupied(id)
                            ? '已入座'
                            : '空座')}
                      {isLeader && '队长'}
                      {G.proposal?.map(idOf).includes(idOf(id)) && ' · 已入队'}
                      {showIdentity &&
                        player.knownEvil &&
                        ` · ${visionLabel('evil-alignment', config.lancelot)}`}
                      {player.percivalHint && ' · 梅林/莫甘娜候选'}
                      {player.knownLancelot && ' · 兰斯洛特'}
                      {dicePhase &&
                        diceRolls?.[idOf(id)] != null &&
                        ` · ${diceRolls[idOf(id)]} 点`}
                      {phase === 'finished' &&
                        player.role &&
                        ' · ' + (roles[player.role] || player.role)}
                    </div>
                    {!!G.timeoutCounts?.[id] && (
                      <div
                        className="avalon-timeout-badges"
                        aria-label={`超时 ${G.timeoutCounts[id]} 次`}
                      >
                        {'💩'.repeat(Math.min(5, G.timeoutCounts[id]))}
                      </div>
                    )}
                    {canSelect && (
                      <button
                        type="button"
                        className="tabletop-button secondary"
                        disabled={
                          team.length >= size &&
                          !selectedTeam.includes(idOf(id))
                        }
                        aria-pressed={selectedTeam.includes(idOf(id))}
                        onClick={() => select(id)}
                      >
                        {selectedTeam.includes(idOf(id))
                          ? '移出队伍'
                          : '加入队伍'}
                      </button>
                    )}
                    {canAssassinate && (
                      <button
                        className="tabletop-button danger"
                        type="button"
                        disabled={!canAct}
                        onClick={() => assassinationMove(id)}
                      >
                        刺杀此人
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="tabletop-note" role="status">
              {G.message}
            </p>
            {leaderOnTeam && phase === 'proposal' && (
              <p className="tabletop-note">本局规则：队长必须在远征队中。</p>
            )}
            <div
              className={`tabletop-actions${phase === 'waiting' ? ' tabletop-pregame-actions' : ''}`}
            >
              {phase === 'waiting' && (
                <>
                  <button
                    disabled={!canAct || me?.ready}
                    onClick={() => moves.readyUp()}
                  >
                    {me?.ready ? '已准备' : '准备'}
                  </button>
                  {isHost && (
                    <button
                      disabled={!canAct || !G.ready?.every(Boolean)}
                      onClick={() => moves.startGame()}
                    >
                      开始游戏
                    </button>
                  )}
                  {isHost && onStartWithAI && hasEmptySeats && (
                    <button
                      className="tabletop-button secondary"
                      disabled={!canUseAI || aiBusy || startingWithAI}
                      onClick={startWithAI}
                      type="button"
                    >
                      {aiBusy || startingWithAI
                        ? '正在补齐并开局…'
                        : '用 AI 补齐并开局'}
                    </button>
                  )}
                </>
              )}
              {canSelect && (
                <button
                  disabled={
                    team.length !== size || (leaderOnTeam && !leaderSelected)
                  }
                  onClick={() => moves.proposeTeam(team)}
                >
                  {leaderOnTeam && !leaderSelected
                    ? '请把队长加入队伍'
                    : `确认队伍（${team.length}/${size} 人）`}
                </button>
              )}
              {phase === 'voting' &&
                (G.hasVoted ? (
                  <span>已表决，等待其他玩家</span>
                ) : (
                  <>
                    <button
                      disabled={!canAct}
                      onClick={() =>
                        moves.voteTeam(true, G.teamVotesHistory.length)
                      }
                    >
                      赞成
                    </button>
                    <button
                      disabled={!canAct}
                      onClick={() =>
                        moves.voteTeam(false, G.teamVotesHistory.length)
                      }
                    >
                      反对
                    </button>
                  </>
                ))}
              {phase === 'quest' &&
                onQuest &&
                (G.hasQuestVoted ? (
                  <span>已提交远征牌</span>
                ) : (
                  <>
                    <button
                      disabled={!canAct}
                      onClick={() =>
                        moves.quest(true, G.teamVotesHistory.length)
                      }
                    >
                      任务成功
                    </button>
                    {me?.alignment === 'evil' && (
                      <button
                        disabled={!canAct}
                        onClick={() =>
                          moves.quest(false, G.teamVotesHistory.length)
                        }
                      >
                        任务失败
                      </button>
                    )}
                  </>
                ))}
            </div>
            {aiError && <p className="tabletop-error">{aiError}</p>}
            {dicePhase && (
              <section className="avalon-advanced-action" aria-label="掷骰">
                <div>
                  <strong>掷骰决定首发队长</strong>
                  <span>
                    {myRoll != null
                      ? `你掷出了 ${myRoll} 点，等待其他玩家。`
                      : '每位玩家都要掷一次；最高点并列时重新掷。'}
                  </span>
                </div>
                {moves.rollDice && canRoll && (
                  <button
                    type="button"
                    className="tabletop-button"
                    disabled={!canAct}
                    onClick={() => moves.rollDice()}
                  >
                    掷骰子
                  </button>
                )}
                {diceWinners.length > 1 && (
                  <p className="tabletop-note">
                    最高点并列，请并列玩家重新掷骰。
                  </p>
                )}
              </section>
            )}
            {(ladyPhase || canSeeLadyResult) && (
              <section className="avalon-advanced-action" aria-label="湖中仙女">
                <div>
                  <strong>湖中仙女验人</strong>
                  <span>验人结果只显示给执行湖中仙女的玩家。</span>
                </div>
                {canLady && !ladyResult && moves.useLady && (
                  <div className="avalon-advanced-form">
                    <select
                      value={ladyTarget}
                      onChange={(event) => setLadyTarget(event.target.value)}
                      aria-label="选择湖中仙女目标"
                    >
                      <option value="">选择目标</option>
                      {players
                        .filter(
                          (player) =>
                            idOf(player.id) !== ladyHolder &&
                            !ladyUsed.has(idOf(player.id)),
                        )
                        .map((player) => (
                          <option key={player.id} value={player.id}>
                            {name(player.id)}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={!ladyTarget || !canAct}
                      onClick={() => moves.useLady(ladyTarget)}
                    >
                      查看阵营
                    </button>
                  </div>
                )}
                {canSeeLadyResult && (
                  <div className="avalon-private-result" aria-live="polite">
                    私密结果：{name(ladyResult.target)} ·
                    {ladyAlignment === 'evil' ? '邪恶阵营' : '善良阵营'}
                    {moves.finishLadyPhase && (
                      <button
                        type="button"
                        className="tabletop-button secondary"
                        onClick={() => moves.finishLadyPhase()}
                      >
                        完成验人
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
            {fatePhase && (
              <section className="avalon-advanced-action" aria-label="命运牌">
                <div>
                  <strong>双兰命运牌</strong>
                  <span>命运牌结果会记录在本局历史中。</span>
                </div>
                {fateMove && canDrawFate && (
                  <button
                    type="button"
                    disabled={!canAct || idOf(playerID) !== idOf(leaderID)}
                    onClick={() => fateMove()}
                  >
                    抽取命运牌
                  </button>
                )}
                {fateMove && !canDrawFate && (
                  <span>等待当前队长抽取命运牌。</span>
                )}
              </section>
            )}
            <FateAnnouncement entry={fateHistory.at(-1)} />
            <AssassinationResult result={G.assassinationResult} name={name} />
            {canUseAssassination && phase !== 'assassination' && (
              <p className="avalon-advanced-action avalon-advanced-action--danger">
                <strong>刺杀已开放</strong>
                <span>
                  刺客可以提前选择目标。命中梅林则邪恶获胜，失手则善良获胜。
                </span>
              </p>
            )}
          </section>
          <aside className="tabletop-card">
            <h2>远征进度</h2>
            <ol className="avalon-history">
              {G.questSizes
                .map((count, index) => {
                  const round = index + 1;
                  const result = G.history.find(({ quest }) => quest === round);
                  const proposals = G.teamVotesHistory.filter(
                    ({ quest }) => quest === round,
                  );
                  const status = result
                    ? result.success
                      ? '成功'
                      : '失败'
                    : index === questIndex && phase !== 'waiting'
                      ? '当前'
                      : '待开始';
                  const label = `第 ${round} 轮 · ${count} 人 · ${status}${result ? ` · ${questVoteText(result)}` : ''}`;
                  const fate = fateHistory.find(({ quest }) => quest === round);
                  return (
                    <li className="avalon-round" key={round}>
                      {proposals.length > 0 ? (
                        <details>
                          <summary>{label}</summary>
                          {proposals.map(
                            ({ team, approved, votes, leaderID }, attempt) => (
                              <section className="avalon-ballot" key={attempt}>
                                <h3>
                                  第 {attempt + 1} 次组队表决 ·{' '}
                                  {approved ? '通过' : '否决'}
                                </h3>
                                <p>
                                  {leaderID != null && (
                                    <>队长：{name(leaderID)} · </>
                                  )}
                                  队伍：{team.map(name).join('、')}
                                </p>
                                <BallotList
                                  votes={votes}
                                  name={name}
                                  yes="赞成"
                                  no="反对"
                                />
                              </section>
                            ),
                          )}
                        </details>
                      ) : (
                        <span>{label}</span>
                      )}
                      {fate && <small>命运牌 · {fateOutcome(fate.card)}</small>}
                    </li>
                  );
                })
                .reverse()}
            </ol>
            {phase === 'voting' && (
              <p>
                已表决 {G.voteCount}/{players.length} 人
              </p>
            )}
            {phase === 'quest' && (
              <p>
                已提交远征牌 {G.questVoteCount}/{G.proposal?.length || 0} 张
              </p>
            )}
            {G.rejectedVotes > 0 && <p>连续否决 {G.rejectedVotes}/5 次</p>}
            {G.questSizes.length >= 4 && (
              <p className="tabletop-note">
                第 4、5 次远征需要至少两张失败牌才判定失败。
              </p>
            )}
            <AvalonVoteMatrix
              history={G.teamVotesHistory}
              players={G.players}
              name={name}
            />
          </aside>
        </div>
      </div>
      <AvalonMobile
        G={G}
        moves={moves}
        playerID={playerID}
        matchData={matchData}
        isActive={isActive}
        isConnected={isConnected}
        onStartWithAI={onStartWithAI}
        startingWithAI={startingWithAI}
        team={team}
        setTeam={setTeam}
        showIdentity={showIdentity}
        setShowIdentity={setShowIdentity}
        ladyTarget={ladyTarget}
        setLadyTarget={setLadyTarget}
        aiBusy={aiBusy}
        aiError={aiError}
        startWithAI={startWithAI}
        name={name}
        occupied={occupied}
      />
    </div>
  );
}

function AvalonMobile({
  G,
  moves,
  playerID,
  matchData,
  isActive,
  isConnected,
  onStartWithAI,
  startingWithAI,
  team,
  setTeam,
  showIdentity,
  setShowIdentity,
  ladyTarget,
  setLadyTarget,
  aiBusy,
  aiError,
  startWithAI,
  name,
  occupied,
}) {
  const { phase, questIndex, leaderID } = G;
  const players = Array.isArray(G.players) ? G.players : [];
  const me = players.find(({ id }) => idOf(id) === idOf(playerID));
  const config = G.config || G.rules || {};
  const size = G.questSizes?.[questIndex] || 0;
  const canAct = isActive && isConnected;
  const bots = new Set((G.bots || []).map(idOf));
  const mode = G.mode || G.presetMode || config.mode;
  const canUseAssassination = canAssassinAct(G, playerID);
  const assassinationMove = moves.assassinate;
  const selectedTeam = team.map(idOf);
  const canSelect =
    phase === 'proposal' && idOf(playerID) === idOf(leaderID) && canAct;
  const leaderSelected = selectedTeam.includes(idOf(leaderID));
  const leaderOnTeam = G.leaderOnTeam === true || config.leaderOnTeam === true;
  const dicePhase = ['dice', 'dice-roll', 'DICE_ROLL'].includes(phase);
  const diceRolls = G.diceRolls || G.dice || {};
  const myRoll = Array.isArray(diceRolls)
    ? diceRolls[Number(playerID)]
    : diceRolls?.[idOf(playerID)];
  const canRoll =
    myRoll == null &&
    (!G.diceEligible?.length || G.diceEligible.includes(idOf(playerID)));
  const ladyPhase = ['lady', 'lady-lake', 'LADY_LAKE'].includes(phase);
  const ladyHolder = idOf(G.ladyHolder ?? G.lady?.holder);
  const ladyResult = G.ladyResult ?? G.lady?.result;
  const ladyViewer = idOf(
    ladyResult && typeof ladyResult === 'object' ? ladyResult.viewer : '',
  );
  // The result is private by viewer/holder, not by the identity toggle. This
  // keeps the completion action available while the role panel is collapsed.
  const canSeeLadyResult =
    Boolean(ladyResult) &&
    (ladyViewer === idOf(playerID) ||
      (!ladyViewer && (!ladyHolder || ladyHolder === idOf(playerID))));
  const ladyAlignment =
    ladyResult && typeof ladyResult === 'object'
      ? ladyResult.alignment || ladyResult.result
      : ladyResult;
  const ladyUsed = new Set(
    (G.ladyUsedPlayers || G.ladyHistory || []).map((entry) =>
      idOf(
        typeof entry === 'object' ? (entry.targetID ?? entry.target) : entry,
      ),
    ),
  );
  const fatePhase = [
    'fate',
    'lancelot',
    'lancelot-switch',
    'LANCELOT_SWITCH',
  ].includes(phase);
  const fateHistory = G.fateHistory || [];
  const canLady =
    ladyPhase && canAct && (!ladyHolder || ladyHolder === idOf(playerID));
  const canDrawFate = fatePhase && canAct && idOf(playerID) === idOf(leaderID);
  const hasEmptySeats = players.some(
    (player) => !occupied(player.id) && !bots.has(idOf(player.id)),
  );
  const isHost = idOf(playerID) === '0';
  const canUseAI =
    phase === 'waiting' &&
    isHost &&
    canAct &&
    Boolean(onStartWithAI) &&
    hasEmptySeats;
  const history = Array.isArray(G.history) ? G.history : [];
  const voteHistory = Array.isArray(G.teamVotesHistory)
    ? G.teamVotesHistory
    : [];

  function toggleTeam(id) {
    setTeam((current) => {
      const key = idOf(id);
      return current.map(idOf).includes(key)
        ? current.filter((entry) => idOf(entry) !== key)
        : [...current, id];
    });
  }

  function roundStatus(index) {
    const round = index + 1;
    const result = history.find(({ quest }) => quest === round);
    if (result) return result.success ? '成功' : '失败';
    return index === questIndex && phase !== 'waiting' ? '进行中' : '待定';
  }

  return (
    <div className="avalon-mobile-board" aria-label="阿瓦隆移动端棋盘">
      <div className="avalon-mobile-status">
        <span className={isConnected ? 'is-live' : 'is-warn'}>
          {isConnected ? '在线' : '重连中'}
        </span>
        <strong>{phases[phase] || phase}</strong>
        <span>第 {Math.min(questIndex + 1, 5)}/5 轮</span>
        <MobileAvalonClock
          clock={G.actionClock}
          actionSeconds={G.actionSeconds}
        />
      </div>

      {isHost && (
        <details className="avalon-mobile-timer-settings">
          <summary>设置每步倒计时（当前 {G.actionSeconds ?? 60} 秒）</summary>
          <ActionTimer
            clock={G.actionClock}
            actionSeconds={G.actionSeconds}
            isHost={isHost && phase !== 'finished'}
            canAct={canAct}
            setActionSeconds={moves.setActionSeconds}
          />
        </details>
      )}

      {mode && (
        <div className="avalon-mobile-mode">{modeLabels[mode] || mode}</div>
      )}

      <div className="avalon-mobile-quest-track" aria-label="五轮远征进度">
        {(G.questSizes || []).map((count, index) => {
          const status = roundStatus(index);
          return (
            <div
              className={`avalon-mobile-quest-step is-${
                status === '成功'
                  ? 'success'
                  : status === '失败'
                    ? 'failed'
                    : status === '进行中'
                      ? 'current'
                      : 'pending'
              }`}
              key={index}
              title={`第 ${index + 1} 轮：${status}，${count} 人`}
            >
              <strong>{index + 1}</strong>
              <span>{status}</span>
            </div>
          );
        })}
      </div>

      <section className="avalon-mobile-seats" aria-label="玩家席位">
        <div className="avalon-mobile-section-heading">
          <strong>席位</strong>
          <span>
            {phase === 'proposal' && canSelect
              ? `组队 ${team.length}/${size}`
              : G.proposal?.length
                ? `远征队 ${G.proposal.length} 人`
                : '点击身份查看详情'}
          </span>
        </div>
        <div className="avalon-mobile-seat-grid">
          {players.map((player) => {
            const id = idOf(player.id);
            const isLeader = phase !== 'waiting' && id === idOf(leaderID);
            const selected =
              selectedTeam.includes(id) || G.proposal?.map(idOf).includes(id);
            const canAssassinate =
              canUseAssassination &&
              id !== idOf(playerID) &&
              Boolean(assassinationMove);
            return (
              <article
                className={`avalon-mobile-seat ${
                  isLeader ? 'is-leader' : ''
                } ${id === idOf(playerID) ? 'is-you' : ''} ${
                  selected ? 'is-selected' : ''
                }`}
                key={id}
              >
                <div className="avalon-mobile-seat-name" title={name(id)}>
                  {phase === 'finished' &&
                  player.role &&
                  rolePortraitSlots[player.role] ? (
                    <RolePortrait
                      role={player.role}
                      className="avalon-mobile-role-avatar"
                    />
                  ) : (
                    <span className="avalon-mobile-avatar" aria-hidden="true">
                      {name(id).slice(0, 1)}
                    </span>
                  )}
                  <strong>{name(id)}</strong>
                  {id === idOf(playerID) && <small>你</small>}
                </div>
                <div className="avalon-mobile-seat-meta">
                  {bots.has(id) ? 'AI' : ''}
                  {isLeader ? '队长' : ''}
                  {selected ? '已入队' : ''}
                  {phase === 'waiting' &&
                    (player.ready
                      ? '已准备'
                      : occupied(id)
                        ? '已入座'
                        : '空座')}
                  {phase === 'finished' &&
                    player.role &&
                    `· ${roles[player.role] || player.role}`}
                </div>
                {!!G.timeoutCounts?.[id] && (
                  <div
                    className="avalon-mobile-timeouts"
                    aria-label={`超时 ${G.timeoutCounts[id]} 次`}
                  >
                    {'💩'.repeat(Math.min(5, G.timeoutCounts[id]))}
                  </div>
                )}
                {canSelect && (
                  <button
                    type="button"
                    className="avalon-mobile-seat-action"
                    disabled={team.length >= size && !selectedTeam.includes(id)}
                    aria-pressed={selectedTeam.includes(id)}
                    onClick={() => toggleTeam(id)}
                  >
                    {selectedTeam.includes(id) ? '移出' : '入队'}
                  </button>
                )}
                {canAssassinate && (
                  <button
                    type="button"
                    className="avalon-mobile-seat-action is-danger"
                    disabled={!canAct}
                    onClick={() => assassinationMove(id)}
                  >
                    刺杀
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="avalon-mobile-action" aria-label="当前操作">
        <div className="avalon-mobile-section-heading">
          <strong>当前操作</strong>
          <span>
            {canUseAssassination
              ? '可在席位中选择刺杀目标'
              : canAct
                ? '轮到你时可操作'
                : '等待连接或其他玩家'}
          </span>
        </div>
        <div
          className={`avalon-mobile-action-buttons${phase === 'waiting' ? ' tabletop-pregame-actions' : ''}`}
        >
          {phase === 'waiting' && (
            <>
              <button
                type="button"
                disabled={!canAct || me?.ready}
                onClick={() => moves.readyUp()}
              >
                {me?.ready ? '已准备' : '准备'}
              </button>
              {isHost && (
                <button
                  type="button"
                  disabled={!canAct || !G.ready?.every(Boolean)}
                  onClick={() => moves.startGame()}
                >
                  开始游戏
                </button>
              )}
              {isHost && onStartWithAI && hasEmptySeats && (
                <button
                  type="button"
                  className="is-secondary"
                  disabled={!canUseAI || aiBusy || startingWithAI}
                  onClick={startWithAI}
                >
                  {aiBusy || startingWithAI ? 'AI补位中…' : 'AI补齐开局'}
                </button>
              )}
            </>
          )}
          {canSelect && (
            <button
              type="button"
              disabled={
                team.length !== size || (leaderOnTeam && !leaderSelected)
              }
              onClick={() => moves.proposeTeam(team)}
            >
              {leaderOnTeam && !leaderSelected
                ? '队长必须出征'
                : `确认队伍 ${team.length}/${size}`}
            </button>
          )}
          {phase === 'voting' &&
            (G.hasVoted ? (
              <span className="avalon-mobile-wait">已表决，等待其他玩家</span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!canAct}
                  onClick={() => moves.voteTeam(true, voteHistory.length)}
                >
                  赞成
                </button>
                <button
                  type="button"
                  className="is-secondary"
                  disabled={!canAct}
                  onClick={() => moves.voteTeam(false, voteHistory.length)}
                >
                  反对
                </button>
              </>
            ))}
          {phase === 'quest' &&
            G.proposal?.map(idOf).includes(idOf(playerID)) &&
            (G.hasQuestVoted ? (
              <span className="avalon-mobile-wait">远征牌已提交</span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!canAct}
                  onClick={() => moves.quest(true, voteHistory.length)}
                >
                  任务成功
                </button>
                {me?.alignment === 'evil' && (
                  <button
                    type="button"
                    className="is-secondary"
                    disabled={!canAct}
                    onClick={() => moves.quest(false, voteHistory.length)}
                  >
                    任务失败
                  </button>
                )}
              </>
            ))}
          {dicePhase && moves.rollDice && canRoll && (
            <button
              type="button"
              disabled={!canAct}
              onClick={() => moves.rollDice()}
            >
              掷骰子
            </button>
          )}
          {dicePhase && myRoll != null && (
            <span className="avalon-mobile-wait">你掷出 {myRoll} 点</span>
          )}
          {ladyPhase && canLady && !ladyResult && moves.useLady && (
            <>
              <select
                value={ladyTarget}
                onChange={(event) => setLadyTarget(event.target.value)}
                aria-label="选择湖中仙女目标"
              >
                <option value="">选择验人目标</option>
                {players
                  .filter(
                    (player) =>
                      idOf(player.id) !== ladyHolder &&
                      !ladyUsed.has(idOf(player.id)),
                  )
                  .map((player) => (
                    <option key={player.id} value={player.id}>
                      {name(player.id)}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!ladyTarget || !canAct}
                onClick={() => moves.useLady(ladyTarget)}
              >
                查看阵营
              </button>
            </>
          )}
          {canSeeLadyResult && (
            <span className="avalon-mobile-private-result">
              {name(ladyResult.target)} ·
              {ladyAlignment === 'evil' ? '邪恶' : '善良'}
              {moves.finishLadyPhase && (
                <button type="button" onClick={() => moves.finishLadyPhase()}>
                  完成
                </button>
              )}
            </span>
          )}
          {fatePhase && moves.drawFate && canDrawFate && (
            <button
              type="button"
              disabled={!canAct}
              onClick={() => moves.drawFate()}
            >
              抽命运牌
            </button>
          )}
          {fatePhase && !canDrawFate && (
            <span className="avalon-mobile-wait">等待队长抽取命运牌</span>
          )}
        </div>
        <FateAnnouncement entry={fateHistory.at(-1)} />
        <AssassinationResult result={G.assassinationResult} name={name} />
        {G.message && <p className="avalon-mobile-message">{G.message}</p>}
        {aiError && <p className="avalon-mobile-error">{aiError}</p>}
      </section>

      <details
        className="avalon-mobile-private"
        open={showIdentity}
        onToggle={(event) => setShowIdentity(event.currentTarget.open)}
      >
        <summary>
          我的身份与私密视野
          {showIdentity && me?.role ? ` · ${roles[me.role] || me.role}` : ''}
        </summary>
        {me?.role ? (
          <div className="avalon-mobile-private-copy">
            <div className="avalon-mobile-private-identity">
              {showIdentity && (
                <RolePortrait
                  role={me.role}
                  className="avalon-role-portrait-large"
                />
              )}
              <strong>
                {roles[me.role] || me.role} ·{' '}
                {me.alignment === 'evil' ? '邪恶' : '善良'}阵营
              </strong>
            </div>
            {Array.isArray(G.vision) && G.vision.length > 0 && (
              <ul>
                {G.vision.map((entry) => (
                  <li key={entry.id}>
                    {name(entry.id)}：{visionLabel(entry.role, config.lancelot)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <span>身份将在游戏开始后显示。</span>
        )}
      </details>

      <details className="avalon-mobile-history">
        <summary>
          远征票型与详细记录 · 已投票 {G.voteCount || 0}/{players.length}
        </summary>
        <ol>
          {(G.questSizes || [])
            .map((count, index) => {
              const round = index + 1;
              const result = history.find(({ quest }) => quest === round);
              const proposals = voteHistory.filter(
                ({ quest }) => quest === round,
              );
              const fate = fateHistory.find(({ quest }) => quest === round);
              return (
                <li key={round}>
                  <div className="avalon-mobile-round-line">
                    <strong>
                      第 {round} 轮 · {count} 人 · {roundStatus(index)}
                    </strong>
                    {result && <span>{questVoteText(result)}</span>}
                  </div>
                  {fate && <small>命运牌 · {fateOutcome(fate.card)}</small>}
                  {proposals.length > 0 && (
                    <details className="avalon-mobile-ballots">
                      <summary>组队票型 · {proposals.length} 次</summary>
                      {proposals.map(
                        (
                          { team: proposal, approved, votes, leaderID },
                          attempt,
                        ) => (
                          <section key={attempt}>
                            <span>
                              第 {attempt + 1} 次组队 ·{' '}
                              {approved ? '通过' : '否决'}
                            </span>
                            <small>
                              {leaderID != null && (
                                <>队长：{name(leaderID)} · </>
                              )}
                              {proposal.map(name).join('、')}
                            </small>
                            {votes && (
                              <BallotList
                                votes={votes}
                                name={name}
                                yes="赞成"
                                no="反对"
                              />
                            )}
                          </section>
                        ),
                      )}
                    </details>
                  )}
                </li>
              );
            })
            .reverse()}
        </ol>
        <AvalonVoteMatrix
          history={voteHistory}
          players={G.players}
          name={name}
          compact
        />
      </details>
    </div>
  );
}

function fateOutcome(card) {
  return card === 'switch' ? '双兰交换阵营' : '双兰阵营不变';
}

function FateAnnouncement({ entry }) {
  return (
    <div className="avalon-fate-notice" role="status">
      {entry && `第 ${entry.quest} 轮命运牌 · ${fateOutcome(entry.card)}`}
    </div>
  );
}

function AssassinationResult({ result, name }) {
  if (!result) return null;
  return (
    <p className="avalon-assassination-result" role="status">
      刺杀目标 · {name(result.targetID)}（
      {roles[result.targetRole] || result.targetRole}）
    </p>
  );
}

function questVoteText(result) {
  const failed = result.failedCards ?? 0;
  const successful =
    result.successfulCards ?? Math.max(0, (result.team?.length || 0) - failed);
  return `成功 ${successful} · 失败 ${failed}`;
}

function MobileAvalonClock({ clock, actionSeconds }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!clock?.endsAt) return undefined;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [clock?.endsAt]);
  if (!clock?.endsAt) return <span className="avalon-mobile-clock">--:--</span>;
  const seconds = Math.min(
    actionSeconds ?? 60,
    Math.max(0, Math.ceil((clock.endsAt - now) / 1000)),
  );
  return (
    <span
      className={`avalon-mobile-clock ${seconds <= 10 ? 'is-danger' : ''}`}
      role="timer"
      aria-label={`${clock.label || '当前操作'}，剩余 ${seconds} 秒`}
    >
      {String(Math.floor(seconds / 60)).padStart(2, '0')}:
      {String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

function BallotList({ votes, name, yes, no }) {
  const { yesCount, noCount, total } = voteCounts({ votes });
  return (
    <div className="avalon-ballot-summary" aria-label="公开票数">
      <span className="is-yes">
        {yes} {yesCount}
      </span>
      <span className="is-no">
        {no} {noCount}
      </span>
      {total > 0 && <small>共 {total} 票</small>}
      {Object.entries(votes ?? {}).map(([id, vote]) => (
        <span key={id} className={vote ? 'is-yes' : 'is-no'}>
          {name(id)} {vote ? yes : no}
        </span>
      ))}
    </div>
  );
}

function voteCounts(ballot) {
  const votes = ballot?.votes;
  if (votes && typeof votes === 'object') {
    const values = Array.isArray(votes) ? votes : Object.values(votes);
    return {
      yesCount: values.filter(Boolean).length,
      noCount: values.filter((vote) => !vote).length,
      total: values.length,
    };
  }
  const yesCount = Number(ballot?.yes ?? ballot?.approvedCount ?? 0);
  const noCount = Number(ballot?.no ?? ballot?.rejectedCount ?? 0);
  return {
    yesCount: Number.isFinite(yesCount) ? yesCount : 0,
    noCount: Number.isFinite(noCount) ? noCount : 0,
    total:
      (Number.isFinite(yesCount) ? yesCount : 0) +
      (Number.isFinite(noCount) ? noCount : 0),
  };
}

function AvalonVoteMatrix({ history = [], players, name, compact = false }) {
  const attempts = new Map();
  const columns = history
    .map((ballot) => {
      const attempt = (attempts.get(ballot.quest) ?? 0) + 1;
      attempts.set(ballot.quest, attempt);
      return { ballot, attempt, key: ballot.quest + ':' + attempt };
    })
    .reverse();

  return (
    <details className={`avalon-vote-matrix${compact ? ' is-compact' : ''}`}>
      <summary>组队投票表</summary>
      {columns.length === 0 ? (
        <p className="avalon-vote-matrix-empty">暂无组队投票记录</p>
      ) : (
        <div
          className="avalon-vote-matrix-scroll"
          tabIndex={0}
          aria-label="组队投票表"
        >
          <table aria-label="组队投票表">
            <thead>
              <tr>
                <th scope="col">玩家</th>
                {columns.map(({ ballot, attempt, key }) => (
                  <th scope="col" key={key}>
                    第 {ballot.quest} 轮 · 提案 {attempt}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map(({ id }) => (
                <tr key={id}>
                  <th scope="row">{name(id)}</th>
                  {columns.map(({ ballot, key }) => {
                    const vote = ballot.votes?.[id];
                    const label =
                      vote === true ? '赞成' : vote === false ? '反对' : '—';
                    return (
                      <td
                        key={key}
                        className={
                          vote === true
                            ? 'is-approved'
                            : vote === false
                              ? 'is-rejected'
                              : 'is-empty'
                        }
                      >
                        {label}
                        {String(ballot.leaderID) === String(id) && (
                          <span>队长</span>
                        )}
                        {ballot.team?.includes(id) && <span>入队</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
