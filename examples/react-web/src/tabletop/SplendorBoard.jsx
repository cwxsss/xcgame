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

const splendorColorOrder = ['black', 'red', 'green', 'blue', 'white', 'gold'];
const splendorDiscountOrder = ['black', 'red', 'green', 'blue', 'white'];

function PurchaseNotice({ purchase, name }) {
  if (!purchase?.card) {
    return (
      <div className="splendor-purchase-notice is-empty" role="status">
        上一轮暂无购买记录
      </div>
    );
  }
  const card = purchase.card;
  return (
    <div className="splendor-purchase-notice" role="status">
      <strong>{name(purchase.playerID)}</strong>
      <span>花费</span>
      {purchase.payment && <MobileCost requirements={purchase.payment} />}
      <span>购买</span>
      <span
        className="splendor-purchase-card-art splendor-card-portrait"
        style={artPosition(card.id)}
        aria-hidden="true"
      />
      <b>
        {card.points}分·{mobileColorName[card.color] ?? colorName[card.color]}
        折扣牌
      </b>
    </div>
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
  onRematch,
  rematchBusy = false,
  rematchError = '',
}) {
  const [chosen, setChosen] = useState([]);
  const [returned, setReturned] = useState([]);
  const [selectionNotice, setSelectionNotice] = useState('');
  const [showResults, setShowResults] = useState(Boolean(ctx.gameover));
  const turnCue = useRef(null);
  const lastAnnouncedTurn = useRef(null);
  const { players, pending, started } = G;
  const me = players[Number(playerID)];
  const bots = G.bots ?? [];
  const skippedPlayers = G.afkPlayers ?? [];
  const purchaseTurn = ctx.gameover ? ctx.turn : ctx.turn - 1;
  const previousPurchase = players
    .map((player) =>
      player.lastPurchase?.turn === purchaseTurn
        ? { ...player.lastPurchase, playerID: player.id }
        : null,
    )
    .filter(Boolean)
    .at(-1);
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
  const tokenTotal = totalTokens(me.tokens);
  const excess = Math.max(0, tokenTotal - 10);
  const nobles = eligibleNobles(me, G.nobles);
  const canReserve = canChooseAction && me.reserved.length < 3;
  const affordableMarketCards = new Map(
    started && !ctx.gameover
      ? G.tiers.flat().flatMap((card) => {
          const payment = paymentFor(me, card);
          return payment ? [[card.id, payment]] : [];
        })
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
    if (ctx.gameover) setShowResults(true);
  }, [ctx.gameover]);

  useEffect(() => {
    setChosen([]);
    setReturned([]);
  }, [ctx.turn, started, pending]);

  useEffect(() => {
    if (!selectionNotice) return undefined;
    const timer = window.setTimeout(() => setSelectionNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [selectionNotice]);

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
    if (!COLORS.includes(color)) {
      setSelectionNotice('黄金只能通过预留牌获得，不能直接拿取');
      return;
    }
    if (!canChooseAction || !G.tokens[color]) return;
    if (!canAdd(color)) {
      setSelectionNotice(
        chosen.length === 1 && chosen[0] === color
          ? '同色拿两枚需要该颜色至少有 4 枚'
          : chosen.length === 3
            ? '每次最多拿取三枚筹码'
            : chosen.length === 2 && chosen[0] === chosen[1]
              ? '已选两枚同色筹码，请确认拿取或清空'
              : '拿三种筹码时不能重复颜色',
      );
      return;
    }
    setChosen((current) => [...current, color]);
  }

  function canAdd(color) {
    if (!COLORS.includes(color)) return false;
    if (!canChooseAction || !G.tokens[color] || chosen.length >= 3)
      return false;
    if (chosen.includes(color))
      return chosen.length === 1 && G.tokens[color] >= 4;
    return new Set(chosen).size === chosen.length;
  }

  return (
    <div className="tabletop-shell splendor-board">
      <audio ref={turnCue} src={turnCueUrl} preload="auto" />
      <SplendorTable
        G={G}
        ctx={ctx}
        moves={moves}
        playerID={playerID}
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
        tokenTotal={tokenTotal}
        selectionNotice={selectionNotice}
        previousPurchase={previousPurchase}
      />
      {ctx.gameover && !showResults && (
        <div className="splendor-result-reopen">
          <button type="button" onClick={() => setShowResults(true)}>
            查看结算
          </button>
        </div>
      )}
      {ctx.gameover && showResults && (
        <ResultDialog
          ctx={ctx}
          players={players}
          name={name}
          skippedPlayers={skippedPlayers}
          onClose={() => setShowResults(false)}
          onRematch={onRematch}
          rematchBusy={rematchBusy}
          rematchError={rematchError}
        />
      )}
    </div>
  );
}

