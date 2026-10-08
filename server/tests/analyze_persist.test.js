// SPDX-License-Identifier: MIT
// Analyze saves its rows into the chapter's lines (the port of tests/test_analyze_persist.py).
// Not runnable yet: every test drives POST /v1/scenes/{id}/analyze and reads the chapter back through the routes — the API wave's. The extraction modules underneath are ported
// (wave D) and tested on their own.
import { test } from "vitest";

test.todo("first_analyze_resegments_and_saves — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("narration_binds_to_the_narrator — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_book_with_no_narrator_analyzes_and_leaves_narration_unread — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("reanalyze_updates_in_place_and_keeps_corrections — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("recut_is_refused_once_takes_exist — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("an_invented_speaker_leaves_the_line_unplaced — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("the_imports_line_ids_survive_the_recut — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("an_unclosed_quote_does_not_gain_a_closing_one — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_run_with_no_rows_never_wipes_the_chapter — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("editing_a_block_forgets_the_stored_source_text — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("an_edited_chapter_keeps_its_lines_and_its_anchors — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("an_edited_chapter_with_takes_is_never_refused — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("lines_changed_during_the_run_save_nothing — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_chapter_never_edited_is_still_cut_from_its_text — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
