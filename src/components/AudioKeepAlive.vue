<!-- SPDX-License-Identifier: MIT -->
<!--
  Keeps the operating system's audio output open while the app sits idle, so
  the first playback after a long pause neither fails nor pops. It loops a
  short clip of true silence (zero samples) at full volume — not a muted
  element, which an engine is free to skip. Written for macOS, whose audio
  session went dormant after idle; see docs/channels.md, "Audio keep-alive".

  Browsers refuse to start audio before the user has interacted with the page,
  so a refused start is retried on the first click or key press, and whenever
  the window comes back into view. A refusal is logged at debug level only.
  Renders nothing; mounted once by layouts/MainLayout.vue.
-->
<script setup>
import { onBeforeUnmount, onMounted } from "vue";

/** One second of 16-bit mono silence at 8 kHz, as a WAV blob. */
function silentWavBlob() {
  const rate = 8000;
  const dataBytes = rate * 2;
  const buf = new ArrayBuffer(44 + dataBytes); // the samples stay zero
  const v = new DataView(buf);
  const ascii = (at, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // bytes per second
  v.setUint16(32, 2, true); // bytes per frame
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);
  return new Blob([buf], { type: "audio/wav" });
}

let audio = null;
let url = null;

function start() {
  if (!audio?.paused) return; // none yet, or already playing
  let attempt;
  try {
    attempt = audio.play();
  } catch (e) {
    console.debug("[keep-alive] audio did not start:", e?.message || e);
    return;
  }
  // Some engines return no promise at all; a refused one waits for a gesture.
  if (attempt && typeof attempt.catch === "function") {
    attempt.catch((e) => console.debug("[keep-alive] audio waits for a click or key press:", e?.message || e));
  }
}

function onVisibility() {
  if (document.visibilityState === "visible") start();
}

const WINDOW_EVENTS = ["pointerdown", "keydown", "focus", "pageshow"];

onMounted(() => {
  // A page without blob URLs or audio (a test's DOM) has no output to keep open.
  if (typeof URL.createObjectURL !== "function" || typeof Audio !== "function") return;
  url = URL.createObjectURL(silentWavBlob());
  audio = new Audio();
  audio.loop = true;
  audio.volume = 1;
  audio.preload = "auto";
  audio.src = url;
  for (const name of WINDOW_EVENTS) window.addEventListener(name, start, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  start();
});

onBeforeUnmount(() => {
  for (const name of WINDOW_EVENTS) window.removeEventListener(name, start);
  document.removeEventListener("visibilitychange", onVisibility);
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio = null;
  }
  if (url) {
    URL.revokeObjectURL(url);
    url = null;
  }
});
</script>

<template>
  <!-- Nothing to show: the silent loop lives outside the page. -->
</template>
