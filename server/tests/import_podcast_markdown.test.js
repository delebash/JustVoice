// SPDX-License-Identifier: MIT
// podcast_markdown adapter — labels, headings, markers, tag preservation (the port of
// tests/test_import_podcast_markdown.py).
import { expect, test } from "vitest";
import { ApiError } from "../src/errors.js";
import { parse } from "../src/imports/adapters/podcast_markdown.js";
import { getAdapter } from "../src/imports/index.js";

const SCRIPT = `# Ep. 42 — The codec episode

SARAH: Welcome back to Signal and Noise. I'm Sarah, that's Jin. [warm]

**JIN:** Mave, your team just shipped a codec that's half the bitrate. [curious]

MAVE: [laughs] Half on a good day.

And the trick is we stopped trying to preserve the waveform.

— Mid-roll marker · ad break —

## Deep dive

JIN: Back to it. Before the break you said something I want to push on.
`;

const enc = (s) => Buffer.from(s, "utf8");

test("labels_headings_markers_and_continuation", () => {
  const out = parse(enc(SCRIPT), { filename: "ep42_script.md" });
  expect(out.project.kind).toBe("podcast");
  expect(out.project.name).toBe("ep42_script");
  expect(out.characters.map((c) => c.name)).toEqual(["Sarah", "Jin", "Mave"]);
  expect(out.scenes.map((s) => s.title)).toEqual(["Ep. 42 — The codec episode", "Deep dive"]);

  const seg1 = out.scenes[0].lines;
  expect(seg1[0].character_id).toBe("sarah");
  expect(seg1[0].text).toContain("[warm]"); // paralinguistic tags preserved
  expect(seg1[1].character_id).toBe("jin");
  expect(seg1[2].character_id).toBe("mave");
  // unlabeled continuation stays with the current speaker
  expect(seg1[3].character_id).toBe("mave");
  expect(seg1[3].text.startsWith("And the trick")).toBe(true);
  // the marker line is unattributed + flagged
  expect(seg1[4].character_id).toBeNull();
  expect(seg1[4].delivery).toEqual({ marker: true });

  expect(out.scenes[1].lines[0].character_id).toBe("jin");
});

test("prose_sentences_with_colons_are_not_labels", () => {
  const out = parse(enc("SARAH: Hi.\n\nThe thing about codecs: they lie.\n"), { filename: "x.md" });
  const lines = out.scenes[0].lines;
  expect(lines.length).toBe(2);
  expect(lines[1].character_id).toBe("sarah"); // continuation, NOT a new 'The thing…' speaker
  expect(out.characters.map((c) => c.id)).toEqual(["sarah"]);
});

test("unlabeled_script_warns", () => {
  const out = parse(enc("Just narration.\n\nMore narration."), { filename: "plain.md" });
  expect(out.characters).toEqual([]);
  expect(out.warnings.some((w) => w.includes("no speaker labels"))).toBe(true);
});

test("empty_rejected_and_registered", () => {
  expect(() => parse(enc("   "), { filename: "empty.md" })).toThrow(ApiError);
  expect(getAdapter("podcast_markdown")).not.toBeNull();
});
