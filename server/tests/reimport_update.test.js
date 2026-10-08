// SPDX-License-Identifier: MIT
// Re-importing a sheet updates its lines in place, and a changed line reads stale (the port of
// tests/test_reimport_update.py).
//
// Not ported here: all three tests drive the import routes (api/projects_api.js + imports/*,
// the imports and API waves) and Render's line page through them: test.todo. The stale rule
// they lean on — a take's recorded inputs key against the line's now — is pinned in
// line_takes.test.js.
import { test } from "vitest";

test.todo("reimport_updates_in_place_and_derives_staleness — waits for api/projects_api.js + imports/*");
test.todo("update_requires_stable_ids — waits for api/projects_api.js + imports/*");
test.todo("block_render_clears_staleness — waits for api/projects_api.js + imports/* + api/takes_api.js");
