// SPDX-License-Identifier: GPL-3.0-or-later
//
// SWR cache for /v1/voices. See `_swrFactory.js` for the semantics.

import { useApi } from "./api.js";
import { defineSwrStore } from "./_swrFactory.js";

export const useVoicesCache = defineSwrStore({
  id: "voicesCache",
  snapshotKey: "jv.voices.snapshot",
  emptyValue: [],
  fetcher: async () => {
    const r = await useApi().safeRequest("/v1/voices", { voices: [] });
    return r?.voices ?? [];
  },
});
