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

const voices = ref([]);          // all voices the server returns
const currentEngine = ref(null); // { id, name, capabilities } of the loaded engine, or null
const voice = ref("");
const text = ref("Hello. This is a test render through JustTTS.");
const audio = ref(null);
const busy = ref(false);

// Only show voices belonging to the currently-loaded engine. "Load engine →
// see its voices" is the mental model; voices from unloaded engines aren't
// reachable anyway (the engine subprocess isn't running).
const availableVoices = computed(() => {
  if (!currentEngine.value) return [];
  return voices.value.filter((v) => v.engine === currentEngine.value.id);
});

const emptyVoiceReason = computed(() => {
  if (!currentEngine.value) return "No engine loaded. Go to Engines and click Load on one.";
  const caps = currentEngine.value.capabilities || [];
  const isCloneOnly = caps.includes("voice_cloning") && !caps.includes("preset_voices");
  if (availableVoices.value.length === 0) {
    return isCloneOnly
      ? `${currentEngine.value.name} is clone-only. Go to Voices and clone a reference WAV first.`
      : `${currentEngine.value.name} has no voices in the catalog yet.`;
  }
  return "";
});

const speed = ref(1.0);
const emotion = ref("");
const pitch = ref(0);
const gain = ref(0);
const pauseBefore = ref(0);
const pauseAfter = ref(0);
const instruct = ref("");
const engineJson = ref("");
const engineJsonError = ref("");

const EMOTIONS = ["", "neutral", "happy", "sad", "angry", "fearful", "whispered", "shouted", "sarcastic", "contemptuous"];
const emotionOptions = computed(() => EMOTIONS.map((e) => ({ label: e || "(none)", value: e })));

const voiceOptions = computed(() =>
  availableVoices.value.length === 0
    ? [{ label: "— no voices available —", value: "" }]
    : availableVoices.value.map((v) => ({ label: `${v.name} — ${v.id}`, value: v.id }))
);

const wordCount = computed(() => text.value.trim().split(/\s+/).filter(Boolean).length);

