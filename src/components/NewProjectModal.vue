<!-- SPDX-License-Identifier: MIT -->
<script setup>
// "What are you making?" — the kind picker (CONCEPTS.md §6, mock #audiobook/1).
//
// Picking a kind sets the sidebar vocabulary, Studio steps, mastering
// target, and export surface for the project. Replaces the old native
// prompt() pair in ProjectsView (native dialogs are banned — project_gotchas).
//
// Emits:
//   close   — cancel / Esc
//   create  — { name, project_type } (caller owns the API call)
//   import  — user chose to create from a file instead (caller opens ImportModal)

import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { UiButton, UiInput, AppModal } from "@delebash/llm-ui";

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
  <AppModal eyebrow="New project" title="What are you making?" :max-width="'980px'" dismissable @close="emit('close')">
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
        <span class="np-alts__lead">Or start from —</span>
        <UiButton intent="ghost" size="small" title="Import EPUB, DOCX, CSV, or markdown" @click="emit('import')">
          <template #icon>📄</template>a file
        </UiButton>
        <UiButton
          v-if="selected !== 'custom'"
          intent="ghost"
          size="small"
          :title="`Seed a small ${KINDS.find(k => k.id === selected)?.label} project you can safely explore`"
          @click="emit('demo', selected)"
        >
          <template #icon>✨</template>a demo project
        </UiButton>
      </div>

      <p class="np-focus-only">
        Not making projects?
        <a href="#" title="Real-time TTS + global hotkey workflows — no project needed" @click.prevent="emit('focus-only', 'dictation')">Set up dictation ➜</a>
        ·
        <a href="#" title="Reader-friendly playback + screen-reader-aware controls" @click.prevent="emit('focus-only', 'accessibility')">Accessibility ➜</a>
      </p>

    <template #footer>
      <UiInput
        ref="nameInput"
        v-model="name"
        width="name"
        class="np-name-input"
        placeholder="Project name…"
        @keydown.enter.stop.prevent="create"
      />
      <span class="jv-spacer" />
      <UiButton intent="primary" :disabled="!canCreate" @click="create">Create project ➜</UiButton>
    </template>
  </AppModal>
</template>

<style scoped>
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
/* Alternatives to picking a kind. Set off from the card grid by a hairline so
   the zone reads as a deliberate "or start another way" rather than two links
   floating under the cards. Ghost buttons (thin-bordered quiet utilities)
   replace the old underlined <a>s, which read as unstyled text and could wrap
   mid-phrase when squeezed. The lead-in + short labels read as one sentence:
   "Or start from — [a file] [a demo project]". */
.np-alts {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  margin-top: 16px; padding-top: 14px;
  border-top: 1px solid var(--line, #e3e1dc);
}
.np-alts__lead { font-size: 12px; color: var(--muted, #888); }

@media (max-width: 860px) {
  .np-grid { grid-template-columns: repeat(2, 1fr); }
}
.np-focus-only { margin: 10px 0 0; font-size: 11.5px; color: var(--muted, #888); }
.np-focus-only a { color: var(--accent, #3a7d63); text-decoration: underline; }
</style>
