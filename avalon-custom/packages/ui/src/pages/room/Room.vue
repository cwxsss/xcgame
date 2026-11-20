<template>
  <div class="room d-flex align-center justify-space-around">
    <span class="online">{{ $t('mainPage.online', { count: online }) }}</span>
    <div v-if="errorMessage" class="room-connection-actions">
      <h1>{{ $t(errorMessage.error === 'errorNotFound' ? 'room.errorNotFound' : 'room.connectionFailed') }}</h1>
      <v-btn v-if="errorMessage.error !== 'errorNotFound'" :loading="loadingRoom" color="primary" @click="refreshRoom">
        {{ $t('room.reconnect') }}
      </v-btn>
      <LocaleLink :to="{ name: 'lobby' }"><v-btn variant="text">{{ $t('room.backToLobby') }}</v-btn></LocaleLink>
    </div>
    <template v-else-if="roomState?.roomID === uuid">
      <p v-if="loadingRoom" class="room-reconnecting" role="status">{{ $t('room.reconnecting') }}</p>
      <BeginnerTips
        v-if="
          tipsSession.available &&
          roomState.stage === 'started' &&
          roomState.game.stage !== 'end' &&
          (!compactViewport || !chatOpen)
        "
        :game="roomState.game"
        :ai="roomState.ai"
        :userID="userID"
        :live="stateManager.viewMode.value === 'live'"
        :spoilers-hidden="$store.state.hideSpoilers"
      />
      <BeginnerReview
        v-if="tipsSession.available && roomState.ai && roomState.stage === 'started' && roomState.game.stage === 'end'"
        v-show="
          !assassinationActive &&
          (!chatOpen || reviewBesideChat) &&
          !$store.state.hideSpoilers &&
          stateManager.viewMode.value === 'live'
        "
        :key="roomState.game.uuid"
        :roomID="roomState.roomID"
        :game="roomState.game"
        :ai="roomState.ai"
        :userID="userID"
      />
      <AiRoomPanel
        v-if="roomState.ai && !(roomState.ai.publicBotGame && roomState.ai.status === 'ready')"
        class="ai-room-status"
        :ai="roomState.ai"
        :roomID="roomState.roomID"
        :player-count="roomState.players.length"
        :is-human-player="!!userID && (roomState.ai?.humanPlayerIDs ?? [roomState.ai?.humanPlayerID]).includes(userID)"
        :is-discussion-player="(roomState.ai?.discussionPlayerID ?? roomState.ai?.humanPlayerID) === userID"
        :canReveal="canRevealRoles"
        :canJoin="canJoinAi"
        :rolesShown="rolesShown"
        @roles="spectatorRoles = $event"
        @decisions="spectatorDecisions = $event"
      />
      <Board
        :key="uuid"
        :room-state="roomState"
        :room-sync-pending="loadingRoom"
        :spectator-roles="rolesShown ? spectatorRoles : {}"
        :spectator-decisions="rolesShown ? spectatorDecisions : []"
        @assassination-active="assassinationActive = $event"
        @refresh-room="refreshRoom"
      >
        <template v-if="roomState.vote" v-slot:content>
          <RoomVote v-if="roomState.vote" :roomUuid="roomState.roomID" :vote="roomState.vote" />
        </template>
        <template v-slot:restart>
          <div class="d-flex flex-column align-center">
            <v-btn
              v-if="roomState.nextRoomID && stateManager.viewMode.value === 'live' && !assassinationActive"
              :to="{ name: 'room', params: { uuid: roomState.nextRoomID } }"
              color="primary"
              class="restart-button"
            >{{ $t('room.goToNextGame') }}</v-btn>
            <BotRematchButton
              v-if="
                roomState.ai &&
                roomState.stage === 'started' &&
                roomState.game.stage === 'end' &&
                stateManager.viewMode.value === 'live' &&
                !assassinationActive
              "
              :key="roomState.roomID"
              :room="roomState"
            />
            <v-btn color="primary" v-if="displayRestartButton" @click="restartGame" class="restart-button">{{
              $t('room.restartGame')
            }}</v-btn>
          </div>
        </template>
      </Board>
      <div class="info-container">
        <div class="room-side-tools">
          <RolesInfo
            v-if="roomState.stage === 'started'"
            :game-roles="game.settings.roles"
            :visible-roles="visibleRoles"
          />
          <HostPanel
            v-if="displayHostPanel && roomState.stage === 'started'"
            :roomState="roomState"
            :gameEnded="game.stage === 'end'"
          />
        </div>
        <CardsInfo
          v-if="roomState.stage === 'started' && game.addonsData.plotCards"
          :data="game.addonsData.plotCards.cardsState"
        />
      </div>
      <Chat v-model:open="chatOpen" :messages="roomState.chat" :roomUuid="roomState.roomID" :seats="chatSeats">
        <template #guidance>
          <BeginnerTips
            v-if="
              compactViewport &&
              chatOpen &&
              tipsSession.available &&
              roomState.stage === 'started' &&
              roomState.game.stage !== 'end'
            "
            :game="roomState.game"
            :ai="roomState.ai"
            :userID="userID"
            :live="stateManager.viewMode.value === 'live'"
            :spoilers-hidden="$store.state.hideSpoilers"
            embedded
          />
        </template>
        <template v-if="!roomState.ai?.beginner" #stickers>
          <StickerPicker :roomID="roomState.roomID" @hide-on-board="hideStickers = $event" />
        </template>
      </Chat>
      <VoicePanel
        v-if="userID && !roomState.archived && !roomState.ai?.beginner"
        :roomUuid="uuid"
        :seatIds="roomState.players.map((player) => player.id).join(',')"
      >
        <template #tools><PlaygroundLauncher :turn-active="playgroundTurnActive" /></template>
      </VoicePanel>
      <div v-else class="room-playground-dock"><PlaygroundLauncher :turn-active="playgroundTurnActive" /></div>
    </template>
    <p v-else role="status">{{ $t('mainPage.loading') }}</p>
  </div>
