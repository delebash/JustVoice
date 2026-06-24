<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  KeyboardCheatsheet — `?` overlay listing the app's discoverable shortcuts.

  Plan Q7 / Slice 2. Opens on `?` keypress (when no input is focused),
  Esc to dismiss. Lives at the App level so any view can document its
  view-specific shortcuts in addition to the global ones.
-->
<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { AppModal } from "@delebash/llm-ui";

const open = ref(false);

// Map view IDs → shortcut bindings. App.vue's view ref isn't reachable
// here, so we group by category and let the user scan. Add new entries
// as new shortcuts land.
const GROUPS = [
  {
    title: "Navigation",
    items: [
      { keys: ["?"], label: "Open this shortcut cheatsheet" },
      { keys: ["Esc"], label: "Close modals / drawers / this cheatsheet" },
    ],
  },
  {
    title: "Generate",
    items: [
      { keys: ["/"], label: "Open paralinguistic tag menu (slash menu)" },
    ],
  },
  {
    title: "Studio Script",
    items: [
      { keys: ["Right-click"], label: "Rewrite a dialogue block in character (preview-then-accept)" },
    ],
  },
  {
    title: "Studio Cast",
    items: [
      { keys: ["Click voice name"], label: "Assign voice to selected character" },
      { keys: ["Click gender chip"], label: "Cycle gender hint (female / male / neutral / engine default)" },
    ],
  },
  {
    title: "Engines",
    items: [
      { keys: ["+ Add provider"], label: "Register a new LLM or TTS provider (Claude, ElevenLabs, etc.)" },
    ],
  },
];

const focusInsideInput = computed(() => {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable;
});

function onKeyDown(e) {
  // Esc closes when open — works even if the focus shifted into an input.
  if (open.value && e.key === "Escape") {
    open.value = false;
    e.preventDefault();
    return;
  }
  // `?` opens — only when no input is focused (so users can still type `?`
  // in the textarea).
  if (e.key === "?" && !focusInsideInput.value) {
    open.value = !open.value;
    e.preventDefault();
  }
}

onMounted(() => {
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", onKeyDown);
  }
});
onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", onKeyDown);
  }
});
</script>

<template>
  <AppModal
    v-if="open"
    eyebrow="Keyboard shortcuts"
    title="Quick reference"
    dismissable
    @close="open = false"
  >
    <div class="cheatsheet__body">
      <section v-for="g in GROUPS" :key="g.title" class="cheatsheet__group">
        <h4 class="cheatsheet__group-title">{{ g.title }}</h4>
        <dl class="cheatsheet__list">
          <template v-for="(item, i) in g.items" :key="i">
            <dt class="cheatsheet__keys">
              <kbd v-for="k in item.keys" :key="k">{{ k }}</kbd>
            </dt>
            <dd class="cheatsheet__label">{{ item.label }}</dd>
          </template>
        </dl>
      </section>
    </div>
    <template #footer>
      <span class="jv-muted" style="font-size: 12px">Press <kbd>?</kbd> to toggle, <kbd>Esc</kbd> to close.</span>
    </template>
  </AppModal>
</template>

<style scoped>
.cheatsheet__body { display: flex; flex-direction: column; gap: 18px; }
.cheatsheet__group-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
  margin: 0 0 6px;
}
.cheatsheet__list {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 16px;
  margin: 0;
  align-items: baseline;
}
.cheatsheet__keys { display: flex; gap: 4px; }
.cheatsheet__label { margin: 0; color: var(--ink-2); font-size: 13px; }
kbd {
  display: inline-block;
  font: inherit;
  font-size: 11.5px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  padding: 1px 6px;
  border-radius: 3px;
  color: var(--ink);
  font-family: var(--font-mono);
}
</style>
