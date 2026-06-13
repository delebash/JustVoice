// SPDX-License-Identifier: GPL-3.0-or-later
//
// SWR cache for /v1/personas. See `_swrFactory.js` for the semantics.

import { useApi } from "./api.js";
import { defineSwrStore } from "./_swrFactory.js";

export const usePersonasCache = defineSwrStore({
  id: "personasCache",
  snapshotKey: "jv.personas.snapshot",
  emptyValue: [],
  fetcher: async () => {
    const r = await useApi().safeRequest("/v1/personas", { personas: [] });
    return r?.personas ?? [];
  },
});
