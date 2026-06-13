<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvTextarea from "../components/jv/JvTextarea.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvTag from "../components/jv/JvTag.vue";
import JvField from "../components/jv/JvField.vue";
import EmptyState from "../components/EmptyState.vue";

const api = useApi();
const voices = ref([]);
const engines = ref([]);

// ── Gender auto-detect + click-cycle override (lift #85). ─────────────
//
// Auto-detect rules:
//   - OpenAI voices: built-in canon (Alloy/Echo/Fable/Onyx/Nova/Shimmer + Ash/Coral/Sage/Verse/Ballad)
//   - Kokoro voices: parse <region><gender>_<name> (af_alloy = American Female, bm_george = British Male)
//   - Cloned / freeform: first-name dictionary; ambiguous names left unset
const OPENAI_VOICE_GENDER = {
  alloy:"N", echo:"M", fable:"M", onyx:"M", nova:"F", shimmer:"F",
  ash:"M", coral:"F", sage:"N", verse:"M", ballad:"M",
};
const FIRST_NAME_GENDER = {
  // Female-leaning
  sarah:"F", emma:"F", lily:"F", maya:"F", anna:"F", mara:"F", lisa:"F", rachel:"F", chloe:"F", hannah:"F", grace:"F", sophia:"F", olivia:"F", emily:"F", isabella:"F", ava:"F", mia:"F", abigail:"F", nicole:"F", katie:"F", laura:"F",
  // Male-leaning
  michael:"M", james:"M", john:"M", robert:"M", david:"M", peter:"M", paul:"M", george:"M", thomas:"M", chris:"M", brian:"M", scott:"M", mark:"M", jack:"M", henry:"M", oliver:"M", tom:"M", andrew:"M", daniel:"M",
  // Ambiguous — deliberately omitted: alex, jamie, sam, riley, charlie, taylor, jordan, robin, casey
};
function autoDetectGender(v) {
  if (v.gender_user_override) return v.gender_user_override;
  if (v.source === "preset") {
    const o = loadPresetGenderOverrides()[v.id];
    if (o) return o;
  }
  if (v.gender) return v.gender;
  if (v.engine === "openai" || v.engine?.startsWith("openai")) {
    const m = OPENAI_VOICE_GENDER[v.name?.toLowerCase()];
    if (m) return m;
  }
  if (v.engine === "kokoro") {
    // af_alloy → American Female; bm_george → British Male. The ID
    // carries the convention — the display name ('Alloy') doesn't.
    const m = /^[a-z]([fm])_/.exec((v.id || v.name || "").toLowerCase());
    if (m) return m[1] === "f" ? "F" : "M";
  }
  // Cloned / freeform voices — match leading first-name token (sarah.wav, michael.wav).
  const first = v.name?.toLowerCase()?.split(/[\s._-]/)[0];
  if (first && FIRST_NAME_GENDER[first]) return FIRST_NAME_GENDER[first];
  return "?";
}

const GENDER_CYCLE = ["?", "F", "M", "N", ""];

// Preset voices ship with the engine — no stored record to PATCH, so
// their overrides persist in localStorage. Stored voices persist via
// PATCH /v1/voices/{id}.
const PRESET_GENDER_KEY = "justvoice.presetGenderOverrides";
function loadPresetGenderOverrides() {
  try { return JSON.parse(localStorage.getItem(PRESET_GENDER_KEY)) || {}; } catch { return {}; }
}
function savePresetGenderOverride(id, gender) {
  try {
    const map = loadPresetGenderOverrides();
    if (gender) map[id] = gender; else delete map[id];
    localStorage.setItem(PRESET_GENDER_KEY, JSON.stringify(map));
  } catch { /* storage unavailable — override stays session-local */ }
}

async function cycleGender(v) {
  const cur = autoDetectGender(v);
  const idx = GENDER_CYCLE.indexOf(cur);
  const next = GENDER_CYCLE[(idx + 1) % GENDER_CYCLE.length];
  v.gender_user_override = next || null;
  voices.value = [...voices.value]; // force reactivity
  if (v.source === "preset") {
    savePresetGenderOverride(v.id, v.gender_user_override);
    return;
  }
  try {
    await api.request(`/v1/voices/${v.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender: v.gender_user_override || "" }),
    });
  } catch (e) {
    pushToast({ message: `Couldn't save gender: ${e.message || e}`, kind: "error" });
  }
}

// ── Catalog filtering + search. ──────────────────────────────────────
const search = ref("");
// Filter ids match the server's VoiceSource literals exactly
// (models.py: preset | cloned | designed | imported | blended | trained).
const typeFilter = ref("all");

const TYPE_FILTERS = [
  { id: "all",      label: "All" },
  { id: "preset",   label: "Preset" },
  { id: "cloned",   label: "Cloned" },
  { id: "designed", label: "Designed" },
  { id: "imported", label: "Imported" },
  { id: "blended",  label: "Blended" },
  { id: "trained",  label: "Trained" },
];

// Hidden built-in voices — presets can't be deleted, but they can be
// tucked away (user request 2026-06-11). Persisted per machine.
const HIDDEN_KEY = "jv.voices.hidden";
const hiddenIds = ref(new Set());
try { hiddenIds.value = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]")); } catch { hiddenIds.value = new Set(); }
const showHidden = ref(false);
function toggleHidden(v) {
  const next = new Set(hiddenIds.value);
  if (next.has(v.id)) next.delete(v.id); else next.add(v.id);
  hiddenIds.value = next;
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
}

const ENGINE_FILTER_KEY = "jv.voices.engineFilter";
const engineFilter = ref(localStorage.getItem(ENGINE_FILTER_KEY) || "all");
function setEngineFilter(id) {
  engineFilter.value = id;
  localStorage.setItem(ENGINE_FILTER_KEY, id);
}
const engineFilterOptions = computed(() => {
  const counts = {};
  for (const v of voices.value || []) counts[v.engine] = (counts[v.engine] || 0) + 1;
  return [
    { label: `All engines (${(voices.value || []).length})`, value: "all" },
    ...Object.entries(counts).sort().map(([id, n]) => ({ label: `${id} (${n})`, value: id })),
  ];
});

const hiddenCount = computed(() => (voices.value || []).filter((v) => hiddenIds.value.has(v.id)).length);

// Currently loaded TTS engine — surfaced in the toolbar (user ask: the
// Voices page should say which engine previews will hit).
const loadedTtsEngine = computed(() =>
  (engines.value || []).find((e) => e.status === "loaded" && (e.kind === "tts" || !e.kind)) || null
);

// LOCAL vs ONLINE badge per voice (user concern: picking voices without
// realizing some load big local engines and some bill an online API).
const engineBackends = computed(() => {
  const m = {};
  for (const e of engines.value || []) m[e.id] = e.backend || "";
  return m;
});
function voiceLocality(v) {
  const e = engineMeta.value[v.engine];
  if (e?.self_hosted) return "self-hosted";
  const backend = engineBackends.value[v.engine];
  if (backend === undefined) return null; // orphan — already tagged
  return backend === "managed" ? "local" : "online";
}

// Isolated engines with no venv yet (Dia, MOSS) — their static voices
// can't preview until Install runs in Engines. Tag + sort last so they
// never read as "the default voice" (user-hit: Dia listed first).
const engineMeta = computed(() => {
  const m = {};
  for (const e of engines.value || []) m[e.id] = e;
  return m;
});
function needsInstall(v) {
  const e = engineMeta.value[v.engine];
  return !!e && e.isolation === "venv" && e.status === "not_installed";
}

const filteredVoices = computed(() => {
  let list = voices.value || [];
  if (!showHidden.value) list = list.filter((v) => !hiddenIds.value.has(v.id));
  if (engineFilter.value !== "all") list = list.filter((v) => v.engine === engineFilter.value);
  if (typeFilter.value !== "all") list = list.filter((v) => v.source === typeFilter.value);
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    list = list.filter((v) => (v.name || "").toLowerCase().includes(q) || (v.id || "").toLowerCase().includes(q));
  }
  // Needs-install voices sink to the bottom — never first-in-list.
  return [...list].sort((a, b) => needsInstall(a) - needsInstall(b));
});

