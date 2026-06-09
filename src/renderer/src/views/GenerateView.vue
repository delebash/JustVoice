<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "../services/toastBridge.js";

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
  <section class="block stack">
    <h3>Voice + text</h3>
    <div class="row">
      <label class="grow">
        <span>
          Voice
          <span v-if="currentEngine" class="endnote" style="text-transform: none; font-weight: 400; margin-left: 8px;">
            from <strong style="font-style: normal; color: var(--ink);">{{ currentEngine.name }}</strong>
          </span>
        </span>
        <select v-model="voice" :disabled="availableVoices.length === 0">
          <option v-if="availableVoices.length === 0" value="">— no voices available —</option>
          <option v-for="v in availableVoices" :key="v.id" :value="v.id">{{ v.name }} — {{ v.id }}</option>
        </select>
      </label>
    </div>
    <p v-if="emptyVoiceReason" class="endnote" style="margin-top: 6px;">
      {{ emptyVoiceReason }}
    </p>
    <div style="margin-top: 16px">
      <label>
        <span>Text</span>
        <textarea v-model="text" rows="5" style="width: 100%"></textarea>
      </label>
      <p class="endnote" style="margin-top: 6px">
        Inline tags:
        <span class="mono">[laugh]</span>,
        <span class="mono">[pause:0.5s]</span>,
        <span class="mono">[whisper]…[/whisper]</span>,
        <span class="mono">[speed:0.7]…[/speed]</span>
      </p>
    </div>
    <div class="row" style="margin-top: 16px">
      <button class="primary" :disabled="busy || !voice" @click="generate">
        {{ busy ? "Rendering…" : "Render" }}
      </button>
      <span class="endnote">POST /v1/generate &rarr; audio/wav</span>
    </div>
    <audio v-if="audio" :src="audio" :key="audio" controls style="margin-top: 18px; width: 100%"></audio>
  </section>

  <section class="block stack">
    <h3>Delivery overlay</h3>
    <p class="endnote" style="margin-bottom: 18px">
      All optional. Untouched controls fall through to the voice's defaults. Universal knobs apply to every engine;
      engine-specific knobs (Chatterbox exaggeration, ElevenLabs stability, etc.) go in the JSON box below.
    </p>
    <div class="grid-2">
      <label>
        <span>Speed — {{ speed.toFixed(2) }}×</span>
        <input type="range" v-model.number="speed" min="0.5" max="2.0" step="0.05" />
      </label>
      <label>
        <span>Pitch — {{ pitch > 0 ? "+" : "" }}{{ pitch }} semitones</span>
        <input type="range" v-model.number="pitch" min="-12" max="12" step="1" />
      </label>
      <label>
        <span>Emotion</span>
        <select v-model="emotion">
          <option v-for="e in EMOTIONS" :key="e" :value="e">{{ e || "(none)" }}</option>
        </select>
      </label>
      <label>
        <span>Gain — {{ gain > 0 ? "+" : "" }}{{ gain }} dB</span>
        <input type="range" v-model.number="gain" min="-24" max="12" step="1" />
      </label>
      <label>
        <span>Pause before (ms)</span>
        <input type="number" min="0" max="5000" v-model.number="pauseBefore" />
      </label>
      <label>
        <span>Pause after (ms)</span>
        <input type="number" min="0" max="5000" v-model.number="pauseAfter" />
      </label>
    </div>
    <div style="margin-top: 22px">
      <label>
        <span>Instruct (Qwen3-native; prefix on other engines where supported)</span>
        <input v-model="instruct" placeholder='e.g. "with growing horror, slowly losing composure"' />
      </label>
    </div>
    <div style="margin-top: 22px">
      <label>
        <span>Engine-specific knobs (JSON)</span>
        <textarea
          v-model="engineJson"
          rows="3"
          spellcheck="false"
          placeholder='{"exaggeration": 0.85, "cfg_weight": 0.5, "temperature": 0.9}'></textarea>
      </label>
      <p v-if="engineJsonError" class="errband" style="margin-top: 8px"><span class="lbl">JSON</span>{{ engineJsonError }}</p>
      <p v-else class="endnote" style="margin-top: 6px">
        Chatterbox: exaggeration / cfg_weight / temperature / speed_factor · ElevenLabs: stability / similarity_boost
        · Qwen3 picks up the Instruct field above.
      </p>
    </div>
  </section>
</template>

