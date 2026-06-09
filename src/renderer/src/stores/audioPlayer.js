// SPDX-License-Identifier: GPL-3.0-or-later
//
// Global audio-player store. Any view calling `audioPlayer.play({...})`
// makes the bottom-anchored GlobalAudioPlayer appear with that track.
// Mirrors voicebox's useAudioPlayer hook + AudioPlayer component (lifted
// pattern: a single shared <audio> element controlled via a pinia store
// so transport state survives navigation across views).
import { defineStore } from "pinia";

export const useAudioPlayer = defineStore("audioPlayer", {
  state: () => ({
    url: null,
    title: "",
    subtitle: "",
    playing: false,
    durationSec: 0,
    currentSec: 0,
    volume: 1.0,
    open: false,
  }),
  actions: {
    play({ url, title = "", subtitle = "" } = {}) {
      if (!url) return;
      this.url = url;
      this.title = title;
      this.subtitle = subtitle;
      this.playing = true;
      this.open = true;
    },
    stop() {
      this.playing = false;
    },
    close() {
      this.open = false;
      this.playing = false;
      this.url = null;
      this.title = "";
      this.subtitle = "";
      this.currentSec = 0;
      this.durationSec = 0;
    },
    toggle() {
      this.playing = !this.playing;
    },
    setProgress(currentSec, durationSec) {
      this.currentSec = currentSec;
      if (durationSec) this.durationSec = durationSec;
    },
    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
    },
  },
});
