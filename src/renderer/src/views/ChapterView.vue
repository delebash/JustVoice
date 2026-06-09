<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "../services/toastBridge.js";
import { useCopy } from "../services/copy.js";

const copy = useCopy();

const api = useApi();
const tasks = useRenderTasks();

const voices = ref([]);
const voice = ref("");
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
  const v = await api.request("/v1/voices");
  voices.value = v.voices;
  if (!voice.value && voices.value.length) voice.value = voices.value[0].id;
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
  <section class="block">
    <h3>{{ copy.chapter.singular }} render</h3>
    <p class="endnote" v-if="!voices.length">No voices yet — install an engine to register your first {{ copy.cast.singular.toLowerCase() }} before rendering a {{ copy.chapter.singular.toLowerCase() }}.</p>
    <div class="row">
      <label class="grow">
        <span>Voice</span>
        <select v-model="voice">
          <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name }} — {{ v.id }}</option>
        </select>
      </label>
      <label>
        <span>Mastering preset</span>
        <select v-model="preset">
          <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <label>
        <span>Silence between lines (ms)</span>
        <input type="number" v-model.number="silenceMs" min="0" max="5000" />
      </label>
    </div>
    <div style="margin-top: 12px">
      <label>
        <span>{{ copy.line.plural }} (one per row)</span>
        <textarea v-model="lines" rows="10"></textarea>
      </label>
    </div>
    <div class="row" style="margin-top: 12px">
      <button class="primary" :disabled="busy || !voice" @click="render">
        {{ busy ? `Rendering ${copy.chapter.singular.toLowerCase()}…` : `Render ${copy.chapter.singular.toLowerCase()}` }}
      </button>
      <span class="endnote">POST /v1/render_chapter</span>
    </div>
    <audio v-if="audio" :src="audio" :key="audio" controls style="margin-top: 16px; width: 100%"></audio>
  </section>
</template>

<style scoped>
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.row > label.grow { flex: 1; min-width: 240px; }
label > span { display: block; font-size: 11px; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
input, select, textarea { width: 100%; padding: 6px 10px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--ink); font-size: 13px; font-family: var(--font-sans); }
</style>
