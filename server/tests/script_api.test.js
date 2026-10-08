// SPDX-License-Identifier: MIT
// Script's chapter pages and grid — GET /v1/scenes/{id}/script, /v1/projects/{id}/script (the port of tests/test_script_api.py).
// Not runnable yet: every test drives the Script routes — the API wave's. The extraction modules underneath are ported
// (wave D) and tested on their own.
import { test } from "vitest";

test.todo("a_run_records_when_and_the_cast_it_chose_from — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("each_line_records_its_paragraph_and_the_books_words — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_propagated_line_carries_its_tags_words — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_reanalyze_records_who_a_changed_line_was — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("the_chapter_page_carries_its_flags — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("the_grid_row_and_the_one_analyzed_rule — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("speakers_from_the_import_are_not_analyzed — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_speaker_added_since_whose_name_is_in_the_text — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_removed_speaker_leaves_their_lines_with_no_speaker — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_line_left_with_no_speaker_is_not_counted_as_decided — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("no_dialogue_found — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_single_quoted_chapter_finds_its_speech — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("unknown_scene_and_project_404 — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_speaker_change_returns_its_fix_and_undo_removes_it — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_null_speaker_clears_it_and_a_missing_one_leaves_it — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("speech_on_the_narrator_counts_like_anyones — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("a_character_who_narrates_is_counted_like_anyone — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("narration_waits_for_a_narrator_instead_of_counting_as_no_speaker — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
test.todo("with_a_narrator_a_line_with_no_speaker_is_counted_as_before — waits for api/extraction_api.js + api/projects_api.js routes + app.js");
