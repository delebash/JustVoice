<!-- SPDX-License-Identifier: MIT -->
<!--
  The Effects chain editor, its chain list drawn compact — the mock (dev only; the persona mock's
  "＋ Edit" beside Effects, and `#/mock/personas/p_june/effects` opens on it). Decided 2026-10-15
  (the build's question 9, rethought: "Effects' chain list is drawn compact in the in-app mock
  first, the build after the user looks"); the shape is mock `_s11`'s "The chain".

  What it draws, over components/EffectsChainEditorModal.vue (everything else is that dialog as
  built, its words and controls as they are):
    · each step is one row of `.jv-chain` (app.scss): the grip, the effect's name (its description
      on hover), its settings inline — the label, a number box sized to its value, the unit after
      it ("Gain [-2] dB") — then ↑ ↓ Remove; the box and "step N" go;
    · the settings take the server's ranges: a value past one is held to it when you leave the box
      (the kit's UiNumber).
  Production minus the plumbing: no server, no real audio — the effects and presets are the
  server's own (services/mock/effectsChainMock.js), ▶ plays a silent take of the line's length.
-->
<script setup>
import { computed, ref, watch } from "vue";
import { useSortable } from "@vueuse/integrations/useSortable";
import { AppModal, Icon, UiButton, UiCheckbox, UiInput, UiNumber, UiSelect, UiTag, pushToast } from "@delebash/ui";
import { usePagePlayer } from "../../composables/usePagePlayer.js";
import { BUILTIN_PRESETS, CATALOG } from "../../services/mock/effectsChainMock.js";
import { silentWav, wait } from "../../services/mock/personaMock.js";
import PagePlayer from "../PagePlayer.vue";
import PlayTransport from "../PlayTransport.vue";

const props = defineProps({
  open: { type: Boolean, required: true },
  modelValue: { type: Array, default: () => [] },
  contextLabel: { type: String, default: "" },
  persona: { type: Object, default: null },
});
const emit = defineEmits(["update:modelValue", "save", "cancel"]);

const chain = ref([]);
const presets = ref(structuredClone(BUILTIN_PRESETS));
const presetPickerOpen = ref(false);
const saveAsName = ref("");
const addEffectType = ref("");

const specFor = (type) => CATALOG.find((e) => e.type === type) || null;

// A setting's label and unit, as the catalog writes them: "Gain (dB)" → "Gain" + "dB" (the unit
// after its box, as `_s11` draws it).
function paramLabel(label) {
  const m = /^(.*\S)\s*\(([^()]*)\)$/.exec(label || "");
  return m ? { name: m[1], unit: m[2] } : { name: label || "", unit: "" };
}

const chainEl = ref(null);
useSortable(chainEl, chain, { handle: ".jv-chain__grip", animation: 150, watchElement: true });
const stepIds = new WeakMap();
let lastStepId = 0;
function stepKey(ef) {
  if (!stepIds.has(ef)) stepIds.set(ef, ++lastStepId);
  return stepIds.get(ef);
}

// ── A / B it: the same take, the chain off and on (here a silent take of a line's length) ──
const player = usePagePlayer();
const abLine = ref("");
const abBusy = ref(null);
let take = null; // { text, dryUrl }
let wet = null; // { chain (JSON), url }
const urls = [];
function keepUrl(blob) {
  const url = URL.createObjectURL(blob);
  urls.push(url);
  return url;
}
function forgetTake() {
  player.stop();
  for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  take = null;
  wet = null;
}
async function hearAB(which) {
  if (abBusy.value) return;
  abBusy.value = which;
  try {
    const text = abLine.value.trim();
    if (!take || take.text !== text) {
      forgetTake();
      await wait();
      take = { text, dryUrl: keepUrl(silentWav(2)) };
    }
    if (which === "dry") return await player.play("ab:dry", take.dryUrl);
    const now = JSON.stringify(chain.value);
    if (!wet || wet.chain !== now) {
      await wait(300);
      wet = { chain: now, url: keepUrl(silentWav(2)) };
    }
    await player.play("ab:wet", wet.url);
  } finally {
    abBusy.value = null;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) forgetTake();
    if (open) {
      chain.value = JSON.parse(JSON.stringify(props.modelValue || []));
      addEffectType.value = "";
      presetPickerOpen.value = false;
      saveAsName.value = "";
    }
  },
  { immediate: true },
);

