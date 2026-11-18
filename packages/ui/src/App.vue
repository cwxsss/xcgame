<template>
  <header class="header">
    <div class="header-left-container d-flex align-center">
      <RouterLink class="home-link" :to="homePath" :aria-label="$t('menu.home')">
        <v-icon class="home-icon" size="20" icon="fa:fa-solid fa-house" aria-hidden="true" />
      </RouterLink>
      <a v-if="embeddedInHall" class="hall-link" href="/">游戏大厅</a>
      <ConnectStatus v-if="currentRoute === 'room'" class="connect-status" />
    </div>
    <nav class="header-navigation" :aria-label="$t('menu.menu')">
      <LocaleLink class="desktop-navigation" :to="{ name: 'wiki' }" :class="{ active: inSection('/wiki/') }">{{
        $t('menu.rulesRoles')
      }}</LocaleLink>
    </nav>
    <div class="header-right-container d-flex align-center">
      <SpoilerEye v-if="currentRoute === 'room'" />
      <button
        v-if="$store.state.profile"
        type="button"
        class="guest-profile"
        aria-label="编辑头像和昵称"
        @click="openAvatarModal"
      >
        <Avatar :avatarID="$store.state.profile.avatar" alt="" />
        <span class="guest-name">{{ $store.state.profile.name }}</span>
      </button>
    </div>
  </header>
  <p v-if="$store.state.connect === false" class="connection-warning" role="status">{{ $t('onlineStatus.error') }}</p>
  <RouterView v-slot="{ Component }">
    <template v-if="Component">
      <Suspense>
        <component :is="Component" class="page"></component>

        <template #fallback> {{ $t('mainPage.loading') }} </template>
      </Suspense>
    </template>
  </RouterView>
  <LanguageSuggestion />
  <AvatarModal ref="avatarModal" />
  <v-dialog v-model="guestOpen" max-width="420" :persistent="guestSubmitting" @after-leave="guestName = ''">
    <v-card class="guest-dialog">
      <v-card-title>进入小褚游戏厅</v-card-title>
      <v-card-text>
        <p class="guest-dialog__hint">输入昵称即可创建或加入阿瓦隆房间。</p>
        <v-text-field
          v-model="guestName"
          label="你的昵称"
          placeholder="例如：小褚"
          autocomplete="nickname"
          autofocus
          :error-messages="guestError ? [guestError] : []"
          @keyup.enter="submitGuest"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="guestSubmitting" @click="guestOpen = false">取消</v-btn>
        <v-btn color="primary" :loading="guestSubmitting" @click="submitGuest">进入游戏</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <InfoSnackbar />
  <Version class="version" />
</template>

<script lang="ts">
import { defineComponent, unref } from 'vue';
import { localizedPath } from '@/router/paths';
import LanguageSuggestion from '@/components/feedback/LanguageSuggestion.vue';
import ConnectStatus from '@/components/feedback/ConnectStatus.vue';
import InfoSnackbar from '@/components/feedback/InfoSnackbar.vue';
import Version from '@/components/feedback/Version.vue';
import SpoilerEye from '@/components/feedback/SpoilerEye.vue';
import Avatar from '@/components/user/Avatar.vue';
import AvatarModal from '@/components/user/AvatarModal.vue';
import { isHolidays } from '@/helpers/utility';
import eventBus from '@/helpers/event-bus';
import { inNavigationSection } from '@/components/header/navigation';
import { socket } from '@/api/socket';
import { isSocketError } from '@/helpers/socket-errors';

