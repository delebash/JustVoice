<!-- SPDX-License-Identifier: MIT -->
<!--
  PersonaEditorView — one persona, on its own page (`Personas › June`): the
  mock's `workbench` screen (docs/plans/mock/_s7.html), as the persona redesign
  corrected it (docs/plans/2026-10-03-persona-redesign.md §6.1).

  A persona is a finished spoken voice: a voice — which carries the model that
  speaks it — plus everything about how it speaks. So the page is built from
  the voice's model:
    · Voice — the kind radios (how a voice was made) FILTER the list; beside it
      Can be directed / Model / Gender filters; each option names its model.
      The model is never picked on its own: it comes with the voice.
    · Hear it — the line through the same resolver a chapter renders with.
    · How it speaks — pace, pitch, gain, pauses (every model); direction in
      the model's own kind (written direction + emotion, or Turbo's tags, or
      none — shown off with the reason); effects; lexicon.
    · Sampling — exactly the model's own knobs and seed, kept per model.
    · Save — Save, Save as new, Revert, Blend, Train a LoRA (off).
  The right column: a summary, This model, Used by.

  A control the current model can't honour is shown, disabled, with its
  reason — never hidden (the mock's own rule). Values a model doesn't take are
  kept, per model, so switching back restores them.
-->
<script setup>
import { computed, onActivated, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import {
  AppModal, EmptyState, UiButton, UiField, UiInput, UiNumber, UiSegmented, UiSelect,
  UiSlider, UiTag, UiTextarea, confirmDialog, languageName, pushToast, saveBlob,
} from "@delebash/llm-ui";
import EffectsChainEditorModal from "../components/EffectsChainEditorModal.vue";
import SlashTagMenu from "../components/SlashTagMenu.vue";
import { usePageCrumbs } from "../composables/usePageCrumbs.js";
import { handleTermsRefusal } from "../services/engineTerms.js";
import { openProjectInStudio } from "../services/openProject.js";
import { DIRECTION_OPTIONS, VOICE_KINDS as KINDS, voiceKind as kindOf } from "../services/personaFacts.js";
import { auditionVoice } from "../services/voiceAudition.js";
import { voiceGender, voiceGenderWord } from "../services/voiceGender.js";
import { useActiveProject } from "../stores/activeProject.js";
import { useApi } from "../stores/api.js";
import { useEnginesStore } from "../stores/engines.js";
import { useLexiconsStore } from "../stores/lexicons.js";
import { usePersonasStore } from "../stores/personas.js";
import { useProjectsStore } from "../stores/projects.js";
import { useVoicesStore } from "../stores/voices.js";

const api = useApi();
const route = useRoute();
const router = useRouter();
const personasStore = usePersonasStore();
const voicesStore = useVoicesStore();
const enginesStore = useEnginesStore();
const lexiconsStore = useLexiconsStore();
const projectsStore = useProjectsStore();
const activeProject = useActiveProject();

const voices = computed(() => voicesStore.items);
const lexicons = computed(() => lexiconsStore.items);

// ── The persona being edited ────────────────────────────────────────────
const SHARED = ["speed", "pitch", "gain_db", "pause_before", "pause_after"];
const personaId = computed(() => (route.name === "persona" ? String(route.params.id || "") : ""));
const isNew = computed(() => personaId.value === "new");
const loading = ref(false);
const missing = ref(false);
const saved = ref(null);   // the persona as stored (null for a new one)
const draft = ref(null);   // what the page edits

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

/** The delivery as it is saved: only what is set; a model with nothing set drops. */
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
    voice_id: d.voice_id || null,
    language: d.language || null,
    voice_instruct: d.voice_instruct.trim() || null,
    note: d.note.trim() || null,
    default_delivery: cleanDelivery(d.default_delivery),
    effects_chain: d.effects_chain || [],
    lexicon_id: d.lexicon_id || null,
  };
}

const dirty = computed(() => {
  if (!draft.value) return false;
  const base = saved.value ? fromPersona(saved.value) : blank();
  return JSON.stringify(payload(draft.value)) !== JSON.stringify(payload(base));
});

// ── Server facts ────────────────────────────────────────────────────────
const caps = ref({});            // capability rows, keyed by model or engine id
const emotionValues = ref([]);   // the app's nine
const usage = ref(null);         // {speakers, total_lines, directed_lines}

async function loadCaps() {
  const r = await api.safeRequest("/v1/engines/capabilities", { engines: {} });
  caps.value = r?.engines || {};
  emotionValues.value = r?.emotion_values || [];
}