function addEffect() {
  const spec = specFor(addEffectType.value);
  if (!spec) return;
  const params = {};
  for (const p of spec.params) if (p.default !== undefined) params[p.key] = p.default;
  chain.value.push({ type: spec.type, params });
  addEffectType.value = "";
}
const removeAt = (i) => chain.value.splice(i, 1);
function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= chain.value.length) return;
  [chain.value[i], chain.value[j]] = [chain.value[j], chain.value[i]];
}
function setParam(i, key, value) {
  const entry = chain.value[i];
  if (!entry) return;
  if (!entry.params) entry.params = {};
  entry.params[key] = value;
}
function loadPreset(preset) {
  chain.value = JSON.parse(JSON.stringify(preset.chain || []));
  presetPickerOpen.value = false;
  pushToast({ message: `Loaded preset "${preset.name}".`, kind: "success", duration: 3000 });
}
function saveAsPreset() {
  const name = saveAsName.value.trim();
  if (!name) {
    pushToast({ message: "Name the preset first.", kind: "info" });
    return;
  }
  presets.value.push({ id: `fx_${presets.value.length + 1}`, name, is_builtin: false, chain: JSON.parse(JSON.stringify(chain.value)) });
  saveAsName.value = "";
  pushToast({ message: `Saved "${name}" to the Effects page as a chain preset.`, kind: "success", duration: 6000 });
}
const effectCount = (p) => (p.chain || []).length;
const hasPersona = computed(() => !!props.persona);

function onSave() {
  emit("update:modelValue", chain.value);
  emit("save", chain.value);
}
</script>

