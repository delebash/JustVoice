<!--
  SPDX-License-Identifier: MIT
  SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
  SPDX-FileCopyrightText: 2026 JustVoice contributors

  Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/app/src/components/AudioPlayer/AudioKeepAlive.tsx
  (commit pinned in voicebox-pin.txt at repo root).
  Translated React -> Vue on 2026-06-08. Modifications by JustVoice contributors
  are licensed under MIT as part of the combined JustVoice work.
  The MIT permission notice (LICENSES/MIT.txt) continues to apply to upstream-derived portions.

  Why this exists: WKWebView tears down the app's CoreAudio output session when
  idle for long enough, and a JS-level reload (cmd+R) does NOT restore it — only
  relaunching the Tauri app does. Keeping a silent <audio> element looping
  forever prevents the OS audio session from ever going dormant.

  Real silence (zero PCM samples) at full volume is preferred over a muted
  element: browsers/WebKit can optimize muted media away, which defeats the
  purpose of holding the session open.
-->
<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';

function buildSilentWavUrl(seconds = 1, sampleRate = 8000) {
  const numSamples = seconds * sampleRate;
  const bytes = 44 + numSamples * 2;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  const write = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

const audioEl = ref(null);
const objectUrl = ref(null);

onMounted(() => {
  objectUrl.value = buildSilentWavUrl(1, 8000);
  const el = new Audio(objectUrl.value);
  el.loop = true;
  el.volume = 1;
  el.preload = 'auto';
  audioEl.value = el;

  const tryPlay = () => {
    if (!audioEl.value) return;
    if (!audioEl.value.paused) return;
    audioEl.value.play().catch((err) => {
      console.debug('[AudioKeepAlive] play blocked (will retry on next gesture):', err);
    });
  };
  tryPlay();

  // Autoplay may be blocked until first user interaction — re-attempt then.
  const onGesture = () => tryPlay();
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);
  const onWake = () => {
    if (!document.hidden) tryPlay();
  };
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('pageshow', onWake);

  onBeforeUnmount(() => {
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('pageshow', onWake);
    if (audioEl.value) {
      audioEl.value.pause();
      audioEl.value.src = '';
      audioEl.value = null;
    }
    if (objectUrl.value) {
      URL.revokeObjectURL(objectUrl.value);
      objectUrl.value = null;
    }
  });
});
</script>

<template>
  <!-- intentionally empty: the audio element is created via JS Audio() and
       lives outside the DOM. Nothing to render. -->
</template>
