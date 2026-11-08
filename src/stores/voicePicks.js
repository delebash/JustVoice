// SPDX-License-Identifier: MIT
//
// The best picks store — the models every model picker marks "Best voices you can sell" or "Best
// acting — not for sale" (GET /v1/book-voices/picks; services/modelPicks.js has the words;
// docs/plans/2026-11-08-latest-models.md D12). Read once; again when the voice sets may have changed
// (`reload` after the one-click card's Voices is set) or an engine changes (`jv:health-refresh`,
// a licence accepted).

import { defineStore } from "pinia";
import { ref } from "vue";

import { useApi } from "./api.js";

export const useVoicePicksStore = defineStore("voicePicks", () => {
  const picks = ref([]);
  const loaded = ref(false);
  let _inflight = null;

  window.addEventListener("jv:health-refresh", () => { void reload(); });

  // Failure leaves `loaded` false so the next caller retries (stores/personas.js).
  async function reload() {
    const r = await useApi().safeRequest("/v1/book-voices/picks", null);
    if (!r) return picks.value;
    picks.value = r.picks ?? [];
    loaded.value = true;
    return picks.value;
  }

  function ensureLoaded() {
    if (loaded.value) return Promise.resolve(picks.value);
    if (!_inflight) _inflight = reload().finally(() => { _inflight = null; });
    return _inflight;
  }

  return { picks, loaded, reload, ensureLoaded };
});
