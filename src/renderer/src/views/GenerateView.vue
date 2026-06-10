<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, reactive, onMounted, computed, watch } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { useAudioPlayer } from "../stores/audioPlayer.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import JvField from "../components/jv/JvField.vue";
import JvTextarea from "../components/jv/JvTextarea.vue";
import JvInput from "../components/jv/JvInput.vue";
import SlashTagMenu from "../components/SlashTagMenu.vue";

const api = useApi();
const tasks = useRenderTasks();
const audioPlayer = useAudioPlayer();

const voices = ref([]);
const currentEngine = ref(null);
const voice = ref("");
// Empty so the placeholder hint is visible on first open.
const text = ref("");
const audio = ref(null);
const busy = ref(false);
// Take history rendered at the bottom of the page. Stubbed until the
// /v1/takes/recent route lands with #87 — safeRequest returns [] when 404.
const history = ref([]);
// Voice profiles — profile selection layer on top of the voice-keyed
// generate flow. Profile selection enables Compose + per-profile
// effects_chain pre-fill + persona-rewrite gating.
const profiles = ref([]);
const selectedProfileId = ref("");
const composeBusy = ref(false);

const selectedProfile = computed(() =>
  profiles.value.find((p) => p.id === selectedProfileId.value) || null,
);
const hasPersonality = computed(() =>
  !!(selectedProfile.value?.personality && selectedProfile.value.personality.trim()),
);
const profileOptions = computed(() => [
  { label: "— no profile —", value: "" },
  ...profiles.value.map((p) => ({ label: p.name, value: p.id })),
]);

const availableVoices = computed(() => {
  if (!currentEngine.value) return [];
  return voices.value.filter((v) => v.engine === currentEngine.value.id);
});

// Returns an object so the template can render real <a> hash-links into
// the banner rather than a flat string. `kind` lets the template pick
// which CTA to show; `null` means "no banner needed".
const emptyVoiceReason = computed(() => {
  if (!currentEngine.value) return { kind: "no-engine" };
  const caps = currentEngine.value.capabilities || [];
  const isCloneOnly = caps.includes("voice_cloning") && !caps.includes("preset_voices");
  if (availableVoices.value.length === 0) {
    return isCloneOnly ? { kind: "clone-only", engine: currentEngine.value.name } : { kind: "empty-catalog", engine: currentEngine.value.name };
  }
  return null;
});

const speed = ref(1.0);
const pitch = ref(0);
const gain = ref(0);
const pauseBefore = ref(0);
const pauseAfter = ref(0);
const temperature = ref(0.7);
const seed = ref("random");
const instruct = ref("");
const autoplay = ref(true);
const personaRewrite = ref(false);
const stylePrompt = ref("");

// ── Engine capability gating ──────────────────────────────────────────
// Capability detail fetched from GET /v1/engines/capabilities. Variant
// ids (chatterbox-turbo, chatterbox-multilingual) take precedence over
// base engine ids. Falls back to base engine id when no variant entry.
// See server/justtts/engines/capability_details.py for the source.
const capabilityMap = ref({});  // { engine_id: EngineCapabilityDetail }

function lookupCapability(engineId) {
  if (!engineId) return null;
  if (capabilityMap.value[engineId]) return capabilityMap.value[engineId];
  // Fallback: try the base engine id by stripping trailing "-variant".
  const base = engineId.split("-")[0];
  return capabilityMap.value[base] || null;
}

const engineCaps = computed(() => {
  const detail = lookupCapability(currentEngine.value?.id);
  if (detail) return detail;
  // Empty fallback shape — matches EngineCapabilityDetail's default fields
  // so downstream computed props don't crash when capability map is empty
  // (offline / pre-fetch state).
  return {
    engine_id: "",
    display_name: "no engine",
    supports_voice_cloning: false,
    supports_clone_prompt_text: false,
    supports_voice_design: false,
    supports_instruct_freeform: false,
    supports_phoneme_input: false,
    supports_multi_speaker: false,
    knobs: [],
    inline_tags: [],
    pitch_native_st_range: null,
    pitch_post_process: false,
    notes: [],
  };
});

// ── Capability-derived computeds ──────────────────────────────────────
// These project the rich manifest into the boolean shape the existing
// template (sliders, hint-text, banner pills) uses. As the template
// evolves to render dynamic knob lists directly from `engineCaps.knobs`,
// these shrink.

function hasKnob(key) {
  return engineCaps.value.knobs?.some((k) => k.key === key) ?? false;
}

const supportsEmotion        = computed(() =>
  engineCaps.value.inline_tags?.some((t) => t.category === "emotion") ?? false,
);
const emotionTagSet          = computed(() =>
  engineCaps.value.inline_tags?.find((t) => t.category === "emotion") || null,
);
const supportsFreeform       = computed(() => engineCaps.value.supports_instruct_freeform);
const supportsParalinguistic = computed(() =>
  engineCaps.value.inline_tags?.some(
    (t) => t.category === "paralinguistic" || t.category === "sfx",
  ) ?? false,
);
const paralinguisticTagSet   = computed(() =>
  engineCaps.value.inline_tags?.find(
    (t) => t.category === "paralinguistic" || t.category === "sfx",
  ) || null,
);
const pitchNative            = computed(() => engineCaps.value.pitch_native_st_range);
const pitchPostProcess       = computed(() => engineCaps.value.pitch_post_process);
const pitchMin               = computed(() => pitchNative.value?.[0] ?? -12);
const pitchMax               = computed(() => pitchNative.value?.[1] ?? 12);
const supportsTemperature    = computed(() => hasKnob("temperature") || hasKnob("talker_temperature"));
const supportsSeed           = computed(() => hasKnob("seed"));
const supportsStylePrompt    = computed(() => engineCaps.value.supports_style_prompt === true);

