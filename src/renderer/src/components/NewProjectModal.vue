<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
// "What are you making?" — the kind picker (CONCEPTS.md §6, mock #audiobook/1).
//
// Picking a kind sets the sidebar vocabulary, Studio steps, mastering
// target, and export surface for the project. Replaces the old native
// prompt() pair in BooksView (native dialogs are banned — project_gotchas).
//
// Emits:
//   close   — cancel / Esc
//   create  — { name, project_type } (caller owns the API call)
//   import  — user chose to create from a file instead (caller opens ImportModal)

import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import JvButton from "./jv/JvButton.vue";

const emit = defineEmits(["close", "create", "import", "demo"]);

const KINDS = [
  {
    id: "audiobook",
    icon: "📖",
    label: "Audiobook",
    bullets: ["Chapters & paragraphs", "Cast → Script → Render", "Lexicons enforce pronunciation"],
    foot: "Exports: chapter WAVs · M4B · ACX −20 LUFS",
  },
  {
    id: "game_voicelines",
    icon: "🎮",
    label: "Game dialogue",
    bullets: ["Lines with stable IDs, grouped", "CSV / JSON / string-table import", "Re-render only changed lines"],
    foot: "Exports: per-line WAVs by ID + manifest.json",
  },
  {
    id: "podcast",
    icon: "🎙️",
    label: "Podcast",
    bullets: ["Episodes & segments, multi-host", "Script import or write in-app", "Timeline assembly, music & SFX"],
    foot: "Exports: episode WAV/MP3 · −16 LUFS stereo",
  },
  {
    id: "custom",
    icon: "📄",
    label: "Plain text",
    bullets: ["Paste or drop any text", "Split into sections, or don't", "A voice per section, or one for all"],
    foot: "Exports: WAV / MP3 — no spec checklist",
  },
];

const selected = ref("audiobook");
const name = ref("");
const nameInput = ref(null);

const canCreate = computed(() => !!name.value.trim());

function pick(id) {
  selected.value = id;
  nameInput.value?.focus();
}

function create() {
  if (!canCreate.value) return;
  emit("create", { name: name.value.trim(), project_type: selected.value });
}

function onKey(e) {
  if (e.key === "Escape") emit("close");
  if (e.key === "Enter" && canCreate.value) create();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  nameInput.value?.focus();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="np-overlay" @click.self="emit('close')" role="dialog" aria-modal="true" aria-labelledby="np-title">
    <div class="np-dialog">
      <header class="np-header">
        <div>
          <div class="np-eyebrow">New project</div>
          <div id="np-title" class="np-title">What are you making?</div>
        </div>
        <button type="button" class="np-close" aria-label="Close" @click="emit('close')">&times;</button>
      </header>

      <p class="np-lede">
        Everything downstream adapts — the words in the sidebar, the default mastering
        target, which Studio steps appear, and what Export produces. Same voices,
        personas, and lexicons either way.
      </p>

      <div class="np-grid">
        <button
          v-for="k in KINDS"
          :key="k.id"
          type="button"
          class="np-card"
          :class="{ sel: selected === k.id }"
          @click="pick(k.id)"
        >
          <span class="np-icon">{{ k.icon }}</span>
          <span class="np-name">{{ k.label }}</span>
          <ul class="np-bullets">
            <li v-for="b in k.bullets" :key="b">{{ b }}</li>
          </ul>
          <span class="np-foot">{{ k.foot }}</span>
        </button>
      </div>

      <footer class="np-footer">
        <input
          ref="nameInput"
          v-model="name"
          class="np-input"
          placeholder="Project name…"
          @keydown.enter.stop.prevent="create"
        />
        <JvButton variant="primary" :disabled="!canCreate" @click="create">Create project ➜</JvButton>
        <button type="button" class="np-import" @click="emit('import')">
          …or create from a file (EPUB, DOCX, CSV, markdown)
        </button>
        <button
          v-if="selected !== 'custom'"
          type="button"
          class="np-import"
          :title="`Seed a small ${KINDS.find(k => k.id === selected)?.label} project you can safely explore`"
          @click="emit('demo', selected)"
        >…or load a demo project</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.np-overlay {
  position: fixed; inset: 0;
  background: rgba(20, 20, 18, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 24px;
}
.np-dialog {
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e3e1dc);
  border-radius: 12px;
  box-shadow: 0 18px 50px rgba(20, 22, 24, 0.25);
  width: min(980px, 96vw);
  padding: 20px 24px;
}
.np-header { display: flex; align-items: flex-start; }
.np-eyebrow {
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--muted, #888);
}
.np-title { font-size: 21px; font-weight: 600; }
.np-close {
  margin-left: auto; border: 0; background: transparent;
  font-size: 22px; line-height: 1; cursor: pointer; color: var(--muted, #888);
}
.np-lede { font-size: 13px; color: var(--ink-2, #4a4a4a); margin: 6px 0 16px; max-width: 720px; }
.np-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.np-card {
  display: flex; flex-direction: column; gap: 7px; text-align: left;
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e3e1dc);
  border-radius: 12px; padding: 15px; cursor: pointer; font: inherit;
}
.np-card:hover { border-color: var(--line-strong, #cfccc4); }
.np-card.sel {
  border-color: var(--accent, #3a7d63);
  box-shadow: 0 0 0 3px var(--accent-soft, #e8f0eb);
}
.np-icon { font-size: 24px; line-height: 1; }
.np-name { font-size: 15.5px; font-weight: 600; }
.np-bullets { margin: 0; padding-left: 16px; font-size: 11.5px; color: var(--ink-2, #4a4a4a); line-height: 1.6; }
.np-foot {
  font-size: 10.5px; color: var(--muted, #888);
  border-top: 1px solid var(--line, #e3e1dc); padding-top: 7px; margin-top: auto;
}
.np-footer { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
.np-input {
  flex: 0 1 320px; height: 34px; padding: 0 12px;
  border: 1px solid var(--line, #e3e1dc); border-radius: 6px;
  font: inherit; font-size: 13px;
}
.np-input:focus { outline: 0; border-color: var(--accent, #3a7d63); box-shadow: 0 0 0 3px var(--accent-soft, #e8f0eb); }
.np-import {
  border: 0; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--muted, #888); text-decoration: underline;
}

@media (max-width: 860px) {
  .np-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
