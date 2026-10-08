// SPDX-License-Identifier: MIT
// srt + audacity_labels adapters (the port of tests/test_import_srt_and_labels.py).
//
// These pin the behaviour that was only ever described in their docstrings: cue and label
// parsing, the speaker prefix lifting to a character, and pause-from-gap arithmetic — the one
// piece of real math in either adapter.
import { expect, test } from "vitest";
import { ApiError } from "../src/errors.js";
import { runAdapter } from "../src/imports/index.js";

const SRT = `1
00:00:01,000 --> 00:00:04,000
NARRATOR: It began at dawn.

2
00:00:05,500 --> 00:00:08,000
The dock was empty.

3
00:00:08,000 --> 00:00:09,250
MARA: You're late.
`;

function apiError(fn) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e;
  }
  throw new Error("expected an ApiError");
}

test("srt_cues_become_lines_with_speakers_and_gaps", () => {
  const result = runAdapter("srt", Buffer.from(SRT, "utf8"), { filename: "episode.srt" });
  expect(result.source).toBe("srt");
  expect(result.project.name).toBe("episode");
  expect(result.scenes.length).toBe(1);
  const [scene] = result.scenes;
  expect(scene.kind).toBe("cue_sheet");

  expect(scene.lines.map((ln) => ln.text)).toEqual(["It began at dawn.", "The dock was empty.", "You're late."]);
  // A `NAME:` prefix lifts into a character and is stripped from the line.
  expect(scene.lines.map((ln) => ln.character_id)).toEqual(["narrator", null, "mara"]);
  expect(result.characters.map((c) => c.name).sort()).toEqual(["Mara", "Narrator"]);

  // pause_after_ms is the gap to the NEXT cue: 5.5s - 4.0s = 1500ms, then 8.0s - 8.0s = no gap,
  // so the second line carries nothing.
  expect(scene.lines.map((ln) => ln.pause_after_ms)).toEqual([1500, null, null]);
});

test("srt_without_cues_is_rejected", () => {
  const e = apiError(() => runAdapter("srt", Buffer.from("not a subtitle file at all"), { filename: "x.srt" }));
  expect(e.detail).toContain("no cues found");
});

const LABELS =
  "0.000000\t4.250000\tFirst label text\n" +
  "\\\t20.000000\t8000.000000\n" + // region frequency row — Audacity writes these
  "5.000000\t6.000000\tSecond label\n" +
  "9.500000\tA point label\n";

test("audacity_labels_become_lines_with_gap_pauses", () => {
  const result = runAdapter("audacity_labels", Buffer.from(LABELS, "utf8"), { filename: "markers.txt" });
  expect(result.source).toBe("audacity_labels");
  expect(result.project.name).toBe("markers");
  expect(result.scenes.length).toBe(1);
  const [scene] = result.scenes;
  expect(scene.kind).toBe("label_track");

  // The backslash-prefixed frequency row is skipped, not imported as text.
  expect(scene.lines.map((ln) => ln.text)).toEqual(["First label text", "Second label", "A point label"]);
  expect(scene.lines.map((ln) => ln.source_ref)).toEqual(["label:1", "label:2", "label:3"]);

  // Gap from one label's END to the next label's START: 5.0 - 4.25 = 750ms, then 9.5 - 6.0 =
  // 3500ms. The last label has no successor.
  expect(scene.lines.map((ln) => ln.pause_after_ms)).toEqual([750, 3500, null]);
});

test("a_label_file_with_no_usable_rows_is_rejected", () => {
  const e = apiError(() => runAdapter("audacity_labels", Buffer.from("nocolumns\nnothing here\n"), { filename: "x.txt" }));
  expect(e.detail).toContain("no label rows");
});
