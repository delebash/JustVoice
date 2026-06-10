<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, computed, onBeforeUnmount } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvField from "../components/jv/JvField.vue";

const api = useApi();

const analyzeFile = ref(null);
const analyzeBusy = ref(false);
const analysis = ref(null);

const masterFile = ref(null);
const masterBusy = ref(false);
const masterPreset = ref("acx");
const masterTitle = ref("");
const masterAuthor = ref("");
const masterBook = ref("");
const masteredUrl = ref("");
const masteredMime = ref("");
const masteredBytes = ref(0);
const masteredName = ref("");

const PRESETS = [
  { id: "acx", label: "ACX (audiobook · MP3)" },
  { id: "inaudio", label: "INaudio (audiobook · MP3)" },
  { id: "podcast", label: "Podcast (MP3)" },
  { id: "youtube", label: "YouTube (AAC/M4A)" },
];

const PRESET_OPTIONS = PRESETS.map((p) => ({ label: p.label, value: p.id }));

const masterExt = computed(() => (masterPreset.value === "youtube" ? "m4a" : "mp3"));

async function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function runAnalyze() {
  if (!analyzeFile.value) return;
  analyzeBusy.value = true;
  analysis.value = null;
  try {
    const b64 = await readAsBase64(analyzeFile.value);
    analysis.value = await api.request("/v1/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wav_b64: b64 }),
    });
  } catch (e) {
    pushToast({ message: `Analyze failed: ${e.message || e}`, kind: "error" });
  } finally {
    analyzeBusy.value = false;
  }
}

function revokeMastered() {
  if (masteredUrl.value) {
    URL.revokeObjectURL(masteredUrl.value);
    masteredUrl.value = "";
  }
}

async function runMaster() {
  if (!masterFile.value) return;
  masterBusy.value = true;
  revokeMastered();
  try {
    const b64 = await readAsBase64(masterFile.value);
    const blob = await api.request("/v1/master", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wav_b64: b64,
        preset: masterPreset.value,
        title: masterTitle.value || null,
        author: masterAuthor.value || null,
        book: masterBook.value || null,
      }),
    });
    masteredUrl.value = URL.createObjectURL(blob);
    masteredMime.value = blob.type || "application/octet-stream";
    masteredBytes.value = blob.size;
    const base = (masterFile.value.name || "track").replace(/\.[^.]+$/, "");
    masteredName.value = `${base}.${masterPreset.value}.${masterExt.value}`;
  } catch (e) {
    pushToast({ message: `Master failed: ${e.message || e}`, kind: "error" });
  } finally {
    masterBusy.value = false;
  }
}

function downloadMastered() {
  if (!masteredUrl.value) return;
  const a = document.createElement("a");
  a.href = masteredUrl.value;
  a.download = masteredName.value;
  a.click();
}

function fmtDb(n) {
  if (n === null || n === undefined) return "—";
  if (!isFinite(n)) return n > 0 ? "∞" : "−∞";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + " dB";
}

function fmtKB(n) {
  return (n / 1024).toFixed(1) + " KB";
}

function fmtPct(n) {
  if (n === null || n === undefined) return "—";
  return (n * 100).toFixed(2) + "%";
}

onBeforeUnmount(revokeMastered);
</script>

