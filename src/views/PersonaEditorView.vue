<!-- SPDX-License-Identifier: MIT -->
<!--
  PersonaEditorView — one persona, on its own page (`Personas › June`): the
  mock's `workbench` screen (docs/plans/mock/_s7.html), as the persona redesign
  corrected it (docs/plans/2026-10-03-persona-redesign.md §6.1).

  A persona is a finished spoken voice: a voice — which carries the model that
  speaks it — plus everything about how it speaks. So the page is built from
  the voice's model, laid out as the in-app mock draws it (src/mock/, approved
  2026-10-04: "mock looks good, go ahead and code it" — plan
  docs/plans/2026-10-04-persona-voice-making.md): knobs three across, text
  boxes as wide as their card, the left column 1.5 × the right.
    · Voice — what a voice can do comes first ("How it can be directed"), how
      it was made second ("Type" — a made type also opens its maker on the
      right); Model / Gender / Voice's language beside the list; each lists only
      what the others leave, with counts that match (decided 2026-10-05, "A");
      a short line under each part says what it means. The voice names its
      model; Version, beside it, is the model's size. The model is never picked
      on its own: it comes with the voice.
    · How it speaks — pace, pitch, gain, pauses (every model); direction in
      the model's own kind (Style Instructions + emotion, or Turbo's tags, or
      none — shown off with the reason); effects; lexicon.
    · Sampling — exactly the model's own knobs and seed, kept per model.
    · Hear it — the line through the same resolver a chapter renders with;
      Rewrite and Compose. Right above Save, below everything that shapes the
      sound (decided 2026-10-05).
    · Save — Save, Revert, Save as new. (Train a LoRA left 2026-10-05: Trained is a
      Type, beside Cloned — where its maker opens once training is rebuilt.) Blend is a kind
      of voice now, not a button here.
  The right column: a summary, This model, Used by.

  A control the current model can't honour is shown, disabled, with its
  reason — never hidden (the mock's own rule). Values a model doesn't take are
  kept, per model, so switching back restores them.
-->
<script setup>
import { computed, onActivated, onBeforeUnmount, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import {
  AppModal, EmptyState, UiButton, UiField, UiInput, UiNumber, UiSegmented, UiSelect,
  DownloadBar, UiSlider, UiTag, UiTextarea, confirmDialog, fmtBytes, languageName, pushToast, runAiEndpoint, saveBlob,
} from "@delebash/llm-ui";
import EffectsChainEditorModal from "../components/EffectsChainEditorModal.vue";
import PersonaBlendMaker from "../components/PersonaBlendMaker.vue";
import PersonaCloneMaker from "../components/PersonaCloneMaker.vue";
import PersonaDesignMaker from "../components/PersonaDesignMaker.vue";
import PageTaskStrips from "../components/PageTaskStrips.vue";
import SlashTagMenu from "../components/SlashTagMenu.vue";
import { usePageCrumbs } from "../composables/usePageCrumbs.js";
import { setDefaultVariant } from "../services/engineDefaults.js";
import { handleTermsRefusal } from "../services/engineTerms.js";
import { makeEngineLoadTask } from "../services/ttsJobChannel.js";
import { facetCounts, facetOptions, facetTotal, narrowed } from "../services/facets.js";
import { lexiconMatches } from "../services/lexiconPreview.js";
import { openProjectInStudio } from "../services/openProject.js";
import { projectsService } from "../services/projects.js";
import { DIRECTION_OPTIONS, VOICE_KINDS as KINDS, voiceKind as kindOf, voiceKindWord, voiceLabel } from "../services/personaFacts.js";
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

// A new persona as it opened — blank, or on the voice Voices' "New persona
// from this voice" picked — so leaving an untouched page doesn't ask.
const opened = ref(null);
const copyOf = (d) => JSON.parse(JSON.stringify(d));
const dirty = computed(() => {
  if (!draft.value) return false;
  const base = saved.value ? fromPersona(saved.value) : (opened.value || blank());
  return JSON.stringify(payload(draft.value)) !== JSON.stringify(payload(base));
});

// ── Server facts ────────────────────────────────────────────────────────
const caps = ref({});            // capability rows, keyed by model or engine id
const emotionValues = ref([]);   // the app's nine
const usage = ref(null);         // {speakers, total_lines, directed_lines}
// Opened from Cast's ＋ New persona (`?project=<id>&for=<speaker id>`): Save
// gives the new persona to that speaker and goes back to the book's Cast.
const castFor = ref(null);       // {project, speaker} — speaker may be null
const effectLabels = ref({});    // effect type → its name ("eq_low" → "EQ — Low shelf")

async function loadCaps() {
  const r = await api.safeRequest("/v1/engines/capabilities", { engines: {} });
  caps.value = r?.engines || {};
  emotionValues.value = r?.emotion_values || [];
}
async function loadEffectLabels() {
  const r = await api.safeRequest("/v1/effects/catalog", { effects: [] });
  effectLabels.value = Object.fromEntries((r?.effects || []).map((e) => [e.type, e.label]));
}

async function load() {
  const id = personaId.value;
  if (!id) return;
  loading.value = true;
  missing.value = false;
  try {
    await Promise.all([
      voicesStore.ensureLoaded(), enginesStore.ensureLoaded(), lexiconsStore.ensureLoaded(),
      projectsStore.ensureLoaded(), loadCaps(), loadEffectLabels(),
    ]);
    if (id === "new") {
      saved.value = null;
      draft.value = blank();
      const voice = String(route.query.voice || "");
      if (voice && voices.value.some((v) => v.id === voice)) pickVoice(voice);
      opened.value = copyOf(draft.value);
      usage.value = null;
      castFor.value = null;
      const project = projectsStore.items.find((p) => p.id === String(route.query.project || ""));
      if (project) {
        let speaker = null;
        if (route.query.for) {
          const r = await api.safeRequest(`/v1/projects/${project.id}/speakers`, { speakers: [] });
          speaker = (r?.speakers || []).find((s) => s.id === String(route.query.for)) || null;
        }
        castFor.value = { project, speaker };
      }
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

// `new?voice=<id>` (Voices' "New persona from this voice") opens a blank
// persona on that voice; the page is KeepAlive-cached, so a second visit with
// another voice reloads too.
watch([personaId, () => route.query.voice, () => route.query.for], ([id, v, f], [before, vBefore, fBefore] = []) => {
  if (id && (id !== before || (id === "new" && (v !== vBefore || f !== fBefore)))) load();
}, { immediate: true });
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

// ── The Voice card — its original layout (decided 2026-10-04), with filters
// that narrow each other (decided 2026-10-05, "A"): How it can be directed and
// Type (once "Made by") first, then Model · Gender · Voice's language, then the voice. Each
// lists only what the others leave, with counts that match what the list will
// show (services/facets.js) — Model and the voice's language were built from
// Type alone, so Written direction + Built-in still offered Kokoro (54).

// What a voice can do comes first (the user, 2026-10-04: "there needs to be a
// bette way to identify a voice that can do direction and words") — each with
// its example.
const directionFilter = ref("");
const DIRECTION_WORD = { words: "written direction", tags: "tags", sliders: "sliders only" };
const DIRECTION_EXAMPLE = { words: "describe it", tags: "[fear] [sigh]", sliders: "pace, pitch, gain" };

// How it was made comes second. A kind is off when nothing of it can be
// directed this way and nothing can make one that can: a clone, or a design's
// kept take, can land on a model of any kind; built-ins are fixed; blends are
// Kokoro's. A made kind also opens its maker on the right.
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

// Model, Gender, and the voice's own language (the user, 2026-10-04: "so if i
// only want to see japanese voices i can do that").
const modelFilter = ref("");
const genderFilter = ref("");
const languageFilter = ref("");
const baseLang = (code) => String(code || "").split(/[-_]/)[0].toLowerCase();

// Every filter, for the shared rule; Type always has a kind chosen.
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
// A blend can be heard only when the installed speech runtime can play one (the capability
// rows say so per install, audit 2026-10-04 §5 E3) — it used to save and then never play.
const canBlend = computed(() => Object.values(caps.value).some((r) => r?.supports_voice_blending));
const kindOptions = computed(() => {
  const n = facetCounts(voices.value, voiceFilters.value, "kind", ["builtin", "clone", "design", "blend"],
    (v, k) => kindOf(v) === k);
  const d = directionFilter.value;
  return KINDS.map((k) => {
    const opt = k.disabled ? k : { ...k, label: `${k.label} (${n[k.value] ?? 0})` };
    if (k.value === "blend" && Object.keys(caps.value).length && !canBlend.value) {
      return { ...opt, disabled: true,
        title: "Blends need a speech runtime that can play them — update it on AI Settings → Speech engines when an update is offered." };
    }
    if (k.disabled || !d) return opt;
    const has = voices.value.some((v) => kindOf(v) === k.value && v.directed_by === d);
    if (has || (CAN_MAKE[k.value] || []).includes(d)) return opt;
    return { ...opt, disabled: true, title: OFF_REASON[k.value]?.[d] || "Nothing of this kind can be directed this way." };
  });
});
// A kind that can't be directed this way gives way to the first that can.
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
  { value: "", label: "All languages" },
  ...facetOptions(voices.value, voiceFilters.value, "language",
    (v) => baseLang(v.language), (c, n) => `${languageName(c) || c} (${n})`),
]);

// ── Making a voice, here (decided 2026-10-04: "the whole design should be
// part of the persona") — picking a kind that is made shows its maker at the
// top of the right column; only then. Keep saves the voice to Voices at once
// and this persona takes it.
const MAKERS = ["clone", "design", "blend"];
const maker = computed(() => (MAKERS.includes(kind.value) ? kind.value : null));
const makerKey = ref(0);   // a new key = a fresh, empty maker
// A kept voice is fixed (decided 2026-10-04); its words start a new design.
const designFrom = ref(null);
watch(kind, () => { modelFilter.value = ""; designFrom.value = null; makerKey.value += 1; });
function startFromThis() {
  designFrom.value = voice.value;
  makerKey.value += 1;
}
async function onKept(v) {
  designFrom.value = null;
  makerKey.value += 1;
  modelFilter.value = "";
  genderFilter.value = "";
  languageFilter.value = "";
  await voicesStore.reload();
  pickVoice(v.id);
}
// The persona as the makers' preview speaks it — the page's draft, unsaved.
const draftPayload = computed(() => (draft.value ? payload() : null));

// Every voice says what it can do, so the list reads without a filter set. The
// persona's own voice stays in the box even when the filters hide it (decided
// 2026-10-05) — the box read as empty while the voice was still chosen.
const listedVoices = computed(() => {
  const cur = voice.value;
  return cur && !shownVoices.value.some((v) => v.id === cur.id) ? [cur, ...shownVoices.value] : shownVoices.value;
});
const voiceOptions = computed(() => listedVoices.value.map((v) => ({
  value: v.id,
  label: [voiceLabel(v), kindOf(v) !== "builtin" ? voiceKindWord(v) : "", DIRECTION_WORD[v.directed_by] || "sliders only"]
    .filter(Boolean).join(" · "),
})));
const voiceSelectValue = computed(() => voice.value?.id || "");
const voiceEmptyHint = computed(() => {
  if (shownVoices.value.length) return "";
  if (voices.value.some((v) => kindOf(v) === kind.value)) {
    return voice.value ? "No other voice matches these filters." : "No voice of this kind matches these filters.";
  }
  return {
    builtin: "No built-in voices — install a speech model on AI Settings → Speech engines.",
    clone: "No cloned voices yet — make one on the right.",
    design: "No designed voices yet — make one on the right.",
    blend: "No blends yet — make one on the right.",
  }[kind.value] || "";
});

const voiceChange = ref(null); // {lines, directed, lost} — the warning after a change

function pickVoice(id) {
  const v = voices.value.find((x) => x.id === id);
  if (!v || !draft.value) return;
  const before = voice.value;
  draft.value.voice_id = id;
  // Speaks becomes the new voice's own language (decided 2026-10-05 — it used
  // to keep the old one whenever the model could speak it, so picking an
  // English voice left a persona speaking Chinese). Change it after if you want
  // another language the model speaks.
  const speaks = v.speaks || [];
  draft.value.language = speaks.length === 1 ? speaks[0] : (v.language || speaks[0] || "");
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
// ── Which version of the model speaks (decided 2026-10-05: "surface in
// persona") — size and precision stay per MODEL, not per persona (doc §6.2
// call 4): the version chosen here is the model's default, so every persona
// on that model speaks with it. A version already loaded keeps speaking until
// the chosen one is loaded — the server's own pick (`variant_for_model`).
const modelVersion = ref(null);   // GET /v1/voices/{id}/model-version
let versionSeq = 0;
async function loadModelVersion() {
  const v = voice.value;
  const seq = ++versionSeq;
  if (!v) {
    modelVersion.value = null;
    return;
  }
  const lang = effectiveLanguage.value ? `?language=${encodeURIComponent(effectiveLanguage.value)}` : "";
  const r = await api.safeRequest(`/v1/voices/${encodeURIComponent(v.id)}/model-version${lang}`, null);
  if (seq === versionSeq) modelVersion.value = r;
}
watch([() => voice.value?.id, () => effectiveLanguage.value], loadModelVersion, { immediate: true });
// A load or a default set anywhere else (Speech engines, Voices) shows here too.
const onHealth = () => { void loadModelVersion(); };
window.addEventListener("jv:health-refresh", onHealth);
onBeforeUnmount(() => window.removeEventListener("jv:health-refresh", onHealth));

// "Qwen3-TTS CustomVoice 1.7B (16-bit)" → "1.7B (16-bit)" — the model is already named.
function versionShort(id) {
  const mv = modelVersion.value;
  const row = mv?.versions.find((x) => x.id === id);
  if (!row) return id || "";
  const rest = row.name.startsWith(mv.model_name) ? row.name.slice(mv.model_name.length).trim() : "";
  return rest || row.name;
}
const chosenVersion = computed(() => modelVersion.value?.default || modelVersion.value?.speaks_with || "");
const versionOptions = computed(() => (modelVersion.value?.versions || []).map((x) => ({
  value: x.id,
  label: [versionShort(x.id), x.size_mb ? fmtBytes(x.size_mb * 1024 * 1024) : "", x.on_disk ? "" : "not downloaded"]
    .filter(Boolean).join(" · "),
})));
const versionBusy = ref(false);
async function chooseVersion(id) {
  const mv = modelVersion.value;
  if (!mv || !id || id === chosenVersion.value || versionBusy.value) return;
  versionBusy.value = true;
  try {
    await setDefaultVariant(api, mv.engine_id, id);
    pushToast({ kind: "success", duration: 6000,
      message: `${mv.model_name} ${versionShort(id)} — every persona on ${mv.model_name} speaks with it.` });
    await loadModelVersion();
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't change the version: ${e?.message || e}` });
  } finally {
    versionBusy.value = false;
  }
}
// The chosen version isn't the loaded one: the loaded one speaks until this loads.
const versionLoadTask = ref(null);
async function loadChosenVersion() {
  const mv = modelVersion.value;
  if (!mv || !chosenVersion.value) return;
  const task = makeEngineLoadTask(api, mv.engine_id, { model_variant: chosenVersion.value });
  versionLoadTask.value = task;
  await task.start();
  if (task.state === "done") {
    versionLoadTask.value = null;
    await loadModelVersion();
  }
}

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

// The chosen lexicon's words in the line typed in Hear it — the count
// Generate showed (moved here 2026-10-05, with Generate gone).
const lexiconEntries = ref([]);
watch(() => draft.value?.lexicon_id, async (id) => {
  lexiconEntries.value = [];
  if (!id) return;
  const lex = await api.safeRequest(`/v1/lexicons/${id}`, null);
  if (draft.value?.lexicon_id === id) lexiconEntries.value = lex?.entries || [];
}, { immediate: true });
const lexiconApplies = computed(() =>
  lexiconMatches(hearText.value, lexiconEntries.value).reduce((n, m) => n + m.count, 0));

// ── Hear it ─────────────────────────────────────────────────────────────
const hearText = ref("");
const hearBusy = ref(false);
const audio = ref(null);   // {url, blob, label}
function setAudio(blob, label) {
  if (audio.value?.url) URL.revokeObjectURL(audio.value.url);
  audio.value = { url: URL.createObjectURL(blob), blob, label };
}

// 🎲 Compose and ✏️ Rewrite, moved here from Generate (decided 2026-10-05).
// Both read the persona's SAVED note on how it sounds (the server's
// /v1/personas/{id}/compose and /rewrite), so they wait for a save.
const savedNote = computed(() => (saved.value?.note || "").trim());
const aiWhy = computed(() => {
  if (isNew.value || !saved.value) return "Save the persona first — Compose and Rewrite read its saved note";
  if (!savedNote.value) return "Write its note on how it sounds, and save, to use Compose and Rewrite";
  if ((draft.value?.note || "").trim() !== savedNote.value) return "Save first — Compose and Rewrite read the saved note";
  return "";
});
const composeBusy = ref(false);
const rewriteBusy = ref(false);
const rewritePreview = ref(null);   // { original, rewritten }
function aiFailed(what, e) {
  if (/abort/i.test(String(e?.message || ""))) return;
  pushToast({
    kind: "warning",
    duration: 6000,
    message: e?.status === 501 || e?.message?.includes("501")
      ? `${what} needs a language model — set one in AI Settings.`
      : `${what} failed: ${e?.message || e}`,
  });
}
async function composeLine() {
  if (aiWhy.value || composeBusy.value) return;
  composeBusy.value = true;
  try {
    const r = await runAiEndpoint({
      request: (path, o) => api.request(path, o),
      path: `/v1/personas/${saved.value.id}/compose`,
      task: { feature: "compose", label: `Compose · ${saved.value.name}`, meta: { personaId: saved.value.id },
        onRetry: () => composeLine() },
    });
    if (r?.text) hearText.value = r.text;
  } catch (e) {
    aiFailed("Compose", e);
  } finally {
    composeBusy.value = false;
  }
}
async function rewriteLine() {
  if (aiWhy.value || rewriteBusy.value) return;
  if (!hearText.value.trim()) {
    pushToast({ kind: "info", message: "Type a line to rewrite first." });
    return;
  }
  rewriteBusy.value = true;
  try {
    const r = await runAiEndpoint({
      request: (path, o) => api.request(path, o),
      path: `/v1/personas/${saved.value.id}/rewrite`,
      body: { text: hearText.value },
      task: { feature: "persona-rewrite", label: `Rewrite · ${saved.value.name}`, meta: { personaId: saved.value.id },
        onRetry: () => rewriteLine() },
    });
    if (r?.rewritten) rewritePreview.value = { original: r.original, rewritten: r.rewritten };
  } catch (e) {
    aiFailed("Rewrite", e);
  } finally {
    rewriteBusy.value = false;
  }
}
function acceptRewrite() {
  if (rewritePreview.value) hearText.value = rewritePreview.value.rewritten;
  rewritePreview.value = null;
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
      const back = castFor.value;
      if (back) {
        // Back to the book's Cast, with the new persona given to the speaker.
        if (back.speaker) await projectsService.updateSpeaker(back.speaker.id, { persona_id: p.id });
        await personasStore.reload();
        pushToast({
          kind: "success",
          message: back.speaker ? `${p.name} created and given to ${back.speaker.name}.` : `${p.name} created.`,
        });
        castFor.value = null;
        openProjectInStudio(activeProject, back.project, "cast");
        return;
      }
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
  draft.value = saved.value ? fromPersona(saved.value) : copyOf(opened.value || blank());
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
const effectNames = computed(() => (draft.value?.effects_chain || [])
  .map((e) => effectLabels.value[e.type] || e.type).filter(Boolean));
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
        <UiTag v-if="voice && speaksLabel" intent="secondary">{{ speaksLabel }}</UiTag>
        <UiTag v-if="usedBy.length" intent="secondary">used by <strong>{{ plural(usedBy.length, "speaker") }}</strong></UiTag>
        <UiTag v-if="dirty" intent="accent2">Unsaved changes</UiTag>
      </div>
      <div v-if="castFor" class="jv-banner">
        <template v-if="castFor.speaker">
          For <strong>{{ castFor.speaker.name }}</strong> in {{ castFor.project.name }} — Save gives
          {{ castFor.speaker.name }} this persona and takes you back to Cast.
        </template>
        <template v-else>Save takes you back to {{ castFor.project.name }}'s Cast.</template>
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

          <!-- Voice: what it can do → how it was made → filters → a voice that names its
               model, each part with its words (decided 2026-10-05, "A"). -->
          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">Voice</h3></div>
            <div class="jv-card__body jv-col">
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
                <UiField v-if="modelVersion?.versions.length" label="Version" layout="block">
                  <UiSelect :model-value="chosenVersion" :options="versionOptions" width="name"
                    :disabled="versionOptions.length < 2 || versionBusy"
                    :title="`The size and precision of ${modelVersion.model_name} — one for every persona on it`"
                    @update:model-value="chooseVersion" />
                </UiField>
              </div>
              <p class="jv-hint">The voice is what the persona keeps. Its model comes with it.</p>
              <p v-if="modelVersion?.versions.length" class="jv-hint"><strong>Version:</strong> Which size of the model speaks. It's set per
                model, so every persona on it uses the same one.</p>
              <p v-if="voiceEmptyHint" class="jv-hint">{{ voiceEmptyHint }}</p>
              <p v-else class="jv-hint">{{ shownVoices.length }} voice{{ shownVoices.length === 1 ? "" : "s" }} in the list.</p>
              <p v-if="modelVersion?.versions.length" class="jv-hint">
                Speaks with <strong>{{ modelVersion.model_name }} {{ versionShort(modelVersion.speaks_with || chosenVersion) }}</strong>
                <template v-if="modelVersion.loaded && modelVersion.loaded === chosenVersion"> · loaded</template>
                <template v-else-if="!modelVersion.loaded"> · not loaded — the first Listen loads it</template>.
                Also on <a href="#/ai">AI Settings → Speech engines</a>.
              </p>
              <div v-if="modelVersion?.loaded && modelVersion.loaded !== chosenVersion" class="jv-inline-row">
                <span class="jv-hint">{{ versionShort(modelVersion.loaded) }} is loaded and speaks until
                  {{ versionShort(chosenVersion) }} is.</span>
                <UiButton intent="secondary" size="small" :label="`Load ${versionShort(chosenVersion)}`"
                  :loading="versionLoadTask?.state === 'running'" @click="loadChosenVersion" />
              </div>
              <DownloadBar v-if="versionLoadTask?.state" :task="versionLoadTask"
                :title="`${modelVersion?.model_name || ''} ${versionShort(chosenVersion)}`" />
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
                <!-- A persona's gender is its voice's — no field of its own; it is
                     what Smart-assign matches against a speaker's pronouns
                     (decided 2026-10-05). -->
                <UiField label="Gender" layout="block">
                  <span class="persona-editor__fixed">{{ voiceGender(voice) === "?" ? "Not known" : voiceGenderWord(voice) }}
                    <span class="jv-hint">· from its voice · <a href="#/voices">change it on Voices ➜</a></span></span>
                </UiField>
              </div>
              <div v-if="voice && voiceGender(voice) === '?'" class="jv-banner jv-banner--warn">
                Its voice's gender isn't known, so <strong>Smart-assign can't match {{ draft.name || "this persona" }}</strong>
                to a speaker's pronouns. Set it on <a href="#/voices">Voices ➜</a> — click the voice's gender.
              </div>
              <div v-if="voiceChange" class="jv-banner jv-banner--warn">
                Changing this makes {{ draft.name || "this persona" }}'s <strong>{{ plural(voiceChange.lines, "line") }}</strong> stale.
                <template v-if="voiceChange.lost && voiceChange.directed">
                  <strong>{{ voiceChange.directed }} carry a written direction</strong> — {{ voiceChange.lost }} won't perform them.
                </template>
              </div>
              <p v-if="locked && !maker" class="jv-hint">Pick a voice first — everything below depends on its model.</p>
              <p v-else-if="locked" class="jv-hint">Pick a voice, or make one on the right — everything below depends on its model.</p>
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
                <UiField label="Lexicon" layout="block"
                  :hint="draft.lexicon_id ? `${lexiconApplies} word replacement${lexiconApplies === 1 ? '' : 's'} would apply to the line in Hear it` : ''">
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

          <!-- Hear it — the same path a chapter renders with; a maker's Preview speaks its line. -->
          <div class="jv-card" :class="{ 'persona-editor__locked': locked && !maker }" :aria-disabled="(locked && !maker) || undefined">
            <div class="jv-card__header"><h3 class="jv-card__title">Hear it</h3></div>
            <div class="jv-card__body jv-col">
              <UiTextarea ref="hearBox" v-model="hearText" :rows="2"
                placeholder="Type a line — or leave it empty to hear the stock line." />
              <SlashTagMenu :tag-sets="tagSets" :open="tagMenuOpen" :anchor="tagAnchor" query=""
                @insert="insertTag" @close="tagMenuOpen = false" />
              <div class="jv-inline-row">
                <UiButton intent="primary" label="▶ Listen" :loading="hearBusy" :disabled="locked" @click="listen" />
                <UiButton intent="secondary" label="↻ Stock line" :disabled="locked" @click="stockLine" />
                <UiButton intent="ghost" label="🏷️ Insert tag…" :disabled="locked || !tagSets.length"
                  :title="tagSets.length ? `${modelName}'s own tags` : `${modelName || 'This model'} takes no tags`"
                  @click="openTagMenu" />
                <UiButton intent="ghost" label="✏️ Rewrite" :loading="rewriteBusy" :disabled="!!aiWhy || rewriteBusy"
                  :title="aiWhy || 'Rewrite the line above in this persona\'s voice, from its note — you see it first'"
                  @click="rewriteLine" />
                <UiButton intent="ghost" label="🎲 Compose" :loading="composeBusy" :disabled="!!aiWhy || composeBusy"
                  :title="aiWhy || 'A fresh line in this persona\'s voice, from its note on how it sounds'"
                  @click="composeLine" />
                <span class="jv-spacer" />
                <UiButton intent="ghost" label="⤓ WAV" :disabled="!audio" @click="saveWav" />
              </div>
              <PageTaskStrips v-if="saved" :features="['compose', 'persona-rewrite']" :meta="{ personaId: saved.id }" />
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
          <!-- The maker for the kind picked on the left — on the right, beside
               the list it fills (the user, 2026-10-04: "you have sapce on the
               right why dont you put the new desing and dynamoic fields on the
               right"). -->
          <PersonaCloneMaker v-if="maker === 'clone'" :key="`clone-${makerKey}`" :rows="caps"
            :engines="enginesStore.items" :direction="directionFilter" :persona="draftPayload"
            :hear-text="hearText" @kept="onKept" />
          <PersonaDesignMaker v-else-if="maker === 'design'" :key="`design-${makerKey}`" :rows="caps"
            :engines="enginesStore.items" :direction="directionFilter" :persona="draftPayload"
            :hear-text="hearText" :note="draft.note" :start-from="designFrom" @kept="onKept" />
          <PersonaBlendMaker v-else-if="maker === 'blend'" :key="`blend-${makerKey}`" :voices="voices"
            :persona="draftPayload" :hear-text="hearText" @kept="onKept" />
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
                :label="usedBooks.length > 1 ? `Open ${b[1]} Cast →` : 'Open Cast →'" @click="openCast(b[0])" />
            </div>
          </div>
        </div>
      </div>
    </template>

    <AppModal v-if="rewritePreview" eyebrow="✏️ Rewrite" :title="`In ${saved?.name || 'this persona'}'s voice`"
      max-width="820px" dismissable @close="rewritePreview = null">
      <div class="persona-editor__rewrite">
        <div>
          <span class="jv-eyebrow">Original</span>
          <p>{{ rewritePreview.original }}</p>
        </div>
        <div>
          <span class="jv-eyebrow">Rewritten</span>
          <p><strong>{{ rewritePreview.rewritten }}</strong></p>
        </div>
      </div>
      <template #footer>
        <UiButton intent="secondary" label="Keep the original" @click="rewritePreview = null" />
        <UiButton intent="primary" label="Use the rewrite" @click="acceptRewrite" />
      </template>
    </AppModal>
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

.persona-editor__rewrite { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.persona-editor__rewrite p { margin: 4px 0 0; max-width: 60ch; }
.persona-editor__summary { margin: 0 0 6px; font-weight: 600; }
.persona-editor__tags { gap: 6px; }
/* A blank persona: only the Voice card is live until a voice is picked —
   everything below depends on its model (plan §6.2, improvement 4). */
.persona-editor__locked { opacity: 0.5; pointer-events: none; }
</style>