<template>
  <AppModal v-if="open" :eyebrow="contextLabel" title="Effects chain" :max-width="'720px'" no-padding dismissable @close="emit('cancel')">
    <div class="mock-fx__body">
      <div class="mock-fx__row">
        <UiButton intent="ghost" size="small" :label="presetPickerOpen ? 'Hide presets' : 'Load from preset…'"
          @click="presetPickerOpen = !presetPickerOpen" />
        <span v-if="presets.length" class="jv-muted">{{ presets.length }} saved</span>
      </div>
      <div v-if="presetPickerOpen" class="mock-fx__presets">
        <button v-for="p in presets" :key="p.id" type="button" class="mock-fx__preset-row" @click="loadPreset(p)">
          <strong>{{ p.name }}</strong>
          <UiTag v-if="p.is_builtin" intent="ghost">built-in</UiTag>
          <span class="jv-muted">{{ effectCount(p) }} effect{{ effectCount(p) === 1 ? '' : 's' }}</span>
        </button>
        <p v-if="!presets.length" class="jv-muted">No saved chains yet. Build one below and click "Save chain to Effects library".</p>
      </div>

      <div class="jv-divider" />

      <div class="mock-fx__row">
        <span class="mock-fx__add-label">The chain</span>
        <span v-if="chain.length > 1" class="jv-hint">drag to reorder</span>
      </div>
      <p v-if="!chain.length" class="jv-muted mock-fx__empty">
        No effects. Pick a type below and click <strong>Add</strong>.
      </p>

      <!-- Each step one row: the grip, its name, its settings inline with their units, ↑ ↓ Remove. -->
      <ul ref="chainEl" class="jv-chain" :class="{ 'mock-fx__chain--empty': !chain.length }">
        <li v-for="(ef, i) in chain" :key="stepKey(ef)" class="jv-chain__step">
          <span class="jv-chain__grip" title="Drag to reorder"><Icon name="DragHandle" :size="16" :sw="2.6" /></span>
          <span class="jv-chain__name" :title="specFor(ef.type)?.description">{{ specFor(ef.type)?.label || ef.type }}</span>
          <span class="jv-chain__settings">
            <label v-for="p in specFor(ef.type)?.params || []" :key="p.key" class="jv-chain__setting">
              <span class="jv-chain__label">{{ paramLabel(p.label).name }}</span>
              <UiCheckbox v-if="p.type === 'boolean'" :model-value="!!ef.params?.[p.key]"
                @change="setParam(i, p.key, $event.target.checked)" />
              <UiNumber v-else width="num" size="small" :use-grouping="false"
                :model-value="ef.params?.[p.key] ?? p.default" :min="p.min" :max="p.max" :step="p.step ?? 1"
                :aria-label="p.label" @update:model-value="setParam(i, p.key, $event)" />
              <span v-if="paramLabel(p.label).unit" class="jv-chain__unit">{{ paramLabel(p.label).unit }}</span>
            </label>
          </span>
          <span class="jv-chain__actions">
            <UiButton intent="ghost" size="small" label="↑" :disabled="i === 0" title="Move up" @click="move(i, -1)" />
            <UiButton intent="ghost" size="small" label="↓" :disabled="i === chain.length - 1" title="Move down" @click="move(i, 1)" />
            <UiButton intent="danger-outline" size="small" label="Remove" @click="removeAt(i)" />
          </span>
        </li>
      </ul>

      <div class="jv-divider" />

      <div class="mock-fx__row mock-fx__add">
        <span class="mock-fx__add-label">Add effect:</span>
        <UiSelect v-model="addEffectType" width="name" placeholder="— pick a type —"
          :options="CATALOG" option-label="label" option-value="type" />
        <UiButton intent="secondary" size="small" label="Add" :disabled="!addEffectType" @click="addEffect" />
      </div>

      <div class="mock-fx__row mock-fx__saveas">
        <UiInput v-model="saveAsName" width="name" placeholder="Name (e.g. Cave reverb, Phone filter)…" />
        <UiButton intent="ghost" size="small" label="Save chain to Effects library"
          :disabled="!saveAsName.trim() || !chain.length" @click="saveAsPreset" />
      </div>

      <section v-if="hasPersona" class="jv-card jv-card--soft mock-fx__card">
        <div class="jv-card__header"><h3 class="jv-card__title">A / B it</h3></div>
        <div class="jv-card__body jv-col jv-col--start">
          <UiInput v-model="abLine" width="prose" placeholder="Type a line — or leave it empty to hear the stock line." />
          <div class="jv-inline-row">
            <UiButton intent="secondary" size="small" :loading="abBusy === 'dry'"
              :label="player.isPlaying('ab:dry') ? '❚❚ Dry' : '▶ Dry'" title="The line with no effects" @click="hearAB('dry')" />
            <UiButton intent="secondary" size="small" :loading="abBusy === 'wet'"
              :label="player.isPlaying('ab:wet') ? '❚❚ Wet' : '▶ Wet'" title="The same take through this chain" @click="hearAB('wet')" />
            <span class="jv-hint">same take, chain on / off</span>
          </div>
          <PlayTransport v-if="player.key?.startsWith('ab:')" :player="player" />
        </div>
      </section>

      <section class="jv-card jv-card--soft mock-fx__card">
        <div class="jv-card__header"><h3 class="jv-card__title">Order matters</h3></div>
        <p class="jv-card__body mock-fx__card-p">
          EQ before compression shapes what the compressor reacts to; after, it shapes what survives
          it. Reverb last, or you compress the room.
        </p>
      </section>
      <PagePlayer :player="player" />
    </div>

    <template #footer>
      <span class="jv-spacer" />
      <UiButton intent="secondary" label="Cancel" @click="emit('cancel')" />
      <UiButton intent="primary" label="Save" @click="onSave" />
    </template>
  </AppModal>
</template>

<style scoped>
/* The dialog as EffectsChainEditorModal.vue draws it (its scoped rules, copied); the chain list is
   app.scss's `.jv-chain`. */
.mock-fx__body { padding: 18px 22px; }
.mock-fx__row { display: flex; align-items: center; gap: 10px; }
.mock-fx__row + .mock-fx__row { margin-top: 8px; }
.mock-fx__presets { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.mock-fx__preset-row {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 8px 12px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink);
  font: inherit;
}
.mock-fx__preset-row:hover { background: var(--accent-soft); border-color: var(--accent); }
.mock-fx__empty { padding: 24px 0; text-align: center; }
/* An empty chain draws no box: the line above says so. */
.mock-fx__chain--empty { display: none; }
.mock-fx__row + .jv-chain { margin-top: 8px; }
.mock-fx__add { align-items: center; margin-top: 14px; }
.mock-fx__add-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.mock-fx__saveas { margin-top: 14px; }
.mock-fx__saveas > .ui-input { flex: 1; }
.mock-fx__card { margin-top: 14px; }
.mock-fx__card-p { margin: 0; max-width: 60ch; }
</style>
