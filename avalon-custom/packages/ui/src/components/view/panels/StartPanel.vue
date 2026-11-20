<template>
  <div
    v-if="roomState.ai?.publicBotGame && roomState.ai.status === 'stopped' && roomState.stage !== 'started'"
    class="bot-start-panel"
  >
    <p role="status">{{ $t('aiArena.setupExpired') }}</p>
    <v-btn :to="lobbyPath" color="primary">{{ $t('room.backToLobby') }}</v-btn>
  </div>
  <div v-else-if="roomState.ai?.publicBotGame && roomState.ai.status === 'ready'" class="bot-start-panel">
    <v-btn v-if="roomState.ai.withFriend && isUserLeader" color="info" class="mb-2" @click="onCopyClick">
      {{ $t('startPanel.copyLink') }}
    </v-btn>
    <v-btn
      v-if="isUserLeader && friendID"
      class="mb-2"
      variant="outlined"
      prepend-icon="close"
      data-kick-friend
      @click="onKickFriend"
    >
      {{ $t('aiArena.setupRemovePlayer') }}
    </v-btn>
    <BotGameChoices
      v-if="isUserLeader"
      :roomID="roomState.roomID"
      :title="roomState.ai.title"
      :expires-at="roomState.ai.launchExpiresAt"
      :beginner="roomState.ai.beginner"
      :with-friend="roomState.ai.withFriend"
      :human-count="roomState.ai.humanPlayerIDs?.length ?? 1"
      :human-seats="roomState.ai.humanSeats"
      :difficulty="roomState.ai.preparedDifficulty"
      :language="roomState.ai.language"
      :player-count="roomState.ai.playerCount"
    />
    <template v-else>
      <h2>{{ roomState.ai.title }}</h2>
      <p>{{ $t('aiArena.ready') }}</p>
      <v-btn
        v-if="
          roomState.ai.withFriend &&
          (isUserInGame || (roomState.ai.humanPlayerIDs?.length ?? 1) < (roomState.ai.humanSeats ?? 2))
        "
        color="info"
        @click="onJoinClick"
        >{{ $t(isUserInGame ? 'startPanel.leaveGame' : 'startPanel.joinGame') }}</v-btn
      >
    </template>
  </div>
  <template v-else-if="!roomState.ai">
    <v-btn color="info" class="mb-4" @click="onCopyClick">
      <template v-slot:prepend>
        <span class="material-icons"> share </span>
      </template>
      {{ $t('startPanel.copyLink') }}
    </v-btn>
    <p v-if="roomState.stage === 'created'" class="seat-help" role="status">
      {{ $t('startPanel.seatHelp') }}
    </p>
    <v-btn
      v-if="isUserInGame"
      color="warning"
      :loading="seatAction === 'leave'"
      :disabled="seatDisabled"
      @click="onJoinClick"
    >
      {{ $t(seatAction === 'leave' ? 'startPanel.leavingSeat' : 'startPanel.leaveGame') }}
    </v-btn>
    <v-btn
      v-else-if="roomState.players.length < 10"
      color="info"
      :disabled="roomState.stage !== 'created' || seatDisabled"
      :loading="seatAction === 'join'"
      @click="onJoinClick"
    >
      {{ $t(seatAction === 'join' ? 'startPanel.joiningSeat' : 'startPanel.joinGame') }}
    </v-btn>
    <div v-if="isUserLeader" class="lobby-host-actions">
      <v-btn color="info" class="lobby-lock" @click="onLockClick">
        <template #prepend
          ><span class="material-icons" aria-hidden="true">{{
            roomState.stage === 'locked' ? 'lock_open' : 'lock'
          }}</span></template
        >
        {{ $t(roomState.stage === 'locked' ? 'startPanel.unlockGame' : 'startPanel.lockGame') }}
      </v-btn>
      <v-btn class="lobby-start" color="success" :disabled="isStartGameDisabled" @click="onStartClick">
        <template #prepend><span class="material-icons" aria-hidden="true">play_arrow</span></template>
        {{ $t('startPanel.startGame') }}
      </v-btn>
      <p class="lobby-start-hint" role="status">{{ $t(startHint) }}</p>
      <HostPanel :roomState="roomState" />
    </div>
  </template>
</template>

