import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createVoiceRelay } from './voice-relay';
import { io } from 'socket.io-client';
import './voice.css';

const VOICE_NAMESPACE = '/tabletop-voice';

function getErrorMessage(error) {
  if (!error) return '语音服务暂时不可用，文字游戏不受影响。';
  if (
    error.name === 'NotAllowedError' ||
    error.name === 'PermissionDeniedError'
  ) {
    return '浏览器没有麦克风权限，请在地址栏允许后重试。';
  }
  if (error.name === 'NotFoundError') {
    return '没有检测到麦克风，请连接麦克风后重试。';
  }
  if (error.name === 'NotReadableError') {
    return '麦克风正在被其他应用占用，请关闭占用它的应用后重试。';
  }
  return error.message || '无法打开麦克风，请稍后重试。';
}

function isDescription(value) {
  return value && typeof value.type === 'string';
}

function isCandidate(value) {
  return (
    value && (typeof value.candidate === 'string' || value.candidate === null)
  );
}

/**
 * Small WebRTC mesh client for a tabletop room.
 *
 * The server only relays signaling messages. Each browser connects directly to
 * every other voice participant, so the component stays usable on the same
 * board-game server without an audio media server.
 */
export function VoicePanel({ gameName, matchID, playerID, credentials }) {
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const remoteStreamsRef = useRef(new Map());
  const audioElementsRef = useRef(new Map());
  const peerNamesRef = useRef(new Map());
  const iceServersRef = useRef([]);
  const micEnabledRef = useRef(false);
  const joinedRef = useRef(false);
  const modeRef = useRef('toggle');
  const relayRef = useRef(null);
  const joinAttemptRef = useRef(0);
  const launcherRef = useRef(null);
  const speakingRef = useRef(false);
  const talkPointerIdRef = useRef(null);
  const toastTimer = useRef(null);

  const [joined, setJoined] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [connectionState, setConnectionState] = useState('idle');
  const [mode, setMode] = useState('toggle');
  const [micEnabled, setMicEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [peers, setPeers] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState('');

  const showVoiceToast = useCallback((message) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(''), 3000);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const setLocalAudioEnabled = useCallback((enabled) => {
    micEnabledRef.current = enabled;
    relayRef.current?.enable(enabled);
    if (enabled) void relayRef.current?.resume().catch(() => {});
    const stream = localStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
    setMicEnabled(enabled);
  }, []);

  const removePeer = useCallback((peerId, removeRoster = false) => {
    relayRef.current?.remove(peerId);
    const record = peerConnectionsRef.current.get(peerId);
    if (record) {
      record.pc.onicecandidate = null;
      record.pc.ontrack = null;
      record.pc.onconnectionstatechange = null;
      record.pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
    remoteStreamsRef.current.delete(peerId);
    setRemoteStreams((current) => {
      if (!current[peerId]) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
    if (removeRoster) {
      setPeers((current) => current.filter((peer) => peer.id !== peerId));
    }
  }, []);

  const emitSignal = useCallback((to, payload) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    socket.emit('voice-signal', { to, ...payload });
  }, []);

  const flushCandidates = useCallback(async (peerId, pc) => {
    const queue = pendingCandidatesRef.current.get(peerId) || [];
    pendingCandidatesRef.current.delete(peerId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (_error) {
        // A stale candidate can arrive while a peer is leaving. It is safe to
        // discard it; the next negotiation will provide a fresh candidate.
      }
    }
  }, []);

  const createPeerConnection = useCallback(
    (peer) => {
      const existing = peerConnectionsRef.current.get(peer.id);
      if (existing) {
        existing.name = peer.name;
        return existing;
      }

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      const record = { pc, name: peer.name || '玩家', offerStarted: false };
      peerConnectionsRef.current.set(peer.id, record);

      const localStream = localStreamRef.current;
      if (localStream) {
        localStream
          .getTracks()
          .forEach((track) => pc.addTrack(track, localStream));
      }

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        emitSignal(peer.id, {
          candidate: event.candidate.toJSON
            ? event.candidate.toJSON()
            : event.candidate,
        });
      };

      pc.ontrack = (event) => {
        const stream = event.streams && event.streams[0];
        if (!stream) return;
        remoteStreamsRef.current.set(peer.id, stream);
        setRemoteStreams((current) => ({ ...current, [peer.id]: stream }));
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          removePeer(peer.id);
        }
      };

      // Both browsers create this record from the roster. Comparing socket
      // IDs gives one stable offer owner and prevents offer glare.
      const ownId = socketRef.current && socketRef.current.id;
      if (ownId && ownId < peer.id) {
        record.offerStarted = true;
        pc.createOffer({ offerToReceiveAudio: true })
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => emitSignal(peer.id, { description: pc.localDescription }))
          .catch(() => {
            record.offerStarted = false;
          });
      }

      return record;
    },
    [emitSignal, removePeer],
  );

  const handleSignal = useCallback(
    async ({ from, description, candidate }) => {
      if (!from || !joinedRef.current) return;
      const peer = { id: from, name: peerNamesRef.current.get(from) || '玩家' };
      const record = createPeerConnection(peer);
      if (!record) return;
      const { pc } = record;

      try {
        if (isDescription(description)) {
          // The lower socket ID owns offers. If an offer arrives on the owner,
          // it is a glare caused by a reconnect and can be ignored safely.
          const ownId = socketRef.current && socketRef.current.id;
          if (description.type === 'offer' && ownId && ownId < from) return;

          if (description.type === 'offer') {
            if (pc.signalingState !== 'stable') return;
            await pc.setRemoteDescription(description);
            await flushCandidates(from, pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            emitSignal(from, { description: pc.localDescription });
          } else if (description.type === 'answer') {
            if (pc.signalingState !== 'have-local-offer') return;
            await pc.setRemoteDescription(description);
            await flushCandidates(from, pc);
          }
        }

        if (isCandidate(candidate)) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(candidate);
          } else {
            const queue = pendingCandidatesRef.current.get(from) || [];
            queue.push(candidate);
            pendingCandidatesRef.current.set(from, queue);
          }
        }
      } catch (_error) {
        // A peer can disappear between a roster update and a signal. Keeping
        // the panel alive is preferable to surfacing a transient ICE error.
      }
    },
    [createPeerConnection, emitSignal, flushCandidates],
  );

  const handleRoster = useCallback(
    (roster) => {
      if (!Array.isArray(roster)) return;
      const ownId = socketRef.current && socketRef.current.id;
      const nextPeers = roster
        .filter((peer) => peer && peer.id && peer.id !== ownId)
        .map((peer) => ({ id: String(peer.id), name: peer.name || '玩家' }));
      const nextIds = new Set(nextPeers.map((peer) => peer.id));

      peerNamesRef.current.clear();
      nextPeers.forEach((peer) => peerNamesRef.current.set(peer.id, peer.name));
      for (const peerId of peerConnectionsRef.current.keys()) {
        if (!nextIds.has(peerId)) removePeer(peerId);
      }
      nextPeers.forEach((peer) => createPeerConnection(peer));
      setPeers(nextPeers);
    },
    [createPeerConnection, removePeer],
  );

  const unlockRemoteAudio = useCallback(async () => {
    try {
      await relayRef.current?.resume();
    } catch (_) {
      // The HTML audio elements can still be played independently.
    }
    let played = false;
    for (const audio of audioElementsRef.current.values()) {
      try {
        await audio.play();
        played = true;
      } catch (_error) {
        // Safari can require a second user gesture after the remote stream is
        // attached. Keep the recovery button visible in that case.
      }
    }
    if (played) setAudioBlocked(false);
  }, []);

  const disconnect = useCallback(() => {
    joinAttemptRef.current++;
    joinedRef.current = false;
    setJoined(false);
    setConnectionState('idle');
    speakingRef.current = false;
    talkPointerIdRef.current = null;
    setLocalAudioEnabled(false);
    setSpeaking(false);

    for (const peerId of peerConnectionsRef.current.keys()) removePeer(peerId);
    const socket = socketRef.current;
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    }
    const stream = localStreamRef.current;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    relayRef.current?.close();
    relayRef.current = null;
    pendingCandidatesRef.current.clear();
    peerNamesRef.current.clear();
    remoteStreamsRef.current.clear();
    setPeers([]);
    setRemoteStreams({});
    setAudioBlocked(false);
  }, [removePeer, setLocalAudioEnabled]);

  const join = useCallback(async () => {
    if (joinedRef.current) return;
    setErrorMessage('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMessage(
        '当前浏览器不支持麦克风，请使用最新版 Chrome、Safari 或 Firefox。',
      );
      return;
    }
    if (typeof RTCPeerConnection === 'undefined') {
      setErrorMessage('当前浏览器不支持实时语音，请更新浏览器后重试。');
      return;
    }

    setConnectionState('connecting');
    const attempt = ++joinAttemptRef.current;
    try {
      const relay = createVoiceRelay((frame) => {
        const socket = socketRef.current;
        if (!socket?.connected || !micEnabledRef.current) return;
        const targets = [...peerNamesRef.current.keys()].filter(
          (id) =>
            peerConnectionsRef.current.get(id)?.pc.connectionState !==
            'connected',
        );
        if (targets.length)
          socket.volatile.emit('voice-audio', { targets, frame });
      });
      relayRef.current = relay;
      void relay?.resume().catch(() => setAudioBlocked(true));
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (attempt !== joinAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      // Joining never opens the microphone unexpectedly.
      setLocalAudioEnabled(false);
      void relay?.attach(stream).catch(() => {});

      const socket = io(VOICE_NAMESPACE, {
        autoConnect: false,
        auth: { gameName, matchID, playerID, credentials },
      });
      socketRef.current = socket;
      let announced = false;
      socket.on('connect', () => {
        setConnectionState('connected');
        setErrorMessage('');
        if (!announced) {
          announced = true;
          showVoiceToast('已加入语音');
        }
      });
      socket.on('disconnect', (reason) => {
        speakingRef.current = false;
        talkPointerIdRef.current = null;
        setLocalAudioEnabled(false);
        setSpeaking(false);
        for (const id of peerConnectionsRef.current.keys()) removePeer(id);
        peerNamesRef.current.clear();
        setPeers([]);
        if (reason === 'io server disconnect') {
          disconnect();
          setErrorMessage('语音席位已断开，可以重新加入。');
        } else setConnectionState('connecting');
      });
      socket.on('voice-error', ({ code }) => {
        if (code === 'ROOM_FULL') {
          disconnect();
          setErrorMessage('本房间的 5 个语音席位已满。');
        }
      });
      socket.on('connect_error', (error) => {
        setConnectionState('error');
        setErrorMessage('语音服务暂时不可用，文字游戏不受影响。');
        if (error && error.message) console.warn('[voice]', error.message);
      });
      socket.on('voice-ice', (servers) => {
        if (Array.isArray(servers)) iceServersRef.current = servers;
      });
      socket.on('voice-peers', handleRoster);
      socket.on('voice-signal', handleSignal);
      socket.on('voice-audio', ({ from, frame }) => {
        if (
          peerConnectionsRef.current.get(from)?.pc.connectionState !==
          'connected'
        ) {
          relayRef.current?.play(from, frame);
        }
      });
      joinedRef.current = true;
      setJoined(true);
      socket.connect();
    } catch (error) {
      if (attempt !== joinAttemptRef.current) return;
      relayRef.current?.close();
      relayRef.current = null;
      setConnectionState('error');
      setErrorMessage(getErrorMessage(error));
      const stream = localStreamRef.current;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  }, [
    credentials,
    disconnect,
    gameName,
    handleRoster,
    handleSignal,
    matchID,
    playerID,
    removePeer,
    setLocalAudioEnabled,
    showVoiceToast,
  ]);

  const toggleMicrophone = useCallback(() => {
    if (!joinedRef.current || modeRef.current !== 'toggle') return;
    setLocalAudioEnabled(!micEnabledRef.current);
  }, [setLocalAudioEnabled]);

  const startTalking = useCallback(
    (event) => {
      if (event) {
        event.preventDefault();
        if (
          event.type.startsWith('pointer') &&
          event.pointerType === 'mouse' &&
          event.button !== 0
        )
          return;
        if (
          event.pointerId !== undefined &&
          talkPointerIdRef.current !== null &&
          talkPointerIdRef.current !== event.pointerId
        )
          return;
        if (event.pointerId !== undefined)
          talkPointerIdRef.current = event.pointerId;
        if (
          event.currentTarget.setPointerCapture &&
          event.pointerId !== undefined
        ) {
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch (_error) {
            // Pointer capture is unavailable in some older mobile WebViews.
          }
        }
      }
      if (
        !joinedRef.current ||
        modeRef.current !== 'push' ||
        speakingRef.current
      )
        return;
      speakingRef.current = true;
      setLocalAudioEnabled(true);
      setSpeaking(true);
    },
    [setLocalAudioEnabled],
  );

  const stopTalking = useCallback(
    (event) => {
      if (modeRef.current !== 'push' || !speakingRef.current) return;
      event?.preventDefault();
      talkPointerIdRef.current = null;
      speakingRef.current = false;
      setLocalAudioEnabled(false);
      setSpeaking(false);
    },
    [setLocalAudioEnabled],
  );

  useEffect(() => {
    const release = (event) => {
      if (event.pointerId === talkPointerIdRef.current) stopTalking();
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
  }, [stopTalking]);

  const changeMode = useCallback(
    (nextMode) => {
      setMode(nextMode);
      modeRef.current = nextMode;
      speakingRef.current = false;
      talkPointerIdRef.current = null;
      setSpeaking(false);
      setLocalAudioEnabled(false);
    },
    [setLocalAudioEnabled],
  );

  const collapsePanel = useCallback(() => {
    // Collapsing must never leave a push-to-talk press active. A toggle-mode
    // microphone keeps its existing intent while the controls are minimized.
    if (modeRef.current === 'push') {
      speakingRef.current = false;
      talkPointerIdRef.current = null;
      setLocalAudioEnabled(false);
      setSpeaking(false);
    }
    setExpanded(false);
  }, [setLocalAudioEnabled]);

  useEffect(() => {
    const collapseOnEscape = (event) => {
      if (event.key === 'Escape' && expanded) collapsePanel();
    };
    document.addEventListener('keydown', collapseOnEscape);
    return () => document.removeEventListener('keydown', collapseOnEscape);
  }, [collapsePanel, expanded]);

  useEffect(() => {
    const stopForBackground = () => {
      // A tab switch, app switch, or screen lock must never leave an open
      // microphone behind. The player can explicitly turn it back on.
      speakingRef.current = false;
      talkPointerIdRef.current = null;
      setLocalAudioEnabled(false);
      setSpeaking(false);
    };
    document.addEventListener('visibilitychange', stopForBackground);
    window.addEventListener('pagehide', stopForBackground);
    return () => {
      document.removeEventListener('visibilitychange', stopForBackground);
      window.removeEventListener('pagehide', stopForBackground);
    };
  }, [setLocalAudioEnabled]);

  useEffect(() => {
    for (const [peerId, stream] of Object.entries(remoteStreams)) {
      const audio = audioElementsRef.current.get(peerId);
      if (!audio) continue;
      if (audio.srcObject !== stream) audio.srcObject = stream;
      audio.play().catch(() => setAudioBlocked(true));
    }
  }, [remoteStreams, peers]);

  useEffect(() => disconnect, [disconnect]);

  const connectionLabel =
    connectionState === 'connected'
      ? '已连接'
      : connectionState === 'connecting'
        ? '连接中'
        : connectionState === 'error'
          ? '连接异常'
          : '未加入';

  return (
    <section
      className={`voice-panel ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      aria-label="房间语音"
    >
      {!expanded ? (
        <button
          ref={launcherRef}
          className={`voice-launcher ${micEnabled ? 'is-live' : ''}`}
          type="button"
          aria-label="打开房间语音控制"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          <span className="voice-launcher-icon" aria-hidden="true">
            {micEnabled ? '🎙️' : '🔊'}
          </span>
          <span className="voice-launcher-copy">
            <strong>语音</strong>
            <span>{joined ? connectionLabel : '点击打开'}</span>
          </span>
          <span
            className={`voice-launcher-status voice-status-${connectionState}`}
            aria-hidden="true"
          />
        </button>
      ) : (
        <div className="voice-panel-content">
          <div className="voice-heading">
            <div>
              <h3>房间语音</h3>
              <p className="voice-subtitle">加入后可和房间内的玩家直接通话</p>
            </div>
            <div className="voice-heading-actions">
              <span
                className={`voice-status voice-status-${connectionState}`}
                role="status"
              >
                {connectionLabel}
              </span>
              <button
                className="voice-collapse-button"
                type="button"
                aria-label="收起语音面板"
                aria-expanded={true}
                onClick={collapsePanel}
              >
                <span aria-hidden="true">⌄</span>
              </button>
            </div>
          </div>

          {!joined ? (
            <button
              className="voice-primary-button"
              type="button"
              onClick={join}
            >
              加入语音
            </button>
          ) : (
            <>
              <div className="voice-toolbar">
                <label className="voice-mode-label" htmlFor="voice-mode">
                  说话方式
                </label>
                <select
                  id="voice-mode"
                  className="voice-mode-select"
                  value={mode}
                  onChange={(event) => changeMode(event.target.value)}
                >
                  <option value="toggle">持续开麦（点击开关）</option>
                  <option value="push">按住说话</option>
                </select>
              </div>

              {mode === 'toggle' ? (
                <button
                  className={`voice-mic-button ${micEnabled ? 'is-live' : ''}`}
                  type="button"
                  aria-pressed={micEnabled}
                  onClick={toggleMicrophone}
                >
                  <span aria-hidden="true">{micEnabled ? '🎙️' : '🔇'}</span>
                  {micEnabled ? '麦克风已开启' : '麦克风已关闭'}
                </button>
              ) : (
                <button
                  className={`voice-talk-button ${speaking ? 'is-live' : ''}`}
                  type="button"
                  aria-label="按住说话，松开结束"
                  onPointerDown={startTalking}
                  onLostPointerCapture={(event) => {
                    if (event.pointerId === talkPointerIdRef.current)
                      stopTalking();
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.key === ' ' || event.key === 'Enter') &&
                      !event.repeat
                    )
                      startTalking(event);
                  }}
                  onKeyUp={(event) => {
                    if (event.key === ' ' || event.key === 'Enter')
                      stopTalking(event);
                  }}
                  onBlur={stopTalking}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <span aria-hidden="true">{speaking ? '🎙️' : '👆'}</span>
                  {speaking ? '正在说话，松开结束' : '按住说话'}
                </button>
              )}

              <div className="voice-peer-summary">
                <span>语音成员 {peers.length + 1}/5</span>
                {peers.length === 0 ? <span>等待其他玩家加入</span> : null}
              </div>
              {peers.length > 0 ? (
                <ul className="voice-peer-list">
                  {peers.map((peer) => (
                    <li key={peer.id}>
                      <span className="voice-peer-dot" aria-hidden="true" />
                      <span>{peer.name}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {audioBlocked ? (
                <button
                  className="voice-recovery-button"
                  type="button"
                  onClick={unlockRemoteAudio}
                >
                  点击播放其他玩家的语音
                </button>
              ) : null}
              <button
                className="voice-leave-button"
                type="button"
                onClick={() => {
                  disconnect();
                  collapsePanel();
                  showVoiceToast('已退出语音');
                }}
              >
                退出语音
              </button>
            </>
          )}

          {errorMessage ? (
            <p className="voice-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
      )}

      <div className="voice-audio-elements" aria-hidden="true">
        {peers.map((peer) => (
          <audio
            key={peer.id}
            autoPlay
            playsInline
            ref={(node) => {
              if (node) audioElementsRef.current.set(peer.id, node);
              else audioElementsRef.current.delete(peer.id);
            }}
          />
        ))}
      </div>
      {createPortal(
        <div className="voice-toast" role="status">
          {toast}
        </div>,
        document.body,
      )}
    </section>
  );
}

export default VoicePanel;
