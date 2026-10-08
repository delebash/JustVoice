// SPDX-License-Identifier: MIT
// JV rides the family's warm-on-startup default (ON) since 2026-08-13 (the port of
// tests/test_warm_default.py). Seeds-only rule: an existing DB's stored value is never flipped
// either way. Both tests read GET /v1/ai/engine-config through the app.
import { test } from "vitest";

test.todo("fresh_db_seeds_warm_on — waits for app.js + engines/llm/*");
test.todo("stored_warm_off_survives_reboot — waits for app.js + engines/llm/*");
