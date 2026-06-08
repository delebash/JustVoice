<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "../services/toastBridge.js";

const api = useApi();
const tasks = useRenderTasks();

const voices = ref([]);
const voice = ref("");
const text = ref("Hello. This is a test render through JustTTS.");
const audio = ref(null);
const busy = ref(false);

// Delivery
const speed = ref(1.0);
const emotion = ref("");
const pitch = ref(0);
const gain = ref(0);
const instruct = ref("");

const EMOTIONS = ["", "neutral", "happy", "sad", "angry", "fearful", "whispered", "shouted", "sarcastic", "contemptuous"];

const wordCount = computed(() => text.value.trim().split(/\s+/).filter(Boolean).length);

async function refreshVoices() {
  try {
    const v = await api.request("/v1/voices");
    voices.value = v.voices;
    if (!voice.value && voices.value.length) voice.value = voices.value[0].id;
  } catch (_) {}
}

function buildDelivery() {
  const d = {};
  if (Math.abs(speed.value - 1.0) > 0.001) d.speed = speed.value;
  if (emotion.value) d.emotion = emotion.value;
  if (Math.abs(pitch.value) > 0.001) d.pitch = pitch.value;
  if (Math.abs(gain.value) > 0.001) d.gain_db = gain.value;
  if (instruct.value.trim()) d.instruct = instruct.value.trim();
  return Object.keys(d).length ? d : undefined;
}

async function generate() {
  if (!voice.value) {
    pushToast({ message: "Pick a voice first", kind: "error" });
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
    const delivery = buildDelivery();
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
  <section class="block">
    <h3>Voice + text</h3>
    <div class="row">
      <label class="grow">
        <span>Voice</span>
        <select v-model="voice">
          <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name }} — {{ v.id }}</option>
        </select>
      </label>
    </div>
    <div style="margin-top: 12px">
      <label>
        <span>Text</span>
        <textarea v-model="text" rows="4" style="width: 100%"></textarea>
      </label>
    </div>
    <div class="row" style="margin-top: 12px">
      <button class="primary" :disabled="busy || !voice" @click="generate">
        {{ busy ? "Rendering…" : "Render" }}
      </button>
      <span class="endnote">POST /v1/generate &rarr; audio/wav</span>
    </div>
    <audio v-if="audio" :src="audio" :key="audio" controls style="margin-top: 16px; width: 100%"></audio>
  </section>

  <section class="block">
    <h3>Delivery overlay</h3>
    <div class="row" style="gap: 24px; flex-wrap: wrap">
      <label>
        <span>Speed ({{ speed.toFixed(2) }})</span>
        <input type="range" v-model.number="speed" min="0.25" max="4.0" step="0.05" />
      </label>
      <label>
        <span>Pitch ({{ pitch }} st)</span>
        <input type="range" v-model.number="pitch" min="-12" max="12" step="0.5" />
      </label>
      <label>
        <span>Gain ({{ gain.toFixed(1) }} dB)</span>
        <input type="range" v-model.number="gain" min="-24" max="12" step="0.5" />
      </label>
      <label>
        <span>Emotion</span>
        <select v-model="emotion">
          <option v-for="e in EMOTIONS" :key="e" :value="e">{{ e || "(none)" }}</option>
        </select>
      </label>
    </div>
    <div style="margin-top: 12px">
      <label>
        <span>Instruct (Qwen3-native)</span>
        <input v-model="instruct" placeholder='e.g. "with growing horror, slowly losing composure"' />
      </label>
    </div>
  </section>
</template>

<style scoped>
.row { display: flex; gap: 12px; align-items: center; }
.row > label.grow { flex: 1; }
label > span { display: block; font-size: 11px; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
input, select, textarea { width: 100%; padding: 6px 10px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--ink); font-size: 13px; }
</style>