<template>
  <div class="audio-tools-view">
    <!-- ── Analyze ── -->
    <section class="jv-card jv-section">
      <h3 class="jv-section__title">Analyze a WAV</h3>
      <p class="jv-muted" style="margin-bottom: 16px;">
        Drop a 16-bit PCM WAV. Reports format, duration, loudness (peak/RMS/crest), silence ratio,
        clipping ratio, and a SHA-256 fingerprint.
      </p>

      <JvField label="WAV file" layout="block">
        <input
          type="file"
          accept="audio/wav,.wav"
          class="file-input"
          @change="analyzeFile = $event.target.files[0]"
        />
      </JvField>

      <div class="jv-row" style="margin-top: 12px; align-items: center;">
        <JvButton variant="primary" :disabled="analyzeBusy || !analyzeFile" :loading="analyzeBusy" @click="runAnalyze">
          {{ analyzeBusy ? "Analyzing…" : "Analyze" }}
        </JvButton>
        <span class="jv-mono jv-muted">POST /v1/analyze</span>
      </div>

      <div v-if="analysis" style="margin-top: 16px;">
        <table class="jv-table">
          <tbody>
            <tr>
              <td><span class="jv-muted">SHA-256</span></td>
              <td colspan="3" class="jv-mono">{{ analysis.sha256 }}</td>
            </tr>
            <tr>
              <td><span class="jv-muted">File size</span></td>
              <td>{{ fmtKB(analysis.file_size_bytes) }}</td>
              <td><span class="jv-muted">Duration</span></td>
              <td>{{ analysis.format.duration_sec.toFixed(3) }} s</td>
            </tr>
            <tr>
              <td><span class="jv-muted">Sample rate</span></td>
              <td>{{ analysis.format.sample_rate }} Hz</td>
              <td><span class="jv-muted">Channels</span></td>
              <td>{{ analysis.format.channels }}</td>
            </tr>
            <tr>
              <td><span class="jv-muted">Bit depth</span></td>
              <td>{{ analysis.format.bits_per_sample }}-bit</td>
              <td><span class="jv-muted">Samples</span></td>
              <td>{{ analysis.format.sample_count.toLocaleString() }}</td>
            </tr>
            <tr>
              <td><span class="jv-muted">Peak</span></td>
              <td>{{ fmtDb(analysis.loudness.peak_dbfs) }}</td>
              <td><span class="jv-muted">RMS</span></td>
              <td>{{ fmtDb(analysis.loudness.rms_dbfs) }}</td>
            </tr>
            <tr>
              <td><span class="jv-muted">Crest factor</span></td>
              <td>{{ fmtDb(analysis.loudness.crest_factor_db) }}</td>
              <td><span class="jv-muted">Silence ratio</span></td>
              <td>{{ fmtPct(analysis.loudness.silence_ratio) }}</td>
            </tr>
            <tr>
              <td><span class="jv-muted">Clipping ratio</span></td>
              <td colspan="3">{{ fmtPct(analysis.loudness.clipping_ratio) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Master ── -->
    <section class="jv-card jv-section">
      <h3 class="jv-section__title">Apply a mastering preset</h3>
      <p class="jv-muted" style="margin-bottom: 16px;">
        Upload a WAV, pick a preset, get a mastered MP3/M4A back. Requires ffmpeg on the server. ACX
        targets audiobook spec (−23 LUFS, −3 dBTP, head/tail silence). YouTube outputs AAC.
      </p>

      <div class="master-grid">
        <JvField label="WAV file" layout="block">
          <input
            type="file"
            accept="audio/wav,.wav"
            class="file-input"
            @change="masterFile = $event.target.files[0]"
          />
        </JvField>

        <JvField label="Preset" layout="block">
          <JvSelect v-model="masterPreset" :options="PRESET_OPTIONS" width="name" />
        </JvField>

        <JvField label="Title (optional)" layout="block">
          <JvInput type="text" v-model="masterTitle" placeholder="Chapter 1" width="name" />
        </JvField>

        <JvField label="Author (optional)" layout="block">
          <JvInput type="text" v-model="masterAuthor" placeholder="Author name" width="name" />
        </JvField>

        <JvField label="Book / album (optional)" layout="block" style="grid-column: 1 / -1;">
          <JvInput type="text" v-model="masterBook" placeholder="Book title" width="name" />
        </JvField>
      </div>

      <div class="jv-row" style="margin-top: 12px; align-items: center;">
        <JvButton variant="primary" :disabled="masterBusy || !masterFile" :loading="masterBusy" @click="runMaster">
          {{ masterBusy ? "Mastering…" : "Master" }}
        </JvButton>
        <span class="jv-mono jv-muted">POST /v1/master</span>
      </div>

      <div v-if="masteredUrl" style="margin-top: 16px;">
        <audio :src="masteredUrl" controls preload="metadata" style="width: 100%; display: block;"></audio>
        <div class="jv-row" style="margin-top: 10px; align-items: center;">
          <JvButton variant="secondary" @click="downloadMastered">Download {{ masteredName }}</JvButton>
          <span class="jv-muted jv-mono">{{ masteredMime }} · {{ fmtKB(masteredBytes) }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.audio-tools-view { padding: 32px; max-width: var(--shell-form); display: flex; flex-direction: column; gap: 24px; }
.master-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; }
.file-input { font-size: 13px; color: var(--ink-2); cursor: pointer; }
</style>