export default defineComponent({
  components: {
    LanguageSuggestion,
    ConnectStatus,
    InfoSnackbar,
    Version,
    SpoilerEye,
    Avatar,
    AvatarModal,
  },
  data() {
    return {
      currentLocale: this.$i18n.locale,
      guestOpen: false,
      guestName: '',
      guestError: '',
      guestSubmitting: false,
      guestContinuation: null as (() => void | Promise<void>) | null,
    };
  },
  computed: {
    embeddedInHall() {
      return process.env.VUE_APP_HALL_BASE === '/avalon/';
    },
    homePath() {
      return localizedPath('/', unref(this.$i18n.locale));
    },
    currentRoute() {
      return this.$route.name;
    },
  },
  watch: {
    '$route.fullPath'() {
      this.guestContinuation = null;
    },
  },
  methods: {
    inSection(path: string) {
      return inNavigationSection(this.$route.path, path);
    },
    openAvatarModal() {
      (this.$refs.avatarModal as typeof AvatarModal).displayModal();
    },
    openAuthModal(resume?: () => void | Promise<void>) {
      this.guestContinuation = resume || null;
      this.guestError = '';
      this.guestOpen = true;
    },
    async submitGuest() {
      if (this.guestSubmitting) return;
      const name = this.guestName.trim();
      if (!name || name.length > 24) {
        this.guestError = '昵称长度需为 1–24 个字符';
        return;
      }
      this.guestSubmitting = true;
      this.guestError = '';
      try {
        const result = await socket.timeout(10000).emitWithAck('createGuest', name);
        if (isSocketError(result)) {
          this.guestError = result.error === 'invalidRequest' ? '昵称不可用' : '进入失败，请稍后重试';
          return;
        }
        const resume = this.guestContinuation;
        this.guestContinuation = null;
        if (resume) {
          socket.once('connect', () => void resume());
        }
        this.$store.commit('updateUserProfile', result);
        this.guestOpen = false;
      } catch {
        this.guestError = '进入失败，请稍后重试';
      } finally {
        this.guestSubmitting = false;
      }
    },
  },
  beforeUnmount() {
    eventBus.off('openAuthModal', this.openAuthModal);
  },
  created() {
    eventBus.on('openAuthModal', this.openAuthModal);
    document.documentElement.lang = this.currentLocale;

    if (isHolidays()) {
      document.querySelector('#app')?.classList.add('holidays-active');
      document.querySelector('#overlay')?.classList.add('holidays-active');
    } else {
      document.querySelector('#app')?.classList.remove('holidays-active');
      document.querySelector('#overlay')?.classList.remove('holidays-active');
    }
  },
});
</script>

<style lang="scss">
.v-theme--lightTheme {
  --v-theme-text-secondary: 93, 105, 120;
  --v-theme-surface-border: 217, 224, 232;
}
.v-theme--darkTheme {
  --v-theme-text-secondary: 175, 189, 207;
  --v-theme-surface-border: 53, 66, 85;
}

body {
  color: rgb(var(--v-theme-text-primary));
}

#app {
  font-family:
    Avenir,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'Noto Sans',
    Helvetica,
    Arial,
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
}

ul > li {
  list-style-type: none;
}

li {
  list-style-position: inside;
}

a {
  text-decoration: none;
  color: rgb(var(--v-theme-text-primary));
}

.header {
  height: 50px;
  width: 100%;
  background-color: rgb(var(--v-theme-bg-header));
  border-bottom: 1px solid rgb(var(--v-theme-surface-border));
  padding-inline: clamp(10px, 2vw, 28px);
  align-items: center;
  gap: 12px;
  display: flex;
  justify-content: space-between;
  position: fixed;
  top: 0px;
  left: 0px;
  z-index: 100;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.025);
}

.page {
  padding-top: 50px;
}

.connect-status {
  font-size: 13px;
}

.header-right-container {
  font-size: large;
}

.version {
  opacity: 0.55;
  pointer-events: none;
  font-size: 11px;
  position: fixed;
  bottom: 5px;
  right: 10px;
}

body {
  background-color: rgb(var(--v-theme-bg-app));
}

.icon-swap {
  vertical-align: text-bottom;
}