// ── Capability-driven engine knobs ───────────────────────────────────
//
// The Delivery overlay above renders cross-engine primary controls
// (Speed / Pitch / Gain / Temperature / Pause / Seed). Anything else
// the engine accepts comes from its capability manifest's `knobs`
// list. We render those dynamically — typed sliders + number inputs,
// no more "Raw engine knobs (JSON)" escape hatch the user couldn't use.
//
// Keys ALREADY covered by primary controls are filtered out so we
// don't render two "Temperature" sliders on Qwen3 (talker_temperature
// is the same knob as the primary one).
const PRIMARY_KNOB_KEYS = new Set([
  "speed", "speed_factor",                  // covered by primary Speed
  "temperature", "talker_temperature",      // covered by primary Temperature
  "seed",                                   // covered by primary Seed
  "t_shift",                                // covered by primary Pitch
]);

const manifestedKnobs = computed(() =>
  (engineCaps.value.knobs || []).filter((k) => !PRIMARY_KNOB_KEYS.has(k.key)),
);
const primaryEngineKnobs  = computed(() => manifestedKnobs.value.filter((k) => !k.advanced));
const advancedEngineKnobs = computed(() => manifestedKnobs.value.filter((k) =>  k.advanced));

// Per-knob value store, keyed by knob.key. Seeded from `default`
// whenever the manifest changes (engine switch). Values that match
// the default are stripped from the payload so we don't send noise.
const knobValues = reactive({});
watch(
  manifestedKnobs,
  (knobs) => {
    for (const k of knobs) {
      if (knobValues[k.key] === undefined) knobValues[k.key] = k.default;
    }
  },
  { immediate: true },
);

// ── Lexicon preview ────────────────────────────────────────────────
//
// Lexicons attach via voice profiles (Profile.default_lexicon_id) and
// persona overrides. When the user picks a profile on this view that
// has a lexicon, we fetch `/v1/lexicons/{id}` and populate
// `attachedLexicon` — the preview row's populated state + the
// "applied entries" modal then work against real data.
const attachedLexicon = ref(null);  // { id, name, entries: [LexiconEntry] }
const showLexiconPreview = ref(false);

// Watch the selected profile — when it changes and has a default
// lexicon, fetch entries and populate the attached lexicon. When the
// user clears the profile or picks one without a lexicon, drop back
// to the empty state. Cancellation isn't critical here since the
// fetch is cheap and idempotent.
let lexiconFetchSeq = 0;
watch(selectedProfile, async (p) => {
  const lexId = p?.default_lexicon_id;
  if (!lexId) { attachedLexicon.value = null; return; }
  const mySeq = ++lexiconFetchSeq;
  try {
    const lex = await api.safeRequest(`/v1/lexicons/${lexId}`, null);
    // Drop if a newer fetch superseded this one (rapid profile-switch
    // race) — keep only the most recent result.
    if (mySeq !== lexiconFetchSeq) return;
    attachedLexicon.value = lex && lex.id ? lex : null;
  } catch {
    if (mySeq === lexiconFetchSeq) attachedLexicon.value = null;
  }
}, { immediate: true });

// Client-side match: walk the lexicon entries longest-first, find every
// case-insensitive occurrence in the current text, return distinct
// matches with their pronunciation. Schema follows the `LexiconEntry`
// pydantic model — `grapheme` is the word to match, `phoneme_ipa` /
// `alias` is the replacement (IPA preferred when both are set).
const appliedLexiconMatches = computed(() => {
  if (!attachedLexicon.value || !text.value) return [];
  const entries = [...(attachedLexicon.value.entries || [])].sort(
    (a, b) => (b.grapheme?.length || 0) - (a.grapheme?.length || 0),
  );
  const seen = new Set();
  const matches = [];
  for (const e of entries) {
    if (!e.grapheme) continue;
    const replacement = e.phoneme_ipa || e.alias;
    if (!replacement) continue;
    const escaped = e.grapheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    const found = text.value.match(re);
    if (!found) continue;
    const key = e.grapheme.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      word: e.grapheme,
      replacement,
      notation: e.phoneme_ipa ? "IPA" : "phonetic",
      count: found.length,
    });
  }
  return matches;
});
const appliedLexiconCount = computed(() =>
  appliedLexiconMatches.value.reduce((sum, m) => sum + m.count, 0),
);

// Used by the capability banner pill "✓ N emotion tags" — keeps the
// count even though the dropdown is gone (emotion is inserted inline
// via SlashTagMenu now).
const EMOTIONS = computed(() => emotionTagSet.value?.tags || []);

const voiceOptions = computed(() =>
  availableVoices.value.length === 0
    ? [{ label: "— no voices available —", value: "" }]
    : availableVoices.value.map((v) => ({ label: v.name, value: v.id }))
);

const wordCount = computed(() => text.value.trim().split(/\s+/).filter(Boolean).length);

