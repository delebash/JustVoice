<!-- SPDX-License-Identifier: MIT -->
<!--
  AI Settings · Speech engines — every audio.cpp model, before anything is downloaded (the mock,
  dev only: #/mock/speech-engines). Slice 4 of docs/plans/2026-10-11-audiocpp-engine-catalog.md;
  the words decided 2026-10-11 ("your rec on all"): commercial use in audio.cpp's own words, a
  licence that isn't "Yes" accepted once before the first download, audio.cpp's status shown,
  "Tested by JustVoice" / "Not tested by JustVoice yet", a model too big for this card listed and
  offered on the CPU. Made from the real tab's shared .ev-* classes on speechEnginesMock.js.
-->
<script setup>
import { computed, reactive, ref } from "vue";
import { AppModal, UiButton, UiSelect, fmtBytes, pushToast } from "@delebash/llm-ui";
import { directionCell } from "../../services/personaFacts.js";
import { CARD_GB, COMMERCIAL_USE, ENGINES } from "../../services/mock/speechEnginesMock.js";

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
  { id: "clone", label: "Cloning" }, { id: "presets", label: "Built-in voices" },
];
const open = reactive({ index_tts2: true, omnivoice: true });
const asking = ref(null); // the engine whose licence prompt is open, or null

const COMMERCIAL_OPTIONS = [{ label: "Any commercial use", value: "all" }, ...COMMERCIAL_USE.map((c) => ({ label: `Commercial use: ${c}`, value: c }))];
const SORTS = [
  { label: "Sort: name", value: "name" },
  { label: "Sort: download size", value: "size" },
  { label: "Sort: memory needed", value: "memory" },
  { label: "Sort: commercial use", value: "commercial" },
];

const fits = (m) => m.needGb != null && m.needGb <= CARD_GB;
const directed = (m) => m.directedBy === "words" || m.directedBy === "tags";
function modelShown(e, m) {
  const text = `${e.name} ${e.id} ${m.name} ${e.description}`.toLowerCase();
  if (q.value.trim() && !text.includes(q.value.trim().toLowerCase())) return false;
  if (commercial.value !== "all" && e.licence.commercial !== commercial.value) return false;
  if (onlyTested.value && !e.tested) return false;
  if (onlyDirected.value && !directed(m)) return false;
  if (onlyFits.value && !fits(m)) return false;
  if (kind.value === "stt") return false; // speech recognition isn't in this mock's data
  if (kind.value === "clone" && !m.cloning) return false;
  if (kind.value === "presets" && !m.presets) return false;
  return true;
}
const smallest = (e, key) => Math.min(...e.models.map((m) => (key === "size" ? m.sizeMb : (m.needGb ?? 999))));
const shown = computed(() => {
  const list = engines.map((e) => ({ e, models: e.models.filter((m) => modelShown(e, m)) })).filter((g) => g.models.length);
  const order = {
    name: (a, b) => a.e.name.localeCompare(b.e.name),
    size: (a, b) => smallest(a.e, "size") - smallest(b.e, "size"),
    memory: (a, b) => smallest(a.e, "memory") - smallest(b.e, "memory"),
    commercial: (a, b) => COMMERCIAL_USE.indexOf(a.e.licence.commercial) - COMMERCIAL_USE.indexOf(b.e.licence.commercial),
  }[sortBy.value];
  return [...list].sort(order);
});
const modelCount = computed(() => shown.value.reduce((n, g) => n + g.models.length, 0));
const filtered = computed(() => q.value.trim() || kind.value !== "all" || commercial.value !== "all" || onlyTested.value || onlyDirected.value || onlyFits.value);
function clearFilters() {
  q.value = "";
  kind.value = "all";
  commercial.value = "all";
  onlyTested.value = onlyDirected.value = onlyFits.value = false;
}

const isOpen = (e) => Boolean(open[e.id]);
const licClass = (c) => ({ Conditional: "ev-lic--warn", No: "ev-lic--no", Unclear: "ev-lic--unclear" })[c] || "";
const licTitle = (l) => [l.name, l.notes, "The licence text at its source is what counts."].filter(Boolean).join(" — ");
const gated = (e) => e.licence.commercial !== "Yes";
const fmtDisk = (mb) => fmtBytes(mb * 1024 * 1024);
function memoryText(m) {
  if (m.needGb == null) return { text: "memory need not stated", warn: false };
  if (fits(m)) return { text: `needs about ${m.needGb} GB · fits this card`, warn: false };
  return { text: `needs about ${m.needGb} GB · too big for this card — Load runs it on the CPU`, warn: true };
}
// The prompt's summary, in the words the server writes into a generated engine's TERMS.
const termsText = (e) =>
  `${e.licence.name}. Commercial use, in audio.cpp's licence table: ${e.licence.commercial}.` +
  (e.licence.notes ? ` ${e.licence.notes}` : "") +
  " The licence text at its source is what counts.";