async function load() {
  const id = personaId.value;
  if (!id) return;
  loading.value = true;
  missing.value = false;
  try {
    await Promise.all([
      voicesStore.ensureLoaded(), enginesStore.ensureLoaded(), lexiconsStore.ensureLoaded(),
      projectsStore.ensureLoaded(), loadCaps(),
    ]);
    if (id === "new") {
      saved.value = null;
      draft.value = blank();
      const voice = String(route.query.voice || "");
      if (voice && voices.value.some((v) => v.id === voice)) pickVoice(voice);
      usage.value = null;
    } else {
      const p = await api.safeRequest(`/v1/personas/${id}`, null);
      if (!p) { missing.value = true; draft.value = null; return; }
      saved.value = p;
      draft.value = fromPersona(p);
      usage.value = await api.safeRequest(`/v1/personas/${id}/usage-detail`, null);
    }
    kind.value = voice.value ? kindOf(voice.value) : "builtin";
  } finally {
    loading.value = false;
  }
}

watch(personaId, (id, before) => { if (id && id !== before) load(); }, { immediate: true });
onActivated(() => { enginesStore.reload?.(); });

// The title bar already says "Personas"; the crumb adds this one.
const { publish: publishCrumbs } = usePageCrumbs(() => [
  { label: isNew.value ? "New persona" : (draft.value?.name || saved.value?.name || "Persona") },
]);
watch([() => draft.value?.name, isNew], publishCrumbs, { immediate: true });

// ── The voice and its model ─────────────────────────────────────────────
const voice = computed(() => voices.value.find((v) => v.id === draft.value?.voice_id) || null);
const voiceGone = computed(() => !!draft.value?.voice_id && !voice.value && voices.value.length > 0);
const model = computed(() => voice.value?.model || "");
const row = computed(() => caps.value[model.value] || null);
const modelName = computed(() => voice.value?.model_name || row.value?.display_name || model.value);
const directedBy = computed(() => voice.value?.directed_by || "");
const locked = computed(() => !voice.value);

// A capability row is keyed by model; a loaded variant id carries a size and
// precision tail ("qwen3-cv-1.7b-q8") — walk it down as the server does.
function modelOfVariant(variantId) {
  let probe = variantId || "";
  while (probe) {
    if (caps.value[probe]) return caps.value[probe].engine_id || probe;
    if (!probe.includes("-")) break;
    probe = probe.slice(0, probe.lastIndexOf("-"));
  }
  return "";
}
const notLoaded = computed(() => {
  if (!voice.value) return false;
  const engine = enginesStore.items.find((e) => e.id === voice.value.engine);
  if (engine?.status !== "loaded") return true;
  return !!engine.current_variant_id && modelOfVariant(engine.current_variant_id) !== model.value;
});

// The kind radios (KINDS) — how a voice was made. They filter the list.
const kind = ref("builtin");
function onKindBlocked(opt) {
  pushToast({ kind: "info", message: opt.title || "Not available yet." });
}

// Filters beside the list (decided 2026-10-03: "some way for the user to
// filter out what types of voices they want to use"); DIRECTION_OPTIONS.
const directionFilter = ref("");
const modelFilter = ref("");
const genderFilter = ref("");

const voicesOfKind = computed(() => voices.value.filter((v) => kindOf(v) === kind.value));
const modelOptions = computed(() => {
  const counts = new Map();
  for (const v of voicesOfKind.value) {
    const cur = counts.get(v.model) || { name: v.model_name || v.model, n: 0 };
    cur.n += 1;
    counts.set(v.model, cur);
  }
  return [
    { value: "", label: "All models" },
    ...[...counts].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([m, c]) => ({ value: m, label: `${c.name} (${c.n})` })),
  ];
});
const GENDER_OPTIONS = [
  { value: "", label: "Any gender" }, { value: "F", label: "Female" },
  { value: "M", label: "Male" }, { value: "N", label: "Neutral" },
];
const shownVoices = computed(() => voicesOfKind.value.filter((v) =>
  (!directionFilter.value || v.directed_by === directionFilter.value)
  && (!modelFilter.value || v.model === modelFilter.value)
  && (!genderFilter.value || voiceGender(v) === genderFilter.value)));
watch(kind, () => { modelFilter.value = ""; });

function voiceLabel(v) {
  return [v.name, voiceGenderWord(v), languageName(v.language) || v.language, v.model_name || v.engine]
    .filter(Boolean).join(" · ");
}
const voiceOptions = computed(() => shownVoices.value.map((v) => ({ value: v.id, label: voiceLabel(v) })));
const voiceSelectValue = computed(() =>
  shownVoices.value.some((v) => v.id === draft.value?.voice_id) ? draft.value.voice_id : "");