// Multi-line placeholder hint shown when the textarea is empty. Shows
// the poetic example sentence plus a discovery hint that lists WHAT
// kinds of inline tags this engine accepts (emotion / paralinguistic /
// SFX / prosody). Naming the categories beats listing specific tag
// names because (a) the SlashTagMenu shows the full list anyway, and
// (b) the categories tell users WHAT they can shape (mood vs sound vs
// timing) at a glance.
const paralinguisticHint = computed(() => {
  const intro = "Once upon a midnight dreary, while I pondered weak and weary…";
  const tagSets = engineCaps.value.inline_tags || [];
  if (!tagSets.length) return intro;
  const categories = [...new Set(tagSets.map((s) => s.category).filter(Boolean))];
  if (!categories.length) return intro;
  return `${intro}\n\nType "/" for ${categories.join(", ")} tags — or use the Insert tag button below.`;
});

// Placeholder always shows the example sentence — the pill in the
// label communicates the disabled state, and the hint below explains
// why and what to use instead. Repeating "Disabled — ..." in the
// placeholder was the third duplicate of the same signal.
const deliveryDirectionPlaceholder =
  'e.g. "with growing horror, voice gradually quieter, last word almost whispered"';

async function refreshVoices() {
  try {
    const [v, cur, h, caps, profs] = await Promise.all([
      api.safeRequest("/v1/voices", { voices: [] }),
      api.safeRequest("/v1/engines/current", { engine: null }),
      api.safeRequest("/v1/takes/recent", { takes: [] }),
      api.safeRequest("/v1/engines/capabilities", { engines: {} }),
      api.safeRequest("/v1/profiles", { profiles: [] }),
    ]);
    voices.value = v?.voices || [];
    currentEngine.value = cur?.engine || null;
    history.value = (h?.takes || []).slice(0, 10);
    capabilityMap.value = caps?.engines || {};
    profiles.value = profs?.profiles || [];
    const stillValid = availableVoices.value.some((x) => x.id === voice.value);
    if (!stillValid) voice.value = availableVoices.value[0]?.id || "";
  } catch (_) {}
}

async function composeLine() {
  if (!selectedProfileId.value || !hasPersonality.value) return;
  composeBusy.value = true;
  try {
    const r = await api.request(`/v1/profiles/${selectedProfileId.value}/compose`, {
      method: "POST",
    });
    if (r?.text) text.value = r.text;
  } catch (e) {
    // 501 = LLM not configured — show a useful toast rather than failing silently.
    pushToast({
      message: e?.message?.includes("501") || e?.status === 501
        ? "Compose unavailable — wire an LLM service in Settings → External."
        : `Compose failed: ${e?.message || e}`,
      kind: "warning",
      duration: 6000,
    });
  } finally {
    composeBusy.value = false;
  }
}

function buildDelivery() {
  const d = {};
  if (Math.abs(speed.value - 1.0) > 0.001) d.speed = speed.value;
  if (Math.abs(pitch.value) > 0.001) d.pitch = pitch.value;
  if (Math.abs(gain.value) > 0.001) d.gain_db = gain.value;
  if (pauseBefore.value > 0) d.pause_before = pauseBefore.value;
  if (pauseAfter.value > 0) d.pause_after = pauseAfter.value;
  if (Math.abs(temperature.value - 0.7) > 0.001) d.temperature = temperature.value;
  if (seed.value && seed.value !== "random") d.seed = Number(seed.value) || seed.value;
  if (instruct.value.trim()) d.instruct = instruct.value.trim();
  if (supportsStylePrompt.value && stylePrompt.value.trim()) d.style_prompt = stylePrompt.value.trim();

  // Manifested engine knobs — only include keys whose current value
  // differs from the spec's default (don't pollute the payload with
  // defaults the engine would apply anyway).
  const engineKnobs = {};
  for (const k of manifestedKnobs.value) {
    const v = knobValues[k.key];
    if (v == null) continue;
    const isDefault = typeof v === "number" && typeof k.default === "number"
      ? Math.abs(v - k.default) < 1e-9
      : v === k.default;
    if (!isDefault) engineKnobs[k.key] = v;
  }
  if (Object.keys(engineKnobs).length) d.engine = engineKnobs;

  return Object.keys(d).length ? d : undefined;
}

async function generate() {
  if (!voice.value) {
    pushToast({ message: "Pick a voice first", kind: "error" });
    return;
  }
  const delivery = buildDelivery();
  busy.value = true;
  if (audio.value) { URL.revokeObjectURL(audio.value); audio.value = null; }
  const ctl = new AbortController();
  const charCount = text.value.length;
  const task = tasks.start({
    label: `Render · ${voice.value}`,
    kind: "generate",
    statsFn: (t) => {
      const out = [`${charCount} chars`, `${wordCount.value} words`];
      if (t.meta?.bytesOut) {
        out.push(`${(t.meta.bytesOut / 1024).toFixed(1)} KB`);
        const audioSec = Math.max(0, (t.meta.bytesOut - 44)) / 48000;
        out.push(`${audioSec.toFixed(1)}s audio`);
      }
      return out;
    },
    onCancel: () => ctl.abort(),
    onRetry: () => generate(),
  });
  try {
    const body = { voice: voice.value, text: text.value, cache: false };
    if (delivery) body.delivery = delivery;
    // Attach the profile's lexicon (if any) so the server applies the
    // pronunciation overrides before TTS — matches the populated state
    // shown in the lexicon-preview row above.
    if (attachedLexicon.value?.id) body.lexicons = [attachedLexicon.value.id];
    if (selectedProfileId.value) body.profile_id = selectedProfileId.value;
    const blob = await api.request("/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    tasks.update(task.id, { meta: { bytesOut: blob.size } });
    tasks.finish(task.id);
    audio.value = URL.createObjectURL(blob);
    if (autoplay.value) {
      // <audio> auto-plays via the v-if/key, but iOS Safari requires explicit
      // play() after element mount. nextTick + DOM grab handles both.
      setTimeout(() => document.querySelector(".generate-view__audio")?.play?.().catch(() => {}), 60);
    }
  } catch (e) {
    if (!ctl.signal.aborted) {
      tasks.fail(task.id, String(e.message || e));
      pushToast({ message: `Render failed: ${e.message || e}`, kind: "error", duration: 6000 });
    }
  } finally {
    busy.value = false;
  }
}

function randomizeSeed() {
  seed.value = String(Math.floor(Math.random() * 1_000_000_000));
}

// Format an ISO timestamp as a short relative-time string
// ("just now", "12m", "2h", "3d").
function relativeTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}

