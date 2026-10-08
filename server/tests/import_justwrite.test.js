// SPDX-License-Identifier: MIT
// justwrite adapter — the book zip JustWrite really exports (the port of
// tests/test_import_justwrite.py).
//
// The other half of this contract lives in JustWrite: a test there asserting
// `book_io.assemble()` still emits the key paths read here. It is recorded in docs/dev/TASKS.md
// and not built, so these fixtures are JustVoice's only guard against the shape drifting.
import { ZipWriter } from "@delebash/llm-runner/platform/zip";
import { expect, test } from "vitest";
import { ApiError } from "../src/errors.js";
import { listAdapters, runAdapter } from "../src/imports/index.js";
import { bookJson, bookZip, scene } from "./jw_fixtures.js";

function apiError(fn) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e;
  }
  throw new Error("expected an ApiError");
}

test("zip_maps_chapters_in_order_with_prose_and_cast", () => {
  const raw = bookZip(
    bookJson({
      title: "The Ninth Facet",
      premise: "A river town keeps its secrets.",
      characters: [
        { id: "mara", name: "Mara Vance", age: 34, gender: "female", pronouns: "she/her", role: "protagonist", oneLiner: "Runs the ferry.", aliases: ["Em", "the ferrywoman"] },
      ],
      chapters: [
        ["ch1", "Departure", [scene("s1", "It began at dawn."), scene("s2", "The dock was empty.")]],
        ["ch2", "Arrival", [scene("s3", "She counted the lights.")]],
      ],
    }),
  );

  const result = runAdapter("justwrite", raw, { filename: "The Ninth Facet.zip" });

  expect(result.source).toBe("justwrite");
  expect(result.project.name).toBe("The Ninth Facet");
  expect(result.project.kind).toBe("audiobook");
  expect(result.project.description).toBe("A river town keeps its secrets.");

  // One JustVoice scene per JustWrite CHAPTER, in the book's order.
  expect(result.scenes.map((s) => s.id)).toEqual(["ch1", "ch2"]);
  expect(result.scenes.map((s) => s.title)).toEqual(["Departure", "Arrival"]);
  // Both of chapter one's scenes land inside it, in order...
  expect(result.scenes[0].lines.map((ln) => ln.text)).toEqual(["It began at dawn.", "The dock was empty."]);
  // ...with the scene boundary preserved in source_ref.
  expect(result.scenes[0].lines.map((ln) => ln.source_ref)).toEqual(["chapter:ch1#scene:s1#block:0", "chapter:ch1#scene:s2#block:0"]);
  // JustWrite does not attribute dialogue, so every line is speakerless. That is the expected
  // result, NOT something to warn about.
  expect(result.scenes.every((s) => s.lines.every((ln) => ln.character_id === null))).toBe(true);
  expect(result.warnings.filter((w) => w.toLowerCase().includes("speaker"))).toEqual([]);

  expect(result.characters.length).toBe(1);
  const [mara] = result.characters;
  expect([mara.id, mara.name]).toEqual(["mara", "Mara Vance"]);
  expect(mara.voice_hint).toBe("female, age 34, protagonist");
  expect(mara.notes).toBe("Runs the ferry. · Also known as: Em, the ferrywoman");
  // A JustWrite book carries no pronunciation data.
  expect(result.lexicon_entries).toEqual([]);
});

test("separators_scene_titles_and_markup_are_not_narrated", () => {
  // The three things that must never reach a voice engine: JustWrite's own scene separator,
  // the planning label on a scene, and inline markup.
  const body = '<p>She waited.</p><p class="scene-mark">* * *</p><p>He said <strong>no</strong>.</p><hr>';
  const raw = bookZip(bookJson({ chapters: [["ch1", "One", [{ id: "s1", title: "Mara confronts him", body }]]] }));
  const { scenes } = runAdapter("justwrite", raw, { filename: "b.zip" });
  expect(scenes.length).toBe(1);
  expect(scenes[0].lines.map((ln) => ln.text)).toEqual(["She waited.", "He said no."]);
});

test("empty_chapters_are_skipped_and_named_in_a_warning", () => {
  const raw = bookZip(
    bookJson({
      chapters: [
        ["ch1", "Written", [scene("s1", "Real prose.")]],
        ["ch2", "Outlined", [scene("s2")]],
        ["ch3", "Also outlined", []],
      ],
    }),
  );
  const result = runAdapter("justwrite", raw, { filename: "b.zip" });
  expect(result.scenes.map((s) => s.id)).toEqual(["ch1"]);
  const skipped = result.warnings.filter((w) => w.includes("skipped"));
  expect(skipped.length).toBe(1);
  expect(skipped[0]).toContain("Outlined");
  expect(skipped[0]).toContain("Also outlined");
});

test("a_book_with_nothing_written_is_rejected", () => {
  const raw = bookZip(bookJson({ chapters: [["ch1", "Outlined", []]] }));
  const e = apiError(() => runAdapter("justwrite", raw, { filename: "b.zip" }));
  expect(e.detail).toContain("no readable text");
});

test("images_are_ignored_but_counted", () => {
  const raw = bookZip(bookJson(), { images: { "cover.png": Buffer.from("not-really-a-png"), "face.jpg": Buffer.from("jpeg") } });
  const result = runAdapter("justwrite", raw, { filename: "b.zip" });
  const notes = result.warnings.filter((w) => w.includes("image"));
  expect(notes.length).toBe(1);
  expect(notes[0]).toContain("2 image file(s)");
});

test("a_bare_book_json_also_parses", () => {
  const raw = Buffer.from(JSON.stringify(bookJson()), "utf8");
  const result = runAdapter("justwrite", raw, { filename: "book.json" });
  expect(result.scenes.map((s) => s.title)).toEqual(["One"]);
  expect(result.warnings.filter((w) => w.includes("image"))).toEqual([]);
});

test("a_non_justwrite_json_is_rejected_and_names_the_right_adapter", () => {
  const raw = Buffer.from(JSON.stringify({ schema_version: "1.0", source: "justvoice_standard", project: { name: "x" } }), "utf8");
  const e = apiError(() => runAdapter("justwrite", raw, { filename: "payload.json" }));
  expect(e.detail).toContain("justvoice_standard");
});

test("a_zip_without_book_json_is_rejected", () => {
  const zf = new ZipWriter();
  zf.writestr("The Ninth Facet/notes.txt", "nope");
  const e = apiError(() => runAdapter("justwrite", zf.toBuffer(), { filename: "x.zip" }));
  expect(e.detail).toContain("book.json");
});

test("the_format_picker_offers_the_zip", () => {
  // The renderer's file dialog filters on these extensions (ImportModal.vue), so a missing .zip
  // would make the export unpickable.
  const infos = listAdapters().filter((a) => a.id === "justwrite");
  expect(infos.length).toBe(1);
  expect(infos[0].file_extensions).toContain(".zip");
  expect(infos[0].implemented).toBe(true);
});