<script lang="ts">
import { localizedPath, neutralRoomUrl } from '@/router/paths';
import { defineComponent, computed, PropType, toRefs } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStore } from '@/store';
import { TPageRoomState } from '@/helpers/game-state-manager';
import { socket } from '@/api/socket';
import eventBus from '@/helpers/event-bus';
import HostPanel from './HostPanel.vue';
import BotGameChoices from '@/components/view/board/modules/BotGameChoices.vue';

export default defineComponent({
  name: 'StartPanel',
  emits: { 'change-seat': (action: 'join' | 'leave') => action === 'join' || action === 'leave' },
  components: { HostPanel, BotGameChoices },
  props: {
    roomState: {
      type: Object as PropType<TPageRoomState>,
      required: true,
    },
    seatAction: [Number, String] as PropType<number | 'join' | 'leave'>,
    seatDisabled: Boolean,
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n();
    const lobbyPath = computed(() => localizedPath('/', locale.value));
    const { roomState } = toRefs(props);
    const store = useStore();
    const isUserInGame = computed(() => {
      return roomState.value.players.some((player) => player.id === store.state.profile?.id);
    });

    const isUserLeader = computed(() => {
      return roomState.value.leaderID === store.state.profile?.id;
    });
    const friendID = computed(() =>
      roomState.value.ai?.withFriend
        ? roomState.value.ai.humanPlayerIDs?.find((id) => id !== roomState.value.leaderID)
        : undefined,
    );
    const onKickFriend = () => {
      if (isUserLeader.value && roomState.value.ai?.status === 'ready' && friendID.value)
        socket.emit('kickPlayer', roomState.value.roomID, friendID.value);
    };

    const isStartGameDisabled = computed(() => {
      return (
        roomState.value.stage !== 'locked' ||
        roomState.value.players.length < 5 ||
        roomState.value.players.length > 10 ||
        Boolean(
          roomState.value.options?.addons?.trapper &&
          (roomState.value.players.length < 8 || roomState.value.options?.addons?.plotCards),
        )
      );
    });

    const onJoinClick = () => {
      if (!store.state.profile) {
        eventBus.emit(
          'openAuthModal',
          () => {
            if (!isUserInGame.value) onJoinClick();
          },
          'join_room',
        );
        return;
      }

      const action = isUserInGame.value ? 'leave' : 'join';
      if (roomState.value.ai) {
        socket.emit(action === 'leave' ? 'leaveGame' : 'joinGame', roomState.value.roomID);
        return;
      }
      emit('change-seat', action);
    };

    const startHint = computed(() =>
      roomState.value.options?.addons?.trapper &&
      (roomState.value.players.length < 8 || roomState.value.options?.addons?.plotCards)
        ? 'trapper.requirements'
        : roomState.value.players.length < 5 || roomState.value.players.length > 10
          ? 'hostMenu.needPlayers'
          : roomState.value.stage !== 'locked'
            ? 'hostMenu.lockBeforeStart'
            : 'hostMenu.ready',
    );
    const onLockClick = () => {
      if (isUserLeader.value && roomState.value.stage !== 'started') socket.emit('lockRoom', roomState.value.roomID);
    };
    const onStartClick = () => {
      if (!isUserLeader.value || isStartGameDisabled.value) return;
      // The opening rules are edited in the host Options panel and persisted
      // through updateOptions. Starting must use that saved room configuration.
      socket.emit('startGame', roomState.value.roomID);
    };

    const onCopyClick = () => {
      navigator.clipboard.writeText(neutralRoomUrl(window.location.href));
      eventBus.emit('infoMessage', t('infoMessage.linkCopied'));
    };

    return {
      lobbyPath,
      roomState,

      isUserInGame,
      isUserLeader,
      friendID,
      onKickFriend,
      isStartGameDisabled,

      onJoinClick,
      onStartClick,
      onLockClick,
      startHint,
      onCopyClick,
    };
  },
});
</script>

<style scoped lang="scss">
.bot-start-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.lobby-host-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.lobby-start-hint {
  max-width: 240px;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
  margin: 0;
}
.seat-help {
  max-width: 240px;
  margin: -4px 0 12px;
  color: rgb(var(--v-theme-text-secondary));
  font-size: 12px;
  line-height: 1.45;
  text-align: center;
}
</style>
