<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { useAudioPlayer } from "../stores/audioPlayer.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import JvField from "../components/jv/JvField.vue";
import JvSelect from "../components/jv/JvSelect.vue";
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
// Voice profiles — voicebox-parity profile selection layer on top of
// the voice-keyed generate flow. Profile selection enables Compose +
// per-profile effects_chain pre-fill + persona-rewrite gating.
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
const emotion = ref("");
const pitch = ref(0);
const gain = ref(0);
const pauseBefore = ref(0);
const pauseAfter = ref(0);
const temperature = ref(0.7);
const seed = ref("random");
const instruct = ref("");
const engineJson = ref("");
const engineJsonError = ref("");
const autoplay = ref(true);
const personaRewrite = ref(false);

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

const EMOTIONS = computed(() => emotionTagSet.value?.tags || []);
const emotionOptions = computed(() => [{ label: "(neutral)", value: "" }, ...EMOTIONS.value.map((e) => ({ label: e, value: e }))]);

const voiceOptions = computed(() =>
  availableVoices.value.length === 0
    ? [{ label: "— no voices available —", value: "" }]
    : availableVoices.value.map((v) => ({ label: v.name, value: v.id }))
);

const wordCount = computed(() => text.value.trim().split(/\s+/).filter(Boolean).length);

// Multi-line placeholder hint shown when the textarea is empty.
// Matches the preview HTML's poetic example + paralinguistic tag hint
// when the engine supports inline tags. Renders engine-specific syntax
// (Higgs uses `<|sfx:laughter|>`, Turbo uses `[laugh]`, Dia uses `(laughs)`).
const paralinguisticHint = computed(() => {
  const intro = "Once upon a midnight dreary, while I pondered weak and weary…";
  const set = paralinguisticTagSet.value;
  if (!set || !set.tags?.length) return intro;
  const syntax = set.syntax || "[{value}]";
  const sample = set.tags.slice(0, 4).map((t) => syntax.replace("{value}", t)).join(" ");
  return `${intro}\n\nType "/" for tags: ${sample}`;
});

const deliveryDirectionPlaceholder = computed(() =>
  supportsFreeform.value
    ? 'e.g. "with growing horror, voice gradually quieter, last word almost whispered"'
    : "Disabled — this engine doesn't accept free-form delivery direction."
);

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
  if (emotion.value) d.emotion = emotion.value;
  if (Math.abs(pitch.value) > 0.001) d.pitch = pitch.value;
  if (Math.abs(gain.value) > 0.001) d.gain_db = gain.value;
  if (pauseBefore.value > 0) d.pause_before = pauseBefore.value;
  if (pauseAfter.value > 0) d.pause_after = pauseAfter.value;
  if (Math.abs(temperature.value - 0.7) > 0.001) d.temperature = temperature.value;
  if (seed.value && seed.value !== "random") d.seed = Number(seed.value) || seed.value;
  if (instruct.value.trim()) d.instruct = instruct.value.trim();
  engineJsonError.value = "";
  if (engineJson.value.trim()) {
    try {
      const parsed = JSON.parse(engineJson.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) d.engine = parsed;
      else { engineJsonError.value = "Engine knobs must be a JSON object."; return null; }
    } catch (e) {
      engineJsonError.value = `Invalid JSON: ${e.message}`;
      return null;
    }
  }
  return Object.keys(d).length ? d : undefined;
}

