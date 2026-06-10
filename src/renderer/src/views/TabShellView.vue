<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  TabShellView — generic sub-tab host (plan WS5 nav consolidation).

  Library, Labs, and Settings are shells over existing views: the views
  are re-homed, not rewritten. Sub-tab selection round-trips through the
  hash as #<baseId>/<tabId> (e.g. #library/voices) so deep links and
  back/forward keep working; App.vue's router matches on the base segment.

  Only the active tab's component is mounted — same lifecycle behavior
  as switching top-level views.
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  // "library" | "labs" | "settings" — the hash base segment.
  baseId: { type: String, required: true },
  // [{ id, label, icon?, component }]
  tabs: { type: Array, required: true },
});

const active = ref(props.tabs[0]?.id || "");

const activeTab = computed(
  () => props.tabs.find((t) => t.id === active.value) || props.tabs[0],
);

function readHash() {
  const raw = (window.location.hash || "").replace(/^#/, "");
  const [base, sub] = raw.split("/");
  if (base === props.baseId && sub && props.tabs.some((t) => t.id === sub)) {
    active.value = sub;
  }
}

function writeHash() {
  const target = `#${props.baseId}/${active.value}`;
  if (window.location.hash !== target) {
    window.history.replaceState(null, "", target);
  }
}

onMounted(() => {
  readHash();
  writeHash();
  window.addEventListener("hashchange", readHash);
});
onBeforeUnmount(() => window.removeEventListener("hashchange", readHash));
watch(active, writeHash);
</script>

<template>
  <div class="tabshell">
    <div class="tabshell__tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="tabshell__tab"
        :class="{ 'tabshell__tab--active': active === t.id }"
        @click="active = t.id"
      >
        <span v-if="t.icon" class="tabshell__tab-icon">{{ t.icon }}</span>
        {{ t.label }}
      </button>
    </div>
    <component :is="activeTab.component" :key="activeTab.id" />
  </div>
</template>

<style scoped>
.tabshell { display: flex; flex-direction: column; gap: 16px; }
.tabshell__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--line-1, var(--border-soft));
  flex-wrap: wrap;
}
.tabshell__tab {
  appearance: none;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 8px 14px;
  font: inherit;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
}
.tabshell__tab:hover { color: var(--ink-1, var(--ink)); }
.tabshell__tab--active {
  color: var(--accent-ink, var(--accent));
  border-bottom-color: var(--accent);
  font-weight: 600;
}
.tabshell__tab-icon { margin-right: 4px; }
</style>
