// SPDX-License-Identifier: MIT
// A chapter's text edited as a whole — GET/PUT /v1/scenes/{id}/text (the port of tests/test_chapter_text.py).
// Not runnable yet: two tests call projects_api.text_edit_plan and six drive the routes — the API wave's. The extraction modules underneath are ported
// (wave D) and tested on their own.
import { test } from "vitest";

test.todo("the_plan_keeps_unchanged_lines_and_counts_the_rest — waits for api/projects_api.js (text_edit_plan + routes) + app.js");
test.todo("spacing_is_not_a_change — waits for api/projects_api.js (text_edit_plan + routes) + app.js");
test.todo("the_text_is_the_chapters_lines_a_paragraph_each — waits for api/projects_api.js (text_edit_plan + routes) + app.js");
test.todo("an_unchanged_text_changes_nothing — waits for api/projects_api.js (text_edit_plan + routes) + app.js");
test.todo("a_changed_paragraph_is_a_new_line_and_the_rest_keep_everything — waits for api/projects_api.js (text_edit_plan + routes) + app.js");
test.todo("a_dry_run_says_which_takes_would_go_and_changes_nothing — waits for api/projects_api.js (text_edit_plan + routes) + app.js");
test.todo("an_empty_text_is_refused — waits for api/projects_api.js (text_edit_plan + routes) + app.js");
test.todo("script_counts_lines_changed_since_the_last_analyze — waits for api/projects_api.js (text_edit_plan + routes) + app.js");
