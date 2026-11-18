<template>
  <v-dialog
    v-model="overlay"
    :width="476"
    :max-width="'calc(100vw - 24px)'"
    aria-labelledby="avatar-dialog-title"
    aria-describedby="avatar-dialog-description"
    @after-leave="restoreFocus"
  >
    <v-card class="avatar-dialog" elevation="8">
      <header class="avatar-header">
        <h2 id="avatar-dialog-title">{{ $t('avatars.modalHeader') }}</h2>
        <v-btn
          icon="close"
          color="text-primary"
          variant="text"
          :aria-label="$t('infoMessage.close')"
          @click="overlay = false"
        />
      </header>
      <div class="avatar-content">
        <form class="nickname-form" @submit.prevent="saveNickname">
          <label for="avatar-nickname">昵称</label>
          <div class="nickname-controls">
            <input id="avatar-nickname" v-model="nickname" autocomplete="nickname" maxlength="24" :disabled="nicknameSaving" />
            <v-btn type="submit" color="primary" :loading="nicknameSaving" :disabled="!nicknameChanged">
              保存昵称
            </v-btn>
          </div>
          <p v-if="nicknameError" role="alert">{{ nicknameError }}</p>
          <p v-else-if="nicknameSaved" role="status">昵称已保存。</p>
        </form>
        <p id="avatar-dialog-description" class="avatar-description">{{ $t('avatars.autoSave') }}</p>
        <div v-if="loadFailed" class="avatar-error" role="alert">
          <p>{{ $t('avatars.loadFailed') }}</p>
          <v-btn variant="outlined" color="text-primary" @click="open">{{ $t('avatars.retry') }}</v-btn>
        </div>
        <div v-else-if="loading" class="avatar-loading" aria-hidden="true">
          <v-progress-circular indeterminate color="info" />
        </div>
        <template v-else>
          <p v-if="!avatars.length">{{ $t('avatars.empty') }}</p>
          <div v-else class="avatars-container">
            <AvatarPreview
              v-for="avatar in avatars"
              :key="avatar.id"
              :avatar="avatar"
              :name="avatarName(avatar.id)"
              :is-selected="avatar.id === selectedAvatar"
              :pending="avatar.id === savingId"
              :busy="!!savingId"
              :has-error="saveFailed && avatar.id === inspected?.id"
              :described-by="avatar.id === inspected?.id ? 'avatar-details' : undefined"
              @select="selectAvatar"
            />
          </div>
        </template>
      </div>
      <footer class="avatar-footer">
        <div class="avatar-feedback" role="status" aria-live="polite" aria-atomic="true">
          <span v-if="savingId">{{ $t('avatars.saving') }}</span>
          <span v-else-if="saved">{{ $t('avatars.saved') }}</span>
          <span v-else-if="loading">{{ $t('avatars.loading') }}</span>
        </div>
        <div v-if="saveFailed" class="avatar-error" role="alert">
          <p>{{ $t('avatars.saveFailed') }}</p>
          <v-btn variant="outlined" color="text-primary" :disabled="!!savingId" @click="inspected && select(inspected)">
            {{ $t('avatars.retry') }}
          </v-btn>
        </div>
        <div v-if="inspected" id="avatar-details" class="avatar-details" role="status" aria-live="polite">
          <strong>{{ avatarName(inspected.id) }}</strong>
          <p v-if="!inspected.available">{{ $t('avatars.howToUnlock') }}</p>
          <p v-if="!inspected.premium">{{ inspected.available && inspected.info ? inspected.info : $t('avatars.' + inspected.id + 'Hint') }}</p>
          <p v-if="inspectedAchievement && !inspected.available" class="unlock-condition">{{ unlockCondition }}</p>
        </div>
      </footer>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { socket } from '@/api/socket';
import { avatarName } from '@/helpers/avatars';
import { getAchievementsText } from '@/helpers/achievements';
import { ACHIEVEMENT_TO_AVATAR_MAP } from '@avalon/types/stats/achievement-avatars';
import { OPEN_ACHIEVEMENT_IDS } from '@avalon/types/stats/achievements-constants';
import type { IAvatarInfo } from '@avalon/types';
import AvatarPreview from '@/components/user/AvatarPreview.vue';
import { useStore } from '@/store';
import { useAvatarSelection } from '@/helpers/composables/useAvatarSelection';

