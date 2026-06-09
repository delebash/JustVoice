<!--
  SPDX-License-Identifier: MIT AND GPL-3.0-or-later
  SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
  SPDX-FileCopyrightText: 2026 JustVoice contributors

  Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/app/src/components/ListPane.tsx
  (commit pinned in voicebox-pin.txt at repo root).
  Translated React -> Vue on 2026-06-08. Modifications by JustVoice contributors
  are licensed under GPL-3.0-or-later. MIT permission notice continues to apply
  to upstream-derived portions.

  Slot-based list/detail scaffold with translucent fade-mask top + soft hairline
  right-divider. Used by Stories, Voices, Personas, Lexicons, Captures, Books.
-->
<script setup>
defineProps({
  title: { type: String, default: '' },
  searchValue: { type: String, default: '' },
  searchPlaceholder: { type: String, default: 'Search…' },
});
const emit = defineEmits(['update:searchValue']);
</script>

<template>
  <div class="list-pane">
    <!-- Right divider with linear-gradient mask (soft hairline, not hard line). -->
    <div class="list-pane__divider" aria-hidden="true" />
    <!-- Top fade mask — list items fade as they approach the title. -->
    <div class="list-pane__fade-top" aria-hidden="true" />

    <div class="list-pane__header">
      <div class="list-pane__title-row">
        <h2 class="list-pane__title">{{ title }}</h2>
        <div class="list-pane__actions"><slot name="actions" /></div>
      </div>
      <div class="list-pane__search">
        <input
          type="text"
          :value="searchValue"
          @input="emit('update:searchValue', $event.target.value)"
          :placeholder="searchPlaceholder"
          class="list-pane__search-input"
        />
      </div>
    </div>

    <div class="list-pane__scroll">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.list-pane {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.list-pane__divider {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 1px;
  background: var(--line, #e3e1dc);
  pointer-events: none;
  z-index: 30;
  mask-image: linear-gradient(to bottom, transparent 0, black 50px);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 50px);
}
.list-pane__fade-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 80px;
  background: linear-gradient(to bottom, var(--bg, #f6f5f1), transparent);
  z-index: 10;
  pointer-events: none;
}
.list-pane__header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 16px;
  z-index: 20;
}
.list-pane__title-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  gap: 8px;
}
.list-pane__title {
  font-size: 22px;
  font-weight: 700;
  padding: 0 4px;
  margin: 0;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.list-pane__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.list-pane__search-input {
  width: 100%;
  height: 36px;
  padding: 0 14px;
  background: var(--surface-2, #fbfaf7);
  border: 1px solid var(--line, #e3e1dc);
  border-radius: 999px;
  font-size: 13px;
  color: inherit;
  outline: none;
}
.list-pane__search-input:focus {
  border-color: var(--accent, #3a7d63);
}
.list-pane__scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 96px;
}
</style>
