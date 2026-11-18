<template>
  <span
    class="player-icon-image"
    :class="[{ 'has-portrait': portrait }, `icon-${icon}`]"
    :style="portrait"
    :title="icon"
    :aria-label="icon"
    role="img"
    >{{ portrait ? '' : symbol }}</span
  >
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';
import type { TPlayerIcon } from '@/components/view/information/interface';

const portraitSlots: Record<string, [number, number]> = {
  merlin: [0, 0],
  percival: [1, 0],
  servant: [2, 0],
  goodLancelot: [3, 0],
  assassin: [0, 1],
  minion: [1, 1],
  morgana: [2, 1],
  mordred: [3, 1],
  oberon: [0, 2],
  evilLancelot: [1, 2],
};

export default defineComponent({
  props: {
    thumbnail: Boolean,
    icon: { required: true, type: String as PropType<TPlayerIcon> },
  },
  computed: {
    portrait() {
      const slot = portraitSlots[this.icon];
      return slot && { backgroundPosition: `${(slot[0] * 100) / 3}% ${slot[1] * 50}%` };
    },
    symbol() {
      if (this.icon === 'unknown') return '?';
      if (this.icon === 'good') return '◇';
      if (this.icon === 'evil') return '◆';
      if (this.icon === 'excalibur') return '⚔';
      return this.icon.slice(0, 1).toUpperCase();
    },
  },
});
</script>

<style scoped>
.player-icon-image {
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  background: #304457;
  color: #fbf2dc;
  font-weight: 700;
}

.player-icon-image.has-portrait {
  background-image: url('./xcgame-role-portraits.jpg');
  background-size: 400% 300%;
  background-repeat: no-repeat;
}

.icon-good {
  background-color: #1f616b;
}
.icon-evil {
  background-color: #883e53;
}
</style>
