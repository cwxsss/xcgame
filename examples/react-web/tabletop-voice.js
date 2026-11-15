import { createHmac } from 'node:crypto';

const VOICE_NAMESPACE = '/tabletop-voice';
const MAX_SEATS = 5;
const MAX_SDP_LENGTH = 200000;
const MAX_CANDIDATE_LENGTH = 12000;
const MAX_NAME_LENGTH = 120;

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const splitUrls = (value) =>
  String(value || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

const validToken = (value, max = 128) =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const roomKey = (gameName, matchID) => `${gameName}:${matchID}`;

/**
 * Build the ICE configuration without ever returning TABLETOP_TURN_SECRET.
 * Coturn's REST credentials are scoped to voice and unique per connection.
 */
const getIceServers = (socketID) => {
  const turnUrls = splitUrls(process.env.TABLETOP_TURN_URLS);
  const stunUrls = splitUrls(process.env.TABLETOP_STUN_URLS);
  const servers = [];

  if (turnUrls.length > 0) {
    const secret = process.env.TABLETOP_TURN_SECRET;
    if (secret) {
      const username = `${Math.floor(Date.now() / 1000) + 14400}:${socketID}`;
      const credential = createHmac('sha1', secret)
        .update(username)
        .digest('base64');
      servers.push({ urls: turnUrls, username, credential });
    } else {
      // A TURN URL without a secret is useful for deployments that use static
      // credentials, but static credentials must be supplied by the operator.
      const username = process.env.TABLETOP_TURN_USERNAME;
      const credential = process.env.TABLETOP_TURN_CREDENTIAL;
      if (username && credential) {
        servers.push({ urls: turnUrls, username, credential });
      }
    }
  }

  if (stunUrls.length > 0) servers.push({ urls: stunUrls });
  return servers;
};

const normalizeDescription = (description) => {
  if (description == null) return undefined;
  if (!isRecord(description)) return null;
  const { type, sdp } = description;
  if (!['offer', 'answer', 'pranswer', 'rollback'].includes(type)) return null;
  if (typeof sdp !== 'string' || sdp.length > MAX_SDP_LENGTH) return null;
  return { type, sdp };
};

const normalizeCandidate = (candidate) => {
  if (candidate == null) return undefined;
  if (!isRecord(candidate)) return null;
  const result = {};
  if (candidate.candidate !== undefined) {
    if (
      typeof candidate.candidate !== 'string' ||
      candidate.candidate.length > MAX_CANDIDATE_LENGTH
    )
      return null;
    result.candidate = candidate.candidate;
  }
  if (candidate.sdpMid !== undefined) {
    if (candidate.sdpMid !== null && !validToken(candidate.sdpMid, 256))
      return null;
    result.sdpMid = candidate.sdpMid;
  }
  if (candidate.sdpMLineIndex !== undefined) {
    if (
      candidate.sdpMLineIndex !== null &&
      (!Number.isInteger(candidate.sdpMLineIndex) ||
        candidate.sdpMLineIndex < 0)
    )
      return null;
    result.sdpMLineIndex = candidate.sdpMLineIndex;
  }
  if (candidate.usernameFragment !== undefined) {
    if (
      candidate.usernameFragment !== null &&
      !validToken(candidate.usernameFragment, 256)
    )
      return null;
    result.usernameFragment = candidate.usernameFragment;
  }
  return result;
};

/**
 * Register the isolated Socket.IO namespace used by the tabletop WebRTC mesh.
 * The caller must pass the same Socket.IO server and storage instance used by
 * the boardgame.io server. No game state or credentials are persisted here.
 */
export function registerTabletopVoice(io, db) {
  if (!io || typeof io.of !== 'function')
    throw new TypeError('A Socket.IO server is required');
  if (!db || typeof db.fetch !== 'function')
    throw new TypeError('A boardgame.io storage API is required');

  const namespace = io.of(VOICE_NAMESPACE);
  const rooms = new Map();

  const peersFor = (room, excludeSocketID) =>
    [...room.values()]
      .filter(({ socket }) => socket.id !== excludeSocketID)
      .map(({ socket, name }) => ({ id: socket.id, name }));

  const broadcastPeers = (key) => {
    const room = rooms.get(key);
    if (!room) return;
    for (const { socket } of room.values()) {
      socket.emit('voice-peers', peersFor(room, socket.id));
    }
  };

  namespace.use(async (socket, next) => {
    const auth = socket.handshake?.auth || {};
    const { gameName, matchID, playerID, credentials } = auth;
    if (
      !validToken(gameName, 64) ||
      !validToken(matchID, 128) ||
      !validToken(playerID, 32) ||
      !validToken(credentials, 512)
    ) {
      return next(new Error('Invalid tabletop voice credentials'));
    }

    try {
      const result = await db.fetch(matchID, { metadata: true });
      const metadata = result?.metadata;
      const seat = metadata?.players?.[playerID];
      if (
        !metadata ||
        metadata.gameName !== gameName ||
        !seat ||
        typeof seat.credentials !== 'string' ||
        seat.credentials !== credentials
      ) {
        return next(new Error('Unauthorized tabletop voice room'));
      }

      socket.data.voice = {
        gameName,
        matchID,
        playerID,
        name:
          typeof seat.name === 'string'
            ? seat.name.slice(0, MAX_NAME_LENGTH)
            : `玩家${playerID}`,
      };
      return next();
    } catch {
      return next(new Error('Unable to validate tabletop voice room'));
    }
  });

  namespace.on('connection', (socket) => {
    const identity = socket.data.voice;
    if (!identity) return socket.disconnect();
    const key = roomKey(identity.gameName, identity.matchID);
    let room = rooms.get(key);
    if (!room) {
      room = new Map();
      rooms.set(key, room);
    }

    // A reconnecting seat replaces its stale socket; it never counts twice.
    const previous = room.get(identity.playerID);
    if (!previous && room.size >= MAX_SEATS) {
      socket.emit('voice-error', { code: 'ROOM_FULL' });
      return socket.disconnect();
    }

    room.set(identity.playerID, { socket, name: identity.name });
    previous?.socket.disconnect();
    socket.emit('voice-ice', getIceServers(socket.id));
    broadcastPeers(key);

    socket.on('voice-signal', (payload) => {
      if (!isRecord(payload) || !validToken(payload.to, 128)) return;
      const targetEntry = [...room.values()].find(
        ({ socket: candidate }) => candidate.id === payload.to,
      );
      if (!targetEntry) return;
      const description = normalizeDescription(payload.description);
      const candidate = normalizeCandidate(payload.candidate);
      if (payload.description != null && description === null) return;
      if (payload.candidate != null && candidate === null) return;
      if (description === undefined && candidate === undefined) return;
      targetEntry.socket.emit('voice-signal', {
        from: socket.id,
        ...(description === undefined ? {} : { description }),
        ...(candidate === undefined ? {} : { candidate }),
      });
    });

    let audioBudget = 40;
    let lastAudio = Date.now();
    socket.on('voice-audio', (payload) => {
      if (!isRecord(payload)) return;
      const { targets, frame } = payload;
      if (
        !Array.isArray(targets) ||
        targets.length > MAX_SEATS - 1 ||
        !Buffer.isBuffer(frame) ||
        frame.length !== 320
      )
        return;
      const now = Date.now();
      audioBudget = Math.min(40, audioBudget + (now - lastAudio) * 0.035);
      lastAudio = now;
      if (audioBudget < 1) return;
      audioBudget--;
      for (const { socket: target } of room.values()) {
        if (target !== socket && targets.includes(target.id))
          target.volatile.emit('voice-audio', { from: socket.id, frame });
      }
    });

    socket.on('disconnect', () => {
      const current = rooms.get(key);
      if (!current || current.get(identity.playerID)?.socket !== socket) return;
      current.delete(identity.playerID);
      if (current.size === 0) rooms.delete(key);
      else broadcastPeers(key);
    });
  });

  return {
    namespace,
    close() {
      namespace.disconnectSockets();
      rooms.clear();
    },
  };
}

export default registerTabletopVoice;