function ResultDialog({
  ctx,
  players,
  name,
  skippedPlayers = [],
  onClose,
  onRematch,
  rematchBusy,
  rematchError,
}) {
  const dialogRef = useRef(null);
  const winners = new Set((ctx.gameover?.winners ?? []).map(String));
  const skipped = new Set(skippedPlayers.map(String));
  const scores = [...(ctx.gameover?.scores ?? [])].sort((a, b) => {
    const aSkipped = skipped.has(String(a.playerID));
    const bSkipped = skipped.has(String(b.playerID));
    return (
      Number(aSkipped) - Number(bSkipped) ||
      b.points - a.points ||
      a.cards - b.cards
    );
  });
  useEffect(() => {
    dialogRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  return (
    <div className="splendor-result-overlay" role="presentation">
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="splendor-result-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="splendor-result-title"
      >
        <div className="splendor-result-heading">
          <span aria-hidden="true">🏆</span>
          <div>
            <h2 id="splendor-result-title">对局结算</h2>
            <p>荣誉属于今天的宝石大师</p>
          </div>
        </div>
        <div className="splendor-result-ranking">
          {scores.map((score, index) => {
            const champion = winners.has(String(score.playerID));
            const isSkipped = skipped.has(String(score.playerID));
            // Use competition ranking for equal scores. The first three
            // players with the same points and card count are all rank 1,
            // and the next player is rank 4.
            const firstMatchingIndex = scores.findIndex(
              (candidate, candidateIndex) =>
                candidateIndex <= index &&
                !skipped.has(String(candidate.playerID)) &&
                candidate.points === score.points &&
                candidate.cards === score.cards,
            );
            const rank = isSkipped ? '—' : firstMatchingIndex + 1;
            return (
              <div
                className={`splendor-result-row${champion ? ' is-champion' : ''}${isSkipped ? ' is-skipped' : ''}`}
                key={score.playerID}
              >
                <strong className="splendor-result-rank">{rank}</strong>
                <span className="splendor-result-avatar" aria-hidden="true">
                  {champion ? '👑' : isSkipped ? '⏸' : '◆'}
                </span>
                <span className="splendor-result-player">
                  <b>{name(score.playerID)}</b>
                  {champion && <em>冠军</em>}
                  {isSkipped && <em>已跳过</em>}
                </span>
                <span className="splendor-result-score">
                  {score.points}分 · {score.cards}卡
                </span>
              </div>
            );
          })}
        </div>
        {rematchError && (
          <p className="splendor-result-error" role="alert">
            {rematchError}
          </p>
        )}
        <div className="splendor-result-actions">
          <button type="button" className="is-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            disabled={!onRematch || rematchBusy}
            onClick={onRematch}
          >
            {rematchBusy ? '正在准备…' : '再来一局'}
          </button>
        </div>
      </section>
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
      {RESOURCES.filter((color) => requirements[color]).map((color) => (
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

function MobileMarketCard({ card, onSelect, selected, affordable, payment }) {
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
      {payment && (
        <span className="splendor-mobile-payment" title="当前资源实际支付">
          <small>实付</small>
          <MobileCost requirements={payment} />
        </span>
      )}
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

function MobileTokens({
  tokens,
  selectable,
  chosen,
  onSelect,
  canAdd,
  includeGold = true,
  onBlockedSelect,
  order = RESOURCES,
}) {
  return (
    <div className="splendor-mobile-gems" aria-label="宝石供应">
      {order
        .filter((color) => includeGold || color !== 'gold')
        .map((color) => {
          const isSelected = chosen?.includes(color);
          const blocked = selectable ? !canAdd(color) : false;
          const disabled = blocked && !onBlockedSelect;
          return (
            <button
              type="button"
              key={color}
              className={`splendor-mobile-gem is-${color} ${
                isSelected ? 'is-selected' : ''
              }${blocked && onBlockedSelect ? ' is-blocked' : ''}`}
              disabled={disabled}
              aria-disabled={disabled || undefined}
              onClick={() =>
                blocked ? onBlockedSelect?.(color) : onSelect?.(color)
              }
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
          <MobileTokens tokens={player.tokens} order={splendorColorOrder} />
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

function SplendorTable({
  G,
  ctx,
  moves,
  playerID,
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
  tokenTotal,
  selectionNotice,
  previousPurchase,
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
  const winners = ctx.gameover?.winners ?? [];

  return (
    <div className="splendor-mobile" aria-label="宝石商人棋盘">
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

      {winners.length > 0 && (
        <section
          className="splendor-mobile-victory"
          role="status"
          aria-label="对局结果"
        >
          <span className="splendor-mobile-victory-icon" aria-hidden="true">
            🏆
          </span>
          <div>
            <strong>{winners.map(name).join('、')}</strong>
            <span>
              {winners.length > 1
                ? '并列获胜 · 荣耀属于你们'
                : '获得胜利 · 荣耀属于你'}
            </span>
          </div>
        </section>
      )}

      {selectionNotice && (
        <div className="splendor-mobile-selection-toast" role="status">
          {selectionNotice}
        </div>
      )}

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
              {G.afkPlayers?.includes(player.id) && ' · 已跳过'}
            </span>
            <span className="splendor-player-chip-strip" aria-label="筹码">
              {splendorColorOrder.map((color) => (
                <i
                  key={color}
                  className={`is-${color}`}
                  title={colorName[color]}
                >
                  {' '}
                  {player.tokens[color] ?? 0}
                </i>
              ))}
            </span>
            <span className="splendor-player-bonus-row" aria-label="永久折扣">
              {splendorDiscountOrder.map((color) => (
                <i
                  key={color}
                  className={`splendor-player-mini-bonus is-${color}`}
                  title={colorName[color]}
                >
                  {' '}
                  {player.bonuses[color] ?? 0}
                </i>
              ))}
              <i
                className="splendor-player-mini-bonus is-placeholder"
                aria-hidden="true"
              />
            </span>
            {String(player.id) !== String(playerID) && (
              <span className="splendor-mobile-opponent-reserves">
                预留 {player.reservedCount ?? 0}/3
              </span>
            )}
            {!!G.timeoutCounts?.[player.id] && (
              <em aria-label={`超时 ${G.timeoutCounts[player.id]} 次`}>
                {'💩'.repeat(Math.min(5, G.timeoutCounts[player.id]))}
              </em>
            )}
          </button>
        ))}
      </div>

      <PurchaseNotice purchase={previousPurchase} name={name} />

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

      <section className="splendor-mobile-supply" aria-label="宝石供应">
        <div className="splendor-mobile-section-label">
          宝石银行 · 点击选择筹码
        </div>
        <MobileTokens
          tokens={G.tokens}
          selectable
          chosen={chosen}
          canAdd={canAdd}
          onSelect={(color) => {
            setSelected(null);
            addGem(color);
          }}
          onBlockedSelect={(color) => {
            setSelected(null);
            addGem(color);
          }}
          order={splendorColorOrder}
        />
      </section>

      <section className="splendor-mobile-market" aria-label="发展卡市场">
        {G.tiers
          .map((cards, tierIndex) => ({ cards, tierIndex }))
          .reverse()
          .map(({ cards, tierIndex }) => (
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
                  payment={affordableMarketCards.get(card.id)}
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
              order={splendorColorOrder}
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
        ) : selected || chosen.length ? (
          <>
            <div
              className={`splendor-mobile-confirm-row${selected ? ' is-card-action' : ''}`}
            >
              <button
                type="button"
                className="is-cancel"
                onClick={() => {
                  setChosen([]);
                  setSelected(null);
                }}
              >
                取消
              </button>
              <span
                className="splendor-mobile-confirm-chips"
                aria-label="本次选择"
              >
                {selected ? (
                  selectedPayment ? (
                    <MobileCost requirements={selectedPayment} />
                  ) : (
                    <span className="splendor-mobile-confirm-hint">
                      {isSelectedMarket ? '预留不花费筹码' : '筹码不足'}
                    </span>
                  )
                ) : (
                  <MobileCost
                    requirements={Object.fromEntries(
                      chosen.map((color) => [
                        color,
                        chosen.filter((item) => item === color).length,
                      ]),
                    )}
                  />
                )}
              </span>
              {selected ? (
                <>
                  <button
                    type="button"
                    className="is-confirm"
                    disabled={!canChooseAction || !selectedPayment}
                    onClick={() => {
                      moves.buyCard(
                        selected.source,
                        selected.tier,
                        selected.index,
                      );
                      setSelected(null);
                    }}
                  >
                    购买
                  </button>
                  {isSelectedMarket && (
                    <button
                      type="button"
                      className="is-reserve"
                      disabled={!canReserve}
                      onClick={() => {
                        moves.reserveCard(selected.tier, selected.index);
                        setSelected(null);
                      }}
                    >
                      预留
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="is-confirm"
                  disabled={!canChooseAction || !takeValid}
                  onClick={() => {
                    moves.takeGems(chosen);
                    setChosen([]);
                  }}
                >
                  确定
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="splendor-mobile-empty-action">
            {affordableMarketCards.size > 0
              ? '红色点阵牌可买 · 点牌查看操作'
              : '点击市场牌或预留牌查看操作'}
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
        )}
      </section>

      <section className="splendor-mobile-self" aria-label="我的资源">
        <div className="splendor-mobile-self-heading">
          <strong>我的资源</strong>
          <span className={tokenTotal > 10 ? 'is-over' : ''}>
            筹码 {tokenTotal}/10 · 预留 {me.reserved.length}/3
          </span>
        </div>
        <MobileTokens
          tokens={me.tokens}
          selectable={false}
          chosen={[]}
          order={splendorColorOrder}
        />
        <div className="splendor-mobile-bonus-row" aria-label="永久折扣">
          {splendorDiscountOrder.map((color) => (
            <span
              key={color}
              className={`splendor-mobile-mini-bonus is-${color}`}
            >
              {mobileColorName[color]}
              {me.bonuses[color]}
            </span>
          ))}
          <span
            className="splendor-mobile-mini-bonus is-placeholder"
            aria-hidden="true"
          />
        </div>
        <div className="splendor-mobile-reserved-row" aria-label="预留牌">
          {[0, 1, 2].map((index) => {
            const card = me.reserved[index];
            return card ? (
              <button
                type="button"
                className={`splendor-mobile-reserved is-level-${card.tier} ${selected?.card.id === card.id ? 'is-selected' : ''}`}
                key={card.id}
                onClick={() =>
                  setSelected({ card, source: 'reserved', tier: 0, index })
                }
                aria-label={`预留牌 ${card.points}分`}
              >
                <span
                  className="splendor-card-portrait splendor-mobile-reserved-art"
                  style={artPosition(card.id)}
                  aria-hidden="true"
                />
                <b>{card.points}分</b>
                <MobileCost requirements={card.requirements} />
              </button>
            ) : (
              <span
                className="splendor-mobile-reserved is-empty"
                key={`empty-${index}`}
                aria-label={`${index + 1}号预留位空闲`}
              >
                <i aria-hidden="true">＋</i>
                <small>{index + 1}号预留位</small>
              </span>
            );
          })}
        </div>
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
