<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  EmptyState — centred "nothing yet" placeholder. Icon + title + body
  + optional primary action. Used inside cards, modal bodies, and full
  pane empty states.
-->
<script setup>
import Icon from "./Icon.vue";
import JvButton from "./ui/JvButton.vue";

defineProps({
  icon:        { type: String, default: "Sparkle" },
  iconSize:    { type: [Number, String], default: 22 },
  title:       { type: String, default: "" },
  message:     { type: String, default: "" },
  actionLabel: { type: String, default: "" },
  compact:     { type: Boolean, default: false },
});
const emit = defineEmits(["action"]);
</script>

<template>
  <div class="jv-empty" :class="{ 'jv-empty--compact': compact }">
    <Icon :name="icon" :size="iconSize" class="jv-empty__icon" />
    <h3 v-if="title" class="jv-empty__title">{{ title }}</h3>
    <p v-if="message" class="jv-empty__message">{{ message }}</p>
    <slot name="actions">
      <JvButton v-if="actionLabel" variant="primary" @click="emit('action')">
        {{ actionLabel }}
      </JvButton>
    </slot>
  </div>
</template>

<style scoped>
.jv-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 36px 16px; text-align: center;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-card);
}
.jv-empty--compact { padding: 20px 12px; }
.jv-empty__icon { color: var(--ink-3); }
.jv-empty__title { font-size: 15px; font-weight: 600; margin: 0; color: var(--ink); }
.jv-empty__message {
  color: var(--ink-3); font-size: 13px; line-height: 1.55;
  margin: 0 0 4px; max-width: 32em;
}
</style>
