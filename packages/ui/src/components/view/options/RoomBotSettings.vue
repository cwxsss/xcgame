<template>
  <section class="room-bot-settings" aria-labelledby="room-bot-settings-title">
    <h3 id="room-bot-settings-title">AI 玩家</h3>
    <p>先添加 AI 玩家，再选择角色并保存。也可以随机分配角色。</p>
    <div v-for="(bot, index) in draft" :key="index" class="room-bot-row">
      <label>
        AI {{ index + 1 }}
        <select v-model="bot.role" :disabled="saving || locked">
          <option value="">随机分配</option>
          <option v-if="bot.role && !availableRoles.includes(bot.role)" :value="bot.role">
            {{ $t(`roles.${bot.role}`) }}（本局未启用）
          </option>
          <option v-for="role in availableRoles" :key="role" :value="role">{{ $t(`roles.${role}`) }}</option>
        </select>
      </label>
      <v-btn color="primary" variant="text" :disabled="saving || locked" @click="draft.splice(index, 1)">移除</v-btn>
    </div>
    <div class="room-bot-actions">
      <v-btn color="primary" variant="outlined" :disabled="saving || locked || draft.length >= capacity" @click="draft.push({ role: '' })">
        <span class="material-icons" aria-hidden="true">add</span>
        添加 AI 玩家
      </v-btn>
      <v-btn color="primary" :loading="saving" :disabled="!changed || locked || overCapacity" @click="save">
        保存 AI 设置
      </v-btn>
    </div>
    <p v-if="locked">解锁房间后可调整 AI 席位。</p>
    <p v-else-if="draft.length >= capacity">玩家总数最多为 10 人。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="saved" role="status">AI 设置已保存。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GameOptions, TRoles } from '@avalon/types';
import { socket } from '@/api/socket';

type BotSeat = { id: string; role?: TRoles };
type BotDraft = { role: TRoles | '' };

const props = defineProps<{
  options: GameOptions;
  roomState: { roomID: string; stage: string; players: readonly unknown[]; roomBots?: BotSeat[] };
}>();

const confirmed = computed<BotDraft[]>(() => (props.roomState.roomBots ?? []).map((bot) => ({ role: bot.role ?? '' })));
const confirmedKey = computed(() => JSON.stringify(confirmed.value));
const draft = ref<BotDraft[]>([]);
const saving = ref(false);
const saved = ref(false);
const error = ref('');
const locked = computed(() => props.roomState.stage !== 'created');
const capacity = computed(() => 10 - props.roomState.players.length + confirmed.value.length);
const overCapacity = computed(() => draft.value.length > capacity.value);
const changed = computed(() => JSON.stringify(draft.value) !== confirmedKey.value);
const availableRoles = computed(() =>
  Object.entries(props.options.roles)
    .filter(([, count]) => count > 0)
    .map(([role]) => role as TRoles),
);

watch(confirmedKey, () => {
  draft.value = confirmed.value.map((bot) => ({ ...bot }));
}, { immediate: true });
watch(changed, (value) => {
  if (value && !saving.value) saved.value = false;
});

async function save() {
  if (!changed.value || saving.value || locked.value || overCapacity.value) return;
  saving.value = true;
  error.value = '';
  try {
    const result = await socket.timeout(8000).emitWithAck(
      'setRoomBots',
      props.roomState.roomID,
      draft.value.map(({ role }) => (role ? { role } : {})),
    );
    if (result === true) {
      saved.value = true;
    } else if (/does not support/i.test(result.error)) {
      error.value = '当前角色或扩展暂不支持内置 AI，请调整房间选项后再添加。';
    } else {
      error.value = '无法保存 AI 设置，请检查席位数量和指定的角色。';
    }
  } catch {
    error.value = '保存超时，请检查连接后重试。';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.room-bot-settings { display: grid; gap: 8px; }
.room-bot-settings p { font-size: 13px; margin: 0; }
.room-bot-row, .room-bot-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.room-bot-row label { display: flex; flex: 1; min-width: 0; align-items: center; gap: 8px; }
.room-bot-row select { min-width: 0; flex: 1; padding: 8px; border: 1px solid rgba(var(--v-theme-text-primary), .24); border-radius: 6px; }
[role='alert'] { color: rgb(var(--v-theme-error)); }
</style>