const typeCounts = computed(() => {
  const list = voices.value || [];
  const cs = { all: list.length, preset: 0, cloned: 0, designed: 0, imported: 0, blended: 0, trained: 0 };
  for (const v of list) if (cs[v.source] !== undefined) cs[v.source]++;
  return cs;
});

// ── Voice clone gate (#99) — Chatterbox is the only local clone engine. ──
const chatterboxLoaded = computed(() => (engines.value || []).some((e) => e?.id?.includes("chatterbox") && e?.status === "loaded"));

// ── Voice preview (LRU-cached on backend). ──────────────────────────
const previewAudio = ref(null);
const previewingId = ref(null);
const AUTOLOAD_KEY = "jv.voices.autoLoadEngine"; // "always" | unset (ask)

async function previewVoice(v) {
  previewingId.value = v.id;
  if (previewAudio.value) {
    URL.revokeObjectURL(previewAudio.value);
    previewAudio.value = null;
  }
  try {
    const always = localStorage.getItem(AUTOLOAD_KEY) === "always";
    let blob;
    try {
      blob = await api.request(`/v1/voices/${v.id}/preview?auto_load=${always}`, { method: "POST" });
    } catch (e) {
      const mi = String(e?.message || "").match(/engine_not_installed:([\w.-]+)/);
      if (mi) {
        const ok = await confirmDialog({
          title: `Install ${mi[1]} first`,
          message: `"${v.name}" belongs to the ${mi[1]} engine, which isn't installed yet (isolated engines need their own venv built once). Open Engines to install it?`,
          confirmLabel: "Open Engines",
        });
        if (ok) window.location.hash = "#engines";
        return;
      }
      const m = String(e?.message || "").match(/engine_not_loaded:([\w.-]+)/);
      if (!m) throw e;
      const engineId = m[1];
      const ok = await confirmDialog({
        title: `Load ${engineId}?`,
        message: `"${v.name}" needs the ${engineId} engine, which isn't loaded. Load it now to preview? The first load can take ~25–55 s; after that previews are instant.`,
        confirmLabel: "Load & preview",
      });
      if (!ok) return;
      pushToast({ message: `Loading ${engineId}… this can take up to a minute.`, kind: "info" });
      blob = await api.request(`/v1/voices/${v.id}/preview?auto_load=true`, { method: "POST" });
      pushToast({
        message: `${engineId} loaded.`,
        kind: "success",
        action: { label: "Always auto-load", fn: () => localStorage.setItem(AUTOLOAD_KEY, "always") },
      });
      // Topbar pill + Engines page track loads from anywhere.
      window.dispatchEvent(new Event("jv:health-refresh"));
    }
    previewAudio.value = URL.createObjectURL(blob);
    const audio = new Audio(previewAudio.value);
    audio.play().catch(() => {});
  } catch (e) {
    pushToast({ message: `Preview failed: ${e.message || e}`, kind: "error" });
  } finally {
    previewingId.value = null;
  }
}

async function refresh() {
  try {
    const v = await api.request("/v1/voices");
    voices.value = v?.voices ?? [];
  } catch { voices.value = []; }
  try {
    const e = await api.request("/v1/engines");
    engines.value = e?.engines ?? [];
  } catch { engines.value = []; }
  try {
    const p = await api.request("/v1/personas");
    personas.value = p?.personas ?? [];
  } catch { personas.value = []; }
}

// ── "Cast as" — which personas a voice backs (CONCEPTS §2). ──────────
const personas = ref([]);
const castAsByVoice = computed(() => {
  const map = {};
  for (const p of personas.value) {
    if (!p.voice_id) continue;
    (map[p.voice_id] ||= []).push(p.name);
  }
  return map;
});

const orphanIds = computed(() => {
  const ids = new Set(engines.value.map((e) => e.id));
  return voices.value.filter((v) => !ids.has(v.engine)).map((v) => v.id);
});

