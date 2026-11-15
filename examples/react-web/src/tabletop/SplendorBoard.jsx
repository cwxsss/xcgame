import React, { useEffect, useRef, useState } from 'react';
import { ActionTimer } from './ActionTimer';
import { COLORS, RESOURCES } from './splendor-data';
import { eligibleNobles, paymentFor, totalTokens } from './splendor';
import './tabletop.css';
import './splendor-mobile.css';
import './splendor-desktop.css';

const turnCueUrl = new URL('./splendor-turn.wav', import.meta.url).href;

const colorName = {
  white: '白钻',
  blue: '蓝宝石',
  green: '祖母绿',
  red: '红宝石',
  black: '玛瑙',
  gold: '黄金',
};

function Gem({ color, count }) {
  return (
    <span
      className={`gem gem-${color}`}
      title={colorName[color]}
      aria-label={`${count} 枚${colorName[color]}`}
    >
      {count}
    </span>
  );
}

function Cost({ requirements }) {
  return (
    <div className="splendor-card-cost">
      {COLORS.filter((color) => requirements[color]).map((color) => (
        <Gem key={color} color={color} count={requirements[color]} />
      ))}
    </div>
  );
}

function Development({ card, affordable, children }) {
  return (
    <article
      className={`splendor-card is-level-${card.tier}${affordable ? ' is-affordable' : ''}`}
      aria-label={affordable ? '当前资源可购买' : undefined}
    >
      <div className="splendor-card-heading">
        <strong>{card.points} 分</strong>
        <span
          className={`splendor-card-bonus is-${card.color}`}
          title={`永久折扣 · ${colorName[card.color]}`}
          aria-label={`永久折扣 · ${colorName[card.color]}`}
        />
      </div>
      <span
        className="splendor-card-portrait splendor-desktop-portrait"
        style={artPosition(card.id)}
        aria-hidden="true"
      />
      <Cost requirements={card.requirements} />
      <div className="tabletop-actions">{children}</div>
    </article>
  );
}

