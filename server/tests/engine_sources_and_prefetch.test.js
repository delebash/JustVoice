// SPDX-License-Identifier: MIT
// S0 + S1 from docs/plans/2026-06-14-engines-download-contract.md (the port of
// tests/test_engine_sources_and_prefetch.py): the sources endpoints + the resolveSource helper
// the prefetch worker reads, and spawnPrefetch — a variant's pinned file(s) into the speech
// cache, with progress + cancel.
//
// Most of this file waits for later waves: the sources / models / speech-cache endpoints are
// api/* routes, and spawnPrefetch resolves the variant's source through
// api/engine_sources_api.resolveSource before it starts (installer.js imports it when it
// exists). The unknown-engine refusal happens before that and runs here.
import { afterEach, expect, test } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import { spawnPrefetch } from "../src/installer.js";

afterEach(() => endState());

test.todo("sources_list_uses_catalog_variant_ids_and_manifest_provenance — waits for app.js + api/engine_sources_api.js");
test.todo("sources_put_persists_and_flips_provenance — waits for app.js + api/engine_sources_api.js");
test.todo("sources_delete_reverts_and_gcs_empty_engine — waits for app.js + api/engine_sources_api.js");
test.todo("sources_negatives — waits for app.js + api/engine_sources_api.js");
test.todo("an_override_swaps_the_repo_and_keeps_the_pinned_files — waits for app.js + api/engine_sources_api.js");

test("prefetch_unknown_engine_raises", async () => {
  const st = useState();
  await expect(spawnPrefetch(st, "no-such-engine", "vX")).rejects.toThrow(/no managed engine/);
});

test.todo("prefetch_lands_plain_files_no_hub_dep_no_hub_layout — waits for api/engine_sources_api.js (resolveSource)");
test.todo("prefetch_cancel_fails_the_job_and_keeps_partials_for_resume — waits for api/engine_sources_api.js (resolveSource)");
test.todo("prefetch_cancel_via_http_endpoint — waits for app.js + api/jobs_api.js");
test.todo("models_list_serves_speech_cache_local_dir — waits for app.js + api/engines_models_api.js");
test.todo("a_model_not_in_the_speech_cache_is_not_on_disk — waits for app.js + api/engines_models_api.js");
test.todo("speech_cache_clear_deletes_all_and_flips_on_disk — waits for app.js + api/models_api.js");
test.todo("speech_cache_clear_refuses_while_an_engine_is_loaded — waits for app.js + api/models_api.js");
