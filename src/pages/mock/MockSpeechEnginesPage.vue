<!-- SPDX-License-Identifier: MIT -->
<!--
  AI Settings · Speech engines — every audio.cpp model, before anything is downloaded (the mock,
  dev only: #/mock/speech-engines). Slice 4 of docs/plans/2026-10-11-audiocpp-engine-catalog.md;
  the words decided 2026-10-11 ("your rec on all"): commercial use in audio.cpp's words, each
  word explained in the filter and each licence in plain words on hover, in the opened engine and
  in the licence prompt (TASKS "Every speech engine's licence in plain words"), a licence that
  isn't "Yes" accepted once before the first download, audio.cpp's status shown, "Tested by
  JustVoice" / "Not tested by JustVoice yet", a model's memory measured here, else the larger of
  audio.cpp's estimate and the download (2026-10-12), one too big for this card offered on the
  CPU, or tried on the card first when only the estimate is too big (2026-10-12; words
  2026-10-13), a measured size held to the safety margin (the narrowings review, M4), and a
  model remembered as failed on the card, with "Try the card again" (M8). Made from the real tab's shared .ev-*
  classes and services/engineFacts.js — the words SpeechEnginesTab.vue uses — on
  speechEnginesMock.js.
-->
<script setup>
import { computed, reactive, ref } from "vue";
import { AppModal, UiButton, UiSelect, fmtBytes, languageName, pushToast } from "@delebash/llm-ui";
import { COMMERCIAL_OPTIONS, COMMERCIAL_USE, SORTS, licClass, licTitle, memoryText, reading } from "../../services/engineFacts.js";
import { directionCell } from "../../services/personaFacts.js";
import { CARD_MB, ENGINES, SAFETY_MARGIN_MB } from "../../services/mock/speechEnginesMock.js";

const engines = reactive(structuredClone(ENGINES));
const q = ref("");
const commercial = ref("all");
const onlyTested = ref(false);
const onlyDirected = ref(false);
const onlyFits = ref(false);
const sortBy = ref("name");
const kind = ref("all"); // the real tab's kind chips
const KINDS = [
  { id: "all", label: "All" }, { id: "tts", label: "TTS" }, { id: "stt", label: "STT" },
  { id: "cloning", label: "Cloning" }, { id: "presets", label: "Built-in voices" },
];
const open = reactive({ index_tts2: true, omnivoice: true });
const asking = ref(null); // the engine whose licence prompt is open, or null

// Where a model runs (the real tab's Runs on row): Auto is the server's answer for the made-up
// state; GPU or CPU is "your choice" (manager.placementFor).
const PLACEMENT_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "GPU", value: "gpu" },
  { label: "CPU", value: "cpu" },
];
const WHERE = { gpu: "the graphics card", cpu: "the CPU" };
const picked = (m) => m.placement === "gpu" || m.placement === "cpu";
const runsOn = (m) => (picked(m) ? m.placement : m.runs_on);
function placeText(m) {
  const why = picked(m) ? "your choice" : m.runs_on_reason;
  return `${m.loaded ? "Running on" : "Loads on"} ${WHERE[runsOn(m)]}${why ? ` — ${why}` : ""}`;
}
// "Try the card again" forgets the remembered failed card load; Auto then answers as the server
// does when the model fits in the card's free memory.
function tryCardAgain(m) {
  m.failed_on_card = false;
  m.runs_on = "gpu";
  m.runs_on_reason = "it fits in the card's free memory";
}

const memoryOf = (m) =>
  memoryText({ measuredMb: m.measured_mb, needGb: m.need_gb, runsOn: runsOn(m) }, CARD_MB, SAFETY_MARGIN_MB);
const fits = (m) => memoryOf(m).fits === true;
const directed = (m) => m.directed_by === "words" || m.directed_by === "tags";
function langText(m) {
  if (m.languages_note) return m.languages_note;
  return m.languages.length === 1 ? languageName(m.languages[0]) || m.languages[0] : `${m.languages.length} languages`;
}
function modelShown(m) {
  if (kind.value === "stt") return false; // speech recognition isn't in this mock's data
  if (kind.value === "cloning" && !m.voice_cloning) return false;
  if (kind.value === "presets" && !m.preset_voices) return false;
  if (onlyDirected.value && !directed(m)) return false;
  if (onlyFits.value && !fits(m)) return false;
  return true;
}
const modelFiltered = () => kind.value === "cloning" || kind.value === "presets" || onlyDirected.value || onlyFits.value;
function engineShown(e) {
  if (commercial.value !== "all" && e.licence.commercial !== commercial.value) return false;
  if (onlyTested.value && !e.tested) return false;
  const text = `${e.name} ${e.id} ${e.description} ${e.models.map((m) => m.name).join(" ")}`.toLowerCase();
  if (q.value.trim() && !text.includes(q.value.trim().toLowerCase())) return false;
  return true;
}
const smallest = (e, key) => Math.min(...e.models.map((m) => (key === "size" ? m.size_mb : (memoryOf(m).gb ?? Number.POSITIVE_INFINITY))));
const ORDER = {
  name: (a, b) => a.e.name.localeCompare(b.e.name),
  size: (a, b) => smallest(a.e, "size") - smallest(b.e, "size"),
  memory: (a, b) => smallest(a.e, "memory") - smallest(b.e, "memory"),
  commercial: (a, b) => COMMERCIAL_USE.indexOf(a.e.licence.commercial) - COMMERCIAL_USE.indexOf(b.e.licence.commercial),
};
const shown = computed(() => {
  const list = engines.filter(engineShown).map((e) => ({ e, models: e.models.filter(modelShown) })).filter((g) => g.models.length);
  return [...list].sort((a, b) => ORDER[sortBy.value](a, b) || ORDER.name(a, b));
});
const modelCount = computed(() => engines.reduce((n, e) => n + e.models.length, 0));
function clearFilters() {
  q.value = "";
  kind.value = "all";
  commercial.value = "all";
  onlyTested.value = onlyDirected.value = onlyFits.value = false;
}