</template>

<script lang="ts">
import { localizedPath } from '@/router/paths';
import { i18n } from '@/plugins/i18n';
import { useRouter } from 'vue-router';
import { defineComponent, ref, computed, watch, provide, shallowRef, onUnmounted } from 'vue';
import { createRoomSession } from '@/helpers/room-session';
import { trackRoomAcquisition } from '@/helpers/acquisition';
import Board from '@/components/view/board/Board.vue';
import type { TVisibleRole, AiSpectatorDecision, TRoles, ISocketError } from '@avalon/types';
import { socket } from '@/api/socket';
import { useStore } from '@/store';
import { GameStateManager } from '@/helpers/game-state-manager';
import RolesInfo from '@/components/view/information/RolesInfo.vue';
import CardsInfo from '@/components/view/information/CardsInfo.vue';
import AiRoomPanel from '@/components/view/panels/AiRoomPanel.vue';
import HostPanel from '@/components/view/panels/HostPanel.vue';
import RoomVote from '@/components/view/panels/RoomVote.vue';
import StickerPicker from '@/components/stickers/StickerPicker.vue';
import { roomChatKey } from '@/helpers/room-chat-context';
import { useRoomStickers } from '@/helpers/composables/useRoomStickers';
import Chat from '@/components/feedback/Chat.vue';
import { roomVoiceKey } from '@/helpers/room-voice-context';
import type { createRoomVoice } from '@/helpers/composables/useRoomVoice';
import VoicePanel from '@/components/voice/VoicePanel.vue';
import PlaygroundLauncher from '@/components/playground/PlaygroundLauncher.vue';
import { useWindowSize } from '@vueuse/core';
import BeginnerReview from '@/components/view/information/BeginnerReview.vue';
import BotRematchButton from '@/components/view/board/modules/BotRematchButton.vue';
import BeginnerTips from '@/components/view/information/BeginnerTips.vue';
import { beginnerTipsSession as tipsSession, startBeginnerTips } from '@/helpers/beginner-tips-session';

