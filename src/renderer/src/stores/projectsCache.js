// SPDX-License-Identifier: GPL-3.0-or-later
//
// SWR cache for /v1/projects. See `_swrFactory.js` for the semantics.

import { projectsService } from "../services/projects.js";
import { defineSwrStore } from "./_swrFactory.js";

export const useProjectsCache = defineSwrStore({
  id: "projectsCache",
  snapshotKey: "jv.books.snapshot",
  emptyValue: [],
  // projectsService.list() returns { projects: [...] } — the cache holds
  // the flat array. Views read store.data as the project list.
  fetcher: async () => (await projectsService.list())?.projects ?? [],
});
