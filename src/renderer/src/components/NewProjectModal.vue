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

const props = defineProps({
  // Preselect a kind (Home's Start-something pills hand this over).
  initialKind: { type: String, default: "" },
});
const emit = defineEmits(["close", "create", "import", "demo", "focus-only"]);

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

const selected = ref(props.initialKind && KINDS.some((k) => k.id === props.initialKind) ? props.initialKind : "audiobook");
const name = ref("");
const nameInput = ref(null);

const canCreate = computed(() => !!name.value.trim());

function pick(id) {
  selected.value = id;
  // Dead-click fix: choosing a kind suggests a name immediately so
  // Create lights up — typing replaces the suggestion (text selected).
  if (!name.value.trim()) {
    name.value = `My ${KINDS.find((k) => k.id === id)?.label.toLowerCase() || "project"}`;
  }
  nameInput.value?.focus();
  nameInput.value?.select();
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
  <div class="jv-overlay" @click.self="emit('close')" role="dialog" aria-modal="true" aria-labelledby="np-title">
    <div class="jv-modal np-modal">
      <header class="jv-modal__header">
        <div class="jv-modal__titleblock">
          <span class="jv-modal__eyebrow">New project</span>
          <h3 id="np-title" class="jv-modal__title">What are you making?</h3>
        </div>
        <button type="button" class="jv-modal__close" aria-label="Close" @click="emit('close')">✕</button>
      </header>

      <div class="jv-modal__body">
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

      <div class="np-alts">
        <a href="#" class="np-link" @click.prevent="emit('import')">
          …or create from a file (EPUB, DOCX, CSV, markdown)
        </a>
        <a
          v-if="selected !== 'custom'"
          href="#"
          class="np-link"
          :title="`Seed a small ${KINDS.find(k => k.id === selected)?.label} project you can safely explore`"
          @click.prevent="emit('demo', selected)"
        >…or load a demo project</a>
      </div>

      <p class="np-focus-only">
        Not making projects?
        <a href="#" title="Real-time TTS + global hotkey workflows — no project needed" @click.prevent="emit('focus-only', 'dictation')">Set up dictation ➜</a>
        ·
        <a href="#" title="Reader-friendly playback + screen-reader-aware controls" @click.prevent="emit('focus-only', 'accessibility')">Accessibility ➜</a>
      </p>
      </div>

      <footer class="jv-modal__footer">
        <input
          ref="nameInput"
          v-model="name"
          class="jv-input jv-w-name np-name-input"
          placeholder="Project name…"
          @keydown.enter.stop.prevent="create"
        />
        <span class="jv-spacer" />
        <JvButton variant="primary" :disabled="!canCreate" @click="create">Create project ➜</JvButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.np-modal { width: min(980px, 96vw); }
.np-lede { font-size: 13px; color: var(--ink-2, #4a4a4a); margin: 0 0 16px; max-width: 720px; }
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
.np-name-input { flex: 0 1 320px; }
.np-alts { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 14px; }
.np-link {
  font-size: 12px; color: var(--accent-ink, #2c6049); text-decoration: underline;
  cursor: pointer;
}

@media (max-width: 860px) {
  .np-grid { grid-template-columns: repeat(2, 1fr); }
}
.np-focus-only { margin: 10px 0 0; font-size: 11.5px; color: var(--muted, #888); }
.np-focus-only a { color: var(--accent, #3a7d63); text-decoration: underline; }
</style>