export default defineComponent({
  name: 'Room',
  components: {
    BeginnerTips,
    BeginnerReview,
    BotRematchButton,
    Board,
    AiRoomPanel,
    RolesInfo,
    CardsInfo,
    HostPanel,
    RoomVote,
    Chat,
    StickerPicker,
    VoicePanel,
    PlaygroundLauncher,
  },
  props: {
    uuid: {
      required: true,
      type: String,
    },
  },
  setup(props) {
    const voiceContext = shallowRef<ReturnType<typeof createRoomVoice>>();
    provide(roomVoiceKey, voiceContext);
    const stateManager = new GameStateManager();
    const { width } = useWindowSize();
    const compactViewport = computed(() => width.value < 960);
    const reviewBesideChat = computed(() => width.value >= 1280);
    const alert = ref<boolean>(true);
    const errorMessage = ref<ISocketError>();
    const loadingRoom = ref(true);
    const store = useStore();
    const router = useRouter();
    const online = ref<number>();
    const userID = computed(() => store.state.profile?.id);

    const roomState = stateManager.state;
    watch(
      () =>
        [
          roomState.value?.roomID,
          userID.value,
          roomState.value?.stage === 'started' &&
            roomState.value.ai?.beginner &&
            roomState.value.game.players.some((p) => p.id === userID.value),
        ] as const,
      ([roomID, id, available]) => startBeginnerTips(roomID || '', id || '', Boolean(available)),
      { immediate: true },
    );
    onUnmounted(() => {
      tipsSession.available = false;
    });
    const hideStickers = ref(false);
    const chatOpen = ref(false);
    provide(roomChatKey, { open: chatOpen, roomID: () => props.uuid });
    watch(
      () => props.uuid,
      () => {
        chatOpen.value = false;
      },
    );
    useRoomStickers(
      () => props.uuid,
      roomState,
      () => hideStickers.value,
    );
    // Read the live room so replaying history cannot hide an action that is due now.
    const playgroundTurnActive = computed(() =>
      Boolean(
        roomState.value?.stage === 'started' &&
        roomState.value.game.players.some((player) => player.id === userID.value && player.features.waitForAction),
      ),
    );
    const game = stateManager.game;
    const assassinationActive = ref(false);
    const spectatorDecisions = ref<AiSpectatorDecision[]>([]);
    const spectatorRoles = ref<Record<string, TRoles>>({});
    const canJoinAi = computed(() =>
      Boolean(
        roomState.value?.leaderID === userID.value &&
        roomState.value?.ai?.status === 'ready' &&
        !roomState.value.ai.humanPlayerID,
      ),
    );
    const canRevealRoles = computed(() =>
      Boolean(
        roomState.value?.ai &&
        !roomState.value.ai.humanPlayerID &&
        roomState.value.stage === 'started' &&
        game.value.stage !== 'end' &&
        !game.value.players.some((p) => p.id === userID.value),
      ),
    );
    const rolesShown = computed(() => canRevealRoles.value && Object.keys(spectatorRoles.value).length > 0);
    watch([() => props.uuid, userID], () => {
      spectatorRoles.value = {};
    });

    const session = createRoomSession(
      socket,
      () => props.uuid,
      (stateFromBackend, source) => {
        errorMessage.value = undefined;
        trackRoomAcquisition(stateFromBackend, userID.value, source === 'update');
        stateManager.mutateRoomState({
          newRoomState: stateFromBackend,
          userID: userID.value,
          isLiveUpdate: source === 'update',
        });
      },
      (error) => {
        errorMessage.value = error;
      },
      () => {
        router.push(localizedPath('/', i18n.global.locale.value));
      },
      (messages) => {
        if (roomState.value?.roomID === props.uuid) roomState.value.chat = messages;
      },
      (game) => {
        if (roomState.value?.stage !== 'started' || roomState.value.archived) return;
        trackRoomAcquisition({ ...roomState.value, game }, userID.value, true);
        stateManager.mutateRoomState({ newGameState: game, userID: userID.value });
      },
      (loading) => {
        loadingRoom.value = loading;
      },
    );
    const initState = session.load;
    const refreshRoom = () => initState(props.uuid);
    onUnmounted(session.dispose);

    const handleRestart = (uuid: string, previousRoomID?: string) => {
      if (previousRoomID && previousRoomID !== props.uuid) return;
      if (userID.value && roomState.value?.players.some((player) => player.id === userID.value)) {
        void router.push({ name: 'room', params: { uuid } });
      } else {
        void refreshRoom();
      }
    };

    const handleOnlineCount = (counter: number) => {
      online.value = counter;
    };
    socket.on('restartGame', handleRestart);
    socket.on('roomOnlineUpdated', handleOnlineCount);
    onUnmounted(() => {
      socket.off('restartGame', handleRestart);
      socket.off('roomOnlineUpdated', handleOnlineCount);
    });

    watch(
      () => props.uuid,
      (newUUID) => {
        errorMessage.value = undefined;
        online.value = undefined;
        initState(newUUID);
      },
    );

    watch(userID, () => {
      initState(props.uuid);
    });

    void refreshRoom();

    const displayHostPanel = computed(() => {
      return !roomState.value.ai && !roomState.value.archived && roomState.value.leaderID === userID.value;
    });

    const displayRestartButton = computed(() => {
      return (
        !roomState.value.ai &&
        !roomState.value.archived &&
        roomState.value.stage === 'started' &&
        game.value.stage === 'end' &&
        roomState.value.leaderID === userID.value
      );
    });

    const restartGame = () => socket.emit('restartGame', roomState.value.roomID);

    const visibleRoles = computed(() => {
      if (roomState.value.stage === 'started') {
        return game.value.players.reduce<TVisibleRole[]>((acc, el) => {
          const role = rolesShown.value ? spectatorRoles.value[el.id] || el.role : el.role;
          if (!acc.includes(role)) {
            acc.push(role);
          }

          return acc;
        }, []);
      }

      return [];
    });

    const chatSeats = computed(() =>
      roomState.value?.stage === 'started' && roomState.value.game.features.displayIndex
        ? Object.fromEntries(roomState.value.game.players.map((player) => [player.id, player.index]))
        : undefined,
    );
    return {
      stateManager,
      playgroundTurnActive,
      tipsSession,
      compactViewport,
      reviewBesideChat,
      chatSeats,
      spectatorRoles,
      spectatorDecisions,
      canRevealRoles,
      canJoinAi,
      rolesShown,
      hideStickers,
      chatOpen,
      roomState,
      errorMessage,
      loadingRoom,
      refreshRoom,
      displayRestartButton,
      displayHostPanel,
      visibleRoles,
      alert,
      game,
      assassinationActive,
      online,
      userID,
      restartGame,
    };
  },

  beforeRouteLeave() {
    socket.emit('leaveRoom', this.$props.uuid);
  },

  beforeRouteUpdate() {
    socket.emit('leaveRoom', this.$props.uuid);
  },
});
</script>