const isOpen = (e) => open[e.id] ?? (Boolean(q.value.trim()) || modelFiltered() || e.models.some((m) => m.loaded));
const gated = (e) => e.licence.commercial !== "Yes";
const fmtDisk = (mb) => fmtBytes(mb * 1024 * 1024);
function summary(e) {
  const onDisk = e.models.filter((m) => m.on_disk).length;
  return `${e.models.length} model${e.models.length === 1 ? "" : "s"} · ${onDisk ? `${onDisk} on disk` : "none on disk"}`;
}

function download(e, m) {
  if (gated(e) && !e.termsAccepted) {
    asking.value = e;
    return;
  }
  m.on_disk = true;
  pushToast({ kind: "success", message: `${m.name} downloaded.`, duration: 4000 });
}
function accept(e) {
  e.termsAccepted = true;
  asking.value = null;
  pushToast({ kind: "success", message: `${e.name}'s models can be downloaded now.` });
}
</script>

<template>
  <div class="mock-engines">
    <div class="ev-toprow">
      <div class="jv-searchbar">
        🔍 <input v-model="q" placeholder="Search speech models and engines…">
      </div>
      <div class="ev-chips">
        <button v-for="f in KINDS" :key="f.id" type="button" class="ev-chip" :class="{ on: kind === f.id }" @click="kind = f.id">{{ f.label }}</button>
      </div>
    </div>
    <div class="ev-toprow">
      <UiSelect v-model="commercial" :options="COMMERCIAL_OPTIONS" width="name" aria-label="Commercial use" />
      <div class="ev-chips">
        <button type="button" class="ev-chip" :class="{ on: onlyTested }" @click="onlyTested = !onlyTested">Tested by JustVoice</button>
        <button type="button" class="ev-chip" :class="{ on: onlyDirected }" @click="onlyDirected = !onlyDirected">Takes direction</button>
        <button type="button" class="ev-chip" :class="{ on: onlyFits }" @click="onlyFits = !onlyFits">Fits this card</button>
      </div>
      <UiSelect v-model="sortBy" :options="SORTS" width="name" aria-label="Sort" />
    </div>

    <div v-if="!shown.length" class="jv-card ev-nomatch">
      <p class="jv-lede">No engines match these filters.</p>
      <UiButton intent="secondary" size="small" label="Clear filters" @click="clearFilters" />
    </div>

    <div class="ev-section-h">
      <h3>Voice generation <span class="suffix">— TTS</span></h3>
      <span class="count">{{ engines.length }} engines · {{ modelCount }} models</span>
      <span class="note">one model loaded at a time — loading another swaps the TTS slot</span>
    </div>

    <div v-for="g in shown" :key="g.e.id" class="ev-group">
      <div class="ev-ghead" @click="open[g.e.id] = !isOpen(g.e)">
        <span class="chev" :class="{ open: isOpen(g.e) }">▶</span>
        <span class="nm">{{ g.e.name }}</span><span class="id">{{ g.e.id }}</span>
        <span class="ev-caps">
          <span class="ev-cap tts">TTS</span>
          <span class="ev-lic" :class="licClass(g.e.licence.commercial)" :title="licTitle(g.e.licence)">Commercial use: {{ g.e.licence.commercial }}</span>
          <span class="ev-cap" :class="{ tested: g.e.tested }" :title="g.e.tested?.note || 'Works as audio.cpp describes it; JustVoice hasn\'t listened to it yet'">
            {{ g.e.tested ? 'TESTED BY JUSTVOICE' : 'NOT TESTED BY JUSTVOICE YET' }}
          </span>
        </span>
        <span class="desc" :title="g.e.description">{{ g.e.description }}</span>
        <span class="gsum">
          <span class="meta">{{ summary(g.e) }}</span>
          <span v-if="g.e.models.some((m) => m.loaded)" class="ldd">● {{ g.e.models.find((m) => m.loaded).name }} loaded · CUDA</span>
        </span>
      </div>

      <div v-if="isOpen(g.e)" class="ev-gbody">
        <div class="ev-gnote">
          <span v-if="g.e.best_for.length">Best for: {{ g.e.best_for.join(" · ") }}</span>
          <span v-if="g.e.tested">Tested by JustVoice: {{ g.e.tested.note }}</span>
          <span>Commercial use: {{ g.e.licence.summary }}
            <span class="ev-gnote-src">({{ reading(g.e.licence) }} ·
              <a :href="g.e.licence.url" target="_blank" rel="noopener">read it at its source</a>)</span></span>
        </div>
        <template v-for="m in g.models" :key="m.id">
          <div class="ev-model">
            <span class="vn">{{ m.name }}</span>
            <span class="ev-vchips">
              <span class="ev-cap">{{ langText(m) }}</span>
              <span v-if="m.voice_cloning" class="ev-cap clone" title="Clones a voice from a short clean sample">CLONING</span>
              <span v-if="m.preset_voices" class="ev-cap presets" :title="`${m.preset_voices} built-in voices — no sample needed`">BUILT-IN · {{ m.preset_voices }}</span>
              <span class="ev-cap" :class="{ directed: directionCell(m.directed_by).intent === 'success' }"
                :title="directionCell(m.directed_by).title">{{ directionCell(m.directed_by).label.toUpperCase() }}</span>
              <span class="ev-cap" title="audio.cpp's own status for this model">{{ g.e.catalog_status.toUpperCase() }}</span>
            </span>
            <span class="vmeta">{{ fmtDisk(m.size_mb) }}<template v-if="m.on_disk"> · on disk</template></span>
            <span class="right">
              <span v-if="m.loaded" class="ev-badge loaded">● Loaded</span>
              <span v-if="m.loaded" class="ev-memhint" title="Measured on this machine at load">{{ fmtDisk(m.measured_mb) }} measured</span>
              <span v-else class="ev-memhint"><span :class="{ 'jv-text-warn': memoryOf(m).warn }">{{ memoryOf(m).text }}</span></span>
              <UiButton v-if="!m.on_disk" intent="primary" size="small" :label="`Download (${fmtDisk(m.size_mb)})`" @click="download(g.e, m)" />
              <UiButton v-else-if="!m.loaded" intent="primary" size="small" label="Load model" />
            </span>
          </div>
          <div v-if="m.runs_on" class="ev-mplace" :data-variant="m.id">
            Runs on
            <UiSelect :modelValue="m.placement || 'auto'" width="token" size="small" :options="PLACEMENT_OPTIONS"
              title="Auto picks from what was measured on this machine: the graphics card when the model fits in its free memory or beside the AI model, else the CPU when the model is fast enough there."
              @update:modelValue="(p) => (m.placement = p)" />
            <span class="ev-mplace__why">{{ placeText(m) }}</span>
            <UiButton v-if="m.failed_on_card" intent="ghost" size="small" label="Try the card again"
              @click="tryCardAgain(m)" />
          </div>
        </template>
        <div v-if="gated(g.e)" class="ev-gfoot">
          <span v-if="g.e.termsAccepted">Licence accepted — downloads are on</span>
          <template v-else>
            <span>Downloads wait until you accept its licence ({{ g.e.licence.name }})</span>
            <UiButton intent="secondary" size="small" label="Read and accept" @click="asking = g.e" />
          </template>
        </div>
      </div>
    </div>

    <AppModal v-if="asking" :eyebrow="`Before downloading ${asking.name}`" :title="`${asking.name}'s licence`"
      max-width="620px" @close="asking = null">
      <p class="mock-engines__lede">
        {{ asking.name }}'s licence isn't a plain yes for commercial use, so it's yours to read before
        you download the model. Here it is in plain words.
      </p>
      <div class="jv-banner mock-engines__terms">{{ asking.licence.summary }}</div>
      <p class="jv-hint">
        {{ reading(asking.licence) }}. The licence text at its source is what counts — you accept once, on this install.
        <a v-if="asking.licence.url" :href="asking.licence.url" target="_blank" rel="noopener">Read the licence at its source</a>.
      </p>
      <template #footer>
        <UiButton intent="ghost" label="Not now" @click="asking = null" />
        <span class="jv-spacer" />
        <UiButton intent="primary" label="Accept the licence" @click="accept(asking)" />
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.mock-engines { padding: 4px 0 24px; }
.mock-engines__lede { margin: 0 0 12px; max-width: 62ch; }
.mock-engines__terms { white-space: pre-wrap; margin: 0 0 12px; max-width: 62ch; }
</style>
