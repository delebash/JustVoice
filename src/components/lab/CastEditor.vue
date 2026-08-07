<!-- SPDX-License-Identifier: MIT -->
<!--
  CastEditor — the attribution Lab's cast editor, ported from the original
  Speaker Lab's Cast pane (JustVioce-old SpeakerLabView.vue: chip list + a
  name input + an aliases input + ＋ Add; the Lab restoration Part 3,
  2026-08-06). No visible ids — ids stay the internal contract; the adapter
  generates them at run time (attributionLab.js parseCharacters).

  v-models the variable's RAW STRING — one character per line,
  "Name | alias, alias" — the ONE agreed shape shared by the editor, the
  parser, the seeded sample and the fill-from-app payloads (Part 6).
-->
<script setup>
import { computed, ref } from "vue";
import { UiButton, UiInput } from "@delebash/llm-ui";

const props = defineProps({ modelValue: { type: String, default: "" } });
const emit = defineEmits(["update:modelValue"]);

// One line per character: "Name" or "Name | alias, alias" (":" tolerated by
// the parser; the editor writes the "|" form). "- " bullets tolerated for
// the identify card's known-characters lines.
const cast = computed(() =>
  String(props.modelValue || "")
    .split("\n")
    .map((line) => line.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean)
    .map((line) => {
      const m = line.split(/[|:]/);
      return {
        name: (m[0] || "").trim(),
        aliases: (m[1] || "").split(",").map((a) => a.trim()).filter(Boolean),
      };
    })
    .filter((c) => c.name));

function serialize(list) {
  return list
    .map((c) => (c.aliases.length ? `${c.name} | ${c.aliases.join(", ")}` : c.name))
    .join("\n");
}

const newName = ref("");
const newAliases = ref("");

function add() {
  const name = newName.value.trim();
  if (!name) return;
  const aliases = newAliases.value.split(",").map((a) => a.trim()).filter(Boolean);
  emit("update:modelValue", serialize([...cast.value, { name, aliases }]));
  newName.value = "";
  newAliases.value = "";
}
function removeAt(i) {
  emit("update:modelValue", serialize(cast.value.filter((_, ix) => ix !== i)));
}
</script>

<template>
  <div class="cast-ed">
    <ul v-if="cast.length" class="cast-ed__chips">
      <li v-for="(c, i) in cast" :key="`${c.name}-${i}`">
        <strong>{{ c.name }}</strong>
        <span v-if="c.aliases.length" class="cast-ed__aliases">aliases: {{ c.aliases.join(", ") }}</span>
        <button type="button" class="cast-ed__x" title="Remove from cast" @click="removeAt(i)">✕</button>
      </li>
    </ul>
    <p v-else class="cast-ed__empty">No cast yet — add everyone who speaks in the passage.</p>
    <div class="cast-ed__add">
      <UiInput v-model="newName" placeholder="Character name" @keydown.enter.prevent="add" />
      <UiInput v-model="newAliases" placeholder="Aliases (comma-separated, optional)" @keydown.enter.prevent="add" />
      <UiButton intent="secondary" size="small" label="＋ Add" @click="add" />
    </div>
  </div>
</template>

<style scoped>
.cast-ed { display: flex; flex-direction: column; gap: 8px; }
.cast-ed__chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.cast-ed__chips li {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid var(--line, #cfccc4); border-radius: 999px;
  padding: 3px 6px 3px 12px; font-size: 12.5px; background: var(--surface, transparent);
}
.cast-ed__aliases { color: var(--ink-2, #777); font-size: 12px; }
.cast-ed__x { border: 0; background: none; cursor: pointer; color: var(--ink-2, #777); font-size: 12px; padding: 2px 4px; }
.cast-ed__x:hover { color: var(--ink, #222); }
.cast-ed__empty { margin: 0; font-size: 12.5px; color: var(--ink-2, #777); }
.cast-ed__add { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
