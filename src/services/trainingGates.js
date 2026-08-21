// SPDX-License-Identifier: MIT
//
// Clip gates and audio helpers shared by the LoRA tab's sub-tabs.
//
// These lived inside TrainView until the LoRA restructure (2026-08-21).
// Preparer and Training both judge clips against the SAME server
// thresholds, so the judging lives in one place — two copies would drift
// the moment one gate changed.
//
// The thresholds themselves are never hardcoded here: they come from
// `settings.training.validation` (SQLite via SettingsStore), per the
// no-hardcoded-operator-values invariant. `judgeClip` takes them as an
// argument rather than fetching, so a caller cannot accidentally judge
// against stale settings it never loaded.

/** A File → its base64 payload (no data: prefix). */
export function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** base64 → a File the clip table can hold and later upload. */
export function b64ToFile(b64, name) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "audio/wav" });
}

/** Judge one analysed clip against the server's training thresholds.
 *
 * `v` is settings.training.validation. A missing measurement means
 * UNKNOWN and never fails a gate — the same contract the server uses in
 * training_prep.py, so the pre-flight verdict and the run-time verdict
 * agree instead of contradicting each other. */
export function judgeClip(analysis, v) {
  const secs = analysis?.format?.duration_sec ?? null;
  const clip = analysis?.loudness?.clipping_ratio ?? 0;
  const silence = analysis?.loudness?.silence_ratio ?? 0;
  const snr = analysis?.loudness?.snr_db ?? null;
  if (secs == null) return { status: "unchecked", seconds: null, reason: "" };
  if (v && secs < v.min_sample_duration_secs)
    return { status: "too_short", seconds: secs, reason: `under ${v.min_sample_duration_secs} s` };
  if (v && secs > v.max_sample_duration_secs)
    return { status: "too_long", seconds: secs, reason: `over ${v.max_sample_duration_secs} s` };
  if (v && clip > v.max_clipping_ratio)
    return { status: "clipping", seconds: secs, reason: "clipping" };
  if (v && silence > v.max_silence_ratio)
    return { status: "silence", seconds: secs, reason: "mostly silence" };
  if (v && snr != null && snr < v.min_snr_db)
    return { status: "low_snr", seconds: secs, reason: `SNR ${snr.toFixed(0)} dB under ${v.min_snr_db} dB` };
  return { status: "ok", seconds: secs, reason: "" };
}

/** Statuses a clip can carry and still be sent to the trainer. "unchecked"
 *  is usable on purpose: non-WAV audio can't be pre-analysed here, and the
 *  trainer judges it at run time rather than us dropping it blind. */
export const USABLE = new Set(["ok", "unchecked", "checking"]);

/** status → how the clip table shows it. `intent` values are UiTag's own
 *  (primary/secondary/success/info/accent2/danger — no "warning", no
 *  "ghost"), and UiTag takes `value`, never `label`. */
export const GATE_TAG = {
  ok: { intent: "success", label: "ok" },
  checking: { intent: "secondary", label: "checking…" },
  unchecked: { intent: "secondary", label: "checked at run time" },
  too_short: { intent: "accent2", label: "too short" },
  too_long: { intent: "accent2", label: "too long" },
  clipping: { intent: "danger", label: "clipping" },
  silence: { intent: "accent2", label: "mostly silence" },
  low_snr: { intent: "accent2", label: "low SNR" },
  low_confidence: { intent: "accent2", label: "unsure transcript" },
};

/** The Preparer reports a per-chunk reason string; map it to the same
 *  status vocabulary the pre-flight uses so one table renders both. */
export function chunkStatus(c) {
  if (c.accepted) return "ok";
  const reason = c.reason || "";
  if (reason.includes("confidence")) return "low_confidence";
  if (reason.includes("SNR")) return "low_snr";
  if (reason.includes("over")) return "too_long";
  return "too_short";
}

/** One line summarising a set of judged clips — only what happened,
 *  never a list of the gates that did not fire. */
export function gateSummary(samples, v) {
  const counts = { usable: 0 };
  for (const s of samples) {
    if (USABLE.has(s.status)) counts.usable += 1;
    else counts[s.status] = (counts[s.status] || 0) + 1;
  }
  const parts = [`${counts.usable} clip${counts.usable === 1 ? "" : "s"} usable`];
  if (counts.too_short) parts.push(`${counts.too_short} under ${v?.min_sample_duration_secs ?? "min"} s skipped`);
  if (counts.too_long) parts.push(`${counts.too_long} over ${v?.max_sample_duration_secs ?? "max"} s skipped`);
  if (counts.clipping) parts.push(`${counts.clipping} clipping skipped`);
  if (counts.silence) parts.push(`${counts.silence} mostly silence skipped`);
  if (counts.low_snr) parts.push(`${counts.low_snr} low SNR skipped`);
  if (counts.low_confidence) parts.push(`${counts.low_confidence} unsure transcript skipped`);
  return parts.join(" · ");
}

/** The languages a LoRA run can train at.
 *
 * These are the CODEC LANGUAGE tokens the Qwen3 trainer maps onto
 * (`engines/qwen3/train_lora.py` `_LANG_NAME`), which is why they are
 * names rather than BCP-47 codes at the trainer boundary. An adapter
 * carries its training language's phonology, so this choice is not
 * cosmetic: training German audio under the English token gives German
 * text an English accent.
 */
export const TRAIN_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "es", label: "Spanish" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "fr", label: "French" },
  { value: "ru", label: "Russian" },
];
