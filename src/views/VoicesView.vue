<!-- SPDX-License-Identifier: MIT -->
<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "@delebash/llm-ui";
import { confirmDialog } from "@delebash/llm-ui";
import { readPref, writePref } from "../services/prefs.js";
import { UiButton, UiInput, UiTextarea, UiField, UiTag, UiChip, UiSelect, AppModal } from "@delebash/llm-ui";
import { EmptyState } from "@delebash/llm-ui";
import { useVoicesStore } from "../stores/voices.js";
import { runAiEndpoint } from "@delebash/llm-ui";
import { useEnginesStore } from "../stores/engines.js";
import { usePersonasStore } from "../stores/personas.js";
import VoiceAudition from "../components/VoiceAudition.vue";

const api = useApi();
// voices / engines / personas come from shared stores. Mutations here
// (clone/design/blend/delete/gender) call refresh() → store.reload(),
// so other views update. Store items are deeply reactive, so in-place
// edits (e.g. gender override) reflect without manual array rebuilds.
const voicesStore = useVoicesStore();
const enginesStore = useEnginesStore();
const personasStore = usePersonasStore();
const voices = computed(() => voicesStore.items);
const engines = computed(() => enginesStore.items);

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
// their overrides persist in the server-backed renderer prefs. Stored
// voices persist via PATCH /v1/voices/{id}.
function loadPresetGenderOverrides() {
  const m = readPref("presetGenderOverrides", {});
  return m && typeof m === "object" ? m : {};
}
function savePresetGenderOverride(id, gender) {
  const map = { ...loadPresetGenderOverrides() };
  if (gender) map[id] = gender; else delete map[id];
  writePref("presetGenderOverrides", map);
}

