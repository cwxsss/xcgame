import React, { useEffect, useState } from 'react';
import { Client } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { Avalon } from './avalon';
import { Splendor } from './splendor';
import { AvalonBoard } from './AvalonBoard';
import {
  AVALON_MODES,
  AVALON_ROLE_OPTIONS,
  resolveAvalonOptions,
} from './avalon-options';
import { SplendorBoard } from './SplendorBoard';
import { VoicePanel } from './VoicePanel';
import './lobby.css';
import './tabletop.css';

const games = {
  splendor: {
    title: '宝石商人',
    kind: '资源策略',
    symbol: '◆',
    counts: [2, 3, 4],
    description: '收集宝石、购买发展卡，用永久折扣赢得贵族的青睐。',
    game: Splendor,
    board: SplendorBoard,
    isWaiting: (G) => !G.started,
  },
  avalon: {
    title: '阿瓦隆',
    kind: '阵营推理',
    symbol: '♜',
    counts: [5, 6, 7, 8, 9, 10],
    description: '秘密领取身份，组队执行任务，在投票与发言中识别敌友。',
    game: Avalon,
    board: AvalonBoard,
    isWaiting: (G) => G.phase === 'waiting',
  },
};

const clients = Object.fromEntries(
  Object.entries(games).map(([key, { game, board: Board, isWaiting }]) => [
    key,
    Client({
      game,
      board: function RoomBoard({ onWaitingChange, ...props }) {
        const waiting = !props.ctx.gameover && isWaiting(props.G);
        useEffect(() => {
          onWaitingChange(waiting);
        }, [onWaitingChange, waiting]);
        return <Board {...props} />;
      },
      multiplayer: SocketIO(),
      loading: () => (
        <p className="tt-notice" role="status">
          正在连接房间…
        </p>
      ),
      debug: false,
    }),
  ]),
);

const roomCode = /^[A-Za-z0-9_-]{1,80}$/;
const seats = new Map();

function readRoom() {
  const [, path, game, matchID, extra] = window.location.hash.split('/');
  return path === 'room' &&
    Object.hasOwn(games, game) &&
    matchID &&
    !extra &&
    roomCode.test(matchID)
    ? { game, matchID }
    : null;
}

function seatKey({ game, matchID }) {
  return `tabletop-seat:${game}:${matchID}`;
}

function readSeat(room) {
  const key = seatKey(room);
  try {
    return seats.get(key) ?? JSON.parse(localStorage.getItem(key));
  } catch {
    return seats.get(key) ?? null;
  }
}

function saveSeat(room, { playerID, playerCredentials }) {
  const key = seatKey(room);
  const seat = { playerID: String(playerID), credentials: playerCredentials };
  seats.set(key, seat);
  try {
    localStorage.setItem(key, JSON.stringify(seat));
  } catch {
    // The active tab can still play when browser storage is disabled.
  }
  return seat;
}

