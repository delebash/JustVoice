// SPDX-License-Identifier: MIT
// Script's Split and Merge, and the left-out dialogue tags (the port of tests/test_split_merge.py).
// Not runnable yet: every test drives the block routes — the API wave's. The extraction modules underneath are ported
// (wave D) and tested on their own.
import { test } from "vitest";

test.todo("a_split_keeps_the_first_line_and_adds_the_second_after_it — waits for api/projects_api.js + api/extraction_api.js routes + app.js");
test.todo("a_split_can_carry_the_editors_words — waits for api/projects_api.js + api/extraction_api.js routes + app.js");
test.todo("a_split_needs_words_on_both_sides — waits for api/projects_api.js + api/extraction_api.js routes + app.js");
test.todo("a_merge_joins_neighbours_onto_the_first_and_deletes_their_takes — waits for api/projects_api.js + api/extraction_api.js routes + app.js");
test.todo("only_lines_next_to_each_other_merge — waits for api/projects_api.js + api/extraction_api.js routes + app.js");
test.todo("a_hand_cut_survives_a_reanalyze — waits for api/projects_api.js + api/extraction_api.js routes + app.js");
test.todo("script_marks_tag_only_lines_left_out_only_when_the_project_says_so — waits for api/projects_api.js + api/extraction_api.js routes + app.js");
test.todo("script_counts_each_lines_takes — waits for api/projects_api.js + api/extraction_api.js routes + app.js");
test.todo("the_project_settings_keep_each_other — waits for api/projects_api.js + api/extraction_api.js routes + app.js");
