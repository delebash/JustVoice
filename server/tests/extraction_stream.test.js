// SPDX-License-Identifier: MIT
// Analyze's stream — POST /v1/scenes/{id}/analyze/stream (the port of tests/test_extraction_stream.py).
// Not runnable yet: every test drives the SSE route — the API wave's. The extraction modules underneath are ported
// (wave D) and tested on their own.
import { test } from "vitest";

test.todo("stream_emits_deltas_then_a_done_frame_with_rows_and_usage — waits for api/extraction_api.js routes + app.js");
test.todo("stream_surfaces_no_llm_as_an_error_frame — waits for api/extraction_api.js routes + app.js");
test.todo("stream_404s_an_unknown_scene_before_streaming — waits for api/extraction_api.js routes + app.js");
