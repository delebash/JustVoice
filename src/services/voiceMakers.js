// SPDX-License-Identifier: MIT
//
// What the persona page's three voice makers share — Clone, Design and Blend
// open on the persona's own page (decided 2026-10-04, plan
// docs/plans/2026-10-04-persona-voice-making.md §3; the approved mock is
// src/mock/MockPersonaEditorView.vue):
//   · the models a maker offers, filtered by how a voice on them can be
//     directed (the page's "How it can be directed"), with its first pick;
//   · the one line that says what a voice on a model keeps;
//   · hearing a voice not kept yet AS the persona
//     (`POST /v1/personas/preview-candidate`);
//   · the clip check — the page decodes the clip to WAV, the server measures
//     it (`POST /v1/voices/clip-check`).
// The facts behind the notes are plan 2026-10-03 §2.3.

import { DIRECTION_OPTIONS } from "./personaFacts.js";
import { rowOptions } from "./capabilities.js";

/** How a voice on this capability row can be directed — the server's rule
 *  (`voice_model.directed_by`): words, else its own tags, else sliders. */
export function rowDirectedBy(row) {
  if (row?.supports_instruct_freeform) return "words";
  if ((row?.inline_tags || []).length) return "tags";
  return "sliders";
}

/** The models that can do `field`, as options — "Chatterbox Turbo (not
 *  loaded)", each with what it takes as its hint — only those whose voices
 *  can be directed `direction` ("" = any). */
export function makerModelOptions(rows, engines, field, direction = "") {
  return rowOptions(rows, engines, field)
    .filter((o) => !direction || rowDirectedBy(rows[o.value]) === direction)
    .map((o) => ({ ...o, hint: DIRECTION_OPTIONS.find((d) => d.value === rowDirectedBy(rows[o.value]))?.label }));
}

/** The first model of `order` the list offers — a maker's starting pick. */
export function preferredModel(options, order) {
  return order.find((id) => options.some((o) => o.value === id)) || options[0]?.value || "";
}

/** What a voice made on this model keeps — said where the model is picked. */
export const MODEL_NOTE = {
  "chatterbox-turbo": "Takes tags — [fear] [sigh] — not written direction. English only; the clip must be longer than 5 seconds.",
  "chatterbox-nano": "Takes tags — [fear] [sigh] — not written direction. English only; the clip must be longer than 5 seconds. Smaller and faster than Turbo.",
  "chatterbox-multilingual": "Takes no direction — shape it with pace, pitch and gain.",
  "qwen3-base": "Written direction is dropped: the clip is the whole voice.",
  voxcpm2: "Takes written direction, on a clone too.",
  pocket: "Takes no direction. One model per language — English, German, Italian, Portuguese or Spanish.",
};

/** What a description keeps on each design model. */
export const DESIGN_NOTE = {
  "qwen3-vd": "Each line is spoken from the description, so the voice can shift a little from line to line.",
  voxcpm2: "Each line is spoken from the description, so the voice can shift a little from line to line. Takes written direction on top.",
};

/** The engine a capability row's model belongs to (qwen3-base → qwen3). */
export function engineOfRow(engines, rowId) {
  const byId = (engines || []).find((e) => e.id === rowId);
  if (byId) return byId;
  return (engines || []).find((e) => rowId?.startsWith(`${e.id}-`)) || null;
}

/** "0:47". */
export function fmtLength(seconds) {
  const s = Math.round(Number(seconds) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A Blob or File as base64, for the API's `*_b64` fields. */
export async function blobToB64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** base64 WAV → a Blob the page's player can play. */
export function b64ToWavBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "audio/wav" });
}

/** Decode any clip the drop box takes (WAV, MP3, M4A, FLAC, OGG, a WebM
 *  recording) into 16-bit mono WAV — what the clip check measures. The clip
 *  that is KEPT is the file as dropped; this copy is only measured. */
export async function clipToWav(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const n = audio.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += ch[i] / audio.numberOfChannels;
    }
    const rate = audio.sampleRate;
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
    str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, "data"); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mono[i])) * 32767, true);
    return new Blob([buf], { type: "audio/wav" });
  } finally {
    ctx.close?.();
  }
}

/** The two clip checks (decided 2026-10-04): length, and how far the speech
 *  stands above the noise. Each is `{intent, label}` for a UiTag, or null. */
const MIN_S = 10;
const MAX_S = 120;
const MIN_MARGIN_DB = 25;
export function clipChecks(seconds, marginDb) {
  let duration = null;
  if (seconds) {
    if (seconds < MIN_S) duration = { intent: "accent2", label: `⚠ ${fmtLength(seconds)} — under 10 s; the copy comes out thin` };
    else if (seconds > MAX_S) duration = { intent: "accent2", label: `⚠ ${fmtLength(seconds)} — over 2 minutes; trim it to one clean stretch` };
    else duration = { intent: "success", label: `✓ ${fmtLength(seconds)} long` };
  }
  let noise = null;
  if (marginDb !== null && marginDb !== undefined) {
    noise = marginDb >= MIN_MARGIN_DB
      ? { intent: "success", label: `✓ clean — ${Math.round(marginDb)} dB above the noise` }
      : { intent: "accent2", label: `⚠ noisy — ${Math.round(marginDb)} dB above the noise; the copy will carry it` };
  }
  return { duration, noise };
}

/** Measure a clip on the server. `{seconds, noise_margin_db}`. */
export async function checkClip(api, blob) {
  const wav = await clipToWav(blob);
  return api.request("/v1/voices/clip-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wav_b64: await blobToB64(wav) }),
  });
}

/** Hear a voice not kept yet as this persona speaks: `{blob, previewId}`.
 *  `persona` is the page's draft (its voice is ignored); `candidate` is a
 *  voice-preview request — engine, model, source and what that source needs. */
export async function previewCandidate(api, persona, candidate, text) {
  const r = await api.request("/v1/personas/preview-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona: { ...persona, voice_id: null }, candidate, text: text || "" }),
  });
  return { blob: b64ToWavBlob(r.wav_b64), previewId: r.preview_id };
}
