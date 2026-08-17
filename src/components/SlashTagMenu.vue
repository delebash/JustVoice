<!-- SPDX-License-Identifier: MIT -->
<!--
  Engine-aware slash menu for inserting inline tags into a textarea.

  Driven by the EngineCapabilityDetail.inline_tags taxonomy fetched
  from /v1/engines/capabilities. Different engines use different
  syntaxes — Chatterbox-Turbo `[laugh]`,
  MOSS `[S1]` + `[pause 1.5s]`. The menu reads the
  syntax + placement rule from the manifest entry, so the same
  component works across engines without per-engine branches.

  Usage:
    <SlashTagMenu
      :tag-sets="engineCaps.inline_tags"
      :open="menuOpen"
      :anchor="anchorEl"
      :query="query"
      @insert="onInsert"
      @close="menuOpen = false"
    />

  Emits `insert` with {syntax, placement, value, tag} so the parent
  can drop the formatted token at cursor or at start-of-turn per
  placement rule.
-->

<script setup>
import { computed, ref, watch, nextTick } from "vue";

const props = defineProps({
  tagSets: { type: Array, default: () => [] },  // InlineTagSet[]
  open: { type: Boolean, default: false },
  anchor: { type: Object, default: null },       // DOMRect-shaped { top, left, bottom }
  query: { type: String, default: "" },
});

const emit = defineEmits(["insert", "close"]);

const activeIdx = ref(0);

// Flatten + filter all tags from all categories matching the query.
// Result is a flat list of { category, label, tag, syntax, placement }
// items ready to render and insert.
const filtered = computed(() => {
  const q = (props.query || "").toLowerCase().replace(/^\//, "");
  const out = [];
  for (const set of props.tagSets || []) {
    for (const tag of set.tags || []) {
      if (q && !tag.toLowerCase().includes(q) && !set.category.toLowerCase().includes(q)) continue;
      out.push({
        category: set.category,
        categoryLabel: set.label,
        tag,
        syntax: set.syntax,
        placement: set.placement || "inline_anywhere",
        rendered: (set.syntax || "{value}").replace("{value}", tag),
      });
    }
  }
  return out.slice(0, 30);  // cap visible to avoid blowout on engines with 40+ tags
});

// Reset selection when query changes.
watch(() => props.query, () => { activeIdx.value = 0; });

function onSelect(idx) {
  const item = filtered.value[idx];
  if (!item) return;
  emit("insert", item);
  emit("close");
}

function onKeydown(e) {
  if (!props.open) return;
  if (e.key === "ArrowDown") { activeIdx.value = (activeIdx.value + 1) % filtered.value.length; e.preventDefault(); }
  else if (e.key === "ArrowUp")  { activeIdx.value = (activeIdx.value - 1 + filtered.value.length) % filtered.value.length; e.preventDefault(); }
  else if (e.key === "Enter" || e.key === "Tab") { onSelect(activeIdx.value); e.preventDefault(); }
  else if (e.key === "Escape")   { emit("close"); }
}

// Bind once when open. defineExpose lets the parent call this from its
// own keydown handler — easier than competing keydown listeners.
defineExpose({ onKeydown });

// Position the menu just below the anchor element.
const popoverStyle = computed(() => {
  if (!props.anchor) return {};
  return {
    position: "absolute",
    top: `${props.anchor.bottom + 6}px`,
    left: `${props.anchor.left}px`,
  };
});

// Scroll the active item into view as ArrowDown walks past it.
const menuRef = ref(null);
watch(activeIdx, async () => {
  await nextTick();
  const el = menuRef.value?.querySelector(`[data-idx="${activeIdx.value}"]`);
  el?.scrollIntoView({ block: "nearest" });
});
</script>

<template>
  <div v-if="open && filtered.length" ref="menuRef" class="slash-menu" :style="popoverStyle">
    <div class="slash-menu__hint">
      Tag · ↑↓ navigate · Enter insert · Esc close
    </div>
    <button
      v-for="(item, i) in filtered"
      :key="`${item.category}-${item.tag}`"
      :data-idx="i"
      class="slash-menu__item"
      :class="{ 'slash-menu__item--active': i === activeIdx }"
      @click="onSelect(i)"
      @mouseenter="activeIdx = i"
    >
      <span class="slash-menu__cat">{{ item.categoryLabel }}</span>
      <code class="slash-menu__rendered">{{ item.rendered }}</code>
      <span v-if="item.placement === 'start_of_turn'" class="slash-menu__place" title="Goes at start of line">↥</span>
    </button>
  </div>
  <p v-else-if="open" class="slash-menu slash-menu--empty" :style="popoverStyle">
    No tags match — this engine has no matching inline tags.
  </p>
</template>

<style scoped>
.slash-menu {
  z-index: 9000;
  width: 360px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  padding: 6px 0;
  font-size: 12.5px;
}
.slash-menu__hint {
  padding: 4px 12px 6px;
  font-size: 10.5px;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  text-transform: uppercase;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.slash-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: var(--ink);
}
.slash-menu__item:hover,
.slash-menu__item--active {
  background: var(--surface-2);
}
.slash-menu__cat {
  min-width: 92px;
  font-size: 10.5px;
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.slash-menu__rendered {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink);
}
.slash-menu__place {
  color: var(--accent);
  font-size: 13px;
}
.slash-menu--empty {
  padding: 12px;
  color: var(--ink-3);
  font-style: italic;
}
</style>
