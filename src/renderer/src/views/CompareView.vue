<script setup>
import { ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";

const api = useApi();

const fileA = ref(null);
const fileB = ref(null);
const labelA = ref("");
const labelB = ref("");
const report = ref(null);
const busy = ref(false);

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

async function compare() {
  if (!fileA.value || !fileB.value) return;
  busy.value = true;
  report.value = null;
  try {
    const [a, b] = await Promise.all([readAsBase64(fileA.value), readAsBase64(fileB.value)]);
    report.value = await api.request("/v1/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        a_wav_b64: a,
        b_wav_b64: b,
        a_label: labelA.value || null,
        b_label: labelB.value || null,
      }),
    });
  } catch (e) {
    pushToast({ message: `Compare failed: ${e.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}

function fmtDb(n) {
  if (n === null || n === undefined) return "—";
  if (!isFinite(n)) return n > 0 ? "∞" : "−∞";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + " dB";
}
</script>

<template>
  <section class="block">
    <h3>Two WAVs in, side-by-side report out</h3>
    <p class="endnote">
      Drop two 16-bit PCM WAV files. JustTTS reports format match, peak/RMS loudness diff, sample-level RMSE,
      and a coarse verdict.
    </p>
    <div class="grid">
      <div>
        <label>
          <span>A (baseline) — label (optional)</span>
          <input type="text" v-model="labelA" placeholder="e.g. JustTTS Kokoro" />
        </label>
        <div style="margin-top: 8px">
          <label>
            <span>WAV file A</span>
            <input type="file" accept="audio/wav,.wav" @change="fileA = $event.target.files[0]" />
          </label>
        </div>
      </div>
      <div>
        <label>
          <span>B (compared against A) — label (optional)</span>
          <input type="text" v-model="labelB" placeholder="e.g. Local Kokoro FastAPI" />
        </label>
        <div style="margin-top: 8px">
          <label>
            <span>WAV file B</span>
            <input type="file" accept="audio/wav,.wav" @change="fileB = $event.target.files[0]" />
          </label>
        </div>
      </div>
    </div>
    <div class="row" style="margin-top: 12px">
      <button class="primary" :disabled="busy || !fileA || !fileB" @click="compare">
        {{ busy ? "Analyzing…" : "Compare" }}
      </button>
      <span class="endnote">POST /v1/compare</span>
    </div>
  </section>

  <section v-if="report" class="block">
    <h3>Verdict: <span class="tag">{{ report.verdict }}</span></h3>
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>{{ report.a_label || "A" }}</th>
          <th>{{ report.b_label || "B" }}</th>
          <th>Δ (B − A)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>SHA-256</td>
          <td class="mono">{{ report.a.sha256.slice(0, 16) }}…</td>
          <td class="mono">{{ report.b.sha256.slice(0, 16) }}…</td>
          <td>{{ report.identical ? "identical" : "differ" }}</td>
        </tr>
        <tr>
          <td>File size</td>
          <td>{{ (report.a.file_size_bytes / 1024).toFixed(1) }} KB</td>
          <td>{{ (report.b.file_size_bytes / 1024).toFixed(1) }} KB</td>
          <td>{{ ((report.b.file_size_bytes - report.a.file_size_bytes) / 1024).toFixed(1) }} KB</td>
        </tr>
        <tr>
          <td>Sample rate</td>
          <td>{{ report.a.format.sample_rate }} Hz</td>
          <td>{{ report.b.format.sample_rate }} Hz</td>
          <td>{{ report.format_match ? "—" : "mismatch" }}</td>
        </tr>
        <tr>
          <td>Duration</td>
          <td>{{ report.a.format.duration_sec.toFixed(3) }}s</td>
          <td>{{ report.b.format.duration_sec.toFixed(3) }}s</td>
          <td>{{ (report.duration_diff_sec >= 0 ? "+" : "") + report.duration_diff_sec.toFixed(3) }}s</td>
        </tr>
        <tr>
          <td>Peak loudness</td>
          <td>{{ fmtDb(report.a.loudness.peak_dbfs) }}</td>
          <td>{{ fmtDb(report.b.loudness.peak_dbfs) }}</td>
          <td>{{ fmtDb(report.peak_diff_db) }}</td>
        </tr>
        <tr>
          <td>RMS loudness</td>
          <td>{{ fmtDb(report.a.loudness.rms_dbfs) }}</td>
          <td>{{ fmtDb(report.b.loudness.rms_dbfs) }}</td>
          <td>{{ fmtDb(report.rms_diff_db) }}</td>
        </tr>
        <tr v-if="report.sample_rmse !== null">
          <td>Sample-level RMSE</td>
          <td colspan="2">{{ report.sample_rmse.toFixed(5) }} (normalized [-1, 1])</td>
          <td>—</td>
        </tr>
        <tr v-if="report.pct_identical_samples !== null">
          <td>% identical samples</td>
          <td colspan="2">{{ (report.pct_identical_samples * 100).toFixed(3) }}%</td>
          <td>—</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 14px; }
th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; color: var(--muted); }
td { padding: 8px 10px; border-bottom: 1px solid var(--border-soft); }
.mono { font-family: var(--font-mono); font-size: 11px; }
.tag { display: inline-block; padding: 2px 10px; background: var(--surface-3); font-size: 13px; font-weight: 500; }
label > span { display: block; font-size: 11px; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
input { width: 100%; padding: 6px 10px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--ink); font-size: 13px; }
</style>