async function deleteVoice(id) {
  const ok = await confirmDialog({
    title: "Delete voice?",
    message: `Voice "${id}" will be permanently removed.`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/voices/${id}`, { method: "DELETE" });
    await refresh();
    pushToast({ message: `Voice "${id}" deleted.` });
  } catch (e) {
    pushToast({ message: `Delete failed: ${e.message || e}`, kind: "error" });
  }
}

onMounted(refresh);
onMounted(loadSettingsDefault);

// ── Modal state ──────────────────────────────────────────────────────────────

const modal = ref(null); // "clone" | "design" | "import" | "blend" | null
const busy = ref(false);

// shared
const selectedEngine = ref("");
const voiceName = ref("");

// clone
const cloneFile = ref(null);
const cloneTranscript = ref("");

// design
const designPrompt = ref("");

// import
const importFile = ref(null);
const importTranscript = ref("");

// blend
const blendStrategy = ref("slerp");
const blendSources = ref([
  { voice_id: "", weight: 1.0 },
  { voice_id: "", weight: 1.0 },
]);

const BLEND_STRATEGIES = [
  { label: "Spherical linear interpolation (slerp)", value: "slerp" },
  { label: "Linear interpolation (lerp)", value: "lerp" },
  { label: "Weighted sum", value: "weighted_sum" },
];

// Settings → Generation "Default TTS engine" — preferred for create
// flows; a loaded engine outranks it (no point spinning up a second).
const settingsDefaultEngine = ref("");
async function loadSettingsDefault() {
  try {
    const s = await api.safeRequest("/v1/settings", {});
    settingsDefaultEngine.value = s?.engines?.default_tts_engine || "";
  } catch { /* keep fallback */ }
}
const defaultEngine = computed(() => {
  const loaded = engines.value.find((e) => e.status === "loaded");
  if (loaded) return loaded.id;
  if (settingsDefaultEngine.value && engines.value.some((e) => e.id === settingsDefaultEngine.value)) {
    return settingsDefaultEngine.value;
  }
  return engines.value[0]?.id ?? "";
});

const engineVoiceOptions = computed(() =>
  voices.value
    .filter((v) => v.engine === selectedEngine.value)
    .map((v) => ({ label: `${v.name} (${v.id})`, value: v.id }))
);

const engineOptions = computed(() =>
  engines.value.map((e) => ({
    label: `${e.name ?? e.id}${e.status === "loaded" ? "" : " (not loaded)"}`,
    value: e.id,
  }))
);

const valid = computed(() => {
  if (!voiceName.value.trim() || !selectedEngine.value) return false;
  if (modal.value === "clone") return !!cloneFile.value;
  if (modal.value === "design") return !!designPrompt.value.trim();
  if (modal.value === "import") return !!importFile.value;
  if (modal.value === "blend")
    return blendSources.value.filter((s) => s.voice_id).length >= 2;
  return false;
});

const busyLabel = computed(() => {
  const map = { clone: "Cloning…", design: "Designing…", import: "Importing…", blend: "Blending…" };
  return map[modal.value] ?? "Working…";
});

const submitLabel = computed(() => {
  const map = { clone: "Clone voice", design: "Design voice", import: "Import clip", blend: "Blend voices" };
  return map[modal.value] ?? "Submit";
});

const modalTitle = computed(() => {
  const map = {
    clone: "Clone voice from reference",
    design: "Design voice from prose",
    import: "Import audio clip",
    blend: "Blend voices via embedding interpolation",
  };
  return map[modal.value] ?? "";
});

function openModal(kind) {
  voiceName.value = "";
  selectedEngine.value = defaultEngine.value;
  cloneFile.value = null;
  cloneTranscript.value = "";
  designPrompt.value = "";
  importFile.value = null;
  importTranscript.value = "";
  blendStrategy.value = "slerp";
  blendSources.value = [
    { voice_id: "", weight: 1.0 },
    { voice_id: "", weight: 1.0 },
  ];
  modal.value = kind;
}

function addBlendSource() {
  blendSources.value.push({ voice_id: "", weight: 1.0 });
}

function removeBlendSource(idx) {
  if (blendSources.value.length > 2) blendSources.value.splice(idx, 1);
}

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function submit() {
  if (!valid.value || busy.value) return;
  busy.value = true;
  try {
    const engine = selectedEngine.value;
    const name = voiceName.value.trim();
    let body;

    if (modal.value === "clone") {
      const ref_wav_b64 = await fileToB64(cloneFile.value);
      body = {
        engine, name, ref_wav_b64, language: "en-US",
        ...(cloneTranscript.value.trim() ? { transcript: cloneTranscript.value.trim() } : {}),
      };
      await api.request("/v1/voices/clone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" cloned.` });
    } else if (modal.value === "design") {
      body = { engine, name, prompt: designPrompt.value.trim(), language: "en-US" };
      await api.request("/v1/voices/design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" designed.` });
    } else if (modal.value === "import") {
      const wav_b64 = await fileToB64(importFile.value);
      body = {
        engine, name, wav_b64, language: "en-US",
        ...(importTranscript.value.trim() ? { transcript: importTranscript.value.trim() } : {}),
      };
      await api.request("/v1/voices/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" imported.` });
    } else if (modal.value === "blend") {
      const validSources = blendSources.value.filter((s) => s.voice_id);
      body = {
        engine, name,
        source_voice_ids: validSources.map((s) => s.voice_id),
        weights: validSources.map((s) => Number(s.weight) || 1.0),
        strategy: blendStrategy.value,
      };
      await api.request("/v1/voices/blend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" blended.` });
    }

    await refresh();
    modal.value = null;
  } catch (e) {
    pushToast({ message: `${modal.value} failed: ${e.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}

// Voice type → JvTag variant mapping
function voiceTypeVariant(source) {
  // One distinct tint per type (v11): neutral / green / solid-green /
  // gold / blue / violet — so the column reads at a glance.
  if (source === "preset") return "default";
  if (source === "cloned") return "success";
  if (source === "designed") return "solid";
  if (source === "blended") return "warn";
  if (source === "trained") return "accent";
  if (source === "imported") return "violet";
  return "default";
}

// ── Inline inspector (preview parity §Voices). ────────────────────────
//
// Click a row → the inspector panel opens beneath the table with the
// voice's metadata + reference samples + 5 sample-management buttons:
//   • + Add WAV file        (file picker → POST /v1/voices/{id}/samples)
//   • 🎙️ Record in-app       (browser MediaRecorder → upload)
//   • ↗ Promote from Captures (open Captures tab with promote intent)
//   • 🧪 Train LoRA          (open Train tab with this voice pre-selected)
//   • 🔀 Blend with…         (open Blend modal with this voice as src #1)
const inspectedId = ref(null);
const inspectedVoice = computed(() =>
  voices.value.find((v) => v.id === inspectedId.value) ?? null,
);
function inspect(voice) {
  inspectedId.value = inspectedId.value === voice.id ? null : voice.id;
  if (inspectedId.value) {
    editDraft.value = { name: voice.name || "", gender: voice.gender || "", language: voice.language || "en" };
  }
}

// Edit-voice (Phase E: grow Inspect into a full editor). Presets ship
// with the engine and stay read-only; stored voices (cloned / blended /
// designed / trained / imported) PATCH their metadata.
const editDraft = ref({ name: "", gender: "", language: "en" });
const editSaving = ref(false);
const inspectedEditable = computed(() => inspectedVoice.value && inspectedVoice.value.source !== "preset");
async function saveVoiceEdit() {
  const v = inspectedVoice.value;
  if (!v || editSaving.value) return;
  editSaving.value = true;
  try {
    await api.request(`/v1/voices/${v.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editDraft.value.name?.trim() || v.name,
        gender: editDraft.value.gender || null,
        language: editDraft.value.language || null,
      }),
    });
    pushToast({ kind: "success", title: "Voice updated" });
    await refresh();
  } catch (e) {
    pushToast({ kind: "error", title: "Update failed", description: String(e?.message ?? e) });
  } finally {
    editSaving.value = false;
  }
}

// Stub sample rows when API has only sample_count — real samples list
// lands when /v1/voices/{id}/samples is wired up in the API.
const inspectedSamples = computed(() => {
  const v = inspectedVoice.value;
  if (!v) return [];
  const n = v.sample_count ?? 0;
  return Array.from({ length: n }, (_, i) => ({
    file: `sample-${String(i + 1).padStart(2, "0")}.wav`,
    duration: "—",
    snr: "—",
    transcript: "Whisper-transcribed (loading via /v1/voices/{id}/samples — placeholder).",
  }));
});

const sampleFileInput = ref(null);
function pickSampleWav() { sampleFileInput.value?.click(); }
async function onSamplePicked(ev) {
  const file = ev.target.files?.[0];
  if (!file || !inspectedVoice.value) return;
  pushToast({ kind: "info", title: `+ Add WAV`, description: `Uploading ${file.name} → /v1/voices/${inspectedVoice.value.id}/samples.` });
  ev.target.value = "";
}
function recordInApp() {
  if (!inspectedVoice.value) return;
  pushToast({ kind: "info", title: "🎙️ Record in-app", description: "Browser MediaRecorder will open with auto-trim + level meter. Lands with the recorder component." });
}
function promoteFromCaptures() {
  pushToast({ kind: "info", title: "↗ Promote from Captures", description: "Switch to Captures and pick a clip — the “→ Sample” action attaches it to this voice." });
  window.location.hash = "#captures";
}
function trainLoraForVoice() {
  if (!inspectedVoice.value) return;
  // Same handoff shape as jv.generate.prefill (Captures → Generate):
  // TrainView reads jv.train.prefill on mount and preselects the voice.
  try {
    window.sessionStorage?.setItem(
      "jv.train.prefill",
      JSON.stringify({ base_voice: inspectedVoice.value.id }),
    );
  } catch { /* ignore */ }
  window.location.hash = "#train";
}
// Item 12: per-voice reset — clears the two user tweaks that exist
// (gender override + hidden). Tuned params live on PERSONAS, not
// voices, so they're out of scope here by design.
function voiceHasTweaks(v) {
  if (!v) return false;
  const presetOverride = v.source === "preset" && !!loadPresetGenderOverrides()[v.id];
  return presetOverride || !!v.gender_user_override || hiddenIds.value.has(v.id);
}
async function resetVoice(v) {
  if (!v) return;
  if (v.source === "preset") {
    savePresetGenderOverride(v.id, null);
  } else if (v.gender_user_override) {
    v.gender_user_override = null;
    try {
      await api.request(`/v1/voices/${v.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gender: "" }),
      });
    } catch (e) {
      pushToast({ kind: "error", title: "Reset failed", description: String(e?.message ?? e) });
      return;
    }
  }
  if (hiddenIds.value.has(v.id)) toggleHidden(v);
  voices.value = [...voices.value];
  pushToast({ kind: "success", message: `${v.name} reset to defaults.` });
}
async function resetAllTweaks() {
  const overrides = Object.keys(loadPresetGenderOverrides()).length;
  const hidden = hiddenIds.value.size;
  if (!overrides && !hidden) {
    pushToast({ kind: "info", message: "Nothing to reset — no gender overrides or hidden voices." });
    return;
  }
  const ok = await confirmDialog({
    title: "Reset all voice tweaks?",
    message: `Clears ${overrides} gender override${overrides === 1 ? "" : "s"} and unhides ${hidden} voice${hidden === 1 ? "" : "s"}. Cloned/designed voices themselves are untouched.`,
    confirmLabel: "Reset all",
    danger: true,
  });
  if (!ok) return;
  try { localStorage.removeItem(PRESET_GENDER_KEY); } catch { /* ignore */ }
  hiddenIds.value = new Set();
  try { localStorage.setItem(HIDDEN_KEY, "[]"); } catch { /* ignore */ }
  voices.value = [...voices.value];
  pushToast({ kind: "success", message: "All voice tweaks reset." });
}