function summary(e) {
  const onDisk = e.models.filter((m) => m.onDisk).length;
  return `${e.models.length} model${e.models.length === 1 ? "" : "s"} · ${onDisk ? `${onDisk} on disk` : "none on disk"}`;
}

function download(e, m) {
  if (gated(e) && !e.termsAccepted) {
    asking.value = e;
    return;
  }
  m.onDisk = true;
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

    <div class="ev-section-h">
      <h3>Text to speech <span class="suffix">— voices</span></h3>
      <span class="count">{{ shown.length }} engine{{ shown.length === 1 ? '' : 's' }} · {{ modelCount }} models</span>
    </div>

    <div v-if="!shown.length" class="jv-card mock-engines__empty">
      <p class="jv-lede">No engines match these filters.</p>
      <UiButton intent="secondary" size="small" label="Clear filters" @click="clearFilters" />
    </div>

    <div v-for="g in shown" :key="g.e.id" class="ev-group">
      <div class="ev-ghead" @click="open[g.e.id] = !isOpen(g.e)">
        <span class="chev" :class="{ open: isOpen(g.e) || filtered }">▶</span>
        <span class="nm">{{ g.e.name }}</span><span class="id">{{ g.e.id }}</span>
        <span class="ev-caps">
          <span class="ev-cap tts">TTS</span>
          <span class="ev-lic" :class="licClass(g.e.licence.commercial)" :title="licTitle(g.e.licence)">Commercial use: {{ g.e.licence.commercial }}</span>
          <span class="ev-cap" :class="{ tested: g.e.tested }" :title="g.e.tested?.note || 'Works as audio.cpp describes it; JustVoice hasn\'t listened to it yet'">
            {{ g.e.tested ? 'TESTED BY JUSTVOICE' : 'NOT TESTED BY JUSTVOICE YET' }}
          </span>
        </span>
        <span class="desc" :title="g.e.description">{{ g.e.description }}</span>
        <span class="gsum"><span class="meta">{{ summary(g.e) }}</span></span>
      </div>

      <div v-if="isOpen(g.e) || filtered" class="ev-gbody">
        <div v-if="g.e.tested || g.e.bestFor.length" class="ev-gnote">
          <span v-if="g.e.bestFor.length">Best for: {{ g.e.bestFor.join(" · ") }}</span>
          <span v-if="g.e.tested">Tested by JustVoice: {{ g.e.tested.note }}</span>
        </div>
        <template v-for="m in g.models" :key="m.id">
          <div class="ev-model">
            <span class="vn">{{ m.name }}</span>
            <span class="ev-vchips">
              <span class="ev-cap">{{ m.langs }} language{{ m.langs === 1 ? '' : 's' }}</span>
              <span v-if="m.cloning" class="ev-cap clone" title="Clones a voice from a short clean sample">CLONING</span>
              <span v-if="m.presets" class="ev-cap presets" :title="`${m.presets} built-in voices — no sample needed`">BUILT-IN · {{ m.presets }}</span>
              <span class="ev-cap" :class="{ directed: directionCell(m.directedBy).intent === 'success' }"
                :title="directionCell(m.directedBy).title">{{ directionCell(m.directedBy).label.toUpperCase() }}</span>
              <span class="ev-cap" title="audio.cpp's own status for this model">{{ g.e.status.toUpperCase() }}</span>
            </span>
            <span class="vmeta">{{ fmtDisk(m.sizeMb) }}<template v-if="m.onDisk"> · on disk</template></span>
            <span class="ev-memhint"><span :class="{ 'jv-text-warn': memoryText(m).warn }">{{ memoryText(m).text }}</span></span>
            <span class="right">
              <span v-if="m.loaded" class="ev-badge loaded">● Loaded</span>
              <UiButton v-if="!m.onDisk" intent="primary" size="small" :label="`Download (${fmtDisk(m.sizeMb)})`" @click="download(g.e, m)" />
              <UiButton v-else-if="!m.loaded" intent="primary" size="small" label="Load model" />
            </span>
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
        you download the model. What follows is audio.cpp's summary of it.
      </p>
      <div class="jv-banner mock-engines__terms">{{ termsText(asking) }}</div>
      <p class="jv-hint">
        You accept once, on this install.
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
.mock-engines .ev-toprow + .ev-toprow { margin-top: 8px; }
.mock-engines__empty { display: flex; align-items: center; gap: 12px; padding: 14px 16px; margin-top: 12px; }
.mock-engines__empty .jv-lede { margin: 0; }
.mock-engines__lede { margin: 0 0 12px; max-width: 62ch; }
.mock-engines__terms { white-space: pre-wrap; margin: 0 0 12px; max-width: 62ch; }
</style>