function playTake(h) {
  if (!h?.audio_url) return;
  const url = `${api.serverUrl}${h.audio_url}`;
  audioPlayer.play({
    url,
    title: h.voice || "Take",
    subtitle: (h.text || "").slice(0, 80),
  });
}

// ── Slash-menu wiring ────────────────────────────────────────────────
// Watches the main textarea for a "/" keystroke and pops up the
// engine-aware tag menu. The menu reads engineCaps.inline_tags and
// inserts the formatted token at cursor (or at start-of-text for tags
// whose placement rule is "start_of_turn", per the manifest's per-tag
// placement constraint).
const slashOpen = ref(false);
const slashAnchor = ref(null);
const slashQuery = ref("");
const slashMenuRef = ref(null);
const textareaEl = ref(null);
// Index in the textarea where the "/" was typed — we replace the slash
// query span when an item is selected.
const slashStart = ref(-1);

function onTextareaKeydown(e) {
  // While menu is open, forward navigation keys to the menu component.
  if (slashOpen.value && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
    slashMenuRef.value?.onKeydown?.(e);
  }
}

function onTextareaInput(e) {
  const el = e.target;
  if (!el) return;
  textareaEl.value = el;
  const value = el.value;
  const caret = el.selectionStart ?? value.length;
  // Look back from caret to find an unbroken token starting with "/".
  // Triggers as the user types "/em" → query "em".
  const before = value.slice(0, caret);
  const match = before.match(/\/([\w-]*)$/);
  if (match) {
    slashStart.value = caret - match[0].length;
    slashQuery.value = match[1];
    // Anchor menu under the textarea (simpler than tracking cursor
    // pixel position — accurate caret coords would need a canvas-based
    // text-measuring helper we don't have).
    slashAnchor.value = el.getBoundingClientRect();
    slashOpen.value = true;
  } else {
    slashOpen.value = false;
    slashStart.value = -1;
    slashQuery.value = "";
  }
}

// Button-triggered open of SlashTagMenu — same menu as typing "/" but
// reachable without keyboard discovery. The handler positions the menu
// at the textarea, sets slashStart to the current caret (so onSlashInsert
// has no "/query" span to replace — the tag just inserts at the caret).
function openTagMenu() {
  const el = textareaEl.value || document.querySelector("textarea.generate-view__text");
  if (!el) return;
  textareaEl.value = el;
  el.focus();
  const caret = el.selectionStart ?? text.value.length;
  slashStart.value = caret;
  slashQuery.value = "";
  slashAnchor.value = el.getBoundingClientRect();
  slashOpen.value = true;
}

function onSlashInsert({ rendered, placement }) {
  const el = textareaEl.value;
  if (!el || slashStart.value < 0) return;
  const value = text.value;
  const caret = el.selectionStart ?? value.length;
  // Remove the "/query" span that triggered the menu.
  const beforeSlash = value.slice(0, slashStart.value);
  const afterCaret = value.slice(caret);
  let inserted;
  let newCaret;
  if (placement === "start_of_turn") {
    // Drop at position 0 — start_of_turn placement (engine constraint).
    // Avoid duplicating if the same tag is already at the start.
    if (value.startsWith(rendered)) {
      inserted = beforeSlash + afterCaret;
      newCaret = slashStart.value;
    } else {
      inserted = rendered + " " + beforeSlash + afterCaret;
      newCaret = slashStart.value + rendered.length + 1;
    }
  } else {
    inserted = beforeSlash + rendered + afterCaret;
    newCaret = slashStart.value + rendered.length;
  }
  text.value = inserted;
  slashOpen.value = false;
  slashStart.value = -1;
  slashQuery.value = "";
  // Restore caret position on next tick (after Vue re-renders).
  setTimeout(() => {
    el.focus();
    el.selectionStart = el.selectionEnd = newCaret;
  }, 0);
}

onMounted(refreshVoices);
</script>

