<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  VoicePicker — the one voice dropdown (plan WS3), replacing the five
  divergent per-view pickers.

  Shows EVERY renderable voice grouped by engine, with an availability
  badge per row:
    ●  engine loaded — renders immediately
    ⇄  engine cold — rendering swaps engines (swap prompt handles it)
    ⬇  engine not installed — row disabled; install on the Engines tab

  Picking a voice NEVER triggers a load (decision D1) — the swap cost is
  paid (and prompted for) at render time via services/engineSwap.js.

  Native <select> + <optgroup> on purpose: keyboard/typeahead a11y for
  free, and the chip-overlay pattern the views already use (an invisible
  select stretched over a styled chip) keeps working — pass the view's
  chip class via `selectClass`.
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  // /v1/voices rows: { id, name, engine, language, engine_loaded, ... }
  voices: { type: Array, default: () => [] },
  // /v1/engines rows — used to mark not-installed engines' voices. When
  // absent, cold voices all show the swap badge (never wrongly disabled).
  engines: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: "Pick a voice" },
  selectClass: { type: String, default: "" },
  title: { type: String, default: "Pick a voice" },
});
const emit = defineEmits(["update:modelValue"]);

const engineStatus = computed(() => {
  const map = {};
  for (const e of props.engines) map[e.id] = e.status;
  return map;
});

function badge(v) {
  if (v.engine_loaded) return "●";
  if (engineStatus.value[v.engine] === "not_installed") return "⬇";
  return "⇄";
}

function rowDisabled(v) {
  return engineStatus.value[v.engine] === "not_installed";
}

const groups = computed(() => {
  const byEngine = new Map();
  for (const v of props.voices) {
    const key = v.engine || "other";
    if (!byEngine.has(key)) byEngine.set(key, []);
    byEngine.get(key).push(v);
  }
  // Loaded engine's group first, then alphabetical.
  return [...byEngine.entries()]
    .sort(([a, va], [b, vb]) => {
      const al = va.some((v) => v.engine_loaded) ? 0 : 1;
      const bl = vb.some((v) => v.engine_loaded) ? 0 : 1;
      return al - bl || a.localeCompare(b);
    })
    .map(([engine, list]) => ({
      engine,
      label: `${engine}${list.some((v) => v.engine_loaded) ? " — loaded" : ""}`,
      voices: list,
    }));
});

function optionLabel(v) {
  const lang = v.language ? ` · ${v.language}` : "";
  return `${badge(v)} ${v.name || v.id}${lang}`;
}
</script>

<template>
  <select
    :value="modelValue"
    :disabled="disabled || voices.length === 0"
    :class="selectClass || 'voice-picker'"
    :title="title"
    @change="emit('update:modelValue', $event.target.value)"
  >
    <option v-if="!modelValue" value="" disabled>{{ voices.length ? placeholder : "no voices" }}</option>
    <optgroup v-for="g in groups" :key="g.engine" :label="g.label">
      <option
        v-for="v in g.voices"
        :key="`${g.engine}:${v.id}`"
        :value="v.id"
        :disabled="rowDisabled(v)"
        :title="rowDisabled(v) ? `${v.engine} is not installed — install it on the Engines tab` : (v.engine_loaded ? 'Engine loaded — renders immediately' : 'Rendering will swap engines')"
      >
        {{ optionLabel(v) }}
      </option>
    </optgroup>
  </select>
</template>

<style scoped>
.voice-picker {
  /* Matches JvSelect's footprint for the standalone (non-chip) uses. */
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--line-1);
  background: var(--bg-1);
  color: var(--ink-1);
  font-size: 13px;
}
</style>
