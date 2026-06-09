<script setup>
import { ref, computed, onBeforeUnmount } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";

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
  <section class="block">
    <h3>Analyze a WAV</h3>
    <p class="endnote">
      Drop a 16-bit PCM WAV. Reports format, duration, loudness (peak/RMS/crest), silence ratio,
      clipping ratio, and a SHA-256 fingerprint.
    </p>
    <div class="row" style="align-items: flex-end">
      <label style="flex: 1">
        <span>WAV file</span>
        <input
          type="file"
          accept="audio/wav,.wav"
          @change="analyzeFile = $event.target.files[0]" />
      </label>
      <button class="primary" :disabled="analyzeBusy || !analyzeFile" @click="runAnalyze">
        {{ analyzeBusy ? "Analyzing…" : "Analyze" }}
      </button>
    </div>
    <p class="endnote" style="margin-top: 6px">POST /v1/analyze</p>

    <table v-if="analysis" style="margin-top: 12px">
      <tbody>
        <tr>
          <th>SHA-256</th>
          <td class="mono" colspan="3">{{ analysis.sha256 }}</td>
        </tr>
        <tr>
          <th>File size</th>
          <td>{{ fmtKB(analysis.file_size_bytes) }}</td>
          <th>Duration</th>
          <td>{{ analysis.format.duration_sec.toFixed(3) }} s</td>
        </tr>
        <tr>
          <th>Sample rate</th>
          <td>{{ analysis.format.sample_rate }} Hz</td>
          <th>Channels</th>
          <td>{{ analysis.format.channels }}</td>
        </tr>
        <tr>
          <th>Bit depth</th>
          <td>{{ analysis.format.bits_per_sample }}-bit</td>
          <th>Samples</th>
          <td>{{ analysis.format.sample_count.toLocaleString() }}</td>
        </tr>
        <tr>
          <th>Peak</th>
          <td>{{ fmtDb(analysis.loudness.peak_dbfs) }}</td>
          <th>RMS</th>
          <td>{{ fmtDb(analysis.loudness.rms_dbfs) }}</td>
        </tr>
        <tr>
          <th>Crest factor</th>
          <td>{{ fmtDb(analysis.loudness.crest_factor_db) }}</td>
          <th>Silence ratio</th>
          <td>{{ fmtPct(analysis.loudness.silence_ratio) }}</td>
        </tr>
        <tr>
          <th>Clipping ratio</th>
          <td colspan="3">{{ fmtPct(analysis.loudness.clipping_ratio) }}</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="block">
    <h3>Apply a mastering preset</h3>
    <p class="endnote">
      Upload a WAV, pick a preset, get a mastered MP3/M4A back. Requires ffmpeg on the server. ACX
      targets audiobook spec (−23 LUFS, −3 dBTP, head/tail silence). YouTube outputs AAC.
    </p>
    <div class="grid">
      <label>
        <span>WAV file</span>
        <input
          type="file"
          accept="audio/wav,.wav"
          @change="masterFile = $event.target.files[0]" />
      </label>
      <label>
        <span>Preset</span>
        <select v-model="masterPreset">
          <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <label>
        <span>Title (optional)</span>
        <input type="text" v-model="masterTitle" placeholder="Chapter 1" />
      </label>
      <label>
        <span>Author (optional)</span>
        <input type="text" v-model="masterAuthor" placeholder="Author name" />
      </label>
      <label style="grid-column: 1 / -1">
        <span>Book / album (optional)</span>
        <input type="text" v-model="masterBook" placeholder="Book title" />
      </label>
    </div>
    <div class="row" style="margin-top: 12px">
      <button class="primary" :disabled="masterBusy || !masterFile" @click="runMaster">
        {{ masterBusy ? "Mastering…" : "Master" }}
      </button>
      <span class="endnote">POST /v1/master</span>
    </div>

    <div v-if="masteredUrl" style="margin-top: 14px">
      <audio :src="masteredUrl" controls preload="metadata" style="width: 100%"></audio>
      <div class="row" style="margin-top: 8px; align-items: center">
        <button @click="downloadMastered">Download {{ masteredName }}</button>
        <span class="endnote">{{ masteredMime }} · {{ fmtKB(masteredBytes) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px 32px; }
</style>
