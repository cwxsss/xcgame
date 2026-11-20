<template>
  <main class="lobby">
    <section class="lobby-hero" aria-labelledby="lobby-title">
      <div class="hero-copy">
        <div class="hero-eyebrow">
          <span class="brand-name">AVALON</span>
          <span v-if="online !== undefined" class="online">{{ $t('mainPage.online', { count: online }) }}</span>
        </div>
        <h1 id="lobby-title">{{ $t('mainPage.header') }}</h1>
        <p class="lobby-intro">{{ $t('mainPage.intro') }}</p>
        <div class="lobby-actions">
          <v-btn class="create-room" color="primary" size="large" elevation="0" :loading="creatingRoom"
            :disabled="creatingRoom" @click="createRoom">
            <span class="material-icons" aria-hidden="true">add</span>
            {{ $t('mainPage.createRoom') }}
          </v-btn>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="hero-orbit"></div>
        <div class="character-card character-card--morgana"><span>II</span></div>
        <div class="character-card character-card--merlin"><span>I</span></div>
        <div class="art-caption">{{ $t('mainPage.heroCaption') }}</div>
      </div>
    </section>

    <div class="lobby-content">
      <section class="rooms-panel" aria-labelledby="games-title">
        <div class="rooms-heading">
          <h2 id="games-title">{{ $t('mainPage.gamesList') }}</h2>
          <span v-if="roomsList" class="room-count">{{ roomsList.length }}</span>
          <v-btn
            class="admin-entry"
            variant="text"
            color="#111111"
            size="small"
            prepend-icon="mdi-shield-key-outline"
            @click="openAdminDialog"
          >
            管理员
          </v-btn>
        </div>
        <div class="room-filters" role="group" :aria-label="$t('mainPage.filterLabel')">
          <button
            v-for="item in filters"
            :key="item"
            type="button"
            :aria-pressed="filter === item"
            :class="{ selected: filter === item, 'ai-filter': item === 'ai-games' }"
            @click="filter = item"
          >
            <v-icon v-if="item === 'ai-games'" icon="fa:fa-solid fa-robot" size="18" aria-hidden="true" />
            {{ item === 'ai-games' ? $t('aiArena.filterWithBots') : $t(`mainPage.filter${item}`) }}
            <span v-if="item === 'ai-games' ? aiRooms !== undefined : roomsList">{{ filterCount(item) }}</span>
          </button>
        </div>
        <div v-if="filter !== 'ai-games' && roomsError" class="rooms-message" role="alert">
          <p>{{ $t('errors.' + roomsError) }}</p>
          <button class="reset-filter" @click="initState">{{ $t('mainPage.retryAi') }}</button>
        </div>
        <div v-else-if="filter === 'ai-games' && aiError" class="rooms-message" role="alert">
          <p>{{ $t('aiArena.connectionError') }}</p>
          <button class="reset-filter" @click="loadAiRooms">{{ $t('mainPage.retryAi') }}</button>
        </div>
        <p v-else-if="filter === 'ai-games' ? aiLoading || !aiRooms : !roomsList" class="rooms-message" role="status">
          {{ $t('mainPage.loading') }}
        </p>
        <div v-else-if="!visibleRooms.length" class="rooms-message" role="status">
          <span class="material-icons empty-icon" aria-hidden="true">meeting_room</span>
          <p>{{ $t(filter === 'ai-games' || roomsList?.length ? 'mainPage.noMatchingRooms' : 'mainPage.noRooms') }}</p>
          <button v-if="filter !== 'all'" class="reset-filter" @click="filter = 'all'">
            {{ $t('mainPage.showAll') }}
          </button>
        </div>
        <div v-else class="games-list">
          <div v-for="game in displayedRooms" :key="game.uuid" class="room-list-item">
            <LobbyRoom :game="game" />
            <v-btn
              v-if="adminUnlocked"
              class="room-delete"
              variant="text"
              size="small"
              color="error"
              prepend-icon="mdi-trash-can-outline"
              :loading="deletingRoom === game.uuid"
              :disabled="Boolean(deletingRoom)"
              @click="requestRoomDeletion(game.uuid)"
            >
              删除房间
            </v-btn>
          </div>
          <nav v-if="filter === 'finished' && finishedPageCount > 1" class="finished-pages" :aria-label="$t('mainPage.filterfinished')">
            <v-btn variant="outlined" size="small" :disabled="finishedPage <= 1" @click="finishedPage--">
              {{ $t('mainPage.previousPage') }}
            </v-btn>
            <span aria-live="polite">{{ finishedPage }} / {{ finishedPageCount }}</span>
            <v-btn variant="outlined" size="small" :disabled="finishedPage >= finishedPageCount" @click="finishedPage++">
              {{ $t('mainPage.nextPage') }}
            </v-btn>
          </nav>
          <button v-else-if="filter !== 'finished' && visibleRooms.length > visibleLimit" class="show-more" @click="visibleLimit += 8">
            {{ $t('mainPage.showMore') }} <span aria-hidden="true">↓</span>
          </button>
        </div>
      </section>
    </div>
    <section class="lobby-guide" aria-labelledby="lobby-guide-title">
      <div class="guide-overview">
        <div class="guide-introduction">
          <h2 id="lobby-guide-title">{{ $t('mainPage.newPlayerTitle') }}</h2>
          <p>{{ $t('mainPage.gameplaySummary') }}</p>
          <nav class="lobby-links" :aria-label="$t('menu.wiki')">
            <LocaleLink :to="{ name: 'rules' }">{{ $t('mainPage.rulesLink') }}</LocaleLink>
            <LocaleLink :to="{ name: 'roles' }">{{ $t('wiki.roles') }}</LocaleLink>
          </nav>
        </div>
        <div class="guide-start">
          <h3>{{ $t('mainPage.guideTitle') }}</h3>
          <ol>
            <li>{{ $t('mainPage.guideCreate') }}</li>
            <li>{{ $t('mainPage.guideInvite') }}</li>
            <li>{{ $t('mainPage.guideStart') }}</li>
          </ol>
        </div>
      </div>
      <div class="guide-questions">
        <details v-for="topic in ['cost', 'devices', 'conversation', 'features']" :key="topic" class="guide-question">
          <summary>{{ $t(`mainPage.guide.${topic}Title`) }}</summary>
          <div class="guide-answer">
            <p>{{ $t(`mainPage.guide.${topic}Text`) }}</p>
            <LocaleLink v-if="topic === 'features'" :to="{ name: 'expansions' }">{{
              $t('breadCrumbs.expansions')
            }}</LocaleLink>
          </div>
        </details>
      </div>
    </section>

    <v-dialog v-model="adminDialog" max-width="430">
      <v-card class="admin-dialog">
        <v-card-title class="d-flex align-center justify-space-between">
          <span>管理员模式</span>
          <v-btn icon="mdi-close" variant="text" aria-label="关闭" @click="adminDialog = false" />
        </v-card-title>
        <v-card-text>
          <template v-if="adminUnlocked">
            <div class="admin-status admin-status--success">
              <v-icon icon="mdi-shield-check-outline" />
              <span>管理员权限已启用，可以删除大厅房间。</span>
            </div>
            <p class="admin-help">删除会关闭房间并从大厅移除，已结束对局的历史记录仍会保留。</p>
          </template>
          <template v-else>
            <p class="admin-help">输入管理员密码后，可以删除大厅中的测试房间。</p>
            <v-text-field
              v-model="adminPassword"
              label="管理员密码"
              type="password"
              autocomplete="current-password"
              variant="outlined"
              density="comfortable"
              autofocus
              :error-messages="adminError ? [adminError] : []"
              @keyup.enter="unlockAdmin"
            />
          </template>
        </v-card-text>
        <v-card-actions class="admin-actions">
          <v-btn variant="text" @click="adminDialog = false">取消</v-btn>
          <v-btn v-if="!adminUnlocked" color="primary" :loading="adminLoading" @click="unlockAdmin">验证密码</v-btn>
          <v-btn v-else color="error" variant="tonal" @click="lockAdmin">退出管理员</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="430">
      <v-card>
        <v-card-title>删除房间？</v-card-title>
        <v-card-text>房间会立即关闭并从大厅移除。已经结束的对局记录仍然保留。</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">取消</v-btn>
          <v-btn color="error" :loading="Boolean(deletingRoom)" @click="deleteRoom">确认删除</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<script lang="ts">