async function request(path, data) {
  const response = await fetch(
    path,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  if (!response.ok) {
    const messages = {
      400: '请检查房间信息后重试。',
      403: '当前座位无法执行这项操作。',
      404: '找不到这个房间，请核对游戏和房间号。',
      409: '这个房间没有空位了。',
    };
    throw new Error(
      messages[response.status] ?? '服务器暂时无法处理，请稍后重试。',
    );
  }
  return response.json();
}

function roomPath({ game, matchID }) {
  return `/games/${game}/${matchID}`;
}

function roomHash({ game, matchID }) {
  return `#/room/${game}/${matchID}`;
}

function openRoom(room) {
  window.location.hash = roomHash(room);
}

function playerCount(counts) {
  return `${counts[0]}–${counts.at(-1)} 人`;
}

function Home() {
  const [game, setGame] = useState('splendor');
  const [count, setCount] = useState(games.splendor.counts[0]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [joinError, setJoinError] = useState('');
  const [options, setOptions] = useState({ mode: 'base', customRoles: [] });

  function selectGame(key) {
    setGame(key);
    if (game !== key) setCount(games[key].counts[0]);
    setError('');
    setJoinError('');
  }

  async function create(event) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setError('');
    setBusy(true);
    try {
      if (game === 'avalon') resolveAvalonOptions(options, count);
      const { matchID } = await request(`/games/${game}/create`, {
        numPlayers: count,
        unlisted: true,
        ...(game === 'avalon' ? { setupData: options } : {}),
      });
      const room = { game, matchID };
      try {
        const joined = await request(`${roomPath(room)}/join`, {
          playerID: '0',
          playerName: name.trim(),
        });
        saveSeat(room, joined);
      } finally {
        openRoom(room);
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  function join(event) {
    event.preventDefault();
    const matchID = code.trim();
    if (!roomCode.test(matchID)) {
      setJoinError('请输入有效的房间号。');
      return;
    }
    openRoom({ game, matchID });
  }

  return (
    <>
      <section className="tt-intro" aria-labelledby="tt-title">
        <h1 id="tt-title">找朋友，开一局。</h1>
        <p>创建房间，把邀请链接发给朋友。大家入座后即可开局。</p>
      </section>

      <section className="tt-games" aria-label="选择游戏">
        {Object.entries(games).map(([key, item]) => (
          <button
            className={`tt-game tt-game--${key}`}
            key={key}
            type="button"
            aria-pressed={game === key}
            disabled={busy}
            onClick={() => selectGame(key)}
          >
            <span className="tt-game-art" aria-hidden="true">
              <span>{item.symbol}</span>
            </span>
            <span className="tt-game-info">
              <span className="tt-game-meta">
                {item.kind} · {playerCount(item.counts)}
              </span>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
              <span className="tt-game-status">
                {game === key ? '✓ 已选择' : '选择游戏'}
              </span>
            </span>
          </button>
        ))}
      </section>

      <div className="tt-actions">
        <form className="tt-panel" id="create-room" onSubmit={create}>
          <h2>创建{games[game].title}房间</h2>
          <label>
            你的昵称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="请输入昵称"
              autoComplete="nickname"
              maxLength={20}
              required
            />
          </label>
          {game === 'avalon' && (
            <AvalonOptions
              options={options}
              setOptions={setOptions}
              setCount={setCount}
            />
          )}
          <label>
            游戏人数
            <select
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            >
              {games[game].counts.map((value) => (
                <option value={value} key={value}>
                  {value} 人
                </option>
              ))}
            </select>
          </label>
          <button
            className="tt-button tt-primary"
            disabled={busy}
            type="submit"
          >
            {busy ? '正在创建…' : `创建${games[game].title}房间`}
          </button>
          {error && (
            <p className="tt-notice tt-error" role="alert">
              {error}
            </p>
          )}
        </form>

        <form className="tt-panel" id="join-room" onSubmit={join}>
          <h2>加入{games[game].title}房间</h2>
          <label>
            房间号
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={80}
              placeholder="输入朋友分享的房间号"
              spellCheck={false}
              required
            />
          </label>
          <button
            className="tt-button tt-secondary"
            disabled={busy}
            type="submit"
          >
            {`加入${games[game].title}房间`}
          </button>
          {joinError && (
            <p className="tt-notice tt-error" role="alert">
              {joinError}
            </p>
          )}
        </form>
      </div>
    </>
  );
}

function AvalonOptions({ options, setOptions, setCount }) {
  function toggleRole(role, enabled) {
    setOptions((current) => ({
      ...current,
      customRoles: enabled
        ? [...current.customRoles, role]
        : current.customRoles.filter((value) => value !== role),
    }));
  }
  return (
    <>
      <label>
        对局模式
        <select
          value={options.mode}
          onChange={(event) => {
            const mode = event.target.value;
            setOptions({ mode, customRoles: [] });
            if (AVALON_MODES[mode].min) setCount(AVALON_MODES[mode].min);
          }}
        >
          {Object.entries(AVALON_MODES).map(([value, { name, min }]) => (
            <option value={value} key={value}>
              {name}
              {min ? `（${min} 人）` : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="tt-mode-description">{AVALON_MODES[options.mode].detail}</p>
      {options.mode === 'custom' && (
        <fieldset className="tt-options">
          <legend>额外角色</legend>
          {Object.entries(AVALON_ROLE_OPTIONS).map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={options.customRoles.includes(value)}
                onChange={(event) => toggleRole(value, event.target.checked)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      <details className="tt-options">
        <summary>自定义对局规则</summary>
        {Object.entries({
          dice: '掷骰决定首任队长',
          lady: '湖中仙女验人',
          leaderOnTeam: '队长必须随队出征',
          earlyAssassin: '允许刺客提前刺杀',
        }).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={options[key] ?? AVALON_MODES[options.mode][key] ?? false}
              onChange={(event) =>
                setOptions({ ...options, [key]: event.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </details>
    </>
  );
}

function Room({ room }) {
  const [info, setInfo] = useState(null);
  const [seat, setSeat] = useState(() => readSeat(room));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inviteStatus, setInviteStatus] = useState('');
  const [retry, setRetry] = useState(0);
  const [showInvite, setShowInvite] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [startingWithAI, setStartingWithAI] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchError, setRematchError] = useState('');
  const game = games[room.game];
  const GameClient = clients[room.game];
  const inviteUrl = new URL(roomHash(room), window.location.origin).href;

  useEffect(() => {
    let active = true;
    request(roomPath(room))
      .then((match) => {
        if (active) setInfo(match);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [room.game, room.matchID, retry]);

  async function join(event) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await request(`${roomPath(room)}/join`, {
        playerName: name.trim(),
      });
      setSeat(saveSeat(room, result));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteStatus('链接已复制，可以发给朋友。');
    } catch {
      setInviteStatus('可长按或右键点击上方链接，复制链接地址。');
    }
  }

  async function rematch() {
    if (rematchBusy) return;
    setRematchBusy(true);
    setRematchError('');
    try {
      const result = await request(`${roomPath(room)}/rematch`, {
        playerID: seat.playerID,
        credentials: seat.credentials,
      });
      const nextRoom = { game: room.game, matchID: result.matchID };
      saveSeat(nextRoom, result);
      openRoom(nextRoom);
    } catch {
      setRematchError('暂时无法进入新一局，请重试。');
    } finally {
      setRematchBusy(false);
    }
  }
  async function startWithAI() {
    if (startingWithAI) return;
    setStartingWithAI(true);
    setError('');
    try {
      await request(`${roomPath(room)}/start-ai`, {
        credentials: seat.credentials,
      });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setStartingWithAI(false);
    }
  }

  return (
    <>
      <section className="tt-room-header">
        <div>
          <a href="#/" className="tt-back">
            ← 返回大厅
          </a>
          <h1>{game.title}</h1>
          <p>
            房间号 <code>{room.matchID}</code>
          </p>
        </div>
        {waiting && (
          <button
            type="button"
            className="tt-button tt-primary"
            onClick={() => {
              setShowInvite(!showInvite);
              setInviteStatus('');
            }}
            aria-controls="tt-room-invite"
            aria-expanded={showInvite}
          >
            邀请好友
          </button>
        )}
      </section>
      {waiting && showInvite && (
        <section
          id="tt-room-invite"
          className="tt-invite-popover"
          aria-label="房间邀请"
        >
          <div>
            房间号 <code>{room.matchID}</code>
          </div>
          <a className="tt-invite-link" href={inviteUrl}>
            {inviteUrl}
          </a>
          <div className="tt-invite-actions">
            <button
              className="tt-button tt-primary"
              type="button"
              onClick={copy}
            >
              复制邀请链接
            </button>
            <button
              className="tt-button tt-secondary"
              type="button"
              onClick={() => setShowInvite(false)}
            >
              关闭
            </button>
          </div>
          {inviteStatus && <span role="status">{inviteStatus}</span>}
        </section>
      )}
      {error && (
        <p className="tt-notice tt-error" role="alert">
          {error}
        </p>
      )}
      {!info &&
        (error ? (
          <button
            className="tt-button tt-secondary"
            type="button"
            onClick={() => {
              setError('');
              setRetry((value) => value + 1);
            }}
          >
            重新连接
          </button>
        ) : (
          <p className="tt-notice" role="status">
            正在查找房间…
          </p>
        ))}
      {info &&
        (seat ? (
          <>
            <GameClient
              matchID={room.matchID}
              playerID={seat.playerID}
              credentials={seat.credentials}
              onWaitingChange={setWaiting}
              {...(room.game === 'splendor'
                ? { onRematch: rematch, rematchBusy, rematchError }
                : {})}
              {...(seat.playerID === '0'
                ? { onStartWithAI: startWithAI, startingWithAI }
                : {})}
            />
            <VoicePanel gameName={room.game} matchID={room.matchID} {...seat} />
          </>
        ) : (
          <form className="tt-panel tt-join" onSubmit={join}>
            <h2>在这张桌上入座</h2>
            <p>{info.players.length} 人房间</p>
            <label>
              你的昵称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="请输入昵称"
                autoComplete="nickname"
                maxLength={20}
                required
              />
            </label>
            <button
              className="tt-button tt-primary"
              disabled={busy}
              type="submit"
            >
              {busy ? '正在加入…' : '加入房间'}
            </button>
          </form>
        ))}
    </>
  );
}

export function TabletopApp() {
  const [room, setRoom] = useState(readRoom);
  useEffect(() => {
    const listener = () => setRoom(readRoom());
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);

  return (
    <div className="tt-site">
      <header className="tt-site-header">
        <a href="#/" className="tt-brand">
          小褚游戏厅
        </a>
        {room && <a href="#/">游戏大厅</a>}
      </header>
      <main className="tt-main">
        {room ? <Room key={seatKey(room)} room={room} /> : <Home />}
      </main>
    </div>
  );
}
