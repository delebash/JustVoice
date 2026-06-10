// SPDX-License-Identifier: GPL-3.0-or-later
//
// useWavRecorder — mic capture straight to a 16-bit PCM WAV Blob.
//
// Why not MediaRecorder: it emits webm/opus, which the server would need
// ffmpeg to decode before Whisper can read it. Capturing raw PCM via an
// AudioContext and writing the WAV header client-side means the upload is
// already in the one format every layer of the pipeline reads natively.
// (Pattern informed by voicebox's useAudioRecording hook — see
// /voicebox-pin.txt — reimplemented for Vue + WAV output.)

import { ref } from "vue";

export function useWavRecorder() {
  const isRecording = ref(false);
  const elapsedMs = ref(0);
  const error = ref(null);

  let mediaStream = null;
  let audioCtx = null;
  let sourceNode = null;
  let processorNode = null;
  let chunks = [];
  let sampleRate = 48000;
  let startedAt = 0;
  let rafId = 0;

  function _tick() {
    if (!isRecording.value) return;
    elapsedMs.value = performance.now() - startedAt;
    rafId = requestAnimationFrame(_tick);
  }

  async function start() {
    if (isRecording.value) return;
    error.value = null;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      error.value = "Microphone access denied — allow mic permission and retry.";
      throw e;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sampleRate = audioCtx.sampleRate;
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    // ScriptProcessor is deprecated but universally available in webviews;
    // 4096-frame buffers keep CPU low and latency irrelevant (we only save).
    processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
    chunks = [];
    processorNode.onaudioprocess = (ev) => {
      chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
    };
    sourceNode.connect(processorNode);
    processorNode.connect(audioCtx.destination);
    isRecording.value = true;
    startedAt = performance.now();
    elapsedMs.value = 0;
    rafId = requestAnimationFrame(_tick);
  }

  /** Stop and return a WAV Blob (or null if nothing was captured). */
  async function stop() {
    if (!isRecording.value) return null;
    isRecording.value = false;
    cancelAnimationFrame(rafId);
    try { processorNode?.disconnect(); sourceNode?.disconnect(); } catch { /* ignore */ }
    mediaStream?.getTracks().forEach((t) => t.stop());
    await audioCtx?.close().catch(() => {});
    mediaStream = null; audioCtx = null; sourceNode = null; processorNode = null;

    const totalFrames = chunks.reduce((n, c) => n + c.length, 0);
    if (!totalFrames) return null;
    const pcm = new Float32Array(totalFrames);
    let off = 0;
    for (const c of chunks) { pcm.set(c, off); off += c.length; }
    chunks = [];
    return encodeWav(pcm, sampleRate);
  }

  function cancel() {
    if (!isRecording.value) return;
    isRecording.value = false;
    cancelAnimationFrame(rafId);
    try { processorNode?.disconnect(); sourceNode?.disconnect(); } catch { /* ignore */ }
    mediaStream?.getTracks().forEach((t) => t.stop());
    audioCtx?.close().catch(() => {});
    mediaStream = null; audioCtx = null; sourceNode = null; processorNode = null;
    chunks = [];
  }

  return { isRecording, elapsedMs, error, start, stop, cancel };
}

/** Float32 [-1,1] mono → 16-bit PCM WAV Blob. */
export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}