// ── LLM gender guess (F1 Phase 3, ruling 2: EXPLICIT button, never auto) ──
// Sends only the voices the dictionary left at "?" to the voice_gender
// feature; applies answers through the SAME persistence as a manual cycle
// (pref override for presets, PATCH for stored voices).
const genderGuessBusy = ref(false);
async function guessUnknownGenders() {
  const unknown = voices.value.filter((v) => autoDetectGender(v) === "?").slice(0, 60);
  if (!unknown.length) {
    pushToast({ message: "Nothing to guess — every voice already has a gender.", duration: 3500 });
    return;
  }
  genderGuessBusy.value = true;
  try {
    // The kit runner owns the task (row + seconds + tokens + cancel).
    const r = await runAiEndpoint({
      request: (p, o) => api.request(p, o),
      path: "/v1/voices/gender-guess",
      body: { voices: unknown.map((v) => ({
        name: v.name || v.id, description: v.design_prompt || "",
      })) },
      task: {
        feature: "voice-gender",
        label: `Gender guess · ${unknown.length} voice${unknown.length === 1 ? "" : "s"}`,
        onRetry: () => guessUnknownGenders(),
      },
    });
    const guesses = r?.guesses || {};
    let applied = 0;
    for (const v of unknown) {
      const g = guesses[v.name || v.id];
      if (!g) continue;
      v.gender_user_override = g;
      if (v.source === "preset") {
        savePresetGenderOverride(v.id, g);
      } else {
        await api.request(`/v1/voices/${v.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gender: g }),
        });
      }
      applied += 1;
    }
    pushToast({
      message: `${applied} voice${applied === 1 ? "" : "s"} labeled · ${unknown.length - applied} left unknown.`,
      kind: "success",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/abort/i.test(msg)) pushToast({
      message: msg.includes("501")
        ? "No AI model set up — run the LLM engine setup under AI Settings first."
        : `Gender guess failed: ${msg}`,
      kind: "error", duration: 6000,
    });
  } finally {
    genderGuessBusy.value = false;
  }
}

async function cycleGender(v) {
  const cur = autoDetectGender(v);
  const idx = GENDER_CYCLE.indexOf(cur);
  const next = GENDER_CYCLE[(idx + 1) % GENDER_CYCLE.length];
  v.gender_user_override = next || null;
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
// tucked away (user request 2026-06-11). Server-backed renderer pref.
const hiddenIds = ref(new Set());
{
  const _h = readPref("hiddenVoices", []);
  hiddenIds.value = new Set(Array.isArray(_h) ? _h : []);
}
const showHidden = ref(false);
function toggleHidden(v) {
  const next = new Set(hiddenIds.value);
  if (next.has(v.id)) next.delete(v.id); else next.add(v.id);
  hiddenIds.value = next;
  writePref("hiddenVoices", [...next]);
}

const engineFilter = ref(readPref("voicesEngineFilter", "all"));
function setEngineFilter(id) {
  engineFilter.value = id;
  writePref("voicesEngineFilter", id);
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
// Plays in a COMPACT INLINE player row under the previewed voice (user
// ruling 2026-08-15: the global bottom bar died; playback is compact and
// in place — this library row IS the preview surface).
const previewAudio = ref(null);
const previewingId = ref(null);
const previewFor = ref(null); // voice id whose row shows the inline player

// ── Audition panel (workbench Slice B) ───────────────────────────────
// Click a row to open it: type a line, turn this engine's knobs, hear the
// result in place. ▶ stays the one-click canned sample; this is the
// "actually, how does it say MY line" surface.
const auditionId = ref(null);
function toggleAudition(v) {
  auditionId.value = auditionId.value === v.id ? null : v.id;
}

async function previewVoice(v) {
  previewingId.value = v.id;
  previewFor.value = null;
  if (previewAudio.value) {
    URL.revokeObjectURL(previewAudio.value);
    previewAudio.value = null;
  }
  try {
    const always = readPref("autoLoadEngine") === "always";
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
        action: { label: "Always auto-load", fn: () => writePref("autoLoadEngine", "always") },
      });
      // Topbar pill + Engines page track loads from anywhere.
      window.dispatchEvent(new Event("jv:health-refresh"));
    }
    previewAudio.value = URL.createObjectURL(blob);
    previewFor.value = v.id; // the row's inline player autoplays
  } catch (e) {
    pushToast({ message: `Preview failed: ${e.message || e}`, kind: "error" });
  } finally {
    previewingId.value = null;
  }
}

async function refresh() {
  await Promise.all([
    voicesStore.reload(),
    enginesStore.reload(),
    personasStore.reload(),
  ]);
}

// ── "Cast as" — which personas a voice backs (CONCEPTS §2). ──────────
const personas = computed(() => personasStore.items);
const castAsByVoice = computed(() => {
  const map = {};
  for (const p of personas.value) {
    if (!p.voice_id) continue;
    map[p.voice_id] ||= [];
    map[p.voice_id].push(p.name);
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
    // Stock ids read like names (`af_bella`), but a cloned voice is minted
    // `voice_<32 hex>` (storage/voices.py:76) — that is not a label. Show what
    // distinguishes two same-named voices instead: the engine.
    .map((v) => ({ label: `${v.name} (${v.engine})`, value: v.id }))
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

// Voice type → UiTag intent mapping
function voiceTypeVariant(source) {
  // One distinct tint per type (v11): neutral / green / solid-green /
  // gold / blue / violet — so the column reads at a glance.
  // Returns shared UiTag intents.
  if (source === "preset") return "ghost";
  if (source === "cloned") return "success";
  if (source === "designed") return "solid";
  if (source === "blended") return "accent2";
  if (source === "trained") return "info";
  if (source === "imported") return "violet";
  return "ghost";
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

// Sample-collection actions (Add WAV / Record / Promote from Captures)
// are disabled in the inspector until the backend flow exists — no fake
// "uploading…" toasts.
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
  writePref("presetGenderOverrides", {});
  hiddenIds.value = new Set();
  writePref("hiddenVoices", []);
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
    <UiInput v-model="search" placeholder="Search voices…" width="name" title="Filter by name or id" />
    <UiSelect
      :model-value="engineFilter"
      :options="engineFilterOptions"
      title="Show only voices from one engine"
      width="id"
      @update:model-value="setEngineFilter"
    />
    <UiChip
      as="a"
      :selected="!!loadedTtsEngine"
      href="#engines"
      :title="loadedTtsEngine
        ? `${loadedTtsEngine.name || loadedTtsEngine.id} is loaded — previews play instantly. Click to manage engines.`
        : 'No TTS engine loaded — the first preview will offer to load one. Click to manage engines.'"
    >{{ loadedTtsEngine ? `● ${loadedTtsEngine.name || loadedTtsEngine.id} loaded` : "○ no engine loaded" }}</UiChip>
    <UiChip
      v-if="hiddenCount"
      :selected="showHidden"
      :title="showHidden ? 'Hide the hidden voices again' : 'Temporarily show voices you have hidden'"
      @click="showHidden = !showHidden"
    >🙈 hidden ({{ hiddenCount }})</UiChip>
    <UiChip
      title="Clear every gender override and unhide all voices (confirmed first)"
      @click="resetAllTweaks"
    >↺ Reset all tweaks</UiChip>
    <div class="voices-view__chips">
      <UiChip
        v-for="f in TYPE_FILTERS"
        :key="f.id"
        :selected="typeFilter === f.id"
        :title="f.id === 'all' ? 'Show every voice' : `Show only ${f.label.toLowerCase()} voices`"
        @click="typeFilter = f.id"
      >{{ f.label }} ({{ typeCounts[f.id] || 0 }})</UiChip>
    </div>
    <span class="jv-spacer" />
    <UiButton intent="secondary" size="small" :loading="genderGuessBusy"
      :disabled="genderGuessBusy"
      label="✨ Guess unknown genders"
      title="Ask the AI to label the voices the built-in dictionary doesn't know (the voice_gender feature — runs only when you click)"
      @click="guessUnknownGenders" />
    <UiButton intent="secondary" size="small" label="⬇ Import .justvoice.zip" @click="openModal('import')" />
    <UiButton
      intent="primary"
      size="small"
      :disabled="!chatterboxLoaded"
      :title="chatterboxLoaded ? '' : 'Voice cloning requires Chatterbox loaded'"
      label="+ Clone new voice"
      @click="openModal('clone')"
    />
  </div>

  <!-- Hint when clone-gate is closed (#99). -->
  <p v-if="!chatterboxLoaded" class="jv-banner jv-banner--warn">
    Voice cloning is Chatterbox-only. <a href="#engines"><strong>Load Chatterbox on the Speech engines tab</strong></a> to enable the "+ Clone new voice" button.
  </p>

  <!-- Add additional creation paths (Design / Blend) — less common, behind a details toggle -->
  <details class="voices-view__add-more">
    <summary>Other ways to add a voice — Design from prose · Blend voices</summary>
    <div class="jv-btn-group" style="margin-top: 10px">
      <UiButton intent="secondary" @click="openModal('design')">Design from prose (Qwen3)</UiButton>
      <UiButton intent="secondary" @click="openModal('blend')">Blend voices</UiButton>
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
          :class="{
            'row-orphan': orphanIds.includes(v.id),
            'voices-view__row--inspected': inspectedId === v.id,
            'voices-view__row--auditioning': auditionId === v.id,
          }"
          title="Click to audition · double-click to inspect"
          @click="toggleAudition(v)"
          @dblclick="inspect(v)"
          style="cursor: pointer"
        >
          <td @click.stop>
            <UiButton intent="ghost" size="small" :loading="previewingId === v.id" label="▶" :title="`Preview ${v.name}`" @click="previewVoice(v)" />
          </td>
          <!-- (the compact preview row renders below this row) -->
          <td>
            <strong>{{ v.name }}</strong>
            <UiTag v-if="orphanIds.includes(v.id)" intent="danger" label="orphan" style="margin-left: 6px" />
          </td>
          <td>
            <!-- Click-cycle gender chip per #85. -->
            <button
              type="button"
              class="voices-view__gender-chip"
              :data-gender="autoDetectGender(v)"
              :title="`Gender: ${autoDetectGender(v) || 'unset'} — click to cycle ? → F → M → N → unset`"
              @click.stop="cycleGender(v)"
            >{{ (autoDetectGender(v) || "?").charAt(0).toUpperCase() }}</button>
          </td>
          <td><UiTag :intent="voiceTypeVariant(v.source)" :label="v.source" /></td>
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
            <UiButton intent="ghost" size="small" label="⚙" :title="`Inspect ${v.name}`" @click="inspect(v)" />
            <UiButton
              v-if="v.source === 'preset'"
              intent="ghost"
              size="small"
              :label="hiddenIds.has(v.id) ? '👁' : '🙈'"
              :title="hiddenIds.has(v.id) ? `Unhide ${v.name}` : `Hide ${v.name} — built-ins can't be deleted, but they can be tucked away`"
              @click="toggleHidden(v)"
            />
            <UiButton
              v-if="v.source !== 'preset'"
              intent="danger-outline"
              size="small"
              label="✕"
              :title="`Delete ${v.name}`"
              @click="deleteVoice(v.id)"
            />
          </td>
        </tr>
        <!-- Compact preview player (the ruling 2026-08-15: playback lives
             in the library row, not a global bottom bar). -->
        <tr v-if="previewFor === v.id && previewAudio" :key="`prev-${v.id}`" class="voices-view__expand"><td colspan="12">
          <audio :src="previewAudio" controls autoplay class="jv-audio-inline" />
        </td></tr>
        <!-- Audition panel — your line, this engine's knobs, in place. -->
        <tr v-if="auditionId === v.id" :key="`aud-${v.id}`" class="voices-view__expand" @click.stop><td colspan="12">
          <VoiceAudition :voice="v" />
        </td></tr>
        <tr v-if="inspectedId === v.id" :key="`exp-${v.id}`" class="voices-view__expand"><td colspan="12"><div class="voices-view__inspector">
    <header class="voices-view__inspector-h">
      <h3>Voice inspector — {{ inspectedVoice.name }}</h3>
      <span class="jv-spacer" />
      <UiButton
        v-if="inspectedEditable"
        intent="primary"
        size="small"
        label="Save changes"
        :loading="editSaving"
        title="Rename / gender / language — PATCHes the stored voice"
        @click="saveVoiceEdit"
      />
      <UiTag intent="ghost" v-else  title="Engine presets ship with the engine — clone or blend to make an editable copy">preset · read-only</UiTag>
      <UiButton
        intent="secondary"
        size="small"
        label="Reset to defaults"
        :disabled="!voiceHasTweaks(inspectedVoice)"
        :title="voiceHasTweaks(inspectedVoice) ? 'Clears the gender override and unhides this voice' : 'Nothing overridden on this voice'"
        @click="resetVoice(inspectedVoice)"
      />
      <UiButton intent="ghost" size="small" label="Close" @click="inspectedId = null" />
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
        <UiInput width="name" v-model="editDraft.name" title="Rename — every picker and persona link follows the id, so renaming is safe" />
      </label>
      <div v-else class="voices-view__field"><span>Name</span><b class="voices-view__fact">{{ inspectedVoice.name }}</b></div>
      <div class="voices-view__field"><span>Type</span><b class="voices-view__fact">{{ inspectedVoice.source }}</b></div>
      <div class="voices-view__field"><span>Engine</span><b class="voices-view__fact">{{ inspectedVoice.engine }}</b></div>
      <label v-if="inspectedEditable" class="voices-view__field">
        <span>Gender</span>
        <UiSelect v-model="editDraft.gender" width="id" title="Drives Smart-assign's gender matching" :options="[
          { value: '', label: 'unspecified' },
          { value: 'female', label: 'female' },
          { value: 'male', label: 'male' },
          { value: 'neutral', label: 'neutral' },
        ]" />
      </label>
      <div v-else class="voices-view__field"><span>Gender</span><b class="voices-view__fact">{{ autoDetectGender(inspectedVoice) === "?" ? "—" : autoDetectGender(inspectedVoice) }}<span class="jv-muted" style="font-weight:400"> (chip on the row cycles it)</span></b></div>
      <label v-if="inspectedEditable" class="voices-view__field">
        <span>Language</span>
        <UiInput width="token" v-model="editDraft.language" title="BCP-47 code, e.g. en, en-GB, de" />
      </label>
      <div v-else class="voices-view__field"><span>Language</span><b class="voices-view__fact">{{ inspectedVoice.language || "en" }}</b></div>
      <div class="voices-view__field"><span>Audio channel</span><b class="voices-view__fact">{{ inspectedVoice.channel_id || "Default" }}</b></div>
      <div class="voices-view__field voices-view__field--wide">
        <span>Default effect chain</span>
        <div class="voices-view__effects-row">
          <span v-if="!(inspectedVoice.default_effects?.length)" class="jv-muted">(none)</span>
          <UiTag intent="ghost" v-for="fx in (inspectedVoice.default_effects || [])" :key="fx">{{ fx }}</UiTag>
          <UiButton intent="ghost" size="small" :disabled="true" title="Per-voice default effect chain editing lands with the Effects integration" label="+ Add" />
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
            <UiButton intent="ghost" size="small" :disabled="true" title="Sample playback lands with /v1/voices/{id}/samples" label="▶" />
            <UiButton intent="ghost" size="small" :disabled="true" title="Sample delete lands with /v1/voices/{id}/samples" label="✕" />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="jv-muted voices-view__samples-empty">
      <span v-if="inspectedVoice.source === 'preset'">
        Baked into the model — preset voices can never take a WAV or an in-app recording.
        To make a voice from a recording, <a href="#voices" @click.prevent="openModal('clone')">clone one with Chatterbox</a>.
      </span>
      <span v-else>No samples on this voice yet — sample collection (add WAV / record / promote) is coming soon.</span>
    </p>

    <div class="voices-view__sample-actions">
      <template v-if="inspectedEditable">
        <!-- Sample-collection flow isn't built yet — disabled so the UI
             doesn't claim an upload/record that never happens. -->
        <UiButton intent="secondary" size="small" :disabled="true" title="Coming soon — attach a WAV as a cloning sample" label="+ Add WAV file (soon)" />
        <UiButton intent="secondary" size="small" :disabled="true" title="Coming soon — in-app recorder with auto-trim + level meter" label="🎙️ Record in-app (soon)" />
        <UiButton intent="secondary" size="small" :disabled="true" title="Coming soon — promote a capture into this voice's samples" label="↗ Promote from Captures (soon)" />
      </template>
      <span class="jv-spacer" />
      <UiButton intent="secondary" size="small" label="🧪 Train LoRA" @click="trainLoraForVoice" />
      <UiButton intent="secondary" size="small" label="🔀 Blend with…" @click="blendWithVoice" />
    </div>
  </div></td></tr>
        </template>
      </tbody>
    </table>
    <EmptyState
      v-else-if="voices.length === 0"
      icon="Sparkle"
      title="No voices registered"
      message="Load an engine to see its preset voices, or clone a new voice from a reference WAV. JustVoice ships with 54 Kokoro presets out of the box."
      action-label="Open Speech engines"
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
  <AppModal v-if="modal" eyebrow="Voice" :title="modalTitle" :max-width="'620px'" dismissable @close="modal = null">

        <!-- Engine + Name (all modes) -->
        <div class="jv-row" style="align-items: flex-end;">
          <div style="flex: 1;">
            <UiField label="Engine" layout="block">
              <UiSelect v-model="selectedEngine" :options="engineOptions" />
            </UiField>
          </div>
          <div style="flex: 1;">
            <UiField label="Voice name" layout="block">
              <UiInput v-model="voiceName" placeholder="e.g. Sarah" />
            </UiField>
          </div>
        </div>

        <!-- Clone fields -->
        <template v-if="modal === 'clone'">
          <UiField label="Reference audio (3–30 s WAV / MP3 / M4A / FLAC)" layout="block" style="margin-top: 14px;">
            <input type="file" accept="audio/*" class="jv-file-input" @change="cloneFile = $event.target.files[0]" />
          </UiField>
          <UiField label="Transcript of clip (optional — improves cloning fidelity)" layout="block" style="margin-top: 14px;">
            <UiTextarea v-model="cloneTranscript" placeholder="What's actually said in the reference clip — engines that support text-conditioned cloning use this." :rows="3" />
          </UiField>
        </template>

        <!-- Design fields -->
        <template v-else-if="modal === 'design'">
          <UiField label="Prose description" layout="block" style="margin-top: 14px;">
            <UiTextarea v-model="designPrompt" placeholder="a calm middle-aged British man, warm and unhurried" :rows="4" />
          </UiField>
          <p class="jv-muted" style="font-size: 12px; margin-top: 6px;">Qwen3-native via the CustomVoice design path. Other engines may approximate from the prompt as a fallback.</p>
        </template>

        <!-- Import fields -->
        <template v-else-if="modal === 'import'">
          <UiField label="Audio clip (WAV preferred)" layout="block" style="margin-top: 14px;">
            <input type="file" accept="audio/*" class="jv-file-input" @change="importFile = $event.target.files[0]" />
          </UiField>
          <UiField label="Transcript (optional)" layout="block" style="margin-top: 14px;">
            <UiTextarea v-model="importTranscript" placeholder="What's said in the clip." :rows="3" />
          </UiField>
          <p class="jv-muted" style="font-size: 12px; margin-top: 6px;">Imported clips are stored as-is. For voice cloning use the Clone flow.</p>
        </template>

        <!-- Blend fields -->
        <template v-else-if="modal === 'blend'">
          <UiField label="Interpolation strategy" layout="block" style="margin-top: 14px;">
            <UiSelect v-model="blendStrategy" :options="BLEND_STRATEGIES" />
          </UiField>

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
                    <UiSelect
                      v-model="s.voice_id"
                      :options="[{ label: '— pick a voice —', value: '' }, ...engineVoiceOptions]"
                    />
                  </td>
                  <td>
                    <UiInput type="number" :modelValue="String(s.weight)" @update:modelValue="s.weight = $event" width="token" />
                  </td>
                  <td>
                    <UiButton intent="ghost" size="small" v-if="blendSources.length > 2" @click="removeBlendSource(idx)">Remove</UiButton>
                  </td>
                </tr>
              </tbody>
            </table>
            <UiButton intent="ghost" size="small" style="margin-top: 8px;" @click="addBlendSource">+ Add source</UiButton>
            <p class="jv-muted" style="font-size: 12px; margin-top: 6px;">Weights normalize automatically. All source voices must belong to the selected engine.</p>
          </div>
        </template>


      <template #footer>
        <UiButton intent="secondary" @click="modal = null">Cancel</UiButton>
        <UiButton intent="primary" :disabled="busy || !valid" :loading="busy" @click="submit">
          {{ busy ? busyLabel : submitLabel }}
        </UiButton>
      </template>
  </AppModal>
</template>

<style scoped>
.row-orphan { opacity: 0.7; }

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
.voices-view__chips .ui-chip {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
}
/* Same specificity as the rule above, declared after — without this the
   transparent background wins and the ACTIVE chip renders white-on-nothing. */
.voices-view__chips .ui-chip.is-selected {
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
/* Audition panel open — softer than the inspector's, so both can be open
   on the same row without the highlight shouting twice. */
.voices-view__row--auditioning { background: var(--surface-2); }

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
