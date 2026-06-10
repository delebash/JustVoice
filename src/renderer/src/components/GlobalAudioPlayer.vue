<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  GlobalAudioPlayer — bottom-anchored transport bar that plays any audio
  URL pushed via the audioPlayer pinia store. Fixed bottom strip, persists
  across view nav, single shared <audio> element so seeking/state survive.
-->
<script setup>
import { ref, watch, onMounted } from "vue";
import { useAudioPlayer } from "../stores/audioPlayer.js";

const player = useAudioPlayer();
const audioEl = ref(null);
const waveformBars = 32;
const bars = ref(Array.from({ length: waveformBars }, () => 0.15 + Math.random() * 0.4));

function fmt(s) {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function onTimeUpdate() {
  const el = audioEl.value;
  if (!el) return;
  player.setProgress(el.currentTime, el.duration);
  // Animate the bars to dance with current playback. Cheap visual —
  // a real waveform would peak-decode the WAV; this is the AudioBars
  // approximation.
  if (player.playing) {
    bars.value = bars.value.map(() => 0.15 + Math.random() * 0.85);
  }
}

function onLoaded() {
  const el = audioEl.value;
  if (!el) return;
  el.volume = player.volume;
  if (player.playing) el.play().catch(() => {});
}

function onEnded() {
  player.playing = false;
}

function seek(e) {
  const el = audioEl.value;
  if (!el || !player.durationSec) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  el.currentTime = pct * player.durationSec;
}

watch(() => player.playing, (p) => {
  const el = audioEl.value;
  if (!el) return;
  if (p) el.play().catch(() => {});
  else el.pause();
});

watch(() => player.url, () => {
  bars.value = bars.value.map(() => 0.15 + Math.random() * 0.4);
});

watch(() => player.volume, (v) => {
  if (audioEl.value) audioEl.value.volume = v;
});
</script>

<template>
  <div v-if="player.open" class="global-audio-player">
    <audio
      ref="audioEl"
      :src="player.url"
      @loadedmetadata="onLoaded"
      @timeupdate="onTimeUpdate"
      @ended="onEnded"
      preload="auto"
    />

    <button class="gap-btn gap-btn--play" :title="player.playing ? 'Pause' : 'Play'" @click="player.toggle()">
      <span v-if="player.playing">⏸</span>
      <span v-else>▶</span>
    </button>

    <div class="gap-meta">
      <div class="gap-title">{{ player.title || "Untitled" }}</div>
      <div class="gap-subtitle">{{ player.subtitle }}</div>
    </div>

    <div class="gap-bars">
      <span
        v-for="(b, i) in bars"
        :key="i"
        class="gap-bar"
        :style="{ height: `${Math.round(b * 100)}%` }"
      />
    </div>

    <div class="gap-time">{{ fmt(player.currentSec) }} / {{ fmt(player.durationSec) }}</div>

    <div class="gap-scrub" @click="seek">
      <div class="gap-scrub__fill" :style="{ width: player.durationSec ? `${(player.currentSec / player.durationSec) * 100}%` : '0%' }" />
    </div>

    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      :value="player.volume"
      class="gap-volume"
      title="Volume"
      @input="player.setVolume(parseFloat($event.target.value))"
    />

    <button class="gap-btn gap-btn--close" title="Close" @click="player.close()">✕</button>
  </div>
</template>

<style scoped>
.global-audio-player {
  position: fixed;
  bottom: 16px;
  left: 96px;
  right: 16px;
  z-index: 7000;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  font-size: 12.5px;
}
.gap-btn {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  color: var(--ink);
  padding: 4px 8px;
  border-radius: 6px;
}
.gap-btn:hover { background: var(--surface-2); }
.gap-btn--play { font-size: 18px; }
.gap-btn--close { font-size: 13px; margin-left: 4px; }

.gap-meta { min-width: 120px; max-width: 240px; }
.gap-title { font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gap-subtitle { font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.gap-bars {
  flex: 0 0 96px;
  height: 28px;
  display: flex;
  align-items: end;
  gap: 2px;
}
.gap-bar {
  flex: 1;
  background: var(--accent);
  border-radius: 1px;
  transition: height 120ms ease-out;
  opacity: 0.85;
}

.gap-time { font-family: var(--font-mono); font-size: 11px; color: var(--ink-2); }

.gap-scrub {
  flex: 1;
  height: 4px;
  background: var(--surface-2);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}
.gap-scrub__fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
  border-radius: 2px;
  transition: width 80ms linear;
}

.gap-volume { width: 80px; accent-color: var(--accent); cursor: pointer; }
</style>
