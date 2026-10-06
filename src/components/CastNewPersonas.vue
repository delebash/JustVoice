<!-- SPDX-License-Identifier: MIT -->
<!--
  ＋ New persona for the N with none — the proposals, shown before anything is
  made (decided 2026-10-05: "Show the proposals before creating anything
  (speaker → voice, ▶ to hear each, untick any, then Create N personas) … since
  this adds to your library"). StudioCast.vue builds them: a speaker whose name
  is already a persona in your library is cast with it (no new one); everyone
  else gets the voice your language model matched — from the installed voices
  that speak the book's language — and a persona named after them with an
  empty note. Create makes the ticked ones and casts them.
  A speaker the model matched no voice to gets a Voice dropdown of those same
  voices (decided 2026-10-06, "your rec a go": the model skips speakers it
  knows little about — RESEARCH §7); picking one ticks the row.
-->
<script setup>
import { computed, onBeforeUnmount, ref } from "vue";
import { AppModal, UiButton, UiCheckbox, UiSelect, UiTable, UiTag, pushToast } from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { handleTermsRefusal } from "../services/engineTerms.js";
import { andList } from "../services/newPersonas.js";
import { voiceLabel } from "../services/personaFacts.js";
import { auditionVoice } from "../services/voiceAudition.js";

const props = defineProps({
  // [{speaker, persona}] — cast with the library persona of exactly that name.
  byName: { type: Array, default: () => [] },
  // [{speaker, voice}] — a new persona each; voice null when none was matched.
  proposals: { type: Array, default: () => [] },
  // The voices the batch matched from — an unmatched row picks from them.
  voices: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "create"]);

const api = useApi();
const on = ref(Object.fromEntries(props.proposals.map((p) => [p.speaker.id, !!p.voice])));
const chosen = ref({});      // speaker id → the voice you picked, for a row the model left without one
const voiceById = computed(() => Object.fromEntries(props.voices.map((v) => [v.id, v])));
const voiceOptions = computed(() => props.voices.map((v) => ({ value: v.id, label: voiceLabel(v) })));
// The speakers the model skipped lead the list, named above it (decided
// 2026-10-06: "Create 7" read as done while three were left).
const rows = computed(() => props.proposals.map((p) => ({
  ...p, id: p.speaker.id, matched: !!p.voice, voice: p.voice || chosen.value[p.speaker.id] || null,
})).sort((a, b) => a.matched - b.matched));
const skipped = computed(() => props.proposals.filter((p) => !p.voice).map((p) => p.speaker.name));
const picked = computed(() => rows.value.filter((r) => r.voice && on.value[r.id])
  .map((r) => ({ speaker: r.speaker, voice: r.voice })));
function pickVoice(row, id) {
  chosen.value = { ...chosen.value, [row.id]: voiceById.value[id] || null };
  on.value = { ...on.value, [row.id]: !!voiceById.value[id] };
}
const COLUMNS = [
  { id: "pick", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "speaker", header: "Speaker" },
  { id: "voice", header: "Voice" },
  { id: "play", header: "", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap" } },
];
const createLabel = computed(() => {
  const n = picked.value.length;
  const m = props.byName.length;
  if (!n && m) return `Cast ${m}`;
  return `Create ${n} persona${n === 1 ? "" : "s"}${m ? ` · cast ${m}` : ""}`;
});

// ▶ — the voice on its own, asking before it loads a model (as every ▶ does).
const playing = ref(null);   // { id, url }
const loading = ref(null);
async function play(p) {
  if (loading.value) return;
  loading.value = p.speaker.id;
  try {
    const blob = await auditionVoice(api, p.voice);
    if (blob instanceof Blob) {
      if (playing.value?.url) URL.revokeObjectURL(playing.value.url);
      playing.value = { id: p.speaker.id, url: URL.createObjectURL(blob) };
    }
  } catch (e) {
    if (!handleTermsRefusal(e)) pushToast({ kind: "error", message: `Couldn't play the voice: ${e?.message || e}` });
  } finally {
    loading.value = null;
  }
}
onBeforeUnmount(() => { if (playing.value?.url) URL.revokeObjectURL(playing.value.url); });
</script>

<template>
  <AppModal eyebrow="＋ New personas" title="A persona for each speaker with none" max-width="760px" dismissable
    @close="emit('close')">
    <p class="cast-new__lede">
      Each new persona is named after its speaker and gets the voice your language model matched to who they
      are. Its note on how it sounds is left for you to write. Where it matched none, pick a voice. Untick any
      you'd rather cast yourself.
    </p>
    <div v-if="byName.length" class="cast-new__byname">
      <strong>Cast with your persona of the same name</strong>
      <span v-for="x in byName" :key="x.speaker.id" class="jv-hint">{{ x.speaker.name }} → persona {{ x.persona.name }}</span>
    </div>
    <p v-if="skipped.length" class="cast-new__skipped jv-text-warn">
      Your model matched no voice for {{ andList(skipped) }} — pick one{{ skipped.length > 1 ? " for each" : "" }},
      or they stay without a persona.
    </p>
    <UiTable v-if="rows.length" class="jv-table-look" :data="rows" :columns="COLUMNS" data-key="id">
      <template #pick="{ row }">
        <UiCheckbox :model-value="!!row.voice && !!on[row.id]" :disabled="!row.voice"
          @update:model-value="(v) => (on = { ...on, [row.id]: v })" />
      </template>
      <template #speaker="{ row }"><strong>{{ row.speaker.name }}</strong></template>
      <template #voice="{ row }">
        <span v-if="row.matched">{{ voiceLabel(row.voice) }}</span>
        <span v-else class="cast-new__pick">
          <UiTag v-if="!row.voice" intent="accent2">No voice yet</UiTag>
          <UiSelect :model-value="row.voice?.id || ''" :options="voiceOptions" width="path"
            placeholder="Pick a voice" @update:model-value="(id) => pickVoice(row, id)" />
        </span>
      </template>
      <template #play="{ row }">
        <UiButton v-if="row.voice" intent="ghost" size="small" label="▶" :loading="loading === row.id"
          :title="`Play ${row.voice.name} on its own`" @click="play(row)" />
      </template>
    </UiTable>
    <audio v-if="playing" :src="playing.url" controls autoplay class="jv-audio-inline" />
    <template #footer>
      <UiButton intent="secondary" label="Cancel" :disabled="busy" @click="emit('close')" />
      <UiButton intent="primary" :label="createLabel" :loading="busy" :disabled="!picked.length && !byName.length"
        @click="emit('create', picked)" />
    </template>
  </AppModal>
</template>

<style scoped>
.cast-new__lede { margin: 0 0 10px; max-width: 60ch; }
.cast-new__byname { display: flex; flex-direction: column; gap: 2px; margin: 0 0 10px; }
.cast-new__skipped { margin: 0 0 10px; max-width: 60ch; }
.cast-new__pick { display: inline-flex; align-items: center; gap: 8px; }
</style>
