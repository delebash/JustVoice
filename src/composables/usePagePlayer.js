// SPDX-License-Identifier: MIT
//
// One audio player for a page — Voices and Render (decided 2026-10-07; it was
// Voices' own). The page renders one hidden <audio> bound to it
// (PagePlayer.vue), every ▶ on the page drives it, and its controls
// (PlayTransport.vue) show in the row whose ▶ started it. The ▶ that is
// loaded pauses, resumes, or — once it ended — plays again from the start.
// Render's ▶ used to set the same URL again, which a finished <audio> ignores,
// so a take played only the first time.
//
// A key names what is loaded AND where it was started ("take:<id>",
// "row:<id>", a voice id…), so the controls show in that one row only.

import { nextTick, reactive } from "vue";

/** 75 → "1:15". Elapsed time rounds down; a total rounds like a take's length (4.7 s → "0:05"). */
export function fmtTime(sec, { round = false } = {}) {
  const t = Math.max(0, (round ? Math.round : Math.floor)(Number(sec) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function usePagePlayer() {
  const p = reactive({
    el: null,       // the page's <audio>, set by PagePlayer.vue
    src: null,
    key: null,
    paused: true,
    time: 0,
    duration: 0,
    /** Load what `key` plays without starting it (Voices' streamed preview starts it itself). */
    load(key, url) {
      p.key = key;
      p.src = url;
      p.time = 0;
      p.duration = 0;
    },
    /** ▶ — the loaded key toggles; anything else loads and plays from the start. */
    async play(key, url) {
      if (!url) return;
      if (p.key === key && p.src === url) return p.toggle();
      p.load(key, url);
      await nextTick();
      p.el?.play().catch(() => {});
    },
    toggle() {
      if (!p.el) return;
      if (p.el.paused) p.el.play().catch(() => {});
      else p.el.pause();
    },
    seek(v) {
      if (p.el) p.el.currentTime = Number(v) || 0;
    },
    /** Silence it and forget what was loaded — its controls go with it. */
    stop() {
      p.el?.pause();
      p.load(null, null);
    },
    isPlaying(key) {
      return p.key === key && !p.paused;
    },
    onTime() {
      if (!p.el) return;
      p.time = p.el.currentTime || 0;
      // A streamed audition's WAV header carries the streaming convention's
      // 0xFFFFFFFF sizes, which browsers read as an hours-long duration —
      // treat anything absurd as unknown so the controls show elapsed time
      // only until the stream (or a cached replay) has a real length.
      const d = p.el.duration;
      p.duration = Number.isFinite(d) && d < 21600 ? d : 0;
    },
    onEnded() {
      p.paused = true;
      p.time = 0;
    },
  });
  return p;
}
