<!--
  SPDX-License-Identifier: MIT AND GPL-3.0-or-later
  SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
  SPDX-FileCopyrightText: 2026 JustVoice contributors

  Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/app/src/components/ChordPicker/ChordPicker.tsx
  (commit pinned in voicebox-pin.txt at repo root).
  Translated React -> Vue on 2026-06-08. Modifications by JustVoice contributors
  are licensed under GPL-3.0-or-later. MIT permission notice continues to apply
  to upstream-derived portions.

  Live keyboard combo editor — captures the peak set of keys held during the
  session so the user can release before clicking Save. Esc + Tab pass through.
-->
<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { UiButton, AppModal } from "@delebash/llm-ui";

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: 'Pick a chord' },
  description: { type: String, default: 'Press the keys you want to use, then release and click Save.' },
  initialKeys: { type: Array, default: () => [] },
});
const emit = defineEmits(['save', 'cancel']);

const pressed = ref(new Set());
const captured = ref([...props.initialKeys]);
const unsupported = ref('');
const captureEl = ref(null);

function canonicalKey(e) {
  // Map browser event.code → canonical name. Preserves the L/R hint by
  // using ShiftLeft / ShiftRight as-is.
  const code = e.code;
  if (!code) return null;
  if (code.startsWith('Key')) return code.slice(3); // KeyA → A
  if (code.startsWith('Digit')) return code.slice(5); // Digit1 → 1
  const aliases = {
    ControlLeft: 'CtrlL',
    ControlRight: 'CtrlR',
    ShiftLeft: 'ShiftL',
    ShiftRight: 'ShiftR',
    AltLeft: 'AltL',
    AltRight: 'AltR',
    MetaLeft: 'CmdL',
    MetaRight: 'CmdR',
    Space: 'Space',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Escape: 'Esc',
    Tab: 'Tab',
  };
  if (aliases[code]) return aliases[code];
  if (code.startsWith('F') && /^F\d+$/.test(code)) return code;
  return code;
}

function sortKeys(arr) {
  // Modifiers first, then alphabetical.
  const mods = arr.filter((k) => /^(Ctrl|Shift|Alt|Cmd)/.test(k));
  const rest = arr.filter((k) => !/^(Ctrl|Shift|Alt|Cmd)/.test(k));
  return [...mods.sort(), ...rest.sort()];
}

function handleKeyDown(e) {
  if (!props.open) return;
  if (e.key === 'Escape' || e.key === 'Tab') return;
  const k = canonicalKey(e);
  if (!k) {
    unsupported.value = e.code || e.key || 'unknown';
    e.preventDefault();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  unsupported.value = '';
  if (pressed.value.has(k)) return;
  const next = new Set(pressed.value);
  next.add(k);
  pressed.value = next;
  captured.value = sortKeys([...next]);
}

function handleKeyUp(e) {
  if (!props.open) return;
  const k = canonicalKey(e);
  if (!k) return;
  const next = new Set(pressed.value);
  next.delete(k);
  pressed.value = next;
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      pressed.value = new Set();
      captured.value = [...props.initialKeys];
      unsupported.value = '';
      // Defer focus until paint.
      setTimeout(() => captureEl.value?.focus(), 50);
    }
  },
);

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('keyup', handleKeyUp, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown, true);
  window.removeEventListener('keyup', handleKeyUp, true);
});

function onSave() {
  emit('save', captured.value);
}
</script>

<template>
  <AppModal v-if="open" eyebrow="Keyboard chord" :title="title" :max-width="'480px'" dismissable @close="emit('cancel')">
    <p class="chord-picker__description">{{ description }}</p>

    <div
      ref="captureEl"
      class="chord-picker__capture"
      tabindex="0"
      @blur="captureEl?.focus()"
      aria-label="Press the keys for your chord"
    >
      <span v-if="captured.length === 0" class="chord-picker__placeholder">Press a key…</span>
      <span v-for="k in captured" :key="k" class="chord-picker__key">{{ k }}</span>
    </div>

    <p v-if="unsupported" class="chord-picker__unsupported">Key "{{ unsupported }}" can't be used.</p>

    <template #footer>
      <span class="jv-spacer" />
      <UiButton intent="secondary" label="Cancel" @click="emit('cancel')" />
      <UiButton intent="primary" label="Save chord" :disabled="captured.length === 0" @click="onSave" />
    </template>
  </AppModal>
</template>

<style scoped>
.chord-picker__description {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--ink-2, #4a4a4a);
}
.chord-picker__capture {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 56px;
  padding: 12px;
  background: var(--surface-2, #fbfaf7);
  border: 1px solid var(--line, #e3e1dc);
  border-radius: 6px;
  outline: none;
}
.chord-picker__capture:focus-within {
  border-color: var(--accent, #3a7d63);
}
.chord-picker__placeholder {
  color: var(--ink-3, #888);
  font-size: 13px;
  font-style: italic;
}
.chord-picker__key {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  background: var(--surface, #fff);
  border: 1px solid var(--line-strong, #cfccc4);
  border-radius: 6px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
}
.chord-picker__unsupported {
  margin: 12px 0 0;
  color: var(--danger, #a8442e);
  font-size: 12px;
}
</style>