const kindEmptyHint = computed(() => {
  if (shownVoices.value.length) return "";
  if (voicesOfKind.value.length) return "No voice of this kind matches these filters.";
  return {
    builtin: "No built-in voices — install a speech model on AI Settings → Speech engines.",
    clone: "No cloned voices yet — make one on Voices → Clone.",
    design: "No designed voices yet — make one on Voices → Design.",
    blend: "No blends yet — make one on Voices → Blend.",
  }[kind.value] || "";
});

const voiceChange = ref(null); // {lines, directed, lost} — the warning after a change

function pickVoice(id) {
  const v = voices.value.find((x) => x.id === id);
  if (!v || !draft.value) return;
  const before = voice.value;
  draft.value.voice_id = id;
  // Keep the language when the new voice's model speaks it; else the voice's own.
  const speaks = v.speaks || [];
  const base = (code) => String(code || "").split("-")[0].toLowerCase();
  if (speaks.length === 1) draft.value.language = speaks[0];
  else if (!speaks.some((s) => base(s) === base(draft.value.language))) draft.value.language = v.language || speaks[0] || "";
  const lines = usage.value?.total_lines || 0;
  if (before && before.id !== v.id && lines) {
    const directed = usage.value?.directed_lines || 0;
    voiceChange.value = { lines, directed, lost: v.directed_by !== "words" ? (v.model_name || v.engine) : "" };
  }
}

// ▶ Raw — the voice on its own, before anything here shapes it.
const rawBusy = ref(false);
async function playRaw() {
  if (!voice.value || rawBusy.value) return;
  rawBusy.value = true;
  try {
    const blob = await auditionVoice(api, voice.value);
    if (blob instanceof Blob) setAudio(blob, `${voice.value.name} on its own`);
  } catch (e) {
    if (!handleTermsRefusal(e)) pushToast({ kind: "error", message: `Couldn't play the voice: ${e?.message || e}` });
  } finally {
    rawBusy.value = false;
  }
}

// ── Language ────────────────────────────────────────────────────────────
const speaks = computed(() => voice.value?.speaks || []);
const languageFixed = computed(() => speaks.value.length <= 1);
const languageOptions = computed(() =>
  speaks.value.map((c) => ({ value: c, label: languageName(c) || c })));
const languageNote = computed(() => {
  const v = voice.value;
  const lang = effectiveLanguage.value;
  if (!v || !lang || !v.language) return "";
  const base = (code) => String(code).split("-")[0].toLowerCase();
  return base(lang) !== base(v.language)
    ? `Speaks ${languageName(lang) || lang} · voice is ${languageName(v.language) || v.language}`
    : "";
});
// What the persona actually speaks: where the voice or model allows one
// language that one, whatever is stored (the render does the same).
const effectiveLanguage = computed(() => (languageFixed.value
  ? speaks.value[0] || voice.value?.language || draft.value?.language
  : draft.value?.language || voice.value?.language || speaks.value[0]));
const speaksLabel = computed(() => {
  const lang = effectiveLanguage.value;
  return lang ? `Speaks ${languageName(lang) || lang}` : "";
});

// ── How it speaks ───────────────────────────────────────────────────────
function shared(key, fallback) {
  const v = draft.value?.default_delivery?.[key];
  return v === null || v === undefined ? fallback : Number(v);
}
function setShared(key, value) {
  draft.value.default_delivery[key] = value === null || value === "" ? null : Number(value);
}
const paceNative = computed(() => !!row.value?.speed_native);

/** The settings the persona keeps for the voice's model. */
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
  if (directedBy.value === "words") return emotionValues.value;
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
const lexiconOptions = computed(() => [
  { value: "", label: "None" }, ...lexicons.value.map((l) => ({ value: l.id, label: l.name })),
]);