export function SplendorBoard({
  G,
  ctx,
  moves,
  playerID,
  matchData,
  isActive,
  isConnected,
  onStartWithAI,
  startingWithAI,
}) {
  const [chosen, setChosen] = useState([]);
  const [returned, setReturned] = useState([]);
  const turnCue = useRef(null);
  const lastAnnouncedTurn = useRef(null);
  const { players, pending, started } = G;
  const me = players[Number(playerID)];
  const bots = G.bots ?? [];
  const name = (id) =>
    bots.includes(id)
      ? `AI 玩家 ${Number(id) + 1}`
      : (matchData?.find(({ id: seat }) => String(seat) === id)?.name ??
        `座位 ${Number(id) + 1}`);
  const occupied = (id) =>
    Boolean(matchData?.find(({ id: seat }) => String(seat) === id)?.name);
  const canAct = isActive && isConnected && !ctx.gameover;
  const ownTurn =
    started && canAct && String(ctx.currentPlayer) === String(playerID)
      ? ctx.turn
      : null;
  const canChooseAction = started && canAct && !pending;
  const available = COLORS.filter((color) => G.tokens[color] > 0).length;
  const distinct = new Set(chosen).size;
  const takeValid =
    chosen.length > 0 &&
    ((chosen.length === distinct && chosen.length === Math.min(available, 3)) ||
      (chosen.length === 2 && distinct === 1 && G.tokens[chosen[0]] >= 4));
  const excess = Math.max(0, totalTokens(me.tokens) - 10);
  const nobles = eligibleNobles(me, G.nobles);
  const canReserve = canChooseAction && me.reserved.length < 3;
  const affordableMarketCards = new Set(
    started && !ctx.gameover
      ? G.tiers
          .flat()
          .filter((card) => paymentFor(me, card))
          .map(({ id }) => id)
      : [],
  );
  const canPass =
    canChooseAction &&
    available === 0 &&
    (me.reserved.length === 3 ||
      (!G.decks.some(({ count }) => count) &&
        !G.tiers.some((tier) => tier.length))) &&
    affordableMarketCards.size === 0 &&
    !me.reserved.some((card) => paymentFor(me, card));

  useEffect(() => {
    setChosen([]);
    setReturned([]);
  }, [ctx.turn, started, pending]);

  useEffect(() => {
    if (ownTurn === null || lastAnnouncedTurn.current === ownTurn) return;
    const audio = turnCue.current;
    let active = true;
    let playing = false;

    function removeRetry() {
      window.removeEventListener('click', play);
      window.removeEventListener('keydown', play);
    }

    async function play() {
      if (!active || playing) return;
      playing = true;
      try {
        audio.currentTime = 0;
        await audio.play();
        if (!active) return;
        lastAnnouncedTurn.current = ownTurn;
        removeRetry();
      } catch (error) {
        playing = false;
        if (!active || error.name !== 'NotAllowedError') return;
        window.addEventListener('click', play);
        window.addEventListener('keydown', play);
      }
    }

    void play();
    return () => {
      active = false;
      removeRetry();
      audio.pause();
    };
  }, [ownTurn]);

  function addGem(color) {
    setChosen((current) => [...current, color]);
  }

  function canAdd(color) {
    if (!canChooseAction || !G.tokens[color] || chosen.length >= 3)
      return false;
    if (chosen.includes(color))
      return chosen.length === 1 && G.tokens[color] >= 4;
    return new Set(chosen).size === chosen.length;
  }

  return (
    <div className="tabletop-shell splendor-board">
      <audio ref={turnCue} src={turnCueUrl} preload="auto" />
      <div className="splendor-desktop">
        <div className="tabletop-status">
          <span
            className={`tabletop-pill ${isConnected ? 'is-live' : 'is-warn'}`}
          >
            {isConnected ? '在线' : '连接中断，正在重连'}
          </span>
          <span className="tabletop-pill">
            {ctx.gameover
              ? '结算完毕'
              : started
                ? `第 ${ctx.turn} 回合 · ${name(ctx.currentPlayer)}`
                : '等待准备'}
          </span>
          {G.finalRound && !ctx.gameover && (
            <span className="tabletop-pill is-warn">最后一轮</span>
          )}
        </div>

        <ActionTimer
          clock={ctx.gameover ? null : G.actionClock}
          actionSeconds={G.actionSeconds}
          isHost={playerID === '0' && !started}
          canAct={canAct}
          setActionSeconds={moves.setActionSeconds}
        />
        <section className="tabletop-card splendor-players-panel">
          <h2>玩家席位</h2>
          <div className="splendor-player-row">
            {players.map((player, index) => (
              <article className="splendor-player" key={player.id}>
                <strong>
                  {name(player.id)}
                  {player.id === playerID ? '（你）' : ''}
                  {!!G.timeoutCounts?.[player.id] && (
                    <span
                      className="splendor-timeouts"
                      aria-label={`超时 ${G.timeoutCounts[player.id]} 次`}
                    >
                      {'💩'.repeat(G.timeoutCounts[player.id])}
                    </span>
                  )}
                </strong>
                {!started ? (
                  <p>
                    {G.ready[index]
                      ? '已准备'
                      : occupied(player.id)
                        ? '已入座'
                        : '空座'}
                  </p>
                ) : (
                  <>
                    <p>
                      {player.points} 分 · {player.cards.length} 张发展卡 ·{' '}
                      {player.reservedCount} 张预留
                    </p>
                    <div className="splendor-token-row">
                      {RESOURCES.filter((color) => player.tokens[color]).map(
                        (color) => (
                          <Gem
                            key={color}
                            color={color}
                            count={player.tokens[color]}
                          />
                        ),
                      )}
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
          {!started && (
            <>
              <p className="tabletop-note">
                {bots.length
                  ? 'AI 已补齐空座，真人准备后自动开局。'
                  : '所有玩家准备后，由房主开始游戏。'}
              </p>
              <div className="tabletop-actions tabletop-pregame-actions">
                <button
                  disabled={!canAct || G.ready[Number(playerID)]}
                  onClick={() => moves.readyUp()}
                >
                  {G.ready[Number(playerID)] ? '已准备' : '准备'}
                </button>
                {playerID === '0' && (
                  <button
                    disabled={!canAct || !G.ready.every(Boolean)}
                    onClick={() => moves.startGame()}
                  >
                    开始游戏
                  </button>
                )}
                {onStartWithAI &&
                  !bots.length &&
                  players.some(({ id }) => !occupied(id)) && (
                    <button
                      type="button"
                      disabled={!canAct || startingWithAI}
                      onClick={onStartWithAI}
                    >
                      {startingWithAI ? '正在补齐…' : '用 AI 补齐并开局'}
                    </button>
                  )}
              </div>
            </>
          )}
          {ctx.gameover && (
            <p className="tabletop-note" role="status">
              {ctx.gameover.winners.map(name).join('、')}
              {ctx.gameover.winners.length > 1 ? ' 并列获胜' : ' 获胜'}
            </p>
          )}
        </section>

        {started && (
          <div className="splendor-layout">
            {pending === 'return' && canAct && (
              <section className="tabletop-card splendor-return-panel">
                <h2>退回 {excess} 枚筹码</h2>
                <p>
                  每次点击选择退回一枚。已选择 {returned.length}/{excess} 枚。
                </p>
                <div className="splendor-token-row">
                  {RESOURCES.map((color) => {
                    const count = returned.filter(
                      (item) => item === color,
                    ).length;
                    return (
                      <button
                        className="splendor-token"
                        key={color}
                        disabled={
                          returned.length >= excess || count >= me.tokens[color]
                        }
                        onClick={() => setReturned([...returned, color])}
                      >
                        <Gem color={color} count={me.tokens[color]} />
                        {colorName[color]} · 已选 {count}
                      </button>
                    );
                  })}
                </div>
                <div className="tabletop-actions">
                  <button
                    disabled={returned.length !== excess}
                    onClick={() => moves.returnGems(returned)}
                  >
                    确认退回
                  </button>
                  <button
                    disabled={!returned.length}
                    onClick={() => setReturned([])}
                  >
                    清空选择
                  </button>
                </div>
              </section>
            )}

            <section className="tabletop-card splendor-supply-panel">
              <h2>宝石供应</h2>
              <div className="splendor-token-row">
                {RESOURCES.map((color) => (
                  <button
                    className={`splendor-token ${chosen.includes(color) ? 'is-selected' : ''}`}
                    key={color}
                    disabled={!canAdd(color)}
                    onClick={() => addGem(color)}
                    aria-label={`${colorName[color]} ${G.tokens[color]}枚`}
                    title={colorName[color]}
                  >
                    <Gem color={color} count={G.tokens[color]} />
                  </button>
                ))}
              </div>
              <p className="tabletop-note">
                {chosen.length
                  ? `已选：${chosen.map((color) => colorName[color]).join('、')}`
                  : '拿三种；同色两枚需库存至少四枚。'}
              </p>
              <div className="tabletop-actions">
                <button
                  disabled={!canChooseAction || !takeValid}
                  onClick={() => moves.takeGems(chosen)}
                >
                  拿取已选筹码
                </button>
                <button disabled={!chosen.length} onClick={() => setChosen([])}>
                  清空选择
                </button>
                {canPass && (
                  <button onClick={() => moves.passTurn()}>
                    无可执行行动，结束回合
                  </button>
                )}
              </div>
            </section>

            <section className="tabletop-card splendor-nobles-panel">
              <h2>贵族</h2>
              {pending === 'noble' && canAct && (
                <p className="tabletop-note">选择一位符合条件的贵族。</p>
              )}
              <div className="splendor-player-row">
                {G.nobles.map((noble, index) => (
                  <article
                    className="splendor-player splendor-noble-card"
                    key={noble.id}
                  >
                    <strong>{noble.points} 分</strong>
                    <span
                      className="splendor-card-portrait splendor-desktop-portrait"
                      style={artPosition(noble.id)}
                      aria-hidden="true"
                    />
                    <Cost requirements={noble.requirements} />
                    {pending === 'noble' &&
                      canAct &&
                      nobles.includes(noble) && (
                        <button
                          className="tabletop-button"
                          onClick={() => moves.claimNoble(index)}
                        >
                          接待贵族
                        </button>
                      )}
                  </article>
                ))}
              </div>
            </section>

            <section className="tabletop-card splendor-market-panel">
              <div className="splendor-market-heading">
                <h2>发展卡市场</h2>
                {affordableMarketCards.size > 0 && (
                  <span className="tabletop-note splendor-affordable-legend">
                    红色点阵牌可买
                  </span>
                )}
              </div>
              {G.tiers.map((cards, index) => (
                <section className="splendor-tier" key={index}>
                  <div className="splendor-tier-heading">
                    <h3>
                      {index + 1} 级 · 牌堆 {G.decks[index].count} 张
                    </h3>
                    <button
                      className="tabletop-button secondary"
                      disabled={!canReserve || !G.decks[index].count}
                      onClick={() => moves.reserveCard(index + 1, -1)}
                    >
                      盲抽并预留
                    </button>
                  </div>
                  <div className="splendor-level">
                    {cards.map((card, cardIndex) => (
                      <Development
                        key={card.id}
                        card={card}
                        affordable={affordableMarketCards.has(card.id)}
                      >
                        <button
                          disabled={
                            !canChooseAction ||
                            !affordableMarketCards.has(card.id)
                          }
                          onClick={() =>
                            moves.buyCard('market', index + 1, cardIndex)
                          }
                        >
                          购买
                        </button>
                        <button
                          className="tabletop-button secondary"
                          disabled={!canReserve}
                          onClick={() =>
                            moves.reserveCard(index + 1, cardIndex)
                          }
                        >
                          预留
                        </button>
                      </Development>
                    ))}
                  </div>
                </section>
              ))}
            </section>

            <section className="tabletop-card splendor-self-panel">
              <h2>
                我的折扣与预留 <small>{me.reserved.length}/3 张</small>
              </h2>
              <div className="splendor-token-row">
                {COLORS.map((color) => (
                  <Gem key={color} color={color} count={me.bonuses[color]} />
                ))}
              </div>
              <div className="splendor-level">
                {me.reserved.map((card, index) => (
                  <Development key={card.id} card={card}>
                    <button
                      disabled={!canChooseAction || !paymentFor(me, card)}
                      onClick={() => moves.buyCard('reserved', 0, index)}
                    >
                      购买
                    </button>
                  </Development>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
      <SplendorMobile
        G={G}
        ctx={ctx}
        moves={moves}
        playerID={playerID}
        matchData={matchData}
        isActive={isActive}
        isConnected={isConnected}
        onStartWithAI={onStartWithAI}
        startingWithAI={startingWithAI}
        players={players}
        me={me}
        name={name}
        occupied={occupied}
        pending={pending}
        started={started}
        canAct={canAct}
        canChooseAction={canChooseAction}
        canReserve={canReserve}
        canPass={canPass}
        affordableMarketCards={affordableMarketCards}
        nobles={nobles}
        chosen={chosen}
        setChosen={setChosen}
        returned={returned}
        setReturned={setReturned}
        excess={excess}
        canAdd={canAdd}
        takeValid={takeValid}
        addGem={addGem}
      />
    </div>
  );
}

const mobileColorName = {
  white: '白',
  blue: '蓝',
  green: '绿',
  red: '红',
  black: '黑',
  gold: '金',
};

function MobileClock({ clock, actionSeconds }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!clock?.endsAt) return undefined;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [clock?.endsAt]);

  if (!clock?.endsAt)
    return <span className="splendor-mobile-clock">--:--</span>;
  const seconds = Math.min(
    actionSeconds ?? 60,
    Math.max(0, Math.ceil((clock.endsAt - now) / 1000)),
  );
  return (
    <span
      className={`splendor-mobile-clock ${seconds <= 10 ? 'is-danger' : ''}`}
      role="timer"
      aria-label={`${clock.label ?? '操作'}，剩余 ${seconds} 秒`}
    >
      {String(Math.floor(seconds / 60)).padStart(2, '0')}:
      {String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

function MobileCost({ requirements }) {
  return (
    <span className="splendor-mobile-cost">
      {COLORS.filter((color) => requirements[color]).map((color) => (
        <span
          key={color}
          className={`splendor-mobile-cost-token is-${color}`}
          title={`${colorName[color]} ${requirements[color]}`}
        >
          {mobileColorName[color]}
          {requirements[color]}
        </span>
      ))}
    </span>
  );
}

function artPosition(cardId) {
  const value = String(cardId ?? 'card');
  const hash =
    [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 16;
  return {
    '--art-x': `${hash % 4}`,
    '--art-y': `${Math.floor(hash / 4)}`,
  };
}

function MobileMarketCard({ card, onSelect, selected, affordable }) {
  return (
    <button
      type="button"
      className={`splendor-mobile-market-card is-level-${card.tier} ${
        selected ? 'is-selected' : ''
      }${affordable ? ' is-affordable' : ''}`}
      onClick={onSelect}
      aria-label={`${card.tier}级，${card.points}分，${colorName[card.color]}折扣，费用 ${Object.entries(
        card.requirements,
      )
        .map(([color, count]) => `${colorName[color]}${count}`)
        .join(' ')}${affordable ? '，当前资源可购买' : ''}`}
      aria-pressed={selected}
    >
      <span className="splendor-mobile-card-top">
        <strong>{card.points}分</strong>
        <span className={`splendor-mobile-bonus is-${card.color}`}>
          {mobileColorName[card.color]}
        </span>
      </span>
      <span
        className="splendor-card-portrait splendor-mobile-card-art"
        style={artPosition(card.id)}
        aria-hidden="true"
      />
      <MobileCost requirements={card.requirements} />
    </button>
  );
}

function MobileNoble({ noble, canClaim, onClaim }) {
  return (
    <button
      type="button"
      className={`splendor-mobile-noble ${canClaim ? 'is-eligible' : ''}`}
      disabled={!canClaim}
      onClick={onClaim}
      aria-label={`贵族，${noble.points}分`}
    >
      <span
        className="splendor-card-portrait splendor-mobile-noble-art"
        style={artPosition(noble.id)}
        aria-hidden="true"
      />
      <strong>{noble.points}分</strong>
      <MobileCost requirements={noble.requirements} />
      {canClaim && <span className="splendor-mobile-noble-action">接待</span>}
    </button>
  );
}

function MobileTokens({ tokens, selectable, chosen, onSelect, canAdd }) {
  return (
    <div className="splendor-mobile-gems" aria-label="宝石供应">
      {RESOURCES.map((color) => {
        const isSelected = chosen?.includes(color);
        const disabled = selectable ? !canAdd(color) : false;
        return (
          <button
            type="button"
            key={color}
            className={`splendor-mobile-gem is-${color} ${
              isSelected ? 'is-selected' : ''
            }`}
            disabled={disabled}
            onClick={() => onSelect?.(color)}
            aria-label={`${colorName[color]} ${tokens[color] ?? 0}枚`}
          >
            <span>{mobileColorName[color]}</span>
            <strong>{tokens[color] ?? 0}</strong>
          </button>
        );
      })}
    </div>
  );
}

function MobilePlayerDetails({ player, name, onClose }) {
  return (
    <div
      className="splendor-mobile-overlay"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="splendor-mobile-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${name(player.id)}的资源`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="splendor-mobile-dialog-heading">
          <strong>{name(player.id)}的资源</strong>
          <button type="button" onClick={onClose} aria-label="关闭资源详情">
            ×
          </button>
        </div>
        <p className="splendor-mobile-dialog-score">
          {player.points} 分 · {player.cards.length} 张发展卡 · 预留{' '}
          {player.reservedCount ?? player.reserved?.length ?? 0} 张
        </p>
        <div className="splendor-mobile-dialog-row">
          <span>筹码</span>
          <MobileTokens tokens={player.tokens} />
        </div>
        <div className="splendor-mobile-bonus-row">
          <span>折扣</span>
          {COLORS.map((color) => (
            <span
              key={color}
              className={`splendor-mobile-mini-bonus is-${color}`}
            >
              {mobileColorName[color]}
              {player.bonuses[color] ?? 0}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function MobileLobby({
  G,
  ctx,
  moves,
  playerID,
  matchData,
  isActive,
  isConnected,
  onStartWithAI,
  startingWithAI,
  players,
  name,
  occupied,
}) {
  return (
    <div className="splendor-mobile-lobby">
      <div className="splendor-mobile-status">
        <span className={isConnected ? 'is-live' : 'is-warn'}>
          {isConnected ? '在线' : '重连中'}
        </span>
        <span>等待准备</span>
      </div>
      <section className="splendor-mobile-lobby-card">
        <div className="splendor-mobile-lobby-heading">
          <strong>
            <span className="splendor-mobile-lobby-mark" aria-hidden="true">
              ◆
            </span>
            好友对战 · 宝石商人
          </strong>
          <span>{G.bots?.length ? 'AI 已补齐' : '准备后开局'}</span>
        </div>
        <div className="splendor-mobile-lobby-players">
          {players.map((player, index) => (
            <span
              key={player.id}
              className={occupied(player.id) ? 'is-occupied' : 'is-empty'}
            >
              <i className="splendor-mobile-seat-icon" aria-hidden="true">
                {occupied(player.id) ? '♟' : '＋'}
              </i>
              <b>{name(player.id)}</b> ·{' '}
              {G.ready[index]
                ? '已准备'
                : occupied(player.id)
                  ? '已入座'
                  : '空座'}
            </span>
          ))}
        </div>
        <div className="splendor-mobile-actions tabletop-pregame-actions">
          <button
            type="button"
            disabled={!isActive || G.ready[Number(playerID)]}
            onClick={() => moves.readyUp()}
          >
            {G.ready[Number(playerID)] ? '已准备' : '准备'}
          </button>
          {playerID === '0' && (
            <button
              type="button"
              disabled={!isActive || !G.ready.every(Boolean)}
              onClick={() => moves.startGame()}
            >
              开始游戏
            </button>
          )}
          {onStartWithAI &&
            !G.bots?.length &&
            players.some(({ id }) => !occupied(id)) && (
              <button
                type="button"
                disabled={!isActive || startingWithAI}
                onClick={onStartWithAI}
              >
                {startingWithAI ? '正在补齐…' : 'AI补齐开局'}
              </button>
            )}
        </div>
      </section>
      <ActionTimer
        clock={null}
        actionSeconds={G.actionSeconds}
        isHost={playerID === '0'}
        canAct={isActive && isConnected && !ctx.gameover}
        setActionSeconds={moves.setActionSeconds}
      />
    </div>
  );
}

function SplendorMobile({
  G,
  ctx,
  moves,
  playerID,
  matchData,
  isActive,
  isConnected,
  onStartWithAI,
  startingWithAI,
  players,
  me,
  name,
  occupied,
  pending,
  started,
  canAct,
  canChooseAction,
  canReserve,
  canPass,
  affordableMarketCards,
  nobles,
  chosen,
  setChosen,
  returned,
  setReturned,
  excess,
  canAdd,
  takeValid,
  addGem,
}) {
  const [selected, setSelected] = useState(null);
  const [expandedPlayer, setExpandedPlayer] = useState(null);

  useEffect(() => setSelected(null), [ctx.turn, pending, started]);

  if (!started) {
    return (
      <MobileLobby
        G={G}
        ctx={ctx}
        moves={moves}
        playerID={playerID}
        matchData={matchData}
        isActive={isActive}
        isConnected={isConnected}
        onStartWithAI={onStartWithAI}
        startingWithAI={startingWithAI}
        players={players}
        name={name}
        occupied={occupied}
      />
    );
  }

  const selectedPayment = selected ? paymentFor(me, selected.card) : null;
  const isSelectedMarket = selected?.source === 'market';
  const showReturn = pending === 'return' && canAct;
  const showNoble = pending === 'noble' && canAct;
  const currentPlayer = players.find(
    (player) => String(player.id) === String(ctx.currentPlayer),
  );

  return (
    <div className="splendor-mobile" aria-label="宝石商人移动端棋盘">
      <div className="splendor-mobile-status">
        <span className={isConnected ? 'is-live' : 'is-warn'}>
          {isConnected ? '在线' : '重连中'}
        </span>
        <span>
          {ctx.gameover
            ? '本局结束'
            : `轮到 ${currentPlayer ? name(currentPlayer.id) : '—'}`}
        </span>
        <span className="splendor-mobile-turn-clock">
          <MobileClock clock={G.actionClock} actionSeconds={G.actionSeconds} />
        </span>
        {G.finalRound && !ctx.gameover && (
          <span className="is-warn">最后一轮</span>
        )}
      </div>

      <div className="splendor-mobile-players" aria-label="玩家分数">
        {players.map((player) => (
          <button
            type="button"
            key={player.id}
            className={`${
              String(player.id) === String(ctx.currentPlayer)
                ? 'is-current'
                : ''
            } ${String(player.id) === String(playerID) ? 'is-you' : ''}`}
            onClick={() => setExpandedPlayer(player)}
            title="查看该玩家筹码与折扣"
          >
            <span className="splendor-mobile-player-icon" aria-hidden="true">
              ◆
            </span>
            <strong>
              {name(player.id)}
              {String(player.id) === String(playerID) ? '·你' : ''}
            </strong>
            <span>
              {player.points}分 · {player.cards.length}卡
            </span>
            {!!G.timeoutCounts?.[player.id] && (
              <em aria-label={`超时 ${G.timeoutCounts[player.id]} 次`}>
                {'💩'.repeat(G.timeoutCounts[player.id])}
              </em>
            )}
          </button>
        ))}
      </div>

      <section className="splendor-mobile-market" aria-label="发展卡市场">
        {G.tiers.map((cards, tierIndex) => (
          <div className="splendor-mobile-market-row" key={tierIndex}>
            <div
              className={`splendor-mobile-tier-label is-level-${tierIndex + 1}`}
            >
              <strong>L{tierIndex + 1}</strong>
              <small>{G.decks[tierIndex].count}</small>
              <button
                type="button"
                disabled={!canReserve || !G.decks[tierIndex].count}
                onClick={() => moves.reserveCard(tierIndex + 1, -1)}
                aria-label={`盲抽${tierIndex + 1}级发展卡`}
              >
                盲抽
              </button>
            </div>
            {cards.map((card, cardIndex) => (
              <MobileMarketCard
                key={card.id}
                card={card}
                affordable={affordableMarketCards.has(card.id)}
                selected={selected?.card.id === card.id}
                onSelect={() =>
                  setSelected({
                    card,
                    source: 'market',
                    tier: tierIndex + 1,
                    index: cardIndex,
                  })
                }
              />
            ))}
          </div>
        ))}
      </section>

      <section className="splendor-mobile-nobles" aria-label="贵族">
        <div className="splendor-mobile-section-label">
          贵族{showNoble ? ' · 请选择' : ''}
        </div>
        <div className="splendor-mobile-noble-grid">
          {G.nobles.map((noble, index) => (
            <MobileNoble
              key={noble.id}
              noble={noble}
              canClaim={showNoble && nobles.includes(noble)}
              onClaim={() => moves.claimNoble(index)}
            />
          ))}
        </div>
      </section>

      <section className="splendor-mobile-self" aria-label="我的资源">
        <div className="splendor-mobile-self-heading">
          <strong>我的资源</strong>
          <span>预留 {me.reserved.length}/3</span>
        </div>
        <MobileTokens tokens={me.tokens} selectable={false} chosen={[]} />
        <div className="splendor-mobile-bonus-row" aria-label="永久折扣">
          <span className="splendor-mobile-bonus-title">折扣</span>
          {COLORS.map((color) => (
            <span
              key={color}
              className={`splendor-mobile-mini-bonus is-${color}`}
            >
              {mobileColorName[color]}
              {me.bonuses[color]}
            </span>
          ))}
        </div>
        {me.reserved.length > 0 && (
          <div className="splendor-mobile-reserved-row" aria-label="预留牌">
            {me.reserved.map((card, index) => (
              <button
                type="button"
                className={`splendor-mobile-reserved is-level-${card.tier} ${selected?.card.id === card.id ? 'is-selected' : ''}`}
                key={card.id}
                onClick={() =>
                  setSelected({ card, source: 'reserved', tier: 0, index })
                }
                aria-label={`预留牌 ${card.points}分`}
              >
                {index + 1}号 · {card.points}分
              </button>
            ))}
          </div>
        )}
      </section>

      <section
        className={`splendor-mobile-action-panel ${showReturn || showNoble ? 'is-pending' : ''}`}
      >
        {showReturn ? (
          <>
            <div className="splendor-mobile-action-heading">
              归还 {excess} 枚 · 已选 {returned.length}/{excess}
            </div>
            <MobileTokens
              tokens={me.tokens}
              selectable
              chosen={returned}
              canAdd={(color) =>
                returned.length < excess &&
                returned.filter((item) => item === color).length <
                  me.tokens[color]
              }
              onSelect={(color) => setReturned([...returned, color])}
            />
            <div className="splendor-mobile-actions">
              <button
                type="button"
                disabled={returned.length !== excess}
                onClick={() => moves.returnGems(returned)}
              >
                确认归还
              </button>
              <button
                type="button"
                disabled={!returned.length}
                onClick={() => setReturned([])}
              >
                清空
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="splendor-mobile-selection">
              {selected ? (
                <>
                  <strong>
                    {selected.source === 'reserved'
                      ? '预留牌'
                      : `L${selected.tier}`}{' '}
                    · {selected.card.points}分
                  </strong>
                  <MobileCost requirements={selected.card.requirements} />
                </>
              ) : (
                <span>
                  {affordableMarketCards.size > 0
                    ? '红色点阵牌可买 · 点牌查看操作'
                    : '点击市场牌或预留牌查看操作'}
                </span>
              )}
            </div>
            <div className="splendor-mobile-actions splendor-mobile-card-actions">
              <button
                type="button"
                className="splendor-mobile-buy"
                disabled={!selected || !canChooseAction || !selectedPayment}
                onClick={() => {
                  if (!selected) return;
                  moves.buyCard(selected.source, selected.tier, selected.index);
                  setSelected(null);
                }}
              >
                购买
              </button>
              <button
                type="button"
                className="splendor-mobile-reserve"
                disabled={!isSelectedMarket || !canReserve}
                onClick={() => {
                  if (!selected) return;
                  moves.reserveCard(selected.tier, selected.index);
                  setSelected(null);
                }}
              >
                预留
              </button>
            </div>
            <div className="splendor-mobile-actions">
              <button
                type="button"
                disabled={!canChooseAction || !takeValid}
                onClick={() => moves.takeGems(chosen)}
              >
                拿取{chosen.length ? ` ${chosen.length}枚` : ''}
              </button>
              <button
                type="button"
                className="is-secondary"
                disabled={!chosen.length}
                onClick={() => setChosen([])}
              >
                清空宝石
              </button>
              {canPass && (
                <button
                  type="button"
                  className="is-secondary"
                  onClick={() => moves.passTurn()}
                >
                  结束回合
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="splendor-mobile-supply" aria-label="宝石供应">
        <div className="splendor-mobile-section-label">供应 · 点击选择筹码</div>
        <MobileTokens
          tokens={G.tokens}
          selectable
          chosen={chosen}
          canAdd={canAdd}
          onSelect={addGem}
        />
      </section>

      {expandedPlayer && (
        <MobilePlayerDetails
          player={expandedPlayer}
          name={name}
          onClose={() => setExpandedPlayer(null)}
        />
      )}
    </div>
  );
}
