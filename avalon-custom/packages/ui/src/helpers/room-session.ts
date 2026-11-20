import type { ChatMessage, ISocketError, Socket, TRoomState, VisualGameState } from '@avalon/types';

const joinTimeout = 6000;
const joinBackoff = [500, 1000];

/** Keep a room subscribed across reconnects and live-to-archive transitions. */
export function createRoomSession(
  socket: Pick<Socket, 'on' | 'off' | 'timeout'>,
  roomID: () => string,
  receive: (state: TRoomState, source: 'snapshot' | 'update') => void,
  onError: (error: ISocketError) => void,
  onExpiredMissing: () => void,
  receiveChat: (messages: ChatMessage[]) => void,
  receiveGame?: (game: VisualGameState) => void,
  onLoadingChange?: (loading: boolean) => void,
) {
  let generation = 0;
  let loading = false;
  let buffered: TRoomState | undefined;
  let latestGame: VisualGameState | undefined;
  let disposed = false;
  const syncBoard = (state: TRoomState): TRoomState => {
    if (state.stage !== 'started' || state.archived || !state.game) return state;
    if (
      latestGame?.uuid === state.roomID &&
      latestGame.revision !== undefined &&
      state.game.revision !== undefined &&
      latestGame.revision > state.game.revision
    ) return { ...state, game: latestGame };
    latestGame = state.game;
    return state;
  };
  const gameUpdated = (game: VisualGameState) => {
    if (game.uuid !== roomID() || disposed) return;
    if (
      latestGame?.uuid === game.uuid && latestGame.revision !== undefined &&
      game.revision !== undefined && game.revision <= latestGame.revision
    ) return;
    latestGame = game;
    if (!loading) receiveGame?.(game);
  };
  const load = async (id: string, expired = false) => {
    if (disposed) return;
    const current = ++generation;
    const isCurrent = () => !disposed && current === generation && id === roomID();
    loading = true;
    onLoadingChange?.(true);
    buffered = undefined;
    latestGame = undefined;
    try {
      let state;
      for (let attempt = 0; isCurrent(); attempt++) {
        try {
          state = await socket.timeout(joinTimeout).emitWithAck('joinRoom', id);
          break;
        } catch (error) {
          if (!isCurrent()) return;
          const wait = joinBackoff[attempt];
          if (wait === undefined) throw error;
          await new Promise<void>((resolve) => setTimeout(resolve, wait));
        }
      }
      if (!isCurrent() || !state) return;
      if ('error' in state) {
        if (expired && state.error === 'errorNotFound') onExpiredMissing();
        else onError(state);
      } else {
        // A broadcast can arrive between subscription and the join acknowledgement.
        const update = buffered as TRoomState | undefined;
        const chat = update
          ? [
              ...new Map(
                [...state.chat, ...update.chat].map((entry) => [entry.id || JSON.stringify(entry), entry]),
              ).values(),
            ]
              .sort((a, b) => a.timestamp - b.timestamp)
              .slice(-1000)
          : state.chat;
        receive(syncBoard({ ...state, chat }), 'snapshot');
      }
    } catch {
      if (isCurrent()) onError({ error: 'requestFailed' });
    } finally {
      if (current === generation) {
        loading = false;
        buffered = undefined;
        onLoadingChange?.(false);
      }
    }
  };
  const updated = (state: TRoomState, chatOnly = false) => {
    if (state.roomID !== roomID()) return;
    if (loading) {
      buffered = state;
      if (state.stage === 'started' && !state.archived && state.game) gameUpdated(state.game);
    } else if (chatOnly) receiveChat(state.chat);
    else receive(syncBoard(state), 'update');
  };
  const reconnect = () => load(roomID());
  const expired = (id: string) => (id === roomID() ? load(id, true) : Promise.resolve());
  socket.on('roomUpdated', updated);
  socket.on('gameUpdated', gameUpdated);
  socket.on('connect', reconnect);
  socket.on('destroyRoom', expired);
  return {
    load,
    isLoading: () => loading,
    dispose() {
      disposed = true;
      loading = false;
      generation++;
      socket.off('roomUpdated', updated);
      socket.off('gameUpdated', gameUpdated);
      socket.off('connect', reconnect);
      socket.off('destroyRoom', expired);
    },
  };
}