// ── Hear it ─────────────────────────────────────────────────────────────
const hearText = ref("");
const hearBusy = ref(false);
const audio = ref(null);   // {url, blob, label}
function setAudio(blob, label) {
  if (audio.value?.url) URL.revokeObjectURL(audio.value.url);
  audio.value = { url: URL.createObjectURL(blob), blob, label };
}
function previewBody(text, extra = {}) {
  const p = payload();
  return {
    persona: {
      name: p.name, voice_id: p.voice_id, language: p.language,
      voice_instruct: p.voice_instruct, default_delivery: p.default_delivery,
      effects_chain: p.effects_chain, lexicon_id: p.lexicon_id,
    },
    text,
    ...extra,
  };
}
async function hear(text, extra = {}) {
  return api.request("/v1/personas/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(previewBody(text, extra)),
  });
}
async function listen() {
  if (!voice.value || hearBusy.value) return;
  hearBusy.value = true;
  try {
    const blob = await hear(hearText.value.trim());
    if (blob instanceof Blob) setAudio(blob, draft.value.name || "This persona");
  } catch (e) {
    if (!handleTermsRefusal(e)) pushToast({ kind: "error", message: `Listen failed: ${e?.message || e}` });
  } finally {
    hearBusy.value = false;
  }
}
async function stockLine() {
  const lang = effectiveLanguage.value || "";
  const r = await api.safeRequest(`/v1/personas/stock-line?language=${encodeURIComponent(lang)}`, null);
  if (r?.text) hearText.value = r.text;
}
async function saveWav() {
  if (!audio.value?.blob) return;
  const name = (draft.value?.name || "persona").replace(/[^\w.-]+/g, "_");
  try { await saveBlob(audio.value.blob, `${name}.wav`); } catch (e) {
    pushToast({ kind: "error", message: `Save failed: ${e?.message || e}` });
  }
}

