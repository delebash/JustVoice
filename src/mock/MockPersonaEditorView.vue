<!-- SPDX-License-Identifier: MIT -->
<!--
  One persona, on its own page — the mock (dev only, #/mock/personas/:id).
  Decided 2026-10-04: a mock is a page in the app, built from the kit's own
  components on made-up data, so what it shows is what ships
  (docs/plans/2026-10-04-persona-voice-making.md §2).

  What it draws, over views/PersonaEditorView.vue:
    · the mock's look (`_s7`), which beats size-to-content on this page —
      knobs three across with the slider filling its cell, text boxes as wide
      as their card, the left column 1.5 × the right;
    · a persona makes its own voice (§3): picking Clone, Design or Blend
      shows that maker's fields at the top of the right column — no ＋ New button (the user,
      2026-10-04: "instead of displaying new buttton when selected you show the
      actual fields"); Keep saves the voice to Voices and this persona speaks
      with it;
    · what a voice can do comes first — "How it can be directed" (Written
      direction · Tags · Sliders only), always in view — and how it was made
      second; every voice in the list says what it can do; the makers offer
      only the models that match (the user, 2026-10-04: "there needs to be a
      bette way to identify a voice that can do direction and words");
    · a Language filter on the voice list, beside Model and Gender.
  Everything else is the persona redesign as built (plan 2026-10-03 §6.1).
-->
<script setup>
import { computed, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import {
  AppModal, EmptyState, UiButton, UiField, UiInput, UiNumber, UiSegmented, UiSelect,
  UiSlider, UiTag, UiTextarea, confirmDialog, languageName, pushToast, saveBlob,
} from "@delebash/llm-ui";
import EffectsChainEditorModal from "../components/EffectsChainEditorModal.vue";
import SlashTagMenu from "../components/SlashTagMenu.vue";
import { usePageCrumbs } from "../composables/usePageCrumbs.js";
import { facetCounts, facetOptions, facetTotal, narrowed } from "../services/facets.js";
import { DIRECTION_OPTIONS, VOICE_KINDS as KINDS, voiceKind as kindOf, voiceKindWord, voiceLabel } from "../services/personaFacts.js";
import { voiceGender } from "../services/voiceGender.js";
import MockBlendMaker from "./MockBlendMaker.vue";
import MockCloneMaker from "./MockCloneMaker.vue";
import MockDesignMaker from "./MockDesignMaker.vue";
import {
  LEXICONS, MODEL_VERSIONS, capabilities as caps, effectLabels, emotionValues, newId, silentWav, statusOf, store, wait,
} from "./personaMock.js";

const route = useRoute();
const router = useRouter();
const voices = computed(() => store.voices);

// ── The persona being edited ────────────────────────────────────────────
const SHARED = ["speed", "pitch", "gain_db", "pause_before", "pause_after"];
const personaId = computed(() => (route.name === "mock-persona" ? String(route.params.id || "") : ""));
const isNew = computed(() => personaId.value === "new");
const missing = ref(false);
const saved = ref(null);
const draft = ref(null);

function blank() {
  return {
    name: "", voice_id: "", language: "", voice_instruct: "", note: "",
    default_delivery: { models: {} }, effects_chain: [], lexicon_id: "",
  };
}
function fromPersona(p) {
  const dd = p.default_delivery || {};
  return {
    name: p.name || "",
    voice_id: p.voice_id || "",
    language: p.language || "",
    voice_instruct: p.voice_instruct || "",
    note: p.note || "",
    default_delivery: {
      ...Object.fromEntries(SHARED.map((k) => [k, dd[k] ?? null])),
      models: JSON.parse(JSON.stringify(dd.models || {})),
    },
    effects_chain: [...(p.effects_chain || [])],
    lexicon_id: p.lexicon_id || "",
  };
}
function cleanDelivery(dd) {
  const out = {};
  for (const k of SHARED) if (dd[k] !== null && dd[k] !== undefined && dd[k] !== "") out[k] = Number(dd[k]);
  const models = {};
  for (const [m, s] of Object.entries(dd.models || {})) {
    const knobs = Object.fromEntries(Object.entries(s.knobs || {}).filter(([, v]) => v !== null && v !== ""));
    const entry = {};
    if (Object.keys(knobs).length) entry.knobs = knobs;
    if (s.seed !== null && s.seed !== undefined && s.seed !== "") entry.seed = Number(s.seed);
    if (s.emotion) entry.emotion = s.emotion;
    if (s.register_tag) entry.register_tag = s.register_tag;
    if (Object.keys(entry).length) models[m] = entry;
  }
  out.models = models;
  return out;
}
function payload(d = draft.value) {
  return {
    name: d.name.trim(),
    voice_id: d.voice_id || "",
    language: d.language || "",
    voice_instruct: d.voice_instruct.trim(),
    note: d.note.trim(),
    default_delivery: cleanDelivery(d.default_delivery),
    effects_chain: d.effects_chain || [],
    lexicon_id: d.lexicon_id || "",
  };
}
const opened = ref(null);
const copyOf = (d) => JSON.parse(JSON.stringify(d));
const dirty = computed(() => {
  if (!draft.value) return false;
  const base = saved.value ? fromPersona(saved.value) : (opened.value || blank());
  return JSON.stringify(payload(draft.value)) !== JSON.stringify(payload(base));
});
const usage = ref(null);   // {speakers, total_lines, directed_lines}

const { publish: publishCrumbs } = usePageCrumbs(() => [
  { label: isNew.value ? "New persona" : (draft.value?.name || saved.value?.name || "Persona") },
]);

// ── The voice and its model ─────────────────────────────────────────────
const voice = computed(() => voices.value.find((v) => v.id === draft.value?.voice_id) || null);
const voiceGone = computed(() => !!draft.value?.voice_id && !voice.value);
const model = computed(() => voice.value?.model || "");
const row = computed(() => caps[model.value] || null);
const modelName = computed(() => voice.value?.model_name || row.value?.display_name || model.value);
const directedBy = computed(() => voice.value?.directed_by || "");
const locked = computed(() => !voice.value);
const notLoaded = computed(() => !!voice.value && statusOf(model.value) !== "loaded");

// The Voice card, as the page (decided 2026-10-05, "A"): How it can be
// directed and Type first, then Model · Gender · Voice's language, then the
// voice; each lists only what the others leave (services/facets.js).
const directionFilter = ref("");
const DIRECTION_WORD = { words: "written direction", tags: "tags", sliders: "sliders only" };
const DIRECTION_EXAMPLE = { words: "describe it", tags: "[fear] [sigh]", sliders: "pace, pitch, gain" };
const kind = ref("builtin");
function onKindBlocked(opt) {
  pushToast({ kind: "info", message: opt.title || "Not available yet." });
}
const CAN_MAKE = { clone: ["words", "tags", "sliders"], design: ["words", "tags", "sliders"], blend: ["sliders"] };
const OFF_REASON = {
  builtin: { tags: "No built-in voice takes tags — Chatterbox Turbo and Nano voices are clones." },
  blend: {
    words: "Blends are Kokoro's — they take no written direction.",
    tags: "Blends are Kokoro's — they take no tags.",
  },
};
const modelFilter = ref("");
const genderFilter = ref("");
const languageFilter = ref("");
const baseLang = (c) => String(c || "").split(/[-_]/)[0].toLowerCase();
const voiceFilters = computed(() => [
  { key: "direction", value: directionFilter.value, test: (v, d) => v.directed_by === d },
  { key: "kind", value: kind.value, test: (v, k) => kindOf(v) === k },
  { key: "model", value: modelFilter.value, test: (v, m) => v.model === m },
  { key: "gender", value: genderFilter.value, test: (v, g) => voiceGender(v) === g },
  { key: "language", value: languageFilter.value, test: (v, c) => baseLang(v.language) === c },
]);
const shownVoices = computed(() => narrowed(voices.value, voiceFilters.value));
const directionChoices = computed(() => {
  const n = facetCounts(voices.value, voiceFilters.value, "direction", ["words", "tags", "sliders"],
    (v, d) => v.directed_by === d);
  return DIRECTION_OPTIONS.map((o) => ({
    value: o.value,
    label: `${o.value ? o.label : "Any"} (${o.value ? n[o.value] : facetTotal(voices.value, voiceFilters.value, "direction")})`,
    sublabel: o.value ? DIRECTION_EXAMPLE[o.value] : "every voice",
  }));
});
const kindOptions = computed(() => {
  const n = facetCounts(voices.value, voiceFilters.value, "kind", ["builtin", "clone", "design", "blend"],
    (v, k) => kindOf(v) === k);
  const d = directionFilter.value;
  return KINDS.map((k) => {
    const opt = k.disabled ? k : { ...k, label: `${k.label} (${n[k.value] ?? 0})` };
    if (k.disabled || !d) return opt;
    const has = voices.value.some((v) => kindOf(v) === k.value && v.directed_by === d);
    if (has || (CAN_MAKE[k.value] || []).includes(d)) return opt;
    return { ...opt, disabled: true, title: OFF_REASON[k.value]?.[d] || "Nothing of this kind can be directed this way." };
  });
});
watch(directionFilter, () => {
  if (kindOptions.value.find((o) => o.value === kind.value)?.disabled) {
    kind.value = kindOptions.value.find((o) => !o.disabled)?.value || "builtin";
  }
});
const modelNames = computed(() => Object.fromEntries(voices.value.map((v) => [v.model, v.model_name || v.model])));
const modelOptions = computed(() => [
  { value: "", label: "All models" },
  ...facetOptions(voices.value, voiceFilters.value, "model", (v) => v.model, (m, n) => `${modelNames.value[m] || m} (${n})`),
]);
const GENDER_WORD = { F: "Female", M: "Male", N: "Neutral" };
const genderOptions = computed(() => [
  { value: "", label: "Any gender" },
  ...facetOptions(voices.value, voiceFilters.value, "gender",
    (v) => (voiceGender(v) === "?" ? "" : voiceGender(v)), (g, n) => `${GENDER_WORD[g] || g} (${n})`),
]);
const languageFilterOptions = computed(() => [
  { value: "", label: "Any language" },
  ...facetOptions(voices.value, voiceFilters.value, "language",
    (v) => baseLang(v.language), (c, n) => `${languageName(c) || c} (${n})`),
]);
const voiceOptions = computed(() => shownVoices.value.map((v) => ({
  value: v.id,
  label: [voiceLabel(v), kindOf(v) !== "builtin" ? voiceKindWord(v) : "", DIRECTION_WORD[v.directed_by] || "sliders only"]
    .filter(Boolean).join(" · "),
})));
const voiceSelectValue = computed(() => voice.value?.id || "");
const voiceEmptyHint = computed(() => {
  if (shownVoices.value.length) return "";
  if (voices.value.some((v) => kindOf(v) === kind.value)) {
    return "No voice of this kind matches these filters.";
  }
  return {
    builtin: "No built-in voices — install a speech model on AI Settings → Speech engines.",
    clone: "No cloned voices yet — make one on the right.",
    design: "No designed voices yet — make one on the right.",
    blend: "No blends yet — make one on the right.",
  }[kind.value] || "";
});
// The Version field, from the catalog's list (MODEL_VERSIONS).
const versionOptions = computed(() => (MODEL_VERSIONS[voice.value?.model] || []).map((x) => ({ value: x, label: x })));

// ── Making a voice, here — a made type under Type opens its maker.
const MAKERS = ["clone", "design", "blend"];
const maker = computed(() => (MAKERS.includes(kind.value) ? kind.value : null));
const designFrom = ref(null);   // a kept design whose words start the maker
const makerKey = ref(0);        // a new key = a fresh, empty maker
watch(kind, () => { modelFilter.value = ""; designFrom.value = null; makerKey.value += 1; });
function startFromThis() {
  designFrom.value = voice.value;
  makerKey.value += 1;
}
function onKept(v) {
  designFrom.value = null;
  makerKey.value += 1;
  modelFilter.value = "";
  genderFilter.value = "";
  languageFilter.value = "";
  pickVoice(v.id);
}
const voiceChange = ref(null);
// A filter change that leaves the voice out of the list empties the box, the
// same as if none was ever picked (decided 2026-10-05: "if you have a voice
// selected and change the filter and that changes the voice list then that
// voice no longer shows"). It used to stay pinned in the box, so the filter
// looked like it did nothing.
watch([directionFilter, kind, modelFilter, genderFilter, languageFilter], () => {
  const cur = voice.value;
  if (!cur || shownVoices.value.some((v) => v.id === cur.id)) return;
  draft.value.voice_id = "";
  voiceChange.value = null;
});
// Opening a persona, and Revert, set the filters so its voice is in the list:
// Type to the voice's type, the rest to Any.
function fitFiltersToVoice() {
  directionFilter.value = "";
  modelFilter.value = "";
  genderFilter.value = "";
  languageFilter.value = "";
  kind.value = voice.value ? kindOf(voice.value) : "builtin";
}
function pickVoice(id) {
  const v = voices.value.find((x) => x.id === id);
  if (!v || !draft.value) return;
  draft.value.voice_id = id;
  // Speaks becomes the new voice's own language (decided 2026-10-05).
  const speaks = v.speaks || [];
  draft.value.language = speaks.length === 1 ? speaks[0] : (v.language || speaks[0] || "");
  // The warning compares with the SAVED voice, so it still shows after a
  // filter emptied the box (decided 2026-10-05).
  const lines = usage.value?.total_lines || 0;
  const savedVoice = saved.value?.voice_id || "";
  if (savedVoice && savedVoice !== v.id && lines) {
    const directed = usage.value?.directed_lines || 0;
    voiceChange.value = { lines, directed, lost: v.directed_by !== "words" ? (v.model_name || v.engine) : "" };
  } else {
    voiceChange.value = null;
  }
}

const rawBusy = ref(false);
async function playRaw() {
  if (!voice.value || rawBusy.value) return;
  rawBusy.value = true;
  await wait();
  setAudio(silentWav(3), `${voice.value.name} on its own`);
  rawBusy.value = false;
}

// ── Language ────────────────────────────────────────────────────────────
const speaks = computed(() => voice.value?.speaks || []);
const languageFixed = computed(() => speaks.value.length <= 1);
const languageOptions = computed(() => speaks.value.map((c) => ({ value: c, label: languageName(c) || c })));
const effectiveLanguage = computed(() => (languageFixed.value
  ? speaks.value[0] || voice.value?.language || draft.value?.language
  : draft.value?.language || voice.value?.language || speaks.value[0]));
const languageNote = computed(() => {
  const v = voice.value;
  const lang = effectiveLanguage.value;
  if (!v || !lang || !v.language) return "";
  return baseLang(lang) !== baseLang(v.language)
    ? `Speaks ${languageName(lang) || lang} · voice is ${languageName(v.language) || v.language}`
    : "";
});
const speaksLabel = computed(() => {
  const lang = effectiveLanguage.value;
  return lang ? `Speaks ${languageName(lang) || lang}` : "";
});

// ── How it speaks ───────────────────────────────────────────────────────
const SHAPE_KNOBS = [
  { key: "speed", label: "Pace", min: 0.5, max: 2, step: 0.05, neutral: 1, unit: "×", reset: "Back to the voice's own pace" },
  { key: "pitch", label: "Pitch", min: -12, max: 12, step: 1, neutral: 0, unit: "st", reset: "Back to the voice's own pitch" },
  { key: "gain_db", label: "Gain", min: -12, max: 12, step: 0.5, neutral: 0, unit: "dB", reset: "Back to the voice's own level" },
];
function shared(key, fallback) {
  const v = draft.value?.default_delivery?.[key];
  return v === null || v === undefined ? fallback : Number(v);
}
function setShared(key, value) {
  draft.value.default_delivery[key] = value === null || value === "" ? null : Number(value);
}
const paceNative = computed(() => !!row.value?.speed_native);
function ms(create = false) {
  const m = model.value;
  if (!m || !draft.value) return null;
  const models = draft.value.default_delivery.models;
  if (!models[m] && create) models[m] = { knobs: {}, seed: null, emotion: null, register_tag: null };
  return models[m] || null;
}
const tagSets = computed(() => row.value?.inline_tags || []);
const emotionTagSet = computed(() => tagSets.value.find((t) => t.category === "emotion") || null);
const registerTagSet = computed(() => tagSets.value.find((t) => t.category === "register") || null);
const emotionChoices = computed(() => {
  if (emotionTagSet.value) return emotionTagSet.value.tags;
  if (directedBy.value === "words") return emotionValues;
  return [];
});
const emotion = computed({
  get: () => ms()?.emotion || "",
  set: (v) => { ms(true).emotion = v || null; },
});
const registerTag = computed({
  get: () => ms()?.register_tag || "",
  set: (v) => { ms(true).register_tag = v || null; },
});
const isVoiceDesign = computed(() => model.value === "qwen3-vd");
const directionReason = computed(() => {
  if (!voice.value) return "";
  if (directedBy.value === "tags") return `${modelName.value} takes tags, not written direction — pick its emotion and register below.`;
  if (directedBy.value === "sliders") return `${modelName.value} takes no direction — shape it with the numbers, or pick a voice on a model that takes direction.`;
  return "";
});

// ── Sampling ────────────────────────────────────────────────────────────
const knobs = computed(() => (row.value?.knobs || []).filter((k) => k.key !== "speed" && k.key !== "seed"));
const seedSupported = computed(() => (row.value?.knobs || []).some((k) => k.key === "seed"));
function knobValue(k) {
  const v = ms()?.knobs?.[k.key];
  return v === undefined || v === null ? Number(k.default) : Number(v);
}
function setKnob(k, value) {
  ms(true).knobs[k.key] = Number(value);
}
function resetKnob(k) {
  const s = ms();
  if (s?.knobs) delete s.knobs[k.key];
}
const seed = computed({
  get: () => ms()?.seed ?? null,
  set: (v) => { ms(true).seed = v === null || v === "" ? null : Number(v); },
});
function rollSeed() {
  seed.value = 1 + Math.floor(Math.random() * 2_000_000_000);
}

// ── Effects, lexicon ────────────────────────────────────────────────────
const effectsOpen = ref(false);
function onEffectsSaved(chain) {
  draft.value.effects_chain = chain;
  effectsOpen.value = false;
}
const effectNames = computed(() => (draft.value?.effects_chain || []).map((e) => effectLabels[e.type] || e.type).filter(Boolean));
const lexiconOptions = [{ value: "", label: "None" }, ...LEXICONS.map((l) => ({ value: l.id, label: l.name }))];

// ── Hear it ─────────────────────────────────────────────────────────────
const STOCK_LINE = {
  en: "The fog came in over the pier before either of them said a word.",
  ja: "どちらかが口を開く前に、霧が桟橋に流れ込んできた。",
  ko: "둘 중 누구도 입을 열기 전에 안개가 부두 위로 밀려왔다.",
  pt: "A névoa chegou ao cais antes que qualquer um deles dissesse uma palavra.",
};
const hearText = ref("");
const hearBusy = ref(false);
const audio = ref(null);
function setAudio(blob, label) {
  if (audio.value?.url) URL.revokeObjectURL(audio.value.url);
  audio.value = { url: URL.createObjectURL(blob), blob, label };
}
async function listen() {
  if (!voice.value || hearBusy.value) return;
  hearBusy.value = true;
  await wait(900);
  setAudio(silentWav(4), draft.value.name || "This persona");
  hearBusy.value = false;
}
function stockLine() {
  hearText.value = STOCK_LINE[baseLang(effectiveLanguage.value)] || STOCK_LINE.en;
}
async function saveWav() {
  if (!audio.value?.blob) return;
  const name = (draft.value?.name || "persona").replace(/[^\w.-]+/g, "_");
  try { await saveBlob(audio.value.blob, `${name}.wav`); } catch (e) {
    pushToast({ kind: "error", message: `Save failed: ${e?.message || e}` });
  }
}
const tagMenuOpen = ref(false);
const tagAnchor = ref(null);
const hearBox = ref(null);
function hearTextarea() {
  return hearBox.value?.$el?.querySelector?.("textarea") || hearBox.value?.$el || null;
}
function openTagMenu() {
  const el = hearTextarea();
  if (!el) return;
  tagAnchor.value = el.getBoundingClientRect();
  tagMenuOpen.value = true;
}
function insertTag({ rendered }) {
  const el = hearTextarea();
  const value = hearText.value;
  const at = el?.selectionStart ?? value.length;
  const gap = at > 0 && !/\s$/.test(value.slice(0, at)) ? " " : "";
  hearText.value = `${value.slice(0, at)}${gap}${rendered} ${value.slice(at)}`.replace(/\s+$/, "");
  tagMenuOpen.value = false;
}

// ── Compare settings… ───────────────────────────────────────────────────
const compareOpen = ref(false);
const compareKey = ref("speed");
const compareValues = ref([0.9, 1.0, 1.1]);
const compareResults = ref([]);
const compareBusy = ref(false);
const compareOptions = computed(() => [
  { value: "speed", label: "Pace" }, { value: "pitch", label: "Pitch" }, { value: "gain_db", label: "Gain" },
  ...knobs.value.map((k) => ({ value: k.key, label: k.label })),
]);
function compareSpec(key) {
  const s = SHAPE_KNOBS.find((x) => x.key === key);
  if (s) return { min: s.min, max: s.max, step: s.step, now: shared(key, s.neutral) };
  const k = knobs.value.find((x) => x.key === key);
  return k ? { min: k.min, max: k.max, step: k.step, now: knobValue(k) } : { min: 0, max: 1, step: 0.01, now: 0 };
}
function seedCompareValues() {
  const s = compareSpec(compareKey.value);
  const clamp = (x) => Math.min(s.max, Math.max(s.min, Math.round(x / s.step) * s.step));
  compareValues.value = [clamp(s.now - 2 * s.step), clamp(s.now), clamp(s.now + 2 * s.step)];
}
function openCompare() {
  compareKey.value = "speed";
  seedCompareValues();
  compareResults.value = [];
  compareOpen.value = true;
}
watch(compareKey, () => { if (compareOpen.value) { seedCompareValues(); compareResults.value = []; } });
async function runCompare() {
  if (compareBusy.value) return;
  compareBusy.value = true;
  compareResults.value = [];
  for (const value of compareValues.value) {
    await wait(500);
    compareResults.value = [...compareResults.value, { value, url: URL.createObjectURL(silentWav(4)) }];
  }
  compareBusy.value = false;
}
function useCompared(value) {
  if (SHARED.includes(compareKey.value)) setShared(compareKey.value, value);
  else {
    const k = knobs.value.find((x) => x.key === compareKey.value);
    if (k) setKnob(k, value);
  }
  compareOpen.value = false;
}

// ── Save ────────────────────────────────────────────────────────────────
const saving = ref(false);
const saveAsName = ref("");
async function save() {
  if (!draft.value?.name.trim() || saving.value) return;
  saving.value = true;
  await wait(300);
  const p = payload();
  if (isNew.value) {
    const id = newId("p");
    const made = { id, ...p };
    store.personas.push(made);
    saved.value = copyOf(made);
    draft.value = fromPersona(made);
    pushToast({ kind: "success", message: `${p.name} created.` });
    saving.value = false;
    router.replace({ name: "mock-persona", params: { id } });
    return;
  }
  const stored = store.personas.find((x) => x.id === personaId.value);
  Object.assign(stored, p);
  saved.value = copyOf(stored);
  draft.value = fromPersona(stored);
  voiceChange.value = null;
  const lines = usage.value?.total_lines || 0;
  pushToast({ kind: "success", message: lines ? `Saved. ${lines} line${lines === 1 ? " is" : "s are"} now stale.` : "Saved." });
  saving.value = false;
}
function saveAsNew() {
  const name = saveAsName.value.trim();
  if (!name || !draft.value) return;
  const id = newId("p");
  store.personas.push({ id, ...payload(), name });
  const was = saved.value?.name;
  saveAsName.value = "";
  draft.value = saved.value ? fromPersona(saved.value) : draft.value;
  pushToast({ kind: "success", message: was ? `Saved as a new persona. ${was} is untouched.` : `${name} created.` });
  router.push({ name: "mock-persona", params: { id } });
}
function revert() {
  draft.value = saved.value ? fromPersona(saved.value) : copyOf(opened.value || blank());
  voiceChange.value = null;
  if (voice.value) fitFiltersToVoice();
}
onBeforeRouteLeave(async () => {
  if (!dirty.value) return true;
  return confirmDialog({
    title: "Leave without saving?",
    message: `${draft.value?.name || "This persona"} has changes that aren't saved. They are lost if you leave.`,
    confirmLabel: "Leave",
    danger: true,
  });
});

// ── The right column ────────────────────────────────────────────────────
const summary = computed(() => {
  if (!voice.value) return "";
  const bits = [voice.value.name, modelName.value];
  const speed = shared("speed", null);
  if (speed !== null) bits.push(`${speed.toFixed(2)}×`);
  const gain = shared("gain_db", null);
  if (gain) bits.push(`${gain > 0 ? "+" : "−"}${Math.abs(gain).toFixed(1)} dB`);
  const pitch = shared("pitch", null);
  if (pitch) bits.push(`${pitch > 0 ? "+" : "−"}${Math.abs(pitch)} st`);
  return bits.join(" · ");
});
const usedBy = computed(() => usage.value?.speakers || []);
const usedBooks = computed(() => [...new Map(usedBy.value.map((u) => [u.project_id, u.project_name]))]);
function openCast(name) {
  pushToast({ kind: "info", message: `Opens ${name} in Studio · Cast.` });
}
function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

// ── Loading — last, once everything it touches exists ──────────────────
function load() {
  const id = personaId.value;
  if (!id) return;
  missing.value = false;
  voiceChange.value = null;
  designFrom.value = null;
  if (id === "new") {
    saved.value = null;
    draft.value = blank();
    opened.value = copyOf(draft.value);
    usage.value = null;
  } else {
    const p = store.personas.find((x) => x.id === id);
    if (!p) { missing.value = true; draft.value = null; return; }
    saved.value = copyOf(p);
    draft.value = fromPersona(p);
    const list = store.usage[id] || [];
    usage.value = {
      speakers: list,
      total_lines: list.reduce((n, u) => n + u.lines, 0),
      directed_lines: list.reduce((n, u) => n + (u.directed || 0), 0),
    };
  }
  fitFiltersToVoice();
}
watch(personaId, (id, before) => { if (id && id !== before) load(); }, { immediate: true });
watch([() => draft.value?.name, isNew], publishCrumbs, { immediate: true });
</script>

<template>
  <div class="persona-editor">
    <EmptyState v-if="missing" icon="Sparkle" title="This persona doesn't exist any more"
      message="It may have been deleted or merged into another persona."
      action-label="Back to Personas" @action="router.push({ name: 'mock-personas' })" />

    <template v-else-if="draft">
      <div class="jv-inline-row persona-editor__pills">
        <UiTag v-if="voice" intent="secondary">{{ voice.name }} · <strong>{{ modelName }}</strong></UiTag>
        <UiTag v-if="speaksLabel && voice" intent="secondary">{{ speaksLabel }}</UiTag>
        <UiTag v-if="usedBy.length" intent="secondary">used by <strong>{{ plural(usedBy.length, "speaker") }}</strong></UiTag>
        <UiTag v-if="dirty" intent="accent2">Unsaved changes</UiTag>
      </div>
      <div v-if="voice && notLoaded" class="jv-banner jv-banner--warn">
        <strong>{{ modelName }} isn't loaded.</strong> The first listen swaps it in — about a minute.
      </div>
      <div v-if="voiceGone" class="jv-banner jv-banner--danger">
        This persona's voice isn't available any more — pick another one below.
      </div>

      <div class="jv-split jv-split--wide-left">
        <div class="jv-split__col">
          <!-- Persona: its name and the note the AI reads. -->
          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">Persona</h3></div>
            <div class="jv-card__body jv-col">
              <div class="jv-inline-row">
                <UiField label="Name" layout="block">
                  <UiInput v-model="draft.name" width="name" placeholder="e.g. Narrator (warm)" />
                </UiField>
              </div>
              <UiField label="Note on how it sounds" layout="block"
                hint="Read by Compose, Rewrite and Smart-assign. Never heard.">
                <UiTextarea v-model="draft.note" :rows="2"
                  placeholder="Warm and unhurried, a little gravel at the bottom of the range." />
              </UiField>
            </div>
          </div>

          <!-- Voice: what it can do → how it was made → filters → a voice that names its model, each with its words. -->
          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">Voice</h3></div>
            <div class="jv-card__body jv-col persona-editor__voicecard">
              <UiField label="How it can be directed" layout="block"
                hint="What the voice's model takes to shape how it speaks. Written direction: you describe it in words (Style Instructions). Tags: you pick from the model's list, like [sigh]. Sliders only: pace, pitch and gain. This decides what How it speaks offers below.">
                <UiSegmented v-model="directionFilter" :options="directionChoices" size="small" aria-label="How it can be directed" />
              </UiField>
              <UiField label="Type" layout="block"
                hint="What type of voice. Built-in voices come with their model. Cloned, Designed and Blended list the voices you've made, and open their maker on the right so you can make a new one.">
                <UiSegmented v-model="kind" :options="kindOptions" size="small" aria-label="Type" @blocked="onKindBlocked" />
              </UiField>
              <div class="jv-field-row">
                <UiField label="Model" layout="block">
                  <UiSelect v-model="modelFilter" :options="modelOptions" width="name" />
                </UiField>
                <UiField label="Gender" layout="block">
                  <UiSelect v-model="genderFilter" :options="genderOptions" width="id" />
                </UiField>
                <UiField label="Voice's language" layout="block">
                  <UiSelect v-model="languageFilter" :options="languageFilterOptions" width="id" />
                </UiField>
              </div>
              <p class="jv-hint">These only narrow the list. Each counts the voices left by the others.</p>
              <div class="jv-field-row">
                <UiField label="Voice" layout="block">
                  <UiSelect :model-value="voiceSelectValue" :options="voiceOptions" width="path"
                    :placeholder="voiceEmptyHint || 'Pick a voice'" :disabled="!voiceOptions.length"
                    @update:model-value="pickVoice" />
                </UiField>
                <UiButton intent="secondary" label="▶ Play" :loading="rawBusy" :disabled="!voice"
                  title="Play the voice on its own, before this page changes anything" @click="playRaw" />
                <UiField v-if="versionOptions.length" label="Version" layout="block">
                  <UiSelect :model-value="versionOptions[0].value" :options="versionOptions" width="name"
                    :disabled="versionOptions.length < 2" />
                </UiField>
              </div>
              <!-- One line under the voice (2026-10-05: three said "its model" twice). -->
              <p v-if="voiceEmptyHint" class="jv-hint">{{ voiceEmptyHint }}</p>
              <p v-else class="jv-hint">{{ shownVoices.length }} voice{{ shownVoices.length === 1 ? "" : "s" }} in the list.
                {{ voice ? "The voice's model" : "Its model" }} decides everything below.</p>
              <p v-if="versionOptions.length" class="jv-hint"><strong>Version:</strong> Which size of the model speaks. It's set per
                model, so every persona on it uses the same one.</p>
              <div v-if="kind === 'design' && voice?.source === 'designed' && voice.design_prompt" class="jv-inline-row">
                <span class="jv-hint">“{{ voice.design_prompt }}”</span>
                <UiButton intent="ghost" size="small" label="Start from this one"
                  title="A kept voice doesn't change — copy its words into the new design on the right"
                  @click="startFromThis" />
              </div>
              <div v-if="voice" class="jv-inline-row">
                <UiField label="Speaks" layout="block" :hint="languageNote">
                  <span v-if="languageFixed" class="persona-editor__fixed">{{ languageName(effectiveLanguage) || effectiveLanguage }}</span>
                  <UiSelect v-else v-model="draft.language" :options="languageOptions" width="name" />
                </UiField>
              </div>
              <div v-if="voiceChange" class="jv-banner jv-banner--warn">
                Changing this makes {{ draft.name || "this persona" }}'s <strong>{{ plural(voiceChange.lines, "line") }}</strong> stale.
                <template v-if="voiceChange.lost && voiceChange.directed">
                  <strong>{{ voiceChange.directed }} carry a written direction</strong> — {{ voiceChange.lost }} won't perform them.
                </template>
              </div>
            </div>
          </div>

          <!-- How it speaks — the numbers on every model; direction in the model's own kind. -->
          <div class="jv-card" :class="{ 'persona-editor__locked': locked }" :aria-disabled="locked || undefined">
            <div class="jv-card__header"><h3 class="jv-card__title">How it speaks</h3></div>
            <div class="jv-card__body jv-col">
              <div class="jv-knob-grid">
                <div v-for="k in SHAPE_KNOBS" :key="k.key" class="jv-knob-grid__knob">
                  <div class="jv-knob-grid__head">
                    <label class="jv-knob-grid__label">{{ k.label }}</label>
                    <UiButton intent="ghost" size="small" label="↺" :disabled="shared(k.key, null) === null"
                      :title="k.reset" @click="setShared(k.key, null)" />
                  </div>
                  <div class="jv-knob-grid__row">
                    <UiSlider :model-value="shared(k.key, k.neutral)" :min="k.min" :max="k.max" :step="k.step"
                      width="full" :aria-label="k.label" @update:model-value="(v) => setShared(k.key, v)" />
                    <span class="jv-knob-grid__unit">{{ k.unit }}</span>
                  </div>
                </div>
                <div class="jv-knob-grid__knob">
                  <div class="jv-knob-grid__head"><label class="jv-knob-grid__label">Pause before → after</label></div>
                  <div class="jv-knob-grid__row">
                    <UiNumber :model-value="draft.default_delivery.pause_before" :min="0" :max="10000" :step="50"
                      width="num" size="small" placeholder="—" aria-label="Pause before"
                      @update:model-value="(v) => setShared('pause_before', v)" />
                    <span class="jv-knob-grid__unit">→</span>
                    <UiNumber :model-value="draft.default_delivery.pause_after" :min="0" :max="10000" :step="50"
                      width="num" size="small" placeholder="—" aria-label="Pause after"
                      @update:model-value="(v) => setShared('pause_after', v)" />
                    <span class="jv-knob-grid__unit">ms</span>
                  </div>
                </div>
              </div>
              <p v-if="voice && !paceNative" class="jv-hint">Pace is time-stretched after {{ modelName }} speaks — it doesn't pace itself.</p>
              <p class="jv-hint">An empty pause is the book's own gap between lines.</p>

              <UiField layout="block" :hint="directionReason || 'A line\'s own direction is added after this.'">
                <template #label>
                  <span class="jv-field-label-row">Style Instructions<template v-if="!directionReason"> (optional)</template>
                    <UiTag v-if="voice" :intent="directedBy === 'words' ? 'success' : 'secondary'">{{ directedBy === 'words' ? '✓' : '✗' }} {{ modelName }}</UiTag>
                  </span>
                </template>
                <UiTextarea v-model="draft.voice_instruct" :rows="2" :disabled="!!directionReason"
                  placeholder="Clipped, world-weary. Dry wit. Boston accent under stress." />
              </UiField>
              <p v-if="isVoiceDesign" class="jv-banner jv-banner--warn">
                On Qwen3 VoiceDesign these words reshape the voice itself, not just how it speaks.
              </p>
              <div class="jv-field-row">
                <UiField :label="emotionTagSet ? `Emotion — ${modelName}'s own tags` : 'Emotion'" layout="block">
                  <UiSelect v-model="emotion" width="id" :disabled="!emotionChoices.length"
                    :options="[{ value: '', label: '— none —' }, ...emotionChoices.map((e) => ({ value: e, label: emotionTagSet ? `[${e}]` : e }))]" />
                </UiField>
                <UiField v-if="registerTagSet" label="Register" layout="block">
                  <UiSelect v-model="registerTag" width="id"
                    :options="[{ value: '', label: '— none —' }, ...registerTagSet.tags.map((t) => ({ value: t, label: `[${t}]` }))]" />
                </UiField>
              </div>
              <p v-if="emotionTagSet" class="jv-hint">
                Put at the start of every line. Sounds like [sigh] or [laugh] go inside a line — type them in its text.
              </p>
              <p v-else-if="!emotionChoices.length && voice" class="jv-hint">{{ modelName }} takes no emotion.</p>

              <div class="jv-field-row">
                <UiField label="Effects" layout="block">
                  <div class="jv-inline-row">
                    <UiTag v-for="(name, i) in effectNames" :key="i" intent="secondary">{{ name }}</UiTag>
                    <span v-if="!effectNames.length" class="jv-hint">None.</span>
                    <UiButton intent="ghost" size="small" label="＋ Edit" @click="effectsOpen = true" />
                  </div>
                </UiField>
                <UiField label="Lexicon" layout="block">
                  <UiSelect v-model="draft.lexicon_id" :options="lexiconOptions" width="name" />
                </UiField>
              </div>
              <p class="jv-hint">The lexicon is read on this persona's lines, after the book's. The book's wins on the same word.</p>
            </div>
          </div>

          <!-- Sampling — exactly the model's own knobs, kept per model. -->
          <div class="jv-card" :class="{ 'persona-editor__locked': locked }" :aria-disabled="locked || undefined">
            <div class="jv-card__header">
              <h3 class="jv-card__title">Sampling</h3>
              <span v-if="voice" class="jv-hint">{{ modelName }}</span>
            </div>
            <div class="jv-card__body jv-col">
              <div class="jv-knob-grid">
                <div v-for="k in knobs" :key="k.key" class="jv-knob-grid__knob">
                  <div class="jv-knob-grid__head">
                    <label class="jv-knob-grid__label" :title="k.hint">{{ k.label }}</label>
                    <UiButton intent="ghost" size="small" label="↺" :disabled="ms()?.knobs?.[k.key] === undefined"
                      :title="`Back to the model default (${k.default})`" @click="resetKnob(k)" />
                  </div>
                  <div class="jv-knob-grid__row">
                    <UiSlider :model-value="knobValue(k)" :min="k.min" :max="k.max" :step="k.step" width="full"
                      :aria-label="k.label" @update:model-value="(v) => setKnob(k, v)" />
                    <span v-if="k.unit" class="jv-knob-grid__unit">{{ k.unit }}</span>
                  </div>
                </div>
                <div v-if="voice" class="jv-knob-grid__knob">
                  <div class="jv-knob-grid__head"><label class="jv-knob-grid__label">Seed</label></div>
                  <div class="jv-knob-grid__row">
                    <UiNumber v-model="seed" :min="0" :max="2000000000" :step="1" width="id" size="small"
                      placeholder="random" :disabled="!seedSupported" :use-grouping="false" aria-label="Seed" />
                    <UiButton intent="ghost" size="small" label="🎲" title="A new seed" :disabled="!seedSupported" @click="rollSeed" />
                  </div>
                </div>
              </div>
              <p v-if="voice && !knobs.length && !seedSupported" class="jv-hint">{{ modelName }} has no sampling settings.</p>
              <p v-if="voice" class="jv-hint">
                {{ seedSupported ? "The same seed gives the same take. Empty = a new one each time." : `${modelName} doesn't repeat with a seed.` }}
              </p>
              <div class="jv-inline-row">
                <UiButton intent="secondary" label="⚖️ Compare settings…" :disabled="locked" @click="openCompare" />
              </div>
            </div>
          </div>

          <!-- Hear it — the same path a chapter renders with; the makers' Preview speaks this line. -->
          <div class="jv-card" :class="{ 'persona-editor__locked': locked && !maker }" :aria-disabled="(locked && !maker) || undefined">
            <div class="jv-card__header"><h3 class="jv-card__title">Hear it</h3></div>
            <div class="jv-card__body jv-col">
              <UiTextarea ref="hearBox" v-model="hearText" :rows="2"
                placeholder="Type a line — or leave it empty to hear the stock line." />
              <SlashTagMenu :tag-sets="tagSets" :open="tagMenuOpen" :anchor="tagAnchor" query=""
                @insert="insertTag" @close="tagMenuOpen = false" />
              <div class="jv-inline-row">
                <UiButton intent="primary" label="▶ Listen" :loading="hearBusy" :disabled="locked" @click="listen" />
                <UiButton intent="secondary" label="↻ Stock line" @click="stockLine" />
                <UiButton intent="ghost" label="🏷️ Insert tag…" :disabled="locked || !tagSets.length"
                  :title="tagSets.length ? `${modelName}'s own tags` : `${modelName || 'This model'} takes no tags`"
                  @click="openTagMenu" />
                <span class="jv-spacer" />
                <UiButton intent="ghost" label="⤓ WAV" :disabled="!audio" @click="saveWav" />
              </div>
              <div v-if="audio" class="jv-col">
                <span class="jv-hint">{{ audio.label }}</span>
                <audio :src="audio.url" controls autoplay class="jv-audio-inline" />
              </div>
            </div>
          </div>

          <!-- Save. -->
          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">Save</h3></div>
            <div class="jv-card__body jv-col">
              <div class="jv-field-row">
                <UiButton intent="primary" label="💾 Save" :loading="saving" :disabled="!dirty || !draft.name.trim()"
                  :title="draft.name.trim() ? '' : 'A persona needs a name'" @click="save" />
                <UiButton intent="secondary" label="↺ Revert" :disabled="!dirty" @click="revert" />
                <template v-if="!isNew">
                  <UiField label="Save as a new persona" layout="block">
                    <UiInput v-model="saveAsName" width="name" placeholder="e.g. June (softer)" />
                  </UiField>
                  <UiButton intent="secondary" label="＋ Save as new" :disabled="!saveAsName.trim()" @click="saveAsNew" />
                </template>
              </div>
            </div>
          </div>
        </div>

        <div class="jv-split__col">
          <!-- The maker for the kind picked on the left (Clone, Design, Blend) —
               on the right, beside the list it fills (the user, 2026-10-04: "you
               have sapce on the right why dont you put the new desing and
               dynamoic fields on the right"). -->
          <MockCloneMaker v-if="maker === 'clone'" :key="`c${makerKey}`" :persona-name="draft.name"
            :direction="directionFilter" @kept="onKept" />
          <MockDesignMaker v-else-if="maker === 'design'" :key="`d${makerKey}`" :persona-name="draft.name"
            :note="draft.note" :start-from="designFrom" :direction="directionFilter" @kept="onKept" />
          <MockBlendMaker v-else-if="maker === 'blend'" :key="`b${makerKey}`" :persona-name="draft.name"
            @kept="onKept" />
          <div class="jv-card jv-card--soft">
            <div class="jv-card__header"><h3 class="jv-card__title">{{ draft.name || "New persona" }}</h3></div>
            <div class="jv-card__body">
              <p v-if="summary" class="persona-editor__summary">{{ summary }}</p>
              <p v-else class="jv-hint">No voice yet.</p>
              <p v-if="draft.voice_instruct && directedBy === 'words'" class="jv-hint">“{{ draft.voice_instruct }}”</p>
              <p v-if="effectNames.length" class="jv-hint">{{ effectNames.join(" + ") }}</p>
            </div>
          </div>

          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">This model</h3></div>
            <div class="jv-card__body jv-col jv-col--start">
              <template v-if="voice">
                <strong>{{ modelName }}</strong>
                <div class="jv-inline-row persona-editor__tags">
                  <UiTag :intent="directedBy === 'words' ? 'success' : 'secondary'">{{ directedBy === 'words' ? '✓' : '✗' }} written direction</UiTag>
                  <UiTag :intent="tagSets.length ? 'success' : 'secondary'">{{ tagSets.length ? '✓' : '✗' }} tags</UiTag>
                  <UiTag intent="secondary">{{ speaks.length > 1 ? `✓ ${speaks.length} languages` : speaksLabel }}</UiTag>
                  <UiTag :intent="row?.supports_voice_cloning ? 'success' : 'secondary'">{{ row?.supports_voice_cloning ? '✓' : '✗' }} cloning</UiTag>
                  <UiTag :intent="seedSupported ? 'success' : 'secondary'">{{ seedSupported ? '✓' : '✗' }} seed</UiTag>
                </div>
                <div v-if="tagSets.length" class="jv-col">
                  <div v-for="set in tagSets" :key="set.category" class="jv-hint">
                    <strong>{{ set.label }}:</strong> {{ set.tags.map((t) => `[${t}]`).join(" ") }}
                  </div>
                </div>
              </template>
              <p v-else class="jv-hint">Pick a voice to see what its model can do.</p>
              <UiButton intent="ghost" size="small" label="Compare models →"
                @click="router.push({ path: '/ai', query: { tab: 'speech-engines' } })" />
            </div>
          </div>

          <div class="jv-card">
            <div class="jv-card__header">
              <h3 class="jv-card__title">Used by</h3>
              <span v-if="usage?.total_lines" class="jv-hint">{{ plural(usage.total_lines, "line") }}</span>
            </div>
            <div class="jv-card__body jv-col jv-col--start">
              <div v-if="usedBy.length" class="jv-inline-row persona-editor__tags">
                <UiTag v-for="u in usedBy" :key="u.speaker_id" intent="secondary">
                  🎭 {{ u.speaker_name }} — {{ u.project_name }} · {{ plural(u.lines, "line") }}
                </UiTag>
              </div>
              <p v-else class="jv-hint">No speaker has this persona yet — give it to one in Studio · Cast.</p>
              <UiButton v-for="b in usedBooks" :key="b[0]" intent="secondary" size="small"
                :label="usedBooks.length > 1 ? `Open ${b[1]} Cast →` : 'Open Cast →'" @click="openCast(b[1])" />
            </div>
          </div>
        </div>
      </div>
    </template>

    <EffectsChainEditorModal v-if="draft" :open="effectsOpen" v-model="draft.effects_chain"
      :context-label="draft.name || 'Persona'" @save="onEffectsSaved" @cancel="effectsOpen = false" />

    <AppModal v-if="compareOpen" eyebrow="Compare settings" :title="draft?.name || 'This persona'"
      :max-width="'640px'" dismissable @close="compareOpen = false">
      <div class="jv-col jv-col--start">
        <p class="jv-hint">Pick a setting and three values, then hear the same line three ways.</p>
        <div class="jv-field-row">
          <UiField label="Setting" layout="block">
            <UiSelect v-model="compareKey" :options="compareOptions" width="id" />
          </UiField>
          <UiField v-for="(v, i) in compareValues" :key="i" :label="`Value ${i + 1}`" layout="block">
            <UiNumber :model-value="v" :min="compareSpec(compareKey).min" :max="compareSpec(compareKey).max"
              :step="compareSpec(compareKey).step" width="num"
              @update:model-value="(x) => (compareValues = compareValues.map((y, j) => (j === i ? x : y)))" />
          </UiField>
        </div>
        <UiButton intent="primary" label="▶ Hear all three" :loading="compareBusy" @click="runCompare" />
        <div v-for="r in compareResults" :key="r.value" class="jv-inline-row">
          <span class="jv-hint">{{ compareOptions.find((o) => o.value === compareKey)?.label }} {{ r.value }}</span>
          <audio :src="r.url" controls class="jv-audio-inline" />
          <UiButton intent="ghost" size="small" label="Use this" @click="useCompared(r.value)" />
        </div>
      </div>
      <template #footer>
        <span class="jv-spacer" />
        <UiButton intent="secondary" label="Close" @click="compareOpen = false" />
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.persona-editor { display: flex; flex-direction: column; gap: 12px; }
.persona-editor__pills { gap: 6px; }
.persona-editor__fixed { font-size: 13.5px; }
/* Every explanatory line on the Voice card wraps at one reading width (the
   layout law: prose gets ~60ch) — the long ones ran the card's width. In rem,
   not ch: the field hints use a smaller font, so 60ch came out narrower. */
.persona-editor__voicecard .jv-hint,
.persona-editor__voicecard :deep(.ui-field__hint) { max-width: 30rem; }

.persona-editor__summary { margin: 0 0 6px; font-weight: 600; }
.persona-editor__tags { gap: 6px; }
/* A blank persona: only the Voice card is live until a voice is picked
   (plan 2026-10-03 §6.2, improvement 4). */
.persona-editor__locked { opacity: 0.5; pointer-events: none; }
</style>