import { computed, defineComponent, ref, onBeforeUnmount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useStore } from '@/store';
import type { TRoomsList } from '@avalon/types';
import { socket } from '@/api/socket';
import { isSocketError } from '@/helpers/socket-errors';
import eventBus from '@/helpers/event-bus';
import LobbyRoom from './LobbyRoom.vue';

export default defineComponent({
  components: {
    LobbyRoom,
  },
  setup() {
    const { t } = useI18n();
    const router = useRouter();
    const store = useStore();

    const roomsList = ref<TRoomsList>();
    const roomsError = ref('');
    const aiRooms = ref<TRoomsList>();
    const aiLoading = ref(false);
    const aiError = ref(false);
    const adminDialog = ref(false);
    const adminPassword = ref('');
    const adminError = ref('');
    const adminLoading = ref(false);
    const adminUnlocked = ref(false);
    const deleteDialog = ref(false);
    const roomToDelete = ref<string>();
    const deletingRoom = ref<string>();
    const creatingRoom = ref(false);
    let pendingCreate: { key: string; request: { id: string; expiresAt: number } } | undefined;
    let aiRefreshPending = false;
    const loadAiRooms = async () => {
      if (aiLoading.value) {
        aiRefreshPending = true;
        return;
      }
      aiLoading.value = true;
      aiError.value = false;
      try {
        const result = await socket.timeout(10000).emitWithAck('getAiRoomsList');
        if ('error' in result) throw new Error(result.error);
        aiRooms.value = result.rooms;
      } catch {
        aiError.value = true;
      } finally {
        aiLoading.value = false;
        if (aiRefreshPending) {
          aiRefreshPending = false;
          if (filter.value === 'ai-games') void loadAiRooms();
        }
      }
    };
    const online = ref<number>();

    const initState = async () => {
      roomsError.value = '';
      try {
        const data = await socket.timeout(10000).emitWithAck('getRoomsList');
        if (isSocketError(data)) {
          roomsError.value = data.error;
          return;
        }
        roomsList.value = data;
      } catch {
        roomsError.value = 'requestFailed';
      }
    };

    const refreshAdminStatus = async () => {
      try {
        const result = await socket.timeout(10000).emitWithAck('getRoomAdminStatus');
        adminUnlocked.value = result === true;
      } catch {
        adminUnlocked.value = false;
      }
    };

    const openAdminDialog = () => {
      if (!store.state.profile) {
        eventBus.emit('openAuthModal', openAdminDialog);
        return;
      }
      adminError.value = '';
      adminPassword.value = '';
      adminDialog.value = true;
      void refreshAdminStatus();
    };

    const unlockAdmin = async () => {
      if (!adminPassword.value.trim() || adminLoading.value) return;
      adminLoading.value = true;
      adminError.value = '';
      try {
        const result = await socket.timeout(10000).emitWithAck('unlockRoomAdmin', adminPassword.value);
        if (result === true) {
          adminUnlocked.value = true;
          adminPassword.value = '';
          adminDialog.value = false;
          eventBus.emit('infoMessage', '管理员权限已启用');
        } else {
          adminError.value = isSocketError(result) ? '管理员密码错误或已失效' : '管理员密码错误';
        }
      } catch {
        adminError.value = '验证失败，请稍后重试';
      } finally {
        adminLoading.value = false;
      }
    };

    const lockAdmin = async () => {
      try {
        if (await socket.timeout(10000).emitWithAck('lockRoomAdmin') !== true) throw Error();
        adminUnlocked.value = false;
        adminDialog.value = false;
      } catch {
        eventBus.emit('infoMessage', '退出管理员失败，请稍后重试');
      }
    };

    const requestRoomDeletion = (uuid: string) => {
      roomToDelete.value = uuid;
      deleteDialog.value = true;
    };

    const deleteRoom = async () => {
      if (!roomToDelete.value || deletingRoom.value) return;
      const uuid = roomToDelete.value;
      deletingRoom.value = uuid;
      try {
        const result = await socket.timeout(10000).emitWithAck('deleteLobbyRoom', uuid);
        if (result === true) {
          roomsList.value = roomsList.value?.filter((room) => room.uuid !== uuid);
          aiRooms.value = aiRooms.value?.filter((room) => room.uuid !== uuid);
          deleteDialog.value = false;
          roomToDelete.value = undefined;
          eventBus.emit('infoMessage', '房间已删除');
        } else if (isSocketError(result)) {
          eventBus.emit('infoMessage', result.error === 'forbidden' ? '管理员权限已失效' : '删除房间失败');
          if (result.error === 'forbidden') adminUnlocked.value = false;
        } else {
          deleteDialog.value = false;
          eventBus.emit('infoMessage', '该房间已不在大厅');
          void initState();
        }
      } catch {
        eventBus.emit('infoMessage', '删除房间失败，请稍后重试');
      } finally {
        deletingRoom.value = undefined;
      }
    };

    const createRoom = async () => {
      if (creatingRoom.value) return;
      const userID = store.state.profile?.id;
      if (!userID) {
        eventBus.emit('openAuthModal', createRoom);
        return;
      }

      creatingRoom.value = true;
      try {
        const key = `avalon-pending-room:${userID}`;
        let pending = pendingCreate?.key === key ? pendingCreate.request : undefined;
        if (!pending) {
          try {
            pending = JSON.parse(sessionStorage.getItem(key) || 'null') ?? undefined;
          } catch {
            // The in-memory request also survives retries without web storage.
          }
        }
        if (typeof pending?.id !== 'string' || typeof pending.expiresAt !== 'number' || pending.expiresAt <= Date.now()) {
          pending = { id: crypto.randomUUID(), expiresAt: Date.now() + 10 * 60000 };
          try { sessionStorage.setItem(key, JSON.stringify(pending)); } catch { /* Optional storage. */ }
        }
        pendingCreate = { key, request: pending };
        const clearPendingCreate = () => {
          pendingCreate = undefined;
          try { sessionStorage.removeItem(key); } catch { /* Optional storage. */ }
        };
        const result = await socket.timeout(10000).emitWithAck('createRoomOnce', pending.id);
        if (typeof result !== 'string') {
          if (result.error === 'errorNotFound' || result.error === 'invalidRequest') clearPendingCreate();
          eventBus.emit('infoMessage', t(result.error === 'errorNotFound' ? 'room.errorNotFound' : 'errors.' + result.error));
          return;
        }
        // Keep the room creation flow in one place: the owner lands in the
        // pre-game options sheet where custom rules and optional bot seats can
        // be configured before inviting friends or locking the table.
        await router.push({ name: 'room', params: { uuid: result }, query: { configure: '1' } });
        if (router.currentRoute.value.params.uuid === result) clearPendingCreate();
      } catch {
        eventBus.emit('infoMessage', t('errors.requestFailed'));
      } finally {
        creatingRoom.value = false;
      }
    };

    const updateRooms = (list: TRoomsList) => {
      roomsList.value = list;
      if (filter.value === 'ai-games') void loadAiRooms();
    };
    socket.on('roomsListUpdated', updateRooms);

    const filter = ref('all');
    const visibleLimit = ref(8);
    const finishedPage = ref(1);
    const finishedPageSize = 8;
    watch(filter, () => {
      visibleLimit.value = filter.value === 'ai-games' ? 20 : 8;
      finishedPage.value = 1;
      if (filter.value === 'ai-games') void loadAiRooms();
    });
    const filters = ['all', 'open', 'playing', 'finished', 'ai-games'];
    const roomCategory = (room: TRoomsList[number]) =>
      room.result || room.aiStatus === 'stopped' || room.aiStatus === 'finished'
        ? 'finished'
        : room.aiStatus === 'paused'
          ? 'paused'
          : room.state === 'created'
            ? room.players < 10
              ? 'open'
              : 'full'
            : 'playing';
    const roomPriority = (room: TRoomsList[number]) => {
      if (roomCategory(room) === 'open') return room.options.features?.lookingForPlayers ? 0 : 1;
      return roomCategory(room) === 'finished' ? 3 : 2;
    };
    const visibleRooms = computed(() =>
      filter.value === 'ai-games'
        ? aiRooms.value || []
        : [...(roomsList.value || [])]
            .filter((room) => filter.value === 'all' || roomCategory(room) === filter.value)
            .sort((a, b) => roomPriority(a) - roomPriority(b)),
    );
    const filterCount = (value: string) =>
      value === 'ai-games'
        ? aiRooms.value?.length || 0
        : (roomsList.value || []).filter((room) => value === 'all' || roomCategory(room) === value).length;
    const finishedPageCount = computed(() => Math.max(1, Math.ceil(filterCount('finished') / finishedPageSize)));
    watch(finishedPageCount, (pages) => {
      finishedPage.value = Math.min(finishedPage.value, pages);
    });
    const displayedRooms = computed(() => {
      if (filter.value !== 'finished') return visibleRooms.value.slice(0, visibleLimit.value);
      const offset = (finishedPage.value - 1) * finishedPageSize;
      return visibleRooms.value.slice(offset, offset + finishedPageSize);
    });

    const updateOnline = (counter: number) => {
      online.value = counter;
    };
    const refreshLobby = () => {
      // Socket.IO queues emits while connecting, but a disconnected lobby
      // should wait for the connect event so the initial request is not
      // duplicated by the first reconnect.
      if (!socket.connected) return;
      void initState();
      void socket
        .timeout(10000)
        .emitWithAck('getOnlineCounter', 'lobby')
        .then((counter) => {
          if (typeof counter === 'number') online.value = counter;
        })
        .catch(() => {});
      if (filter.value === 'ai-games') void loadAiRooms();
    };
    socket.on('onlineCounterUpdated', updateOnline);
    socket.on('connect', refreshLobby);
    if (socket.connected) void refreshLobby();
    const resetAdminStatus = () => {
      adminUnlocked.value = false;
      deleteDialog.value = false;
    };
    watch(() => store.state.profile?.token, resetAdminStatus);
    socket.on('disconnect', resetAdminStatus);
    if (store.state.profile) void refreshAdminStatus();
    onBeforeUnmount(() => {
      aiRefreshPending = false;
      socket.off('roomsListUpdated', updateRooms);
      socket.off('onlineCounterUpdated', updateOnline);
      socket.off('connect', refreshLobby);
      socket.off('disconnect', resetAdminStatus);
      adminUnlocked.value = false;
    });

    return {
      createRoom,
      creatingRoom,
      aiRooms,
      aiLoading,
      aiError,
      loadAiRooms,
      filter,
      visibleLimit,
      filters,
      visibleRooms,
      displayedRooms,
      finishedPage,
      finishedPageCount,
      filterCount,
      online,
      roomsList,
      roomsError,
      initState,
      adminDialog,
      adminPassword,
      adminError,
      adminLoading,
      adminUnlocked,
      deleteDialog,
      deletingRoom,
      openAdminDialog,
      unlockAdmin,
      lockAdmin,
      requestRoomDeletion,
      deleteRoom,
    };
  },
});
</script>