// The tag picker — the voice's model's own tags (Turbo's 19), inserted at
// the caret; a model with none shows the button off with its reason.
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
const compareResults = ref([]);   // [{value, url, blob}]
const compareBusy = ref(false);
const compareOptions = computed(() => [
  { value: "speed", label: "Pace" }, { value: "pitch", label: "Pitch" }, { value: "gain_db", label: "Gain" },
  ...knobs.value.map((k) => ({ value: k.key, label: k.label })),
]);
function compareSpec(key) {
  if (key === "speed") return { min: 0.5, max: 2, step: 0.05, now: shared("speed", 1) };
  if (key === "pitch") return { min: -12, max: 12, step: 1, now: shared("pitch", 0) };
  if (key === "gain_db") return { min: -12, max: 12, step: 0.5, now: shared("gain_db", 0) };
  const k = knobs.value.find((x) => x.key === key);
  return k ? { min: k.min, max: k.max, step: k.step, now: knobValue(k) } : { min: 0, max: 1, step: 0.01, now: 0 };
}
function openCompare() {
  compareKey.value = "speed";
  seedCompareValues();
  compareResults.value = [];
  compareOpen.value = true;
}
function seedCompareValues() {
  const s = compareSpec(compareKey.value);
  const clamp = (x) => Math.min(s.max, Math.max(s.min, Math.round(x / s.step) * s.step));
  compareValues.value = [clamp(s.now - 2 * s.step), clamp(s.now), clamp(s.now + 2 * s.step)];
}
watch(compareKey, () => { if (compareOpen.value) { seedCompareValues(); compareResults.value = []; } });
async function runCompare() {
  if (compareBusy.value) return;
  compareBusy.value = true;
  for (const r of compareResults.value) URL.revokeObjectURL(r.url);
  compareResults.value = [];
  try {
    for (const value of compareValues.value) {
      const blob = await hear(hearText.value.trim(), { delivery: { [compareKey.value]: Number(value) } });
      if (blob instanceof Blob) compareResults.value = [...compareResults.value, { value, blob, url: URL.createObjectURL(blob) }];
    }
  } catch (e) {
    if (!handleTermsRefusal(e)) pushToast({ kind: "error", message: `Compare failed: ${e?.message || e}` });
  } finally {
    compareBusy.value = false;
  }
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
  try {
    if (isNew.value) {
      const p = await api.request("/v1/personas", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()),
      });
      saved.value = p;
      draft.value = fromPersona(p);
      await personasStore.reload();
      pushToast({ kind: "success", message: `${p.name} created.` });
      router.replace({ name: "persona", params: { id: p.id } });
    } else {
      const p = await api.request(`/v1/personas/${personaId.value}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()),
      });
      saved.value = p;
      draft.value = fromPersona(p);
      voiceChange.value = null;
      await personasStore.reload();
      const lines = usage.value?.total_lines || 0;
      pushToast({ kind: "success", message: lines ? `Saved. ${lines} line${lines === 1 ? " is" : "s are"} now stale.` : "Saved." });
    }
  } catch (e) {
    pushToast({ kind: "error", message: `Save failed: ${e?.message || e}` });
  } finally {
    saving.value = false;
  }
}
async function saveAsNew() {
  const name = saveAsName.value.trim();
  if (!name || !draft.value) return;
  try {
    const p = await api.request("/v1/personas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload(), name }),
    });
    await personasStore.reload();
    const was = saved.value?.name;
    saveAsName.value = "";
    // The page moves to the new persona; this one stays as it was saved.
    draft.value = saved.value ? fromPersona(saved.value) : draft.value;
    pushToast({ kind: "success", message: was ? `Saved as a new persona. ${was} is untouched.` : `${p.name} created.` });
    router.push({ name: "persona", params: { id: p.id } });
  } catch (e) {
    pushToast({ kind: "error", message: `Save as new failed: ${e?.message || e}` });
  }
}
function revert() {
  draft.value = saved.value ? fromPersona(saved.value) : blank();
  voiceChange.value = null;
  if (voice.value) kind.value = kindOf(voice.value);
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
  if (gain) bits.push(`${gain > 0 ? "+" : ""}${gain.toFixed(1)} dB`);
  const pitch = shared("pitch", null);
  if (pitch) bits.push(`${pitch > 0 ? "+" : ""}${pitch} st`);
  return bits.join(" · ");
});
const effectNames = computed(() => (draft.value?.effects_chain || []).map((e) => e.type).filter(Boolean));
const usedBy = computed(() => usage.value?.speakers || []);
const usedBooks = computed(() => [...new Map(usedBy.value.map((u) => [u.project_id, u.project_name]))]);
function openCast(projectId) {
  const project = projectsStore.items.find((p) => p.id === projectId);
  if (project) openProjectInStudio(activeProject, project, "cast");
}
function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }
</script>

<template>
  <div class="persona-editor">
    <EmptyState v-if="missing" icon="Sparkle" title="This persona doesn't exist any more"
      message="It may have been deleted or merged into another persona."
      action-label="Back to Personas" @action="router.push({ name: 'personas' })" />

    <template v-else-if="draft">
      <!-- The header pills (mock: voice · model, used by N). -->
      <div class="jv-inline-row persona-editor__pills">
        <UiTag v-if="voice" intent="secondary">{{ voice.name }} · <strong>{{ modelName }}</strong></UiTag>
        <UiTag v-if="speaksLabel" intent="secondary">{{ speaksLabel }}</UiTag>
        <UiTag v-if="usedBy.length" intent="secondary">used by <strong>{{ plural(usedBy.length, "speaker") }}</strong></UiTag>
        <UiTag v-if="dirty" intent="accent2">Unsaved changes</UiTag>
      </div>
      <div v-if="voice && notLoaded" class="jv-banner jv-banner--warn">
        <strong>{{ modelName }} isn't loaded.</strong> The first listen swaps it in — about a minute.
      </div>
      <div v-if="voiceGone" class="jv-banner jv-banner--danger">
        This persona's voice isn't available any more — pick another one below.
      </div>

      <div class="jv-split">
        <div class="jv-split__col">
          <!-- Persona: its name and the note the AI reads. -->
          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">Persona</h3></div>
            <div class="jv-card__body jv-col jv-col--start">
              <UiField label="Name" layout="block">
                <UiInput v-model="draft.name" width="name" placeholder="e.g. Narrator (warm)" />
              </UiField>
              <UiField label="Note on how it sounds" layout="block"
                hint="Read by Compose, Rewrite and Smart-assign. Never heard.">
                <UiTextarea v-model="draft.note" class="persona-editor__prose" :rows="2"
                  placeholder="Warm and unhurried, a little gravel at the bottom of the range." />
              </UiField>
            </div>
          </div>

          <!-- Voice: kind → filters → a voice that names its model. -->
          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">Voice</h3></div>
            <div class="jv-card__body jv-col jv-col--start">
              <UiSegmented v-model="kind" :options="KINDS" size="small" aria-label="Kind of voice" @blocked="onKindBlocked" />
              <div class="jv-field-row">
                <UiField label="Can be directed" layout="block">
                  <UiSelect v-model="directionFilter" :options="DIRECTION_OPTIONS" width="name" />
                </UiField>
                <UiField label="Model" layout="block">
                  <UiSelect v-model="modelFilter" :options="modelOptions" width="name" />
                </UiField>
                <UiField label="Gender" layout="block">
                  <UiSelect v-model="genderFilter" :options="GENDER_OPTIONS" width="id" />
                </UiField>
              </div>
              <div class="jv-field-row">
                <UiField label="Voice" layout="block">
                  <UiSelect :model-value="voiceSelectValue" :options="voiceOptions" width="path"
                    :placeholder="kindEmptyHint || 'Pick a voice'" :disabled="!voiceOptions.length"
                    @update:model-value="pickVoice" />
                </UiField>
                <UiButton intent="secondary" label="▶ Raw" :loading="rawBusy" :disabled="!voice"
                  title="Play the voice on its own, before this page changes anything" @click="playRaw" />
              </div>
              <p v-if="kindEmptyHint" class="jv-hint">{{ kindEmptyHint }}</p>
              <UiField v-if="voice" label="Speaks" layout="block" :hint="languageNote">
                <span v-if="languageFixed" class="persona-editor__fixed">{{ languageName(effectiveLanguage) || effectiveLanguage }}</span>
                <UiSelect v-else v-model="draft.language" :options="languageOptions" width="name" />
              </UiField>
              <div v-if="voiceChange" class="jv-banner jv-banner--warn">
                Changing this makes {{ draft.name || "this persona" }}'s <strong>{{ plural(voiceChange.lines, "line") }}</strong> stale.
                <template v-if="voiceChange.lost && voiceChange.directed">
                  <strong>{{ voiceChange.directed }} carry a written direction</strong> — {{ voiceChange.lost }} won't perform them.
                </template>
              </div>
              <p v-if="locked" class="jv-hint">Pick a voice first — everything below depends on its model.</p>
            </div>
          </div>

          <!-- Hear it — the same path a chapter renders with. -->
          <div class="jv-card" :class="{ 'persona-editor__locked': locked }" :aria-disabled="locked || undefined">
            <div class="jv-card__header"><h3 class="jv-card__title">Hear it</h3></div>
            <div class="jv-card__body jv-col jv-col--start">
              <UiTextarea ref="hearBox" v-model="hearText" class="persona-editor__prose" :rows="2"
                placeholder="Type a line — or leave it empty to hear the stock line." />
              <SlashTagMenu :tag-sets="tagSets" :open="tagMenuOpen" :anchor="tagAnchor" query=""
                @insert="insertTag" @close="tagMenuOpen = false" />
              <div class="jv-inline-row persona-editor__actions">
                <UiButton intent="primary" label="▶ Listen" :loading="hearBusy" :disabled="locked" @click="listen" />
                <UiButton intent="secondary" label="↻ Stock line" :disabled="locked" @click="stockLine" />
                <UiButton intent="ghost" label="🏷️ Insert tag…" :disabled="locked || !tagSets.length"
                  :title="tagSets.length ? `${modelName}'s own tags` : `${modelName || 'This model'} takes no tags`"
                  @click="openTagMenu" />
                <span class="jv-spacer" />
                <UiButton intent="ghost" label="⤓ WAV" :disabled="!audio" @click="saveWav" />
              </div>
              <div v-if="audio" class="persona-editor__player">
                <span class="jv-hint">{{ audio.label }}</span>
                <audio :src="audio.url" controls autoplay class="jv-audio-inline" />
              </div>
            </div>
          </div>

          <!-- How it speaks — every model takes the numbers; direction is the model's own kind. -->
          <div class="jv-card" :class="{ 'persona-editor__locked': locked }" :aria-disabled="locked || undefined">
            <div class="jv-card__header"><h3 class="jv-card__title">How it speaks</h3></div>
            <div class="jv-card__body jv-col jv-col--start">
              <div class="jv-knobs">
                <div class="jv-knobs__row">
                  <label class="jv-knobs__label">Pace</label>
                  <UiSlider :model-value="shared('speed', 1)" :min="0.5" :max="2" :step="0.05" width="short"
                    aria-label="Pace" @update:model-value="(v) => setShared('speed', v)" />
                  <span class="jv-knobs__unit">×</span>
                  <UiButton intent="ghost" size="small" label="↺" :disabled="shared('speed', null) === null"
                    title="Back to the voice's own pace" @click="setShared('speed', null)" />
                </div>
                <div class="jv-knobs__row">
                  <label class="jv-knobs__label">Pitch</label>
                  <UiSlider :model-value="shared('pitch', 0)" :min="-12" :max="12" :step="1" width="short"
                    aria-label="Pitch" @update:model-value="(v) => setShared('pitch', v)" />
                  <span class="jv-knobs__unit">st</span>
                  <UiButton intent="ghost" size="small" label="↺" :disabled="shared('pitch', null) === null"
                    title="Back to the voice's own pitch" @click="setShared('pitch', null)" />
                </div>
                <div class="jv-knobs__row">
                  <label class="jv-knobs__label">Gain</label>
                  <UiSlider :model-value="shared('gain_db', 0)" :min="-12" :max="12" :step="0.5" width="short"
                    aria-label="Gain" @update:model-value="(v) => setShared('gain_db', v)" />
                  <span class="jv-knobs__unit">dB</span>
                  <UiButton intent="ghost" size="small" label="↺" :disabled="shared('gain_db', null) === null"
                    title="Back to the voice's own level" @click="setShared('gain_db', null)" />
                </div>
              </div>
              <p v-if="voice && !paceNative" class="jv-hint">
                Pace is time-stretched after {{ modelName }} speaks — it doesn't pace itself.
              </p>
              <div class="jv-field-row">
                <UiField label="Pause before" layout="block">
                  <UiNumber :model-value="draft.default_delivery.pause_before" :min="0" :max="10000" :step="50"
                    width="id" placeholder="—" @update:model-value="(v) => setShared('pause_before', v)" />
                </UiField>
                <UiField label="Pause after" layout="block">
                  <UiNumber :model-value="draft.default_delivery.pause_after" :min="0" :max="10000" :step="50"
                    width="id" placeholder="—" @update:model-value="(v) => setShared('pause_after', v)" />
                </UiField>
              </div>
              <p class="jv-hint">Pauses in milliseconds. Empty = the project's gap between lines.</p>

              <UiField label="Standing delivery" layout="block"
                :hint="directionReason || 'A line\'s own direction is added after this.'">
                <UiTextarea v-model="draft.voice_instruct" class="persona-editor__prose" :rows="2"
                  :disabled="!!directionReason"
                  placeholder="Clipped, world-weary. Dry wit. Boston accent under stress." />
              </UiField>
              <p v-if="isVoiceDesign" class="jv-banner jv-banner--warn">
                On Qwen3 VoiceDesign these words reshape the voice itself, not just how it speaks.
              </p>
              <div class="jv-field-row">
                <UiField :label="emotionTagSet ? `Emotion — ${modelName}'s own tags` : 'Emotion'" layout="block">
                  <UiSelect v-model="emotion" width="name" :disabled="!emotionChoices.length"
                    :options="[{ value: '', label: '— none —' }, ...emotionChoices.map((e) => ({ value: e, label: emotionTagSet ? `[${e}]` : e }))]" />
                </UiField>
                <UiField v-if="registerTagSet" label="Register" layout="block">
                  <UiSelect v-model="registerTag" width="name"
                    :options="[{ value: '', label: '— none —' }, ...registerTagSet.tags.map((t) => ({ value: t, label: `[${t}]` }))]" />
                </UiField>
              </div>
              <p v-if="emotionTagSet" class="jv-hint">
                Put at the start of every line. Sounds like [sigh] or [laugh] go inside a line — type them in its text.
              </p>
              <p v-else-if="!emotionChoices.length && voice" class="jv-hint">{{ modelName }} takes no emotion.</p>

              <UiField label="Effects" layout="block">
                <div class="jv-inline-row">
                  <UiTag v-for="(name, i) in effectNames" :key="i" intent="secondary">{{ name }}</UiTag>
                  <span v-if="!effectNames.length" class="jv-hint">None.</span>
                  <UiButton intent="ghost" size="small" label="＋ Edit" @click="effectsOpen = true" />
                </div>
              </UiField>
              <UiField label="Lexicon" layout="block"
                hint="Read on this persona's lines, after the book's lexicon. The book's wins on the same word.">
                <UiSelect v-model="draft.lexicon_id" :options="lexiconOptions" width="name" />
              </UiField>
            </div>
          </div>

          <!-- Sampling — exactly the model's own knobs, kept per model. -->
          <div class="jv-card" :class="{ 'persona-editor__locked': locked }" :aria-disabled="locked || undefined">
            <div class="jv-card__header">
              <h3 class="jv-card__title">Sampling</h3>
              <span v-if="voice" class="jv-hint">{{ modelName }}</span>
            </div>
            <div class="jv-card__body jv-col jv-col--start">
              <div v-if="knobs.length" class="jv-knobs">
                <div v-for="k in knobs" :key="k.key" class="jv-knobs__row">
                  <label class="jv-knobs__label" :title="k.hint">{{ k.label }}</label>
                  <UiSlider :model-value="knobValue(k)" :min="k.min" :max="k.max" :step="k.step" width="short"
                    :aria-label="k.label" @update:model-value="(v) => setKnob(k, v)" />
                  <span class="jv-knobs__unit">{{ k.unit }}</span>
                  <UiButton intent="ghost" size="small" label="↺"
                    :disabled="ms()?.knobs?.[k.key] === undefined"
                    :title="`Back to the model default (${k.default})`" @click="resetKnob(k)" />
                </div>
              </div>
              <p v-else-if="voice" class="jv-hint">{{ modelName }} has no sampling settings.</p>
              <div class="jv-field-row">
                <UiField label="Seed" layout="block">
                  <UiNumber v-model="seed" :min="0" :max="2000000000" :step="1" width="id"
                    placeholder="random" :disabled="!seedSupported" :use-grouping="false" />
                </UiField>
                <UiButton intent="ghost" label="🎲" title="A new seed" :disabled="!seedSupported" @click="rollSeed" />
              </div>
              <p class="jv-hint">
                {{ seedSupported ? "The same seed gives the same take. Empty = a new one each time." : `${modelName || "This model"} doesn't repeat with a seed.` }}
              </p>
              <UiButton intent="secondary" label="⚖️ Compare settings…" :disabled="locked" @click="openCompare" />
            </div>
          </div>

          <!-- Save. -->
          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">Save</h3></div>
            <div class="jv-card__body jv-col jv-col--start">
              <div class="jv-inline-row persona-editor__actions">
                <UiButton intent="primary" label="💾 Save" :loading="saving"
                  :disabled="!dirty || !draft.name.trim()"
                  :title="draft.name.trim() ? '' : 'A persona needs a name'" @click="save" />
                <UiButton intent="secondary" label="↺ Revert" :disabled="!dirty" @click="revert" />
              </div>
              <div v-if="!isNew" class="jv-field-row">
                <UiField label="Save as a new persona" layout="block">
                  <UiInput v-model="saveAsName" width="name" placeholder="e.g. Narrator (softer)" />
                </UiField>
                <UiButton intent="secondary" label="＋ Save as new" :disabled="!saveAsName.trim()" @click="saveAsNew" />
              </div>
              <div class="jv-inline-row persona-editor__actions">
                <UiButton intent="ghost" label="🔀 Blend" title="Make a voice out of other voices — Voices → Blend"
                  @click="router.push({ name: 'voices', query: { tab: 'blended' } })" />
                <UiButton intent="ghost" label="🧪 Train a LoRA" disabled
                  title="Needs voice training, which isn't rebuilt yet." />
              </div>
            </div>
          </div>
        </div>

        <div class="jv-split__col">
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
                <div v-if="tagSets.length" class="persona-editor__taglist">
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
                :label="usedBooks.length > 1 ? `Open ${b[1]} Cast →` : 'Open Cast →'" @click="openCast(b[0])" />
            </div>
          </div>
        </div>
      </div>
    </template>

    <EffectsChainEditorModal v-if="draft" :open="effectsOpen" v-model="draft.effects_chain"
      :context-label="draft.name || 'Persona'" @save="onEffectsSaved" @cancel="effectsOpen = false" />

    <AppModal v-if="compareOpen" eyebrow="Compare settings" :title="draft?.name || 'This persona'"
      :max-width="'640px'" dismissable @close="compareOpen = false">
      <div class="jv-col jv-col--start persona-editor__compare">
        <p class="jv-hint">Pick a setting and three values, then hear the same line three ways.</p>
        <div class="jv-field-row">
          <UiField label="Setting" layout="block">
            <UiSelect v-model="compareKey" :options="compareOptions" width="name" />
          </UiField>
          <UiField v-for="(v, i) in compareValues" :key="i" :label="`Value ${i + 1}`" layout="block">
            <UiNumber :model-value="v" :min="compareSpec(compareKey).min" :max="compareSpec(compareKey).max"
              :step="compareSpec(compareKey).step" width="id"
              @update:model-value="(x) => (compareValues = compareValues.map((y, j) => (j === i ? x : y)))" />
          </UiField>
        </div>
        <UiButton intent="primary" label="▶ Hear all three" :loading="compareBusy" @click="runCompare" />
        <div v-for="r in compareResults" :key="r.value" class="persona-editor__player">
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
.persona-editor__pills { gap: 6px; flex-wrap: wrap; }
.persona-editor__prose { max-width: 60ch; }
.persona-editor__actions { gap: 8px; flex-wrap: wrap; align-items: center; }
.persona-editor__player { display: flex; flex-direction: column; gap: 4px; }
.persona-editor__fixed { font-size: 13.5px; }
.persona-editor__summary { margin: 0 0 6px; font-weight: 600; }
.persona-editor__tags { gap: 6px; flex-wrap: wrap; }
.persona-editor__taglist { display: flex; flex-direction: column; gap: 2px; }
.persona-editor__compare { gap: 10px; }
/* A blank persona: only the Voice card is live until a voice is picked —
   everything below depends on its model (plan §6.2, improvement 4). */
.persona-editor__locked { opacity: 0.5; pointer-events: none; }
</style>
