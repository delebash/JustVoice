// SPDX-License-Identifier: GPL-3.0-or-later
//
// SWR cache for /v1/lexicons. See `_swrFactory.js` for the semantics.

import { useApi } from "./api.js";
import { defineSwrStore } from "./_swrFactory.js";

export const useLexiconsCache = defineSwrStore({
  id: "lexiconsCache",
  snapshotKey: "jv.lexicons.snapshot",
  emptyValue: [],
  fetcher: async () => {
    const r = await useApi().safeRequest("/v1/lexicons", { lexicons: [] });
    return r?.lexicons ?? [];
  },
});