export default defineComponent({
  components: { AvatarPreview },
  setup() {
    const overlay = ref(false);
    const store = useStore();
    const { t } = useI18n();
    const selectedAvatar = computed(() => store.state.profile?.avatar);
    const nickname = ref('');
    const nicknameSaving = ref(false);
    const nicknameError = ref('');
    const nicknameSaved = ref(false);
    const nicknameChanged = computed(() =>
      Boolean(nickname.value.trim()) && nickname.value.trim() !== store.state.profile?.name,
    );
    async function saveNickname() {
      if (!nicknameChanged.value || nicknameSaving.value) return;
      const name = nickname.value.trim();
      nicknameSaving.value = true;
      nicknameError.value = '';
      nicknameSaved.value = false;
      try {
        const result = await store.dispatch('updateUserName', { name });
        if (result === true) {
          nickname.value = name;
          nicknameSaved.value = true;
        } else {
          nicknameError.value = result.error === 'invalidRequest' ? '请输入 1–24 个有效字符。' : '昵称保存失败，请重试。';
        }
      } catch {
        nicknameError.value = '昵称保存失败，请检查连接后重试。';
      } finally {
        nicknameSaving.value = false;
      }
    }
    const picker = useAvatarSelection({
      load: () => socket.timeout(10000).emitWithAck('getUserAvatars'),
      save: (avatarID) => store.dispatch('updateUserAvatar', { avatarID }),
      current: () => selectedAvatar.value,
    });
    let opener: HTMLElement | null = null;
    const displayModal = () => {
      if (overlay.value) return;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      nickname.value = store.state.profile?.name ?? '';
      nicknameError.value = '';
      nicknameSaved.value = false;
      overlay.value = true;
    };
    watch(overlay, (visible) => (visible ? picker.open() : picker.close()));
    onBeforeUnmount(picker.close);
    const restoreFocus = () => {
      if (!overlay.value && opener?.isConnected) opener.focus();
    };
    const selectAvatar = (avatar: IAvatarInfo) => {
      const focused = document.activeElement;
      void picker.select(avatar);
      void nextTick(() => {
        if (focused instanceof HTMLElement && focused.matches('.avatar-item')) {
          focused.scrollIntoView({ block: 'nearest' });
        }
      });
    };
    const inspectedAchievement = computed(
      () => Object.entries(ACHIEVEMENT_TO_AVATAR_MAP).find(([, id]) => id === picker.inspected.value?.id)?.[0],
    );
    const knownAchievement = computed(
      () =>
        !!inspectedAchievement.value &&
        (OPEN_ACHIEVEMENT_IDS.includes(inspectedAchievement.value) ||
          store.state.profile?.knownAchievements?.includes(inspectedAchievement.value)),
    );
    const unlockCondition = computed(() =>
      knownAchievement.value
        ? getAchievementsText(inspectedAchievement.value!, t(`achievements.${inspectedAchievement.value}_description`))
        : t('cosmeticRewards.secretCondition'),
    );
    return {
      ...picker,
      overlay,
      selectedAvatar,
      nickname,
      nicknameChanged,
      nicknameSaving,
      nicknameError,
      nicknameSaved,
      saveNickname,
      displayModal,
      restoreFocus,
      avatarName: (id: string) => avatarName(id, t),
      selectAvatar,
      inspectedAchievement,
      unlockCondition,
    };
  },
});
</script>

<style scoped lang="scss">
.nickname-form {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
}
.nickname-controls {
  display: flex;
  gap: 8px;
}
.nickname-controls input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid rgb(var(--v-theme-surface-border));
  border-radius: 6px;
}
.nickname-form [role='alert'] {
  color: rgb(var(--v-theme-error));
}
.avatar-dialog {
  max-height: 85dvh;
  border-radius: 16px !important;
  background: rgb(var(--v-theme-inset)) !important;
  color: rgb(var(--v-theme-text-primary));
}
.avatar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 8px 4px 20px;
  flex-shrink: 0;
  h2 {
    font-size: 20px;
    line-height: 1.3;
    font-weight: 600;
  }
}
.avatar-content {
  padding: 0 20px 20px;
  overflow-y: auto;
  min-height: 0;
}
.avatar-description {
  font-size: 14px;
  line-height: 1.5;
}
.avatar-footer {
  flex-shrink: 0;
  max-height: 32dvh;
  overflow-y: auto;
  padding: 0 20px 8px;
}
.avatar-feedback {
  min-height: 28px;
  padding: 4px 0;
  font-size: 13px;
}
.avatar-loading {
  display: grid;
  place-items: center;
  min-height: 180px;
}
.avatar-error,
.avatar-details {
  padding: 12px;
  margin-bottom: 12px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  p + .v-btn {
    margin-top: 8px;
  }
}
.avatar-details {
  background: rgb(var(--v-theme-surface));
}
.avatar-error {
  border: 1px solid rgb(var(--v-theme-error));
}
.avatars-container {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 520px) {
  .avatars-container {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .avatar-content {
    padding: 0 12px 12px;
  }
}
@media (max-width: 340px) {
  .avatars-container {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
