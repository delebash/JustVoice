<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "../services/toastBridge.js";

const api = useApi();
const tasks = useRenderTasks();

const voices = ref([]);
const currentEngine = ref(null);
const voice = ref("");

// Same "voices belong to loaded engine" model as GenerateView.
const availableVoices = computed(() => {
  if (!currentEngine.value) return [];
  return voices.value.filter((v) => v.engine === currentEngine.value.id);
});
const emptyVoiceReason = computed(() => {
  if (!currentEngine.value) return "No engine loaded. Go to Engines and click Load on one.";
  const caps = currentEngine.value.capabilities || [];
  const cloneOnly = caps.includes("voice_cloning") && !caps.includes("preset_voices");
  if (availableVoices.value.length === 0) {
    return cloneOnly
      ? `${currentEngine.value.name} is clone-only. Clone a reference WAV on the Voices tab first.`
      : `${currentEngine.value.name} has no voices in the catalog yet.`;
  }
  return "";
});
const lines = ref("Once upon a time, in a quiet little town.\nThe wind whispered through the trees.\nAnd then she said, 'follow me.'");
const preset = ref("");
const silenceMs = ref(250);
const audio = ref(null);
const busy = ref(false);

const PRESETS = [
  { id: "", label: "None (raw WAV)" },
  { id: "acx", label: "ACX — Audible/Amazon" },
  { id: "inaudio", label: "INaudio — Findaway / Spotify" },
  { id: "podcast", label: "Podcast" },
  { id: "youtube", label: "YouTube" },
];

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

async function render() {
  busy.value = true;
  if (audio.value) {
    URL.revokeObjectURL(audio.value);
    audio.value = null;
  }
  const ctl = new AbortController();
  const lineArr = lines.value.split("\n").filter((l) => l.trim());
  const wordCount = lineArr.reduce((s, l) => s + l.trim().split(/\s+/).filter(Boolean).length, 0);
  const task = tasks.start({
    label: `Chapter · ${lineArr.length} lines${preset.value ? " · " + preset.value : ""}`,
    kind: "chapter",
    statsFn: (t) => {
      const out = [`${lineArr.length} lines`, `${wordCount} words`];
      if (t.meta?.bytesOut) out.push(`${(t.meta.bytesOut / 1024 / 1024).toFixed(2)} MB`);
      return out;
    },
    onCancel: () => ctl.abort(),
  });
  try {
    const body = {
      lines: lineArr.map((text) => ({ voice: voice.value, text })),
      between_lines: { silence_ms: Number(silenceMs.value) || 0 },
    };
    if (preset.value) body.master = preset.value;
    const blob = await api.request("/v1/render_chapter", {
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
      pushToast({ message: `Chapter render failed: ${e.message || e}`, kind: "error", duration: 6000 });
    }
  } finally {
    busy.value = false;
  }
}

onMounted(refreshVoices);
</script>

<template>
  <section class="block stack">
    <h3>Chapter render</h3>
    <label>
      <span>
        Voice (applied to every line — multi-voice scenes use POST /v1/render_scene)
        <span v-if="currentEngine" class="endnote" style="text-transform: none; font-weight: 400; margin-left: 8px;">
          from <strong style="font-style: normal; color: var(--ink);">{{ currentEngine.name }}</strong>
        </span>
      </span>
      <select v-model="voice" :disabled="availableVoices.length === 0">
        <option v-if="availableVoices.length === 0" value="">— no voices available —</option>
        <option v-for="v in availableVoices" :key="v.id" :value="v.id">{{ v.name }} — {{ v.id }}</option>
      </select>
      <p v-if="emptyVoiceReason" class="endnote" style="margin-top: 6px;">{{ emptyVoiceReason }}</p>
    </label>
    <label>
      <span>Script — one line per row, blank lines ignored</span>
      <textarea v-model="lines" rows="10" style="min-height: 240px;"></textarea>
    </label>
    <div class="grid-2">
      <label>
        <span>Silence between lines (ms)</span>
        <input type="number" v-model.number="silenceMs" min="0" max="5000" />
      </label>
      <label>
        <span>Mastering preset</span>
        <select v-model="preset">
          <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
    </div>
    <div class="row">
      <button class="primary" :disabled="busy || !voice" @click="render">
        {{ busy ? "Rendering chapter…" : "Render chapter" }}
      </button>
      <span class="endnote">POST /v1/render_chapter → audio/wav or audio/mpeg (with mastering)</span>
    </div>
    <audio v-if="audio" :src="audio" :key="audio" controls style="width: 100%"></audio>
  </section>
</template>