async function generate() {
  if (!voice.value) {
    pushToast({ message: "Pick a voice first", kind: "error" });
    return;
  }
  const delivery = buildDelivery();
  if (engineJsonError.value) {
    pushToast({ message: engineJsonError.value, kind: "error" });
    return;
  }
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
  });
  try {
    const body = { voice: voice.value, text: text.value, cache: false };
    if (delivery) body.delivery = delivery;
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

// Format an ISO timestamp as a short relative-time string. Mirrors
// voicebox's HistoryTable cell shape ("just now", "12m", "2h", "3d").
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
// whose placement rule is "start_of_turn", per Higgs's emotion/style/
// prosody placement constraint).
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
    // Drop at position 0 — Higgs's emotion/style/prosody constraint.
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
      <div class="jv-chip-card">🎭 Profile:
        <strong>{{ selectedProfile?.name || "none" }}</strong>
        <select v-model="selectedProfileId" class="generate-view__chip-select">
          <option v-for="o in profileOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="jv-chip-card">🎛️ Effects: <strong>none</strong> <span class="muted">▾</span></div>
      <label class="jv-chip-card" v-if="hasPersonality">
        🎭 Persona rewrite
        <input type="checkbox" v-model="personaRewrite" />
      </label>
      <label class="jv-chip-card">
        🔁 Autoplay
        <input type="checkbox" v-model="autoplay" />
      </label>
      <span class="jv-spacer" />
      <JvButton
        v-if="hasPersonality"
        variant="ghost"
        size="lg"
        :loading="composeBusy"
        :disabled="composeBusy"
        label="🎲 Compose"
        title="Generate a fresh in-character line via the profile's personality prompt"
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
        v-if="busy"
        variant="danger-outline"
        size="sm"
        label="⏹"
        title="Stop queued / running"
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
          <JvField :label="`Speed — ${speed.toFixed(2)}×`" layout="block">
            <div class="generate-view__paired">
              <input type="range" v-model.number="speed" min="0.5" max="2.0" step="0.05" class="generate-view__range" />
              <JvInput v-model.number="speed" type="number" size="sm" class="generate-view__num" />
            </div>
          </JvField>
          <JvField :label="`Temperature — ${temperature.toFixed(2)}`" layout="block">
            <div class="generate-view__paired">
              <input type="range" v-model.number="temperature" min="0" max="1" step="0.05" class="generate-view__range" />
              <JvInput v-model.number="temperature" type="number" size="sm" class="generate-view__num" />
            </div>
          </JvField>
          <JvField :label="`Pitch — ${pitch > 0 ? '+' : ''}${pitch} st`" layout="block">
            <div class="generate-view__paired">
              <input type="range" v-model.number="pitch" :min="pitchMin" :max="pitchMax" step="1" class="generate-view__range" :disabled="!pitchNative && !pitchPostProcess" />
              <JvInput v-model.number="pitch" type="number" size="sm" class="generate-view__num" :disabled="!pitchNative && !pitchPostProcess" />
            </div>
            <span v-if="pitchNative" class="jv-field__hint">Native — engine accepts pitch directly.</span>
            <span v-else-if="pitchPostProcess" class="jv-field__hint">Post-process — applied to output WAV (pedalboard).</span>
            <span v-else class="jv-field__hint">Disabled — no pitch shift available for this engine.</span>
          </JvField>
          <JvField :label="`Gain — ${gain > 0 ? '+' : ''}${gain} dB`" layout="block">
            <div class="generate-view__paired">
              <input type="range" v-model.number="gain" min="-24" max="12" step="1" class="generate-view__range" />
              <JvInput v-model.number="gain" type="number" size="sm" class="generate-view__num" />
            </div>
          </JvField>
          <JvField label="Pause before / after (ms)" layout="block">
            <div class="generate-view__paired">
              <JvInput v-model.number="pauseBefore" type="number" size="sm" />
              <span class="jv-muted">→</span>
              <JvInput v-model.number="pauseAfter" type="number" size="sm" />
            </div>
          </JvField>
          <JvField label="Seed" layout="block">
            <div class="generate-view__paired">
              <JvInput v-model="seed" />
              <JvButton variant="ghost" size="sm" label="🎲" @click="randomizeSeed" />
            </div>
          </JvField>
        </div>

        <div class="jv-divider" />

        <!-- Capability-gated Emotion dropdown — only shows for engines
             that declare an emotion inline-tag taxonomy (Higgs's 21). -->
        <JvField v-if="supportsEmotion" label="Emotion" layout="block">
          <JvSelect v-model="emotion" :options="emotionOptions" />
          <span class="jv-field__hint">
            {{ EMOTIONS.length }} {{ currentEngine?.name }} emotions.
            <template v-if="emotionTagSet?.placement === 'start_of_turn'">
              Inserted at the start of the line — shapes the whole turn.
            </template>
          </span>
        </JvField>

        <!-- Capability-gated Delivery direction textarea. -->
        <div class="generate-view__delivery-direction">
          <div class="generate-view__delivery-label">
            <label class="jv-field__label">Delivery direction</label>
            <span v-if="!supportsFreeform" class="jv-pill jv-pill--ghost">disabled · requires Qwen3-TTS or LuxTTS</span>
            <span v-else class="jv-pill jv-pill--green">free-form</span>
          </div>
          <JvTextarea
            v-model="instruct"
            :rows="3"
            :disabled="!supportsFreeform"
            :placeholder="deliveryDirectionPlaceholder"
          />
          <span class="jv-field__hint" v-if="!supportsFreeform">
            {{ currentEngine?.name || "This engine" }} doesn't accept free-form delivery prose.
            <span v-if="supportsEmotion">Use the Emotion dropdown above</span><span v-if="supportsEmotion && supportsParalinguistic"> and </span><span v-if="supportsParalinguistic">embed {{ paralinguisticTagSet?.category }} tags in the main text</span>.
          </span>
        </div>

        <div class="jv-divider" />

        <details class="generate-view__advanced">
          <summary>⚙ Show engine-specific JSON (advanced)</summary>
          <JvField label="Raw engine knobs (JSON)" layout="block" style="margin-top: 12px">
            <JvTextarea
              v-model="engineJson"
              :rows="3"
              spellcheck="false"
              placeholder='{ "emotion_strength": 0.7, "exaggeration": 1.2, "cfg_weight": 0.5 }'
            />
            <div v-if="engineJsonError" class="jv-banner jv-banner--danger" style="margin-top: 8px; margin-bottom: 0">{{ engineJsonError }}</div>
            <span v-else class="jv-field__hint">
              Merged with the form values above. Form wins on key conflict. Most users never open this.
            </span>
          </JvField>
        </details>

        <div class="jv-divider" />

        <!-- Lexicon preview row — shows which pronunciation dictionaries are
             attached and would apply before TTS. Stubbed for now until the
             Personas tab is wired to attach lexicons to voices. -->
        <div class="generate-view__lexicon-row">
          <span class="jv-muted">Lexicon preview applies before TTS:</span>
          <span class="jv-pill jv-pill--ghost">no lexicon attached</span>
          <span class="jv-muted">— attach via <a href="#personas">Personas</a> or pass <code class="jv-mono">lexicons: ["lex_id"]</code> in the API.</span>
        </div>
      </div>
    </div>

    <!-- Capability example — what the same panel would look like with a
         different engine. Educational: explains why the controls above
         re-render when you switch engines. Hidden on engines that already
         match the example (qwen3 / luxtts). -->
    <div v-if="currentEngine?.id !== 'qwen3' && currentEngine?.id !== 'luxtts'" class="jv-section">
      <h3 class="jv-section__title">What this panel would look like with <em>Qwen3-TTS</em> instead</h3>
      <div class="jv-card jv-card--soft">
        <p class="jv-muted" style="font-size: 12px; margin: 0 0 12px">
          Engine swap → Delivery direction textarea becomes the primary control. Emotion dropdown is hidden (Qwen3 doesn't have a discrete enum). Pitch range narrows to ±6 st per the engine's capability manifest.
        </p>
        <JvField layout="block">
          <template #label>
            Delivery direction
            <span class="jv-pill jv-pill--green">free-form</span>
          </template>
          <JvTextarea
            :rows="3"
            disabled
            placeholder="with growing horror, voice gradually quieter, last word almost whispered"
          />
          <span class="jv-field__hint">Plain language. The model interprets the prose directly. This is what voicebox / Qwen3 / LuxTTS expect.</span>
        </JvField>
        <JvField label="Style prompt (optional, Qwen3-specific)" layout="block" style="margin-top: 12px">
          <JvInput disabled placeholder="warm narrative voice, calm tempo" />
        </JvField>
        <div class="generate-view__manifest">
          <span class="jv-muted">Capability manifest from server:</span>
          <code class="jv-mono">{ instruct: "freeform", emotions: null, style_prompt: true, pitch_range: [-6, 6], paralinguistic: [] }</code>
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
.generate-view {
  padding: 24px 32px 64px;
}

.generate-view__text {
  font-size: 15px;
  line-height: 1.55;
  min-height: 140px;
  margin-bottom: 14px;
}

.generate-view__floating {
  margin: 14px 0;
}

.generate-view__chip-select {
  appearance: none;
  background: transparent;
  border: 0;
  font-family: inherit;
  font-size: inherit;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  margin-left: 6px;
  width: 12px;          /* hide the native arrow + label; the strong text shows the value */
  overflow: hidden;
}

.generate-view__caps {
  margin: 16px 0 6px;
}
.generate-view__caps-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.generate-view__audio {
  width: 100%;
  margin-top: 12px;
}

.generate-view__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px 28px;
}

.generate-view__paired {
  display: flex;
  align-items: center;
  gap: 10px;
}
.generate-view__range {
  flex: 1;
  accent-color: var(--accent);
  cursor: pointer;
}
.generate-view__num {
  width: 96px;
  text-align: right;
  font-family: var(--font-mono);
}

.generate-view__advanced {
  margin-top: 4px;
}
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

.generate-view__delivery-direction { margin-top: 16px; }
.generate-view__delivery-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.generate-view__delivery-label .jv-field__label { margin: 0; }

.generate-view__lexicon-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11.5px;
}
.generate-view__lexicon-row code { font-size: 11px; }

.generate-view__manifest {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  font-size: 11px;
}
.generate-view__manifest code {
  background: var(--surface-3);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10.5px;
}
</style>
