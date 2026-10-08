// SPDX-License-Identifier: MIT
// Speaker Lab truth surface — GET /v1/extraction/config + the per-call user_prompt / confidence_floor overrides (the port of tests/test_extraction_config.py).
// Not runnable yet: every test drives GET /v1/extraction/config, POST /v1/extraction/analyze-text or PATCH /v1/settings — the API wave's. The extraction modules underneath are ported
// (wave D) and tested on their own.
import { test } from "vitest";

test.todo("extraction_config_shape — waits for api/extraction_api.js routes + app.js");
test.todo("extraction_config_no_provider — waits for api/extraction_api.js routes + app.js");
test.todo("provider_override_routes_call — waits for api/extraction_api.js routes + app.js");
test.todo("user_prompt_and_floor_overrides — waits for api/extraction_api.js routes + app.js");
test.todo("direct_min_b_has_an_api_floor — waits for api/extraction_api.js routes + app.js");
test.todo("a_chapter_past_the_context_says_so — waits for api/extraction_api.js routes + app.js");
test.todo("any_other_model_failure_carries_the_providers_reason — waits for api/extraction_api.js routes + app.js");