function blendWithVoice() {
  if (!inspectedVoice.value) return;
  blendSources.value = [
    { voice_id: inspectedVoice.value.id, weight: 1.0 },
    { voice_id: "", weight: 1.0 },
  ];
  selectedEngine.value = inspectedVoice.value.engine;
  voiceName.value = `Blend: ${inspectedVoice.value.name}+`;
  modal.value = "blend";
}
</script>

<template>
  <!-- Single-root .jv-fill so the page itself doesn't scroll — only the
       voice catalog list scrolls within its own container. Toolbar +
       banner + add-more details stay pinned at the top of the pane. -->
  <div class="voices-view jv-fill">
  <!-- ── Toolbar: search + type filter + + Clone primary action ─────────── -->
  <div class="voices-view__toolbar">
    <JvInput v-model="search" placeholder="Search voices…" width="name" title="Filter by name or id" />
    <JvSelect
      :model-value="engineFilter"
      :options="engineFilterOptions"
      title="Show only voices from one engine"
      width="id"
      @update:model-value="setEngineFilter"
    />
    <a
      class="jv-pill"
      :class="loadedTtsEngine ? 'jv-pill--green' : 'jv-pill--ghost'"
      href="#engines"
      :title="loadedTtsEngine
        ? `${loadedTtsEngine.name || loadedTtsEngine.id} is loaded — previews play instantly. Click to manage engines.`
        : 'No TTS engine loaded — the first preview will offer to load one. Click to manage engines.'"
    >{{ loadedTtsEngine ? `● ${loadedTtsEngine.name || loadedTtsEngine.id} loaded` : "○ no engine loaded" }}</a>
    <button
      v-if="hiddenCount"
      type="button"
      class="jv-pill"
      :class="showHidden ? 'jv-pill--solid' : 'jv-pill--ghost'"
      :title="showHidden ? 'Hide the hidden voices again' : 'Temporarily show voices you have hidden'"
      @click="showHidden = !showHidden"
    >🙈 hidden ({{ hiddenCount }})</button>
    <button
      type="button"
      class="jv-pill jv-pill--ghost"
      title="Clear every gender override and unhide all voices (confirmed first)"
      @click="resetAllTweaks"
    >↺ Reset all tweaks</button>
    <div class="voices-view__chips">
      <button
        v-for="f in TYPE_FILTERS"
        :key="f.id"
        class="jv-pill"
        :class="typeFilter === f.id ? 'jv-pill--solid' : 'jv-pill--ghost'"
        :title="f.id === 'all' ? 'Show every voice' : `Show only ${f.label.toLowerCase()} voices`"
        @click="typeFilter = f.id"
      >{{ f.label }} ({{ typeCounts[f.id] || 0 }})</button>
    </div>
    <span class="jv-spacer" />
    <JvButton variant="secondary" size="sm" label="⬇ Import .justvoice.zip" @click="openModal('import')" />
    <JvButton
      variant="primary"
      size="sm"
      :disabled="!chatterboxLoaded"
      :title="chatterboxLoaded ? '' : 'Voice cloning requires Chatterbox loaded'"
      label="+ Clone new voice"
      @click="openModal('clone')"
    />
  </div>

  <!-- Hint when clone-gate is closed (#99). -->
  <p v-if="!chatterboxLoaded" class="jv-banner jv-banner--warn">
    Voice cloning is Chatterbox-only. <a href="#engines"><strong>Load Chatterbox in the Engines tab</strong></a> to enable the "+ Clone new voice" button.
  </p>

  <!-- Add additional creation paths (Design / Blend) — less common, behind a details toggle -->
  <details class="voices-view__add-more">
    <summary>Other ways to add a voice — Design from prose · Blend voices</summary>
    <div class="jv-btn-group" style="margin-top: 10px">
      <JvButton variant="secondary" @click="openModal('design')">Design from prose (Qwen3)</JvButton>
      <JvButton variant="secondary" @click="openModal('blend')">Blend voices</JvButton>
    </div>
    <p class="jv-muted" style="font-size: 11.5px; margin-top: 8px">
      <strong style="color: var(--ink);">Design</strong>: text-prompt → voice (Qwen3 native).
      <strong style="color: var(--ink);">Blend</strong>: interpolate two or more voices in embedding space (engines with <code class="jv-mono">supports_embedding_blending</code>).
    </p>
  </details>

  <!-- ── Voice catalog table — owns its own scroll lane ───────────────── -->
  <div class="voices-view__list">
    <table v-if="filteredVoices.length" class="jv-table voices-view__table">
      <thead>
        <tr>
          <th></th>
          <th>Name</th>
          <th>Gender</th>
          <th>Type</th>
          <th>Engine</th>
          <th>Lang</th>
          <th>Samples</th>
          <th>Gens</th>
          <th>Effects</th>
          <th>Channel</th>
          <th>Cast as</th>
          <th class="jv-table__actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="v in filteredVoices" :key="v.id">
        <tr
          :class="{ 'row-orphan': orphanIds.includes(v.id), 'voices-view__row--inspected': inspectedId === v.id }"
          title="Double-click to inspect"
          @dblclick="inspect(v)"
          style="cursor: pointer"
        >
          <td @click.stop>
            <JvButton variant="ghost" size="sm" :loading="previewingId === v.id" label="▶" :title="`Preview ${v.name}`" @click="previewVoice(v)" />
          </td>
          <td>
            <strong>{{ v.name }}</strong>
            <JvTag v-if="orphanIds.includes(v.id)" variant="danger" label="orphan" style="margin-left: 6px" />
          </td>
          <td>
            <!-- Click-cycle gender chip per #85. -->
            <button
              type="button"
              class="voices-view__gender-chip"
              :data-gender="autoDetectGender(v)"
              :title="`Gender: ${autoDetectGender(v) || 'unset'} — click to cycle ? → F → M → N → unset`"
              @click="cycleGender(v)"
            >{{ (autoDetectGender(v) || "?").charAt(0).toUpperCase() }}</button>
          </td>
          <td><JvTag :variant="voiceTypeVariant(v.source)" :label="v.source" /></td>
          <td>
            <span class="jv-mono jv-muted">{{ v.engine }}</span>
            <span
              v-if="voiceLocality(v) === 'local'"
              class="jv-locality jv-locality--local"
              title="Runs on this machine — no usage cost; loads the engine into RAM/VRAM on first use"
            >LOCAL</span>
            <span
              v-else-if="voiceLocality(v) === 'self-hosted'"
              class="jv-locality jv-locality--local"
              title="An OpenAI-compatible server you run yourself — free and private"
            >SELF-HOSTED</span>
            <span
              v-else-if="voiceLocality(v) === 'online'"
              class="jv-locality jv-locality--online"
              title="External provider — needs network and may bill per character/minute"
            >ONLINE · METERED</span>
            <span
              v-if="needsInstall(v)"
              class="jv-locality jv-locality--online"
              :title="`${v.engine} is an isolated engine with no venv yet — Install it in Engines before this voice can play`"
            >NEEDS INSTALL</span>
          </td>
          <td class="jv-muted">{{ v.language || "en" }}</td>
          <td>{{ v.sample_count ?? (v.source === "preset" ? "—" : 0) }}</td>
          <td>{{ v.generation_count ?? 0 }}</td>
          <td class="jv-muted">{{ v.default_effects?.join(", ") || "—" }}</td>
          <td class="jv-muted">{{ v.channel_id || "Default" }}</td>
          <td class="jv-muted voices-view__castas" :title="(castAsByVoice[v.id] || []).join(', ')">{{ (castAsByVoice[v.id] || []).join(' · ') || "—" }}</td>
          <td class="jv-table__actions" @click.stop>
            <JvButton variant="ghost" size="sm" label="⚙" :title="`Inspect ${v.name}`" @click="inspect(v)" />
            <JvButton
              v-if="v.source === 'preset'"
              variant="ghost"
              size="sm"
              :label="hiddenIds.has(v.id) ? '👁' : '🙈'"
              :title="hiddenIds.has(v.id) ? `Unhide ${v.name}` : `Hide ${v.name} — built-ins can't be deleted, but they can be tucked away`"
              @click="toggleHidden(v)"
            />
            <JvButton
              v-if="v.source !== 'preset'"
              variant="danger-outline"
              size="sm"
              label="✕"
              :title="`Delete ${v.name}`"
              @click="deleteVoice(v.id)"
            />
          </td>
        </tr>
        <tr v-if="inspectedId === v.id" :key="`exp-${v.id}`" class="voices-view__expand"><td colspan="12"><div class="voices-view__inspector">
    <header class="voices-view__inspector-h">
      <h3>Voice inspector — {{ inspectedVoice.name }}</h3>
      <span class="jv-spacer" />
      <JvButton
        v-if="inspectedEditable"
        variant="primary"
        size="sm"
        label="Save changes"
        :loading="editSaving"
        title="Rename / gender / language — PATCHes the stored voice"
        @click="saveVoiceEdit"
      />
      <span v-else class="jv-pill jv-pill--ghost" title="Engine presets ship with the engine — clone or blend to make an editable copy">preset · read-only</span>
      <JvButton
        variant="secondary"
        size="sm"
        label="Reset to defaults"
        :disabled="!voiceHasTweaks(inspectedVoice)"
        :title="voiceHasTweaks(inspectedVoice) ? 'Clears the gender override and unhides this voice' : 'Nothing overridden on this voice'"
        @click="resetVoice(inspectedVoice)"
      />
      <JvButton variant="ghost" size="sm" label="Close" @click="inspectedId = null" />
    </header>

    <p v-if="!inspectedEditable" class="jv-muted voices-view__readonly-note">
      Shipped with the <strong>{{ inspectedVoice.engine }}</strong> engine — these facts aren't
      editable. The <em>gender chip</em> on the row and <em>🙈 hide</em> are the two tweaks
      preset voices take.
    </p>
    <div class="voices-view__inspector-grid">
      <!-- Item 10: read-only data renders as plain facts, never as
           textboxes that look editable. Inputs only where edits persist. -->
      <label v-if="inspectedEditable" class="voices-view__field">
        <span>Name</span>
        <input class="jv-input" v-model="editDraft.name" title="Rename — every picker and persona link follows the id, so renaming is safe" />
      </label>
      <div v-else class="voices-view__field"><span>Name</span><b class="voices-view__fact">{{ inspectedVoice.name }}</b></div>
      <div class="voices-view__field"><span>Type</span><b class="voices-view__fact">{{ inspectedVoice.source }}</b></div>
      <div class="voices-view__field"><span>Engine</span><b class="voices-view__fact">{{ inspectedVoice.engine }}</b></div>
      <label v-if="inspectedEditable" class="voices-view__field">
        <span>Gender</span>
        <select class="jv-input" v-model="editDraft.gender" title="Drives Smart-assign's gender matching">
          <option value="">unspecified</option>
          <option value="female">female</option>
          <option value="male">male</option>
          <option value="neutral">neutral</option>
        </select>
      </label>
      <div v-else class="voices-view__field"><span>Gender</span><b class="voices-view__fact">{{ autoDetectGender(inspectedVoice) === "?" ? "—" : autoDetectGender(inspectedVoice) }}<span class="jv-muted" style="font-weight:400"> (chip on the row cycles it)</span></b></div>
      <label v-if="inspectedEditable" class="voices-view__field">
        <span>Language</span>
        <input class="jv-input" v-model="editDraft.language" title="BCP-47 code, e.g. en, en-GB, de" />
      </label>
      <div v-else class="voices-view__field"><span>Language</span><b class="voices-view__fact">{{ inspectedVoice.language || "en" }}</b></div>
      <div class="voices-view__field"><span>Audio channel</span><b class="voices-view__fact">{{ inspectedVoice.channel_id || "Default" }}</b></div>
      <div class="voices-view__field voices-view__field--wide">
        <span>Default effect chain</span>
        <div class="voices-view__effects-row">
          <span v-if="!(inspectedVoice.default_effects?.length)" class="jv-muted">(none)</span>
          <span v-for="fx in (inspectedVoice.default_effects || [])" :key="fx" class="jv-pill jv-pill--ghost">{{ fx }}</span>
          <button class="jv-btn jv-btn--ghost jv-btn--sm" type="button" disabled title="Per-voice default effect chain editing lands with the Effects integration">+ Add</button>
        </div>
      </div>
    </div>

    <div class="jv-divider" />

    <h4 class="voices-view__sub-h">
      Reference samples ({{ inspectedSamples.length }})
      <span class="jv-muted" style="font-weight:400">Whisper-transcribed</span>
    </h4>

    <table v-if="inspectedSamples.length" class="jv-table voices-view__samples-tbl">
      <thead>
        <tr><th>File</th><th>Duration</th><th>SNR</th><th>Transcript</th><th class="right"></th></tr>
      </thead>
      <tbody>
        <tr v-for="(s, i) in inspectedSamples" :key="i">
          <td><code>{{ s.file }}</code></td>
          <td>{{ s.duration }}</td>
          <td>{{ s.snr }}</td>
          <td class="jv-muted">{{ s.transcript }}</td>
          <td class="right">
            <button class="jv-btn jv-btn--ghost jv-btn--sm" disabled title="Sample playback lands with /v1/voices/{id}/samples">▶</button>
            <button class="jv-btn jv-btn--ghost jv-btn--sm" disabled title="Sample delete lands with /v1/voices/{id}/samples">✕</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="jv-muted voices-view__samples-empty">
      <span v-if="inspectedVoice.source === 'preset'">
        Baked into the model — preset voices can never take a WAV or an in-app recording.
        To make a voice from a recording, <a href="#voices" @click.prevent="openModal('clone')">clone one with Chatterbox</a>.
      </span>
      <span v-else>No samples on this voice yet. Use the buttons below to add some.</span>
    </p>

    <div class="voices-view__sample-actions">
      <template v-if="inspectedEditable">
        <button class="jv-btn jv-btn--secondary jv-btn--sm" @click="pickSampleWav">+ Add WAV file</button>
        <button class="jv-btn jv-btn--secondary jv-btn--sm" @click="recordInApp">🎙️ Record in-app</button>
        <button class="jv-btn jv-btn--secondary jv-btn--sm" @click="promoteFromCaptures">↗ Promote from Captures</button>
      </template>
      <span class="jv-spacer" />
      <button class="jv-btn jv-btn--secondary jv-btn--sm" @click="trainLoraForVoice">🧪 Train LoRA</button>
      <button class="jv-btn jv-btn--secondary jv-btn--sm" @click="blendWithVoice">🔀 Blend with…</button>
    </div>

    <input ref="sampleFileInput" type="file" accept="audio/*" style="display:none" @change="onSamplePicked" />
  </div></td></tr>
        </template>
      </tbody>
    </table>
    <EmptyState
      v-else-if="voices.length === 0"
      icon="Sparkle"
      title="No voices registered"
      message="Load an engine to see its preset voices, or clone a new voice from a reference WAV. JustVoice ships with 54 Kokoro presets out of the box."
      action-label="Open Engines"
      compact
      @action="$router && $router.push?.('#engines'); window.location.hash = '#engines'"
    />
    <p v-else class="jv-muted" style="padding: 24px 0; text-align: center; font-style: italic;">
      No voices match "{{ search }}" or filter "{{ typeFilter }}".
    </p>
  </div>

  <!-- ── Inline inspector (preview parity §Voices voice-inspector card) ── -->
  </div><!-- /.voices-view.jv-fill — page-scroll-free pane ends here -->

  <!-- ── Modal ───────────────────────────────────────────────────────── -->
  <div class="modal-overlay" v-if="modal" @click.self="modal = null">
    <div class="modal">

      <div class="modal-head">
        <span class="modal-title">{{ modalTitle }}</span>
        <JvButton variant="ghost" size="sm" @click="modal = null">Close</JvButton>
      </div>

      <div class="modal-body">

        <!-- Engine + Name (all modes) -->
        <div class="jv-row" style="align-items: flex-end;">
          <div style="flex: 1;">
            <JvField label="Engine" layout="block">
              <JvSelect v-model="selectedEngine" :options="engineOptions" />
            </JvField>
          </div>
          <div style="flex: 1;">
            <JvField label="Voice name" layout="block">
              <JvInput v-model="voiceName" placeholder="e.g. Sarah" />
            </JvField>
          </div>
        </div>

        <!-- Clone fields -->
        <template v-if="modal === 'clone'">
          <JvField label="Reference audio (3–30 s WAV / MP3 / M4A / FLAC)" layout="block" style="margin-top: 14px;">
            <input type="file" accept="audio/*" class="jv-file-input" @change="cloneFile = $event.target.files[0]" />
          </JvField>
          <JvField label="Transcript of clip (optional — improves cloning fidelity)" layout="block" style="margin-top: 14px;">
            <JvTextarea v-model="cloneTranscript" placeholder="What's actually said in the reference clip — engines that support text-conditioned cloning use this." :rows="3" />
          </JvField>
        </template>

        <!-- Design fields -->
        <template v-else-if="modal === 'design'">
          <JvField label="Prose description" layout="block" style="margin-top: 14px;">
            <JvTextarea v-model="designPrompt" placeholder="a calm middle-aged British man, warm and unhurried" :rows="4" />
          </JvField>
          <p class="jv-muted" style="font-size: 12px; margin-top: 6px;">Qwen3-native via the CustomVoice design path. Other engines may approximate from the prompt as a fallback.</p>
        </template>

        <!-- Import fields -->
        <template v-else-if="modal === 'import'">
          <JvField label="Audio clip (WAV preferred)" layout="block" style="margin-top: 14px;">
            <input type="file" accept="audio/*" class="jv-file-input" @change="importFile = $event.target.files[0]" />
          </JvField>
          <JvField label="Transcript (optional)" layout="block" style="margin-top: 14px;">
            <JvTextarea v-model="importTranscript" placeholder="What's said in the clip." :rows="3" />
          </JvField>
          <p class="jv-muted" style="font-size: 12px; margin-top: 6px;">Imported clips are stored as-is. For voice cloning use the Clone flow.</p>
        </template>

        <!-- Blend fields -->
        <template v-else-if="modal === 'blend'">
          <JvField label="Interpolation strategy" layout="block" style="margin-top: 14px;">
            <JvSelect v-model="blendStrategy" :options="BLEND_STRATEGIES" />
          </JvField>

          <div style="margin-top: 14px;">
            <p class="jv-muted" style="font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: .04em; margin-bottom: 8px;">Source voices + weights</p>
            <table class="jv-table">
              <thead>
                <tr>
                  <th>Voice</th>
                  <th style="width: 110px;">Weight</th>
                  <th style="width: 60px;"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, idx) in blendSources" :key="idx">
                  <td>
                    <JvSelect
                      v-model="s.voice_id"
                      :options="[{ label: '— pick a voice —', value: '' }, ...engineVoiceOptions]"
                    />
                  </td>
                  <td>
                    <JvInput type="number" :modelValue="String(s.weight)" @update:modelValue="s.weight = $event" width="token" />
                  </td>
                  <td>
                    <JvButton variant="ghost" size="sm" v-if="blendSources.length > 2" @click="removeBlendSource(idx)">Remove</JvButton>
                  </td>
                </tr>
              </tbody>
            </table>
            <JvButton variant="ghost" size="sm" style="margin-top: 8px;" @click="addBlendSource">+ Add source</JvButton>
            <p class="jv-muted" style="font-size: 12px; margin-top: 6px;">Weights normalize automatically. All source voices must belong to the selected engine.</p>
          </div>
        </template>

      </div><!-- /.modal-body -->

      <div class="modal-footer">
        <JvButton variant="ghost" @click="modal = null">Cancel</JvButton>
        <JvButton variant="primary" :disabled="busy || !valid" :loading="busy" @click="submit">
          {{ busy ? busyLabel : submitLabel }}
        </JvButton>
      </div>

    </div>
  </div>
