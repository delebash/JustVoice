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
  { label: "None (raw WAV)", value: "" },
  { label: "ACX — Audible/Amazon", value: "acx" },
  { label: "INaudio — Findaway / Spotify", value: "inaudio" },
  { label: "Podcast", value: "podcast" },
  { label: "YouTube", value: "youtube" },
];

const voiceOptions = computed(() =>
  availableVoices.value.length === 0
    ? [{ label: "— no voices available —", value: "" }]
    : availableVoices.value.map((v) => ({ label: `${v.name} — ${v.id}`, value: v.id }))
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
  <div class="chapter-view">
    <div class="jv-section">
      <h3 class="jv-section__title">Chapter render</h3>

      <div class="jv-card">
        <JvField label="Voice" layout="block">
          <template #default>
            <JvSelect v-model="voice" :options="voiceOptions" :disabled="availableVoices.length === 0" />
            <span v-if="currentEngine" class="jv-field__hint">
              from <strong>{{ currentEngine.name }}</strong>
            </span>
            <p v-if="emptyVoiceReason" class="jv-field__hint" style="color: var(--warn-ink)">{{ emptyVoiceReason }}</p>
          </template>
        </JvField>

        <div class="jv-divider" />

        <JvField label="Script" layout="block" hint="One line per row — blank lines are ignored">
          <JvTextarea v-model="lines" :rows="10" style="min-height: 240px" />
        </JvField>

        <div class="chapter-view__grid">
          <JvField label="Silence between lines (ms)" layout="block">
            <JvInput type="number" v-model="silenceMs" />
          </JvField>
          <JvField label="Mastering preset" layout="block">
            <JvSelect v-model="preset" :options="PRESETS" />
          </JvField>
        </div>

        <div class="jv-divider" />

        <div class="jv-floating">
          <JvButton
            variant="primary"
            size="lg"
            :loading="busy"
            :disabled="busy || !voice"
            :label="busy ? 'Rendering chapter…' : 'Render chapter'"
            @click="render"
          />
          <span class="jv-muted" style="font-size: 12px; font-family: var(--font-mono)">
            POST /v1/render_chapter → audio/wav
          </span>
          <span v-if="audio" class="jv-pill jv-pill--green">Ready</span>
        </div>

        <audio v-if="audio" :src="audio" :key="audio" controls class="chapter-view__audio" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chapter-view {
  padding: 24px 32px 64px;
}

.chapter-view__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
}

.chapter-view__audio {
  width: 100%;
  margin-top: 12px;
}
</style>
