<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import JvField from "../components/jv/JvField.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvTextarea from "../components/jv/JvTextarea.vue";
import JvInput from "../components/jv/JvInput.vue";

const api = useApi();
const tasks = useRenderTasks();

const voices = ref([]);
const currentEngine = ref(null);
const voice = ref("");
const text = ref("Hello. This is a test render through JustVoice.");
const audio = ref(null);
const busy = ref(false);

const availableVoices = computed(() => {
  if (!currentEngine.value) return [];
  return voices.value.filter((v) => v.engine === currentEngine.value.id);
});

const emptyVoiceReason = computed(() => {
  if (!currentEngine.value) return "No engine loaded. Go to Engines → Load.";
  const caps = currentEngine.value.capabilities || [];
  const isCloneOnly = caps.includes("voice_cloning") && !caps.includes("preset_voices");
  if (availableVoices.value.length === 0) {
    return isCloneOnly
      ? `${currentEngine.value.name} is clone-only — clone a reference WAV in Voices first.`
      : `${currentEngine.value.name} has no voices in the catalog.`;
  }
  return "";
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
// TODO (#89): replace with a live capability manifest from
// GET /v1/engines/{id}/capabilities. For now, hardcoded by engine id.
const CAPABILITY = {
  "chatterbox":            { instruct: "structured", emotions: ["neutral","happy","sad","angry","fearful","whispered","shouted","sarcastic","contemptuous","tender"], paralinguistic: ["laugh","sigh","pause","gasp"], pitch: [-12, 12] },
  "chatterbox-turbo":      { instruct: "structured", emotions: ["neutral","happy","sad","angry","fearful","whispered","shouted","sarcastic","contemptuous","tender"], paralinguistic: ["laugh","sigh","pause","gasp"], pitch: [-12, 12] },
  "chatterbox-multilingual":{ instruct: "structured", emotions: ["neutral","happy","sad"],                                              paralinguistic: ["laugh","sigh","pause"],          pitch: [-12, 12] },
  "kokoro":                { instruct: "none",       emotions: null,                                                                  paralinguistic: [],                                pitch: null      },
  "qwen3":                 { instruct: "freeform",   emotions: null,                                                                  paralinguistic: [],                                pitch: [-6, 6]   },
  "luxtts":                { instruct: "freeform",   emotions: null,                                                                  paralinguistic: [],                                pitch: [-6, 6]   },
};

const engineCaps = computed(() => CAPABILITY[currentEngine.value?.id] || CAPABILITY[currentEngine.value?.name?.toLowerCase()] || { instruct: "none", emotions: null, paralinguistic: [], pitch: [-12, 12] });

const supportsEmotion       = computed(() => Array.isArray(engineCaps.value.emotions));
const supportsFreeform      = computed(() => engineCaps.value.instruct === "freeform");
const supportsStructured    = computed(() => engineCaps.value.instruct === "structured");
const supportsParalinguistic= computed(() => engineCaps.value.paralinguistic && engineCaps.value.paralinguistic.length > 0);
const pitchMin              = computed(() => engineCaps.value.pitch?.[0] ?? -12);
const pitchMax              = computed(() => engineCaps.value.pitch?.[1] ?? 12);

const EMOTIONS = computed(() => engineCaps.value.emotions || []);
const emotionOptions = computed(() => [{ label: "(neutral)", value: "" }, ...EMOTIONS.value.map((e) => ({ label: e, value: e }))]);

const voiceOptions = computed(() =>
  availableVoices.value.length === 0
    ? [{ label: "— no voices available —", value: "" }]
    : availableVoices.value.map((v) => ({ label: v.name, value: v.id }))
);

const wordCount = computed(() => text.value.trim().split(/\s+/).filter(Boolean).length);

const paralinguisticHint = computed(() => {
  if (!supportsParalinguistic.value) return "";
  return `Type "/" for paralinguistic tags: ${engineCaps.value.paralinguistic.map((t) => `[${t}]`).join(" ")}`;
});

const deliveryDirectionPlaceholder = computed(() =>
  supportsFreeform.value
    ? 'e.g. "with growing horror, voice gradually quieter, last word almost whispered"'
    : "Disabled — this engine doesn't accept free-form delivery direction."
);

async function refreshVoices() {
  try {
    const [v, cur] = await Promise.all([
      api.request("/v1/voices"),
      api.request("/v1/engines/current").catch(() => ({ engine: null })),
    ]);
    voices.value = v.voices || [];
    currentEngine.value = cur?.engine || null;
    const stillValid = availableVoices.value.some((x) => x.id === voice.value);
    if (!stillValid) voice.value = availableVoices.value[0]?.id || "";
  } catch (_) {}
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

onMounted(refreshVoices);
</script>

<template>
  <div class="generate-view">
    <!-- Main textarea — paralinguistic hint placeholder when supported. -->
    <JvTextarea
      v-model="text"
      :rows="6"
      :placeholder="paralinguisticHint || 'Type the line you want to render…'"
      class="generate-view__text"
    />

    <!-- Floating chip-card bar (matches preview HTML §1 mockup). -->
    <div class="jv-floating generate-view__floating">
      <div class="jv-chip-card">🎙️ Voice:
        <strong>{{ availableVoices.find((v) => v.id === voice)?.name || "—" }}</strong>
        <select v-model="voice" :disabled="availableVoices.length === 0" class="generate-view__chip-select">
          <option v-for="o in voiceOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="jv-chip-card">🧠 Engine:
        <strong>{{ currentEngine?.name || "none loaded" }}</strong>
      </div>
      <div class="jv-chip-card">🎛️ Effects: <strong>none</strong> <span class="muted">▾</span></div>
      <label class="jv-chip-card">
        🎭 Persona rewrite
        <input type="checkbox" v-model="personaRewrite" />
      </label>
      <label class="jv-chip-card">
        🔁 Autoplay
        <input type="checkbox" v-model="autoplay" />
      </label>
      <span class="jv-spacer" />
      <JvButton
        variant="primary"
        size="lg"
        :loading="busy"
        :disabled="busy || !voice"
        :label="busy ? 'Rendering…' : '▶ Generate'"
        @click="generate"
      />
    </div>

    <p v-if="emptyVoiceReason" class="jv-banner jv-banner--warn">{{ emptyVoiceReason }}</p>

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
        <span v-if="pitchMin !== null && pitchMax !== null" class="jv-pill jv-pill--green">✓ pitch {{ pitchMin }} → {{ pitchMax }} st</span>
        <span v-if="supportsEmotion" class="jv-pill jv-pill--green">✓ {{ EMOTIONS.length }} discrete emotions</span>
        <span v-else class="jv-pill jv-pill--ghost">✗ discrete emotions</span>
        <span v-if="supportsFreeform" class="jv-pill jv-pill--green">✓ free-form delivery direction</span>
        <span v-else class="jv-pill jv-pill--ghost">✗ free-form delivery</span>
        <span v-if="supportsParalinguistic" class="jv-pill jv-pill--green">✓ paralinguistic tags ({{ engineCaps.paralinguistic.length }})</span>
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
              <input type="range" v-model.number="pitch" :min="pitchMin" :max="pitchMax" step="1" class="generate-view__range" :disabled="engineCaps.pitch === null" />
              <JvInput v-model.number="pitch" type="number" size="sm" class="generate-view__num" :disabled="engineCaps.pitch === null" />
            </div>
            <span v-if="engineCaps.pitch === null" class="jv-field__hint">Disabled — this engine doesn't accept pitch shift.</span>
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

        <!-- Capability-gated Emotion dropdown. -->
        <JvField v-if="supportsEmotion" label="Emotion" layout="block">
          <JvSelect v-model="emotion" :options="emotionOptions" />
          <span class="jv-field__hint">Dropdown because {{ currentEngine?.name }} accepts a fixed enum. Values outside the list get ignored.</span>
        </JvField>

        <!-- Capability-gated Delivery direction textarea. -->
        <JvField label="Delivery direction" layout="block" style="margin-top: 16px">
          <JvTextarea
            v-model="instruct"
            :rows="3"
            :disabled="!supportsFreeform"
            :placeholder="deliveryDirectionPlaceholder"
          />
          <span class="jv-field__hint" v-if="!supportsFreeform">
            <span v-if="supportsEmotion">Use the Emotion dropdown above</span><span v-if="supportsEmotion && supportsParalinguistic">; </span><span v-if="supportsParalinguistic">embed paralinguistic tags ({{ engineCaps.paralinguistic.map(t => `[${t}]`).join(", ") }}) in the main text</span>.
          </span>
        </JvField>

        <div class="jv-divider" />

        <details class="generate-view__advanced">
          <summary>⚙ Show engine-specific JSON (advanced)</summary>
          <JvField label="Raw engine knobs (JSON)" layout="block" style="margin-top: 12px">
            <JvTextarea
              v-model="engineJson"
              :rows="3"
              spellcheck="false"
              placeholder='{"exaggeration": 1.2, "cfg_weight": 0.5}'
            />
            <div v-if="engineJsonError" class="jv-banner jv-banner--danger" style="margin-top: 8px; margin-bottom: 0">{{ engineJsonError }}</div>
            <span v-else class="jv-field__hint">
              Merged with the form values above. Form wins on key conflict. Most users never open this.
            </span>
          </JvField>
        </details>
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
</style>
