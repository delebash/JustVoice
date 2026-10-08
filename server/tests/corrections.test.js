// SPDX-License-Identifier: MIT
// Correction memory — THE one writer (the port of tests/test_corrections.py).
// Not runnable yet: every test drives the app's routes (POST/DELETE /v1/projects/{id}/corrections, PATCH /v1/blocks/{id}) or extraction_api.record_correction — the API wave's. The extraction modules underneath are ported
// (wave D) and tested on their own.
import { test } from "vitest";

test.todo("lab_door_records_and_counts — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("lab_door_refuses_unknown_speakers — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("snippet_capped_at_400_chars — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("cap_at_200_per_project — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("studio_block_patch_shares_the_writer — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