async function refreshVoices() {
  try {
    // Pull voices + the current-engine record in parallel. The voice dropdown
    // filters by current engine, so we need both before the picker is meaningful.
    const [v, cur] = await Promise.all([
      api.request("/v1/voices"),
      api.request("/v1/engines/current").catch(() => ({ engine: null })),
    ]);
    voices.value = v.voices || [];
    currentEngine.value = cur?.engine || null;
    // Reset selected voice if it no longer belongs to the loaded engine
    // (e.g. user switched engines on the Engines tab).
    const stillValid = availableVoices.value.some((x) => x.id === voice.value);
    if (!stillValid) {
      voice.value = availableVoices.value[0]?.id || "";
    }
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
  if (instruct.value.trim()) d.instruct = instruct.value.trim();
  engineJsonError.value = "";
  if (engineJson.value.trim()) {
    try {
      const parsed = JSON.parse(engineJson.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        d.engine = parsed;
      } else {
        engineJsonError.value = "Engine knobs must be a JSON object.";
        return null;
      }
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
  if (audio.value) {
    URL.revokeObjectURL(audio.value);
    audio.value = null;
  }
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
  } catch (e) {
    if (!ctl.signal.aborted) {
      tasks.fail(task.id, String(e.message || e));
      pushToast({ message: `Render failed: ${e.message || e}`, kind: "error", duration: 6000 });
    }
  } finally {
    busy.value = false;
  }
}

onMounted(refreshVoices);
</script>

<template>
  <div class="generate-view">
    <!-- ── Voice + Text ─────────────────────────────────────────────────── -->
    <div class="jv-section">
      <h3 class="jv-section__title">Voice + text</h3>

      <div class="jv-card">
        <JvField label="Voice" layout="block">
          <JvSelect
            v-model="voice"
            :options="voiceOptions"
            :disabled="availableVoices.length === 0"
          />
          <span v-if="currentEngine" class="jv-field__hint">
            from <strong>{{ currentEngine.name }}</strong>
          </span>
          <p v-if="emptyVoiceReason" class="jv-field__hint" style="color: var(--warn-ink)">
            {{ emptyVoiceReason }}
          </p>
        </JvField>

        <div class="jv-divider" />

        <JvField label="Text" layout="block">
          <JvTextarea v-model="text" :rows="5" />
          <span class="jv-field__hint">
            Inline tags:
            <code class="jv-mono">[laugh]</code>,
            <code class="jv-mono">[pause:0.5s]</code>,
            <code class="jv-mono">[whisper]…[/whisper]</code>,
            <code class="jv-mono">[speed:0.7]…[/speed]</code>
          </span>
        </JvField>

        <div class="jv-divider" />

        <div class="jv-floating">
          <JvButton
            variant="primary"
            size="lg"
            :loading="busy"
            :disabled="busy || !voice"
            :label="busy ? 'Rendering…' : 'Render'"
            @click="generate"
          />
          <span class="jv-muted" style="font-size: 12px; font-family: var(--font-mono)">
            POST /v1/generate &rarr; audio/wav
          </span>
          <span class="jv-spacer" />
          <span class="jv-pill jv-pill--ghost jv-mono">{{ wordCount }} words</span>
        </div>

        <audio v-if="audio" :src="audio" :key="audio" controls class="generate-view__audio" />
      </div>
    </div>

    <!-- ── Delivery overlay ───────────────────────────────────────────────── -->
    <div class="jv-section">
      <h3 class="jv-section__title">Delivery overlay</h3>

      <div class="jv-card">
        <p class="jv-muted" style="font-size: 13px; margin-bottom: 18px">
          All optional. Untouched controls fall through to the voice's defaults. Universal knobs apply to every engine;
          engine-specific knobs go in the JSON box below.
        </p>

        <div class="generate-view__grid">
          <JvField :label="`Speed — ${speed.toFixed(2)}×`" layout="block">
            <input type="range" v-model.number="speed" min="0.5" max="2.0" step="0.05" class="generate-view__range" />
          </JvField>
          <JvField :label="`Pitch — ${pitch > 0 ? '+' : ''}${pitch} semitones`" layout="block">
            <input type="range" v-model.number="pitch" min="-12" max="12" step="1" class="generate-view__range" />
          </JvField>
          <JvField label="Emotion" layout="block">
            <JvSelect v-model="emotion" :options="emotionOptions" />
          </JvField>
          <JvField :label="`Gain — ${gain > 0 ? '+' : ''}${gain} dB`" layout="block">
            <input type="range" v-model.number="gain" min="-24" max="12" step="1" class="generate-view__range" />
          </JvField>
          <JvField label="Pause before (ms)" layout="block">
            <JvInput type="number" v-model="pauseBefore" />
          </JvField>
          <JvField label="Pause after (ms)" layout="block">
            <JvInput type="number" v-model="pauseAfter" />
          </JvField>
        </div>

        <div class="jv-divider" />

        <JvField label="Instruct" layout="block" hint="Qwen3-native; prefix on other engines where supported">
          <JvInput v-model="instruct" placeholder='e.g. "with growing horror, slowly losing composure"' />
        </JvField>

        <JvField label="Engine-specific knobs (JSON)" layout="block" style="margin-top: 16px">
          <JvTextarea
            v-model="engineJson"
            :rows="3"
            spellcheck="false"
            placeholder='{"exaggeration": 0.85, "cfg_weight": 0.5, "temperature": 0.9}'
          />
          <div v-if="engineJsonError" class="jv-banner jv-banner--danger" style="margin-top: 8px; margin-bottom: 0">
            {{ engineJsonError }}
          </div>
          <span v-else class="jv-field__hint">
            Chatterbox: exaggeration / cfg_weight / temperature / speed_factor · ElevenLabs: stability / similarity_boost · Qwen3: use Instruct field above.
          </span>
        </JvField>
      </div>
    </div>
  </div>
</template>

<style scoped>
.generate-view {
  padding: 24px 32px 64px;
}

.generate-view__audio {
  width: 100%;
  margin-top: 12px;
}

.generate-view__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.generate-view__range {
  width: 100%;
  accent-color: var(--accent);
  cursor: pointer;
}
</style>