<style scoped lang="scss">
.finished-pages {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
}

.lobby-guide {
  margin-top: 32px;
  border: 1px solid rgba(var(--v-theme-text-primary), 0.1);
  border-radius: 20px;
  background: rgb(var(--v-theme-inset));
  font-size: 16px;
  line-height: 1.65;
  color: rgb(var(--v-theme-text-primary));
  h2 {
    margin-bottom: 16px;
    font-size: 28px;
    line-height: 1.25;
    text-wrap: balance;
  }
  h3 {
    font-size: 18px;
    line-height: 1.4;
  }
  a {
    color: inherit;
    text-underline-offset: 4px;
  }
}
.lobby-guide .game-guides {
  margin: 0 32px 32px;
}
.guide-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 40px;
  padding: 32px;
}
.guide-introduction .lobby-links {
  margin-top: 20px;
}
.guide-start {
  padding-left: 32px;
  border-left: 1px solid rgba(var(--v-theme-text-primary), 0.12);
  ol {
    padding-left: 22px;
    margin: 16px 0 24px;
  }
  li {
    padding-left: 4px;
  }
  li + li {
    margin-top: 12px;
  }
  li::marker {
    font-weight: 700;
    color: rgb(var(--v-theme-primary));
  }
}
.guide-questions {
  padding: 0 32px 12px;
}
.guide-question {
  border-top: 1px solid rgba(var(--v-theme-text-primary), 0.12);
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    min-height: 56px;
    padding: 16px 0;
    font-weight: 600;
    line-height: 1.4;
    list-style: none;
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::after {
    content: '+';
    flex-shrink: 0;
    font-size: 24px;
    font-weight: 400;
    line-height: 1;
  }
  &[open] summary::after {
    content: '−';
  }
  summary:hover {
    color: rgb(var(--v-theme-primary));
  }
  summary:focus-visible {
    outline: 2px solid rgb(var(--v-theme-primary));
    outline-offset: 4px;
    border-radius: 4px;
  }
}
.guide-answer {
  max-width: 72ch;
  padding: 0 0 20px;
  a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin-top: 8px;
  }
}
.lobby {
  width: min(1200px, 100%);
  margin: 0 auto;
  padding: 74px 28px 48px;
}
.lobby-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 28px;
  padding: 28px 32px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-text-primary), 0.08);
  border-radius: 20px;
  background: linear-gradient(115deg, rgb(var(--v-theme-inset)) 55%, rgba(var(--v-theme-primary), 0.08));
}
.hero-eyebrow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 10px;
  font-size: 12px;
}
.brand-name {
  font-weight: 800;
  letter-spacing: 0.22em;
  color: rgb(var(--v-theme-text-primary));
}
.online {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgba(var(--v-theme-text-primary), 0.7);
}
.online::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
}
h1 {
  font-size: clamp(27px, 3.2vw, 36px);
  line-height: 1.2;
  letter-spacing: -0.035em;
  text-wrap: balance;
}
.lobby-intro {
  max-width: 690px;
  margin-top: 12px;
  font-size: 15px;
  line-height: 1.65;
  color: rgba(var(--v-theme-text-primary), 0.75);
}
.lobby-actions,
.lobby-links {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 24px;
}
.lobby-actions {
  margin-top: 20px;
}
.create-room {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
}
.create-room .material-icons {
  margin-right: 6px;
  font-size: 20px;
}
.lobby-links a {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: 14px;
  text-decoration: none;
}
.lobby-links .link-label {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.hero-art {
  position: relative;
  min-height: 200px;
  align-self: center;
}
.hero-orbit {
  position: absolute;
  width: 220px;
  height: 220px;
  top: -10px;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 50%;
}
.character-card {
  position: absolute;
  width: 104px;
  height: 150px;
  border: 3px solid #b9a276;
  border-radius: 12px;
  background-color: #25334b;
  background-size: cover;
  box-shadow: 0 12px 24px #101c3433;
}
.character-card span {
  position: absolute;
  bottom: 7px;
  left: 50%;
  transform: translateX(-50%);
  color: #fff0cb;
  background: #172135dd;
  border: 1px solid #b9a276;
  border-radius: 50%;
  width: 25px;
  height: 25px;
  text-align: center;
  font-family: Georgia, serif;
}
.character-card--morgana {
  top: 12px;
  right: 15px;
  transform: rotate(14deg);
  background-image: getAvatarPathByID('roles', 'morgana');
  background-position: center;
}
.character-card--merlin {
  top: 0;
  left: 18px;
  transform: rotate(-12deg);
  background-image: getAvatarPathByID('roles', 'merlin');
  background-position: center;
}
.art-caption {
  position: absolute;
  bottom: 0;
  width: 100%;
  text-align: center;
  font-family: Georgia, serif;
  font-size: 13px;
  font-style: italic;
  color: rgba(var(--v-theme-text-primary), 0.65);
}
.lobby-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'rooms';
  align-items: start;
  gap: 28px;
  margin-top: 28px;
}
.rooms-panel {
  min-width: 0;
}
.rooms-panel {
  grid-area: rooms;
}
.rooms-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.rooms-heading .admin-entry.v-btn {
  margin-left: auto;
  color: #111;
  background: #f2f5f8;
  text-transform: none;
  letter-spacing: 0;
}
.rooms-heading h2 {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.room-count {
  font-size: 13px;
  color: rgba(var(--v-theme-text-primary), 0.65);
}
.room-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 16px;
}
.room-filters button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: rgba(var(--v-theme-text-primary), 0.7);
}
.room-filters button.selected {
  background: rgb(var(--v-theme-inset));
  color: rgb(var(--v-theme-text-primary));
  box-shadow: 0 1px 3px #00000010;
  font-weight: 600;
}
.room-filters button:hover {
  background: rgba(var(--v-theme-inset), 0.6);
}
.room-filters button span {
  font-size: 11px;
  opacity: 0.65;
}
.room-filters button.ai-filter {
  border: 1px solid rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
}
.room-filters button.ai-filter:hover,
.room-filters button.ai-filter.selected {
  background: rgba(var(--v-theme-primary), 0.18);
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-primary));
}