#app.holidays-active {
  .player-crown {
    background-image: getImagePathByID('core', 'santa-hat');
    width: 90px;
    height: 90px;
    left: 20px;
  }
}

#overlay.holidays-active {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  min-height: 100vh;
  background-image: getImagePathByID('core', 'holidays-background');
  background-attachment: fixed;
  background-size: cover;
  pointer-events: none;
  z-index: -1;
  opacity: var(--v-holiday-background-opacity);
}

.v-data-table {
  background-color: rgb(var(--v-theme-bg-app)) !important;
  color: rgb(var(--v-theme-text-primary)) !important;
  font-size: 18px !important;

  .v-data-table__th:hover {
    color: rgb(var(--v-theme-text-primary)) !important;
  }
}

@media (max-width: 600px) {
  .v-data-table {
    font-size: 14px !important;
  }
}

.home-icon {
  width: 20px;
}

.header-left-container {
  font-size: 36px;
}

/* Override for skeleton loaders to have transparent background */
.v-skeleton-loader {
  background-color: transparent !important;
}
</style>

<style lang="scss">
.header-left-container {
  gap: 14px;
  min-width: 0;
}
.header-right-container {
  min-width: 0;
  flex-shrink: 0;
}
.guest-name {
  display: block;
  min-width: 0;
  max-width: 12em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(var(--v-theme-text-secondary));
  font-size: 14px;
}
.guest-profile {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  max-width: min(220px, 30vw);
  min-height: 44px;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.guest-profile:hover,
.guest-profile:focus-visible {
  border-color: rgb(var(--v-theme-surface-border));
  background: rgb(var(--v-theme-inset));
}
.guest-profile img {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border-radius: 50%;
  object-fit: cover;
}
.header .home-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 0 8px;
  min-height: 44px;
  text-transform: none;
  letter-spacing: 0;
}
.header .hall-link {
  min-width: 0;
  max-width: 8em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 1.25;
  font-weight: 600;
}
.header-navigation {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.header-navigation a {
  display: inline-flex;
  align-items: center;
  min-height: 42px;
  padding: 8px 14px;
  font-size: 14px;
  border-radius: 8px;
}
.header-navigation a:hover {
  background: rgb(var(--v-theme-inset-hover));
}
.header-navigation .active {
  color: rgb(var(--v-theme-support-accent));
  background: rgb(var(--v-theme-support-button));
}
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 3px;
}
:where(button, select, summary) {
  cursor: pointer;
}
:where(button, input, select, textarea):disabled {
  cursor: not-allowed;
}
.page :where(h1, h2, h3, h4) {
  text-wrap: pretty;
}
.page :where(input:not([type='checkbox']):not([type='radio']), select, textarea) {
  font-size: 16px;
}
@media (max-width: 760px) {
  .header .desktop-navigation {
    display: none;
  }
  .header-navigation {
    margin-left: 0;
    min-width: 0;
    flex: 1;
  }
  .header-navigation a {
    padding: 8px;
    font-size: 14px;
    line-height: 1.25;
  }
  .header-left-container .connect-status {
    display: none;
  }
  .header-left-container {
    gap: 10px;
  }
  .header {
    gap: 4px;
  }
  .guest-profile {
    max-width: min(150px, 30vw);
    padding-inline: 5px;
    gap: 5px;
  }
  .guest-name {
    max-width: 8em;
  }
}
@media (max-width: 400px) {
  .guest-profile {
    max-width: min(110px, 30vw);
  }
  .guest-name {
    max-width: 5em;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>

<style lang="scss">
.header-account {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 14px;
}
.header-account:hover {
  background: rgb(var(--v-theme-inset-hover));
}
.header-account img {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}
.connection-warning {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 110;
  max-width: calc(100vw - 32px);
  padding: 10px 16px;
  border-radius: 8px;
  background: rgb(var(--v-theme-error));
  color: rgb(var(--v-theme-on-error));
  font-size: 14px;
}
</style>
