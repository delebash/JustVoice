// SPDX-License-Identifier: MIT
//
// What Script's Analyze would run on — GET /v1/extraction/config — for the
// chapter grid and a chapter's page, kept current. Both are kept alive in
// Studio, so a read on mount alone went stale: a model loaded from the LLM
// engine setup or AI Settings left "Analyze needs a language model" on screen
// until the app restarted (2026-10-05). It is re-read each time the page comes
// back, and whenever the kit's shared list of the built-in runner's models
// changes (a model loaded, unloaded or downloaded — the list the header reads).

import { computed, onActivated, onMounted, ref, watch } from "vue";
import { useRunnerModels } from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";

export function useAnalyzeModel() {
  const api = useApi();
  const config = ref(null);
  async function load() {
    config.value = await api.safeRequest("/v1/extraction/config", null);
  }
  onMounted(load);
  onActivated(load);
  const { models } = useRunnerModels();
  watch(() => models.value.map((m) => `${m.id}:${m.status}`).join(","), load);
  // No model: the route Auto would run names no model at all.
  const noModel = computed(() => !!config.value && (config.value.auto_checks || []).every((c) => !c.model));
  return { config, noModel, reload: load };
}