<style lang="scss">
.room-connection-actions {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 16px;
  text-align: center;
}
.room-connection-actions h1 {
  font-size: clamp(1rem, 4vw, 1.5rem);
}
.room-reconnecting {
  position: fixed;
  z-index: 13;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100vw - 32px);
  padding: 6px 12px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 2px 8px #0002;
  font-size: 14px;
  pointer-events: none;
}
.ai-room-status {
  position: fixed;
  top: 65px;
  left: 12px;
  z-index: 12;
  max-width: 330px;
}
@media (max-width: 600px) {
  .ai-room-status {
    top: 55px;
    left: 8px;
    max-width: calc(100vw - 16px);
    font-size: 12px;
  }
}

.room > .online {
  opacity: 30%;
  font-size: large;
  position: fixed;
  top: 60px;
  right: 10px;
}

.game-stage {
  width: 500px;
  background-color: white;
  font-size: 18px;
}

.info-container {
  position: fixed;
  left: 0;
  top: 50%;
  display: flex;
  flex-direction: column;
  gap: 60px;
  transform: translateY(-50%);
}

.info-container > :not(.room-side-tools) {
  transform-origin: left center;
  transform: rotate(90deg) translateX(-50%);
  margin-left: 10px;
}

.restart-button {
  margin-top: 10px;
  z-index: 10;
}

.room {
  width: 100vw;
  height: 100dvh;
  padding-top: 50px;
  box-sizing: border-box;
  overflow: clip;
}
</style>

<style lang="scss">
.room-side-tools {
  margin-left: -8px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.room-side-tools .roles {
  writing-mode: vertical-rl;
  min-width: 44px;
  width: 44px;
  height: 88px;
  padding: 8px 0;
  border-radius: 0 6px 0 0;
}
.room-side-tools .host-trigger--game {
  border-radius: 0 0 6px 0;
  background: rgb(var(--v-theme-info));
  color: white !important;
}
</style>

<style scoped>
.room-playground-dock {
  position: fixed;
  left: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom));
  z-index: 15;
  padding: 4px;
  border: 1px solid rgb(var(--v-theme-surface-border));
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 4px 18px #0002;
}
@media (max-width: 600px) {
  .room-playground-dock {
    left: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom));
  }
}
</style>