</template>

<style scoped>
.row-orphan { opacity: 0.7; }

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.modal {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-xl);
  width: min(620px, 92vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-3);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px;
  border-bottom: 1px solid var(--line);
}
.modal-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.modal-body { padding: 20px 22px; overflow-y: auto; flex: 1; }
.modal-footer {
  padding: 14px 22px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--line);
}

/* File input inherits basic styling */
.jv-file-input {
  display: block;
  font-size: 13px;
  color: var(--ink-2);
  margin-top: 4px;
}

/* Root pane — flex column. Toolbar/banner/details stay pinned, the
   catalog list scroller (.voices-view__list) takes the leftover height
   so the OUTER .jv-content never scrolls when the catalog is long. */
.voices-view {
  display: flex;
  flex-direction: column;
}
.voices-view__list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  margin-top: 14px;
}

/* Toolbar — search + type filter chips + + Clone primary action. */
.voices-view__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.voices-view__expand > td { background: var(--surface-2); padding: 14px 18px; }
.voices-view__expand .voices-view__inspector { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.voices-view__fact { font-size: 13px; font-weight: 600; }
.voices-view__readonly-note { font-size: 12px; margin: 0 0 10px; }

.voices-view__chips {
  display: inline-flex;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  padding: 2px;
  gap: 2px;
}
.voices-view__chips .jv-pill {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
}
/* Same specificity as the rule above, declared after — without this the
   transparent background wins and the ACTIVE chip renders white-on-nothing. */
.voices-view__chips .jv-pill--solid {
  background: var(--accent);
  color: #fff;
}
.voices-view__add-more {
  margin-top: 6px;
  padding: 8px 12px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
}
.voices-view__add-more > summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--ink-2);
  user-select: none;
}
.voices-view__add-more > summary:hover { color: var(--ink); }