.games-list {
  container: lobby-games / inline-size;
  display: grid;
  gap: 8px;
}
.room-list-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  gap: 8px;
}
.room-list-item > .game {
  min-width: 0;
}
.room-delete {
  min-height: 44px;
  text-transform: none;
  letter-spacing: 0;
  white-space: nowrap;
}
.admin-dialog .admin-help {
  margin: 0 0 16px;
  color: rgba(var(--v-theme-text-primary), 0.72);
  line-height: 1.6;
}
.admin-status {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  line-height: 1.5;
}
.admin-status--success {
  color: rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.1);
}
.admin-actions {
  justify-content: flex-end;
  gap: 8px;
}
.show-more {
  min-height: 44px;
  border: 1px solid rgba(var(--v-theme-text-primary), 0.15);
  border-radius: 10px;
  font-size: 13px;
}
.show-more:hover {
  background: rgb(var(--v-theme-inset));
}
.rooms-message {
  padding: 32px 20px;
  border: 1px dashed rgba(var(--v-theme-text-primary), 0.2);
  border-radius: 14px;
  text-align: center;
  font-size: 15px;
  line-height: 1.6;
  color: rgba(var(--v-theme-text-primary), 0.7);
}
.empty-icon {
  font-size: 30px;
  margin-bottom: 10px;
  opacity: 0.5;
}
.reset-filter {
  margin-top: 12px;
  text-decoration: underline;
  text-underline-offset: 4px;
  min-height: 44px;
}
button:focus-visible,
a:focus-visible {
  outline: 2px solid rgb(var(--v-theme-text-primary));
  outline-offset: 3px;
}
@media (max-width: 1000px) {
  .hero-art {
    display: none;
  }
  .lobby-hero {
    grid-template-columns: minmax(0, 1fr);
  }
  .lobby-content {
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 20px;
  }
}
@media (max-width: 760px) {
  .lobby-guide .game-guides {
    margin-inline: 24px;
  }
  .guide-overview {
    grid-template-columns: minmax(0, 1fr);
    gap: 28px;
    padding: 24px;
  }
  .guide-start {
    padding-left: 0;
    border-left: 0;
  }
  .guide-questions {
    padding: 0 24px 8px;
  }
  .lobby-guide h2 {
    font-size: 24px;
  }
  .lobby-content {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'rooms';
  }
}
@media (max-width: 600px) {
  .lobby {
    padding: 66px 12px 40px;
  }
  .lobby-hero {
    padding: 20px;
    border-radius: 16px;
  }
  .lobby-intro {
    font-size: 14px;
    line-height: 1.6;
  }
  .lobby-actions {
    gap: 8px 20px;
    margin-top: 16px;
  }
  .lobby-actions > .v-btn {
    width: 100%;
  }
  .lobby-links {
    width: 100%;
    justify-content: center;
  }
  .lobby-content {
    margin-top: 24px;
  }
  .room-filters {
    gap: 2px;
  }
  .room-filters button {
    padding: 8px;
    gap: 5px;
    font-size: 12px;
  }
  .rooms-heading {
    align-items: flex-start;
  }
  .admin-entry {
    margin-top: -6px;
    padding-inline: 4px;
  }
  .room-list-item {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  .room-delete {
    justify-self: end;
    margin-top: -2px;
    margin-right: 4px;
  }
}
</style>