<template>
  <div class="generate-view">
    <!-- Main textarea — multi-line placeholder with poetic example + tag
         hint (visible when textarea is empty). Matches preview HTML §1.
         Slash-key triggers SlashTagMenu (engine-aware inline-tag picker). -->
    <JvTextarea
      v-model="text"
      autosize
      :min-height-px="140"
      :max-height-px="360"
      :placeholder="paralinguisticHint"
      class="generate-view__text"
      @input="onTextareaInput"
      @keydown="onTextareaKeydown"
    />
    <SlashTagMenu
      ref="slashMenuRef"
      :tag-sets="engineCaps.inline_tags"
      :open="slashOpen"
      :anchor="slashAnchor"
      :query="slashQuery"
      @insert="onSlashInsert"
      @close="slashOpen = false"
    />

    <!-- Persistent affordance for users who don't know the "/" shortcut.
         Opens the same SlashTagMenu programmatically. Visible only when
         the loaded engine has inline tags to offer. -->
    <button
      v-if="engineCaps.inline_tags?.length"
      type="button"
      class="jv-btn jv-btn--ghost jv-btn--sm generate-view__tag-button"
      @click="openTagMenu"
    >
      🏷️ Insert tag…
    </button>

    <!-- Floating chip-card bar (matches preview HTML §1 mockup). -->
    <div class="jv-floating generate-view__floating">
      <div class="jv-chip-card">🎙️ Voice:
        <strong>{{ availableVoices.find((v) => v.id === voice)?.name || "Pick a voice" }}</strong>
        <select v-model="voice" :disabled="availableVoices.length === 0" class="generate-view__chip-select">
          <option v-for="o in voiceOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="jv-chip-card">🧠 Engine:
        <strong>{{ currentEngine?.name || "none loaded" }}</strong>
      </div>
      <div class="jv-chip-card">🗣️ Lang:
        <strong>{{ availableVoices.find((v) => v.id === voice)?.language || "en" }}</strong>
      </div>
      <div class="jv-chip-card">👤 Profile:
        <strong>{{ selectedProfile?.name || "none" }}</strong>
        <select v-model="selectedProfileId" class="generate-view__chip-select">
          <option v-for="o in profileOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="jv-chip-card">🎛️ Effects: <strong>none</strong> <span class="muted">▾</span></div>
      <label
        class="jv-chip-card"
        :class="{ 'jv-chip-card--disabled': !hasPersonality }"
        :title="hasPersonality
          ? 'Re-roll the input through the profile\'s personality prompt via LLM before TTS'
          : 'Pick a profile with a personality prompt to enable persona rewrite'"
      >
        🎭 Persona rewrite
        <input
          type="checkbox"
          v-model="personaRewrite"
          :disabled="!hasPersonality"
        />
      </label>
      <label class="jv-chip-card">
        🔁 Autoplay
        <input type="checkbox" v-model="autoplay" />
      </label>
      <span class="jv-spacer" />
      <JvButton
        variant="ghost"
        size="lg"
        :loading="composeBusy"
        :disabled="composeBusy || !hasPersonality"
        label="🎲 Compose"
        :title="hasPersonality
          ? 'Generate a fresh in-character line via the profile\'s personality prompt'
          : 'Pick a profile that has a personality prompt to enable Compose'"
        @click="composeLine"
      />
      <JvButton
        variant="primary"
        size="lg"
        :loading="busy"
        :disabled="busy || !voice"
        :label="busy ? 'Rendering…' : '▶ Generate'"
        @click="generate"
      />
      <JvButton
        variant="danger-outline"
        size="sm"
        :disabled="!busy"
        label="⏹"
        :title="busy ? 'Stop queued / running render' : 'No render in flight'"
      />
    </div>

    <p v-if="emptyVoiceReason" class="jv-banner jv-banner--warn">
      <template v-if="emptyVoiceReason.kind === 'no-engine'">
        No engine loaded. <a href="#engines">Go to Engines → Load</a>.
      </template>
      <template v-else-if="emptyVoiceReason.kind === 'clone-only'">
        {{ emptyVoiceReason.engine }} is clone-only — <a href="#voices">clone a reference WAV in Voices</a> first.
      </template>
      <template v-else-if="emptyVoiceReason.kind === 'empty-catalog'">
        {{ emptyVoiceReason.engine }} has no voices in the catalog. <a href="#voices">Visit Voices</a> to add one.
      </template>
    </p>

    <audio
      v-if="audio"
      :src="audio"
      :key="audio"
      controls
      class="generate-view__audio"
    />

    <!-- Engine capability indicator — drives which controls render below. -->
    <div class="jv-banner jv-banner--info generate-view__caps">
      Delivery controls below reflect <strong>{{ currentEngine?.name || "the loaded engine" }}</strong>'s capabilities. Switch engine → controls re-render.
      <div class="generate-view__caps-list">
        <span class="jv-pill jv-pill--ghost"><strong>{{ currentEngine?.name || "no engine" }}</strong> · {{ currentEngine ? 'loaded' : 'not loaded' }}</span>
        <span v-if="pitchNative" class="jv-pill jv-pill--green">✓ pitch {{ pitchMin }} → {{ pitchMax }} st (native)</span>
        <span v-else-if="pitchPostProcess" class="jv-pill jv-pill--ghost">pitch via post-process only</span>
        <span v-if="supportsTemperature" class="jv-pill jv-pill--green">✓ temperature</span>
        <span v-if="supportsSeed" class="jv-pill jv-pill--green">✓ seed</span>
        <span v-if="supportsEmotion" class="jv-pill jv-pill--green">✓ {{ EMOTIONS.length }} emotion tags</span>
        <span v-if="supportsParalinguistic" class="jv-pill jv-pill--green">✓ {{ paralinguisticTagSet?.tags?.length || 0 }} {{ paralinguisticTagSet?.category }} tags</span>
        <span v-if="supportsFreeform" class="jv-pill jv-pill--green">✓ free-form delivery</span>
        <span v-else class="jv-pill jv-pill--ghost">✗ free-form delivery (use Qwen3)</span>
        <span v-if="engineCaps.supports_voice_cloning" class="jv-pill jv-pill--green">✓ cloning</span>
        <span v-if="engineCaps.supports_phoneme_input" class="jv-pill jv-pill--green">✓ IPA phoneme input</span>
        <span v-if="engineCaps.supports_multi_speaker" class="jv-pill jv-pill--green">✓ multi-speaker</span>
      </div>
      <div v-if="engineCaps.notes?.length" class="generate-view__caps-notes">
        <p v-for="(n, i) in engineCaps.notes" :key="i" class="jv-muted">{{ n }}</p>
      </div>
    </div>

    <!-- Delivery overlay — paired slider + numeric input. -->
    <div class="jv-section">
      <h3 class="jv-section__title">Delivery overlay</h3>
      <div class="jv-card">
        <div class="generate-view__grid">
          <JvField layout="block">
            <template #label>
              Speed <span class="jv-muted generate-view__label-hint">slider 0.5–2.0×</span>
            </template>
            <div class="generate-view__paired">
              <input type="range" v-model.number="speed" min="0.5" max="2.0" step="0.05" class="generate-view__range" />
              <JvInput v-model.number="speed" type="number" size="sm" class="generate-view__num" />
              <span class="jv-muted">×</span>
            </div>
          </JvField>
          <JvField layout="block">
            <template #label>
              Pitch <span class="jv-muted generate-view__label-hint">slider ±{{ Math.max(Math.abs(pitchMin), Math.abs(pitchMax)) }} st</span>
            </template>
            <div class="generate-view__paired">
              <input type="range" v-model.number="pitch" :min="pitchMin" :max="pitchMax" step="1" class="generate-view__range" :disabled="!pitchNative && !pitchPostProcess" />
              <JvInput v-model.number="pitch" type="number" size="sm" class="generate-view__num" :disabled="!pitchNative && !pitchPostProcess" />
              <span class="jv-muted">st</span>
            </div>
            <span v-if="pitchNative" class="jv-field__hint">Native — engine accepts pitch directly.</span>
            <span v-else-if="pitchPostProcess" class="jv-field__hint">Post-process — applied to output WAV (pedalboard).</span>
            <span v-else class="jv-field__hint">Disabled — no pitch shift available for this engine.</span>
          </JvField>
          <JvField layout="block">
            <template #label>
              Gain <span class="jv-muted generate-view__label-hint">slider ±12 dB</span>
            </template>
            <div class="generate-view__paired">
              <input type="range" v-model.number="gain" min="-24" max="12" step="1" class="generate-view__range" />
              <JvInput v-model.number="gain" type="number" size="sm" class="generate-view__num" />
              <span class="jv-muted">dB</span>
            </div>
          </JvField>
          <JvField layout="block">
            <template #label>
              Temperature <span class="jv-muted generate-view__label-hint">slider 0–1</span>
            </template>
            <div class="generate-view__paired">
              <input type="range" v-model.number="temperature" min="0" max="1" step="0.05" class="generate-view__range" />
              <JvInput v-model.number="temperature" type="number" size="sm" class="generate-view__num" />
            </div>
          </JvField>
          <JvField layout="block">
            <template #label>
              Pause before → after <span class="jv-muted generate-view__label-hint">ms</span>
            </template>
            <div class="generate-view__paired generate-view__paired--pause">
              <JvInput v-model.number="pauseBefore" type="number" size="sm" class="generate-view__pause-num" />
              <span class="jv-muted">→</span>
              <JvInput v-model.number="pauseAfter" type="number" size="sm" class="generate-view__pause-num" />
            </div>
          </JvField>
          <JvField label="Seed" layout="block">
            <div class="generate-view__paired generate-view__paired--seed">
              <JvInput v-model="seed" class="generate-view__seed-input" />
              <JvButton variant="ghost" size="sm" label="🎲 randomize" @click="randomizeSeed" />
            </div>
          </JvField>
        </div>

        <div class="jv-divider" />

        <!-- Emotion is inserted inline via the SlashTagMenu (type `/`
             in the main textarea or click the 🏷️ Insert tag button).
             Engines with a declared emotion taxonomy surface their
             tags through that menu; no per-engine dropdown needed.
             The capability banner above still announces "✓ N emotion
             tags" so users know they're available. -->

        <!-- Capability-gated Delivery direction textarea. Uses the
             same `JvField + #label slot` shape as the Qwen3 example
             below so the eyebrow renders uppercase and the
             enabled/disabled pill sits inline with the label — same
             pattern as `Raw engine knobs (JSON)`. -->
        <JvField layout="block" style="margin-top: 16px">
          <template #label>
            Delivery direction
            <span v-if="!supportsFreeform" class="jv-pill jv-pill--ghost">disabled · requires Qwen3-TTS or LuxTTS</span>
            <span v-else class="jv-pill jv-pill--green">free-form</span>
          </template>
          <JvTextarea
            v-model="instruct"
            :rows="3"
            :disabled="!supportsFreeform"
            :placeholder="deliveryDirectionPlaceholder"
            class="generate-view__delivery-textarea"
          />
          <span class="jv-field__hint" v-if="!supportsFreeform && (supportsEmotion || supportsParalinguistic)">
            {{ currentEngine?.name || "This engine" }} doesn't accept free-form delivery prose.
            Use the
            <strong>🏷️ Insert tag</strong> button (or type <code class="jv-mono">/</code> in the text)
            to add
            <span v-if="supportsEmotion">emotion</span><span v-if="supportsEmotion && supportsParalinguistic"> and </span><span v-if="supportsParalinguistic">{{ paralinguisticTagSet?.category }}</span>
            tags inline instead.
          </span>
        </JvField>

        <!-- Style prompt — Qwen3-specific. Sits under Delivery direction
             because both are about shaping the line's tone. Gated on the
             engine declaring `supports_style_prompt` in its capability
             manifest (only Qwen3 today). -->
        <JvField v-if="supportsStylePrompt" layout="block" style="margin-top: 12px">
          <template #label>
            Style prompt <span class="jv-muted generate-view__label-hint">optional · {{ currentEngine?.name }}-specific</span>
          </template>
          <JvInput
            v-model="stylePrompt"
            placeholder="warm narrative voice, calm tempo"
          />
          <span class="jv-field__hint">
            Short tone/style descriptor for the engine. Different from Delivery direction — the style prompt sets a consistent voice character, the delivery direction shapes THIS line's delivery.
          </span>
        </JvField>

        <!-- Engine-specific knobs — rendered straight from the engine's
             capability manifest (server/justtts/engines/capability_details.py).
             Non-advanced knobs show inline; advanced ones live in the
             collapsible below. Each KnobSpec → paired slider + number.
             Replaces the old "Raw engine knobs (JSON)" textarea — users
             can't be expected to know what JSON keys each engine accepts. -->
        <template v-if="primaryEngineKnobs.length">
          <div class="jv-divider" />
          <h4 class="generate-view__knobs-h">{{ currentEngine?.name || "Engine" }}-specific knobs</h4>
          <div class="generate-view__grid">
            <JvField v-for="k in primaryEngineKnobs" :key="k.key" layout="block">
              <template #label>
                {{ k.label }}
                <span v-if="k.hint" class="jv-muted generate-view__label-hint">{{ k.hint }}</span>
              </template>
              <div class="generate-view__paired">
                <input
                  type="range"
                  v-model.number="knobValues[k.key]"
                  :min="k.min" :max="k.max" :step="k.step"
                  class="generate-view__range"
                />
                <JvInput
                  v-model.number="knobValues[k.key]"
                  type="number" size="sm"
                  class="generate-view__num"
                  :min="k.min" :max="k.max" :step="k.step"
                />
              </div>
            </JvField>
          </div>
        </template>

        <div class="jv-divider" v-if="advancedEngineKnobs.length || primaryEngineKnobs.length" />

        <details v-if="advancedEngineKnobs.length" class="generate-view__advanced">
          <summary>⚙ Show advanced knobs ({{ advancedEngineKnobs.length }})</summary>
          <p class="jv-muted generate-view__advanced-hint">
            Power-user controls for {{ currentEngine?.name }}. Defaults work for most cases — change only if you know what each knob affects.
          </p>
          <div class="generate-view__grid generate-view__grid--advanced">
            <JvField v-for="k in advancedEngineKnobs" :key="k.key" layout="block">
              <template #label>
                {{ k.label }}
                <span v-if="k.hint" class="jv-muted generate-view__label-hint">{{ k.hint }}</span>
              </template>
              <div class="generate-view__paired">
                <input
                  type="range"
                  v-model.number="knobValues[k.key]"
                  :min="k.min" :max="k.max" :step="k.step"
                  class="generate-view__range"
                />
                <JvInput
                  v-model.number="knobValues[k.key]"
                  type="number" size="sm"
                  class="generate-view__num"
                  :min="k.min" :max="k.max" :step="k.step"
                />
              </div>
            </JvField>
          </div>
        </details>

        <div class="jv-divider" />

        <!-- Lexicon preview row — single always-visible shape per UX
             rule "everything visible, disable don't hide". Pill shows
             the attached lexicon name (or "no lexicon attached"); the
             count always renders (0 when nothing attached); the View
             applied entries button is always rendered and disabled when
             count is 0. Personas link sits inline only when nothing is
             attached so the user knows where to wire one up. -->
        <div class="generate-view__lexicon-row">
          <span class="jv-muted">Lexicon preview applies before TTS:</span>
          <span class="jv-pill jv-pill--ghost">{{ attachedLexicon?.name || "no lexicon attached" }}</span>
          <span class="jv-muted">
            {{ appliedLexiconCount }} word replacement{{ appliedLexiconCount === 1 ? "" : "s" }} would apply.
          </span>
          <span v-if="!attachedLexicon" class="jv-muted">
            — attach via <a href="#personas">Personas</a>.
          </span>
          <span class="jv-spacer" />
          <button
            type="button"
            class="jv-btn jv-btn--ghost jv-btn--sm"
            :disabled="!appliedLexiconCount"
            :title="appliedLexiconCount
              ? 'View matches against the current text'
              : (attachedLexicon
                ? 'Type text to see matching entries from this lexicon'
                : 'Attach a lexicon via Personas first')"
            @click="showLexiconPreview = true"
          >View applied entries</button>
        </div>

        <!-- Applied-entries preview modal — client-side match against
             the current textarea text. Same scan logic as the Lexicons
             tab's "▶ Preview against text" button. -->
        <div v-if="showLexiconPreview && attachedLexicon" class="jv-overlay" @click.self="showLexiconPreview = false">
          <div class="jv-modal">
            <header class="jv-modal__header">
              <div class="jv-modal__titleblock">
                <span class="jv-modal__eyebrow">{{ attachedLexicon.name }}</span>
                <h3 class="jv-modal__title">Applied entries · {{ appliedLexiconCount }} replacement{{ appliedLexiconCount === 1 ? "" : "s" }}</h3>
              </div>
              <button type="button" class="jv-modal__close" @click="showLexiconPreview = false">✕</button>
            </header>
            <div class="jv-modal__body">
              <p v-if="!appliedLexiconMatches.length" class="jv-muted">
                None of the lexicon's words appear in the current text. Type a word that's in the lexicon to see it here.
              </p>
              <table v-else class="jv-table">
                <thead>
                  <tr><th>Word</th><th>Pronunciation</th><th>Format</th><th class="right">Count</th></tr>
                </thead>
                <tbody>
                  <tr v-for="m in appliedLexiconMatches" :key="m.word">
                    <td><strong>{{ m.word }}</strong></td>
                    <td><code class="jv-mono">{{ m.replacement }}</code></td>
                    <td>{{ m.notation }}</td>
                    <td class="right">{{ m.count }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <footer class="jv-modal__footer">
              <span class="jv-spacer" />
              <button type="button" class="jv-btn jv-btn--secondary" @click="showLexiconPreview = false">Close</button>
            </footer>
          </div>
        </div>
      </div>
    </div>

    <!-- History — takes, favorites, retry. Pulls from /v1/takes/recent
         (route lands with #87); empty-state until then. Card-wrapped to
         match Overview's "Recent generations" empty-state shape. -->
    <div class="jv-section">
      <h3 class="jv-section__title">History — takes, favorites, retry</h3>
      <div class="jv-card">
        <table v-if="history.length" class="jv-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Voice</th>
              <th>Text preview</th>
              <th>Take</th>
              <th>Effects</th>
              <th class="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in history" :key="h.id">
              <td class="jv-muted">{{ relativeTime(h.when) }}</td>
              <td><strong>{{ h.voice || "—" }}</strong></td>
              <td>{{ h.text }}</td>
              <td>{{ h.take || h.status || "—" }}</td>
              <td>{{ h.effects || "—" }}</td>
              <td class="right">
                <JvButton variant="ghost" size="sm" label="▶" :disabled="!h.audio_url" @click="playTake(h)" />
                <JvButton variant="ghost" size="sm" :label="h.is_favorited ? '★' : '☆'" title="Favorite" />
                <JvButton variant="ghost" size="sm" label="↻" title="Retry" />
                <JvButton variant="ghost" size="sm" label="✕" title="Delete" />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="jv-table__empty">No takes yet. Render something above — recent generations land here.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * GenerateView — layout only. ALL control sizing (input height, button
 * padding, slider rendering, textarea min-height, floating-bar padding,
 * chip-card radius) lives in the global styles.css. This file is the
 * page-specific grid, gaps, and per-field widths that don't belong in
 * a global primitive.
 */

/* No outer padding — `.jv-content` already handles `24px 32px 64px`.
   Adding more here pushes the textarea right of the lede and leaves a
   visible indent step between the two. */
.generate-view { padding: 0; }

/* Main textarea — 140px floor + readable 15px/1.55 typography. */
.generate-view__text {
  font-size: 15px;
  line-height: 1.55;
  min-height: 140px;
  margin-bottom: 8px;
}

/* Persistent SlashTagMenu opener — small ghost button beneath the
   textarea. Discoverability for users who don't know the "/" trigger. */
.generate-view__tag-button {
  margin-bottom: 10px;
}

/* The native <select> next to the strong-text label inside a chip-card.
   We hide the visible width of the select (the chip's strong text shows
   the chosen value) but keep the native dropdown clickable. */
.generate-view__chip-select {
  appearance: none;
  background: transparent;
  border: 0;
  font: inherit;
  color: var(--ink);
  cursor: pointer;
  margin-left: 6px;
  width: 12px;
  overflow: hidden;
}

/* Capability indicator pills row */
.generate-view__caps-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.generate-view__audio { width: 100%; margin-top: 12px; }

/* Delivery overlay paired-control grid — tight row gap, generous
   column gap (matches preview/full-app-preview.html:124 `.field-grid`). */
.generate-view__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 24px;
}

/* Paired slider + numeric input on the same row. */
.generate-view__paired { display: flex; align-items: center; gap: 10px; }
.generate-view__range  { flex: 1; cursor: pointer; }
.generate-view__num    { width: 88px; text-align: right; font-family: var(--font-mono); }

/* In-label hint — the "slider 0.5–2.0×" suffix that sits after the
   field label. The parent label is uppercase + letter-spaced via the
   global .jv-field__label rule; this overrides the case + weight back
   to regular so the hint reads as a quiet annotation rather than a
   second eyebrow. Matches preview L434/442/450/458 muted-span pattern. */
.generate-view__label-hint {
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  font-size: 11px;
}

/* Pause: two narrow boxes + → separator + trailing `ms` label. */
.generate-view__paired--pause { gap: 8px; }
.generate-view__pause-num { width: 88px; text-align: right; font-family: var(--font-mono); }

/* Seed: moderate-width input + randomize button. */
.generate-view__paired--seed { gap: 8px; }
.generate-view__seed-input   { width: 180px; font-family: var(--font-mono); }

/* Advanced details (engine JSON escape hatch) — small uppercase summary. */
.generate-view__advanced > summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-3);
  user-select: none;
  padding: 6px 0;
}
.generate-view__advanced > summary:hover { color: var(--ink); }

/* Subordinate textareas (delivery direction / engine JSON / Qwen3
   example) override the global jv-textarea 96px floor with the
   preview's 60–64px floors. */
.generate-view__delivery-textarea { min-height: 64px; }

/* Engine-specific knobs section header — small uppercase eyebrow,
   same treatment as the global jv-field__label so it lines up with
   the "Speed" / "Temperature" / etc. labels above. */
.generate-view__knobs-h {
  margin: 0 0 12px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.generate-view__advanced-hint {
  font-size: 11.5px;
  margin: 8px 0 14px;
}
.generate-view__grid--advanced { margin-top: 12px; }

.generate-view__lexicon-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11.5px;
}

</style>