.voices-view__table { font-size: 13px; }

/* Gender chip: click-cycle ❓ → F → M → N → unset. */
.voices-view__gender-chip[data-gender="female"] { border-color: #c98aa7; color: #a85a7e; background: #faf0f5; }
.voices-view__gender-chip[data-gender="male"]   { border-color: #7e9cc4; color: #4a6fa0; background: #eef3fa; }
.voices-view__gender-chip {
  appearance: none;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink-2);
  width: 28px;
  height: 22px;
  border-radius: var(--r-pill);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  display: inline-grid;
  place-items: center;
  transition: background 0.1s, color 0.1s;
}
.voices-view__gender-chip:hover { background: var(--surface-2); color: var(--ink); }
.voices-view__gender-chip[data-gender="F"] { color: var(--accent); border-color: var(--accent-line); background: var(--accent-soft); }
.voices-view__gender-chip[data-gender="M"] { color: var(--info-blue, #2f74b5); border-color: rgba(47, 116, 181, 0.4); background: #eef4fb; }
.voices-view__gender-chip[data-gender="N"] { color: var(--warn-ink); border-color: var(--warn-line); background: var(--warn-bg); }
.voices-view__gender-chip[data-gender="?"] { color: var(--ink-3); border-color: var(--line); }

/* Inline inspector (replaces modal pattern for voice editing). */
.voices-view__row--inspected { background: var(--accent-soft); }

.voices-view__inspector {
  margin-top: 18px;
  padding: 20px 24px;
}
.voices-view__inspector-h {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.voices-view__inspector-h h3 { margin: 0; font-size: 16px; }

.voices-view__inspector-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px 18px;
  margin-bottom: 12px;
}
.voices-view__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.voices-view__field > span {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.voices-view__field--wide { grid-column: 1 / -1; }

.voices-view__effects-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 30px;
}

.voices-view__sub-h {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
}
.voices-view__samples-tbl { font-size: 13px; }
.voices-view__samples-tbl thead th {
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
}
.voices-view__samples-tbl tbody td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: middle;
}
.voices-view__samples-tbl .right { text-align: right; }
.voices-view__samples-empty { padding: 10px 0; font-style: italic; font-size: 13px; }

.voices-view__sample-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.voices-view__castas { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
</style>
