// SPDX-License-Identifier: GPL-3.0-or-later
//
// SWR cache for /v1/engines. See `_swrFactory.js` for the semantics.
//
// NOTE: EnginesView itself maintains its own status-polling loop
// (install / load progress) and doesn't go through this cache. This
// cache exists so the OTHER views that need the engine list (Voices,
// Personas, Lexicons, Studio) stop hitting the endpoint on every
// mount.

import { useApi } from "./api.js";
import { defineSwrStore } from "./_swrFactory.js";

export const useEnginesCache = defineSwrStore({
  id: "enginesCache",
  snapshotKey: "jv.engines.snapshot",
  emptyValue: [],
  fetcher: async () => {
    const r = await useApi().safeRequest("/v1/engines", { engines: [] });
    return r?.engines ?? [];
  },
});
