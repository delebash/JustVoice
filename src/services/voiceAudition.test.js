// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";

vi.mock("@delebash/ui", () => ({ confirmDialog: vi.fn(), pushToast: vi.fn() }));
vi.mock("./prefs.js", () => ({ readPref: (_k, fallback) => fallback, writePref: () => {} }));

const { lexiconPreviewBody, lexiconTake, replaysTake } = await import("./voiceAudition.js");

// Lexicons' ▶ and Try a word (2026-10-13): the line as a render reads it — the book's
// lexicon, then the persona's — with this lexicon in its slot (After) or without it (Before).
describe("lexiconPreviewBody — this lexicon in its slot, beside the book's", () => {
  const june = { id: "p1", name: "June", voice_id: "Sohee", lexicon_id: "lex-june" };
  const entries = [{ grapheme: "Worcester", alias: "Wooster" }];

  it("puts a lexicon the book didn't choose in the persona's slot, after the book's", () => {
    const book = { id: "b1", default_lexicon_id: "lex-book" };
    const after = lexiconPreviewBody(june, "To Worcester.", { lexiconId: "lex-x", entries, book, after: true });
    expect(after).toEqual({
      persona: { ...june, lexicon_id: "lex-x" }, text: "To Worcester.", project_id: "b1",
      draft_lexicon: { id: "lex-x", entries },
    });
    const before = lexiconPreviewBody(june, "To Worcester.", { lexiconId: "lex-x", entries, book, after: false });
    expect(before).toEqual({ persona: { ...june, lexicon_id: null }, text: "To Worcester.", project_id: "b1" });
  });

  it("puts the book's own lexicon in the book's slot, the persona keeping its own", () => {
    const book = { id: "b1", default_lexicon_id: "lex-book" };
    const after = lexiconPreviewBody(june, "Hi", { lexiconId: "lex-book", entries, book, after: true });
    expect(after.project_id).toBe("b1");
    expect(after.persona.lexicon_id).toBe("lex-june");
    expect(after.draft_lexicon).toEqual({ id: "lex-book", entries });
    const before = lexiconPreviewBody(june, "Hi", { lexiconId: "lex-book", entries, book, after: false });
    expect("project_id" in before).toBe(false);
    expect(before.persona.lexicon_id).toBe("lex-june");
    // A persona that carries the book's lexicon too doesn't read it Before.
    const both = { ...june, lexicon_id: "lex-book" };
    expect(lexiconPreviewBody(both, "Hi", { lexiconId: "lex-book", book, after: false }).persona.lexicon_id).toBeNull();
  });

  it("with no book, swaps the persona's slot alone, as before", () => {
    const after = lexiconPreviewBody(june, "Hi", { lexiconId: "lex-x", after: true });
    expect(after).toEqual({ persona: { ...june, lexicon_id: "lex-x" }, text: "Hi" });
    const before = lexiconPreviewBody(june, "Hi", { lexiconId: "lex-x", after: false });
    expect(before).toEqual({ persona: { ...june, lexicon_id: null }, text: "Hi" });
  });
});

// 2026-10-15: Try a word replayed the old take when the word changed.
describe("replaysTake — ▶ replays a take only while it says the same thing", () => {
  const june = { id: "p1" };
  const mara = { id: "p2" };
  it("replays the same word, in the same voice, before or after alike", () => {
    const take = lexiconTake(june, "Worcester ", "after");
    expect(replaysTake("try:after", "try:after", take, lexiconTake(june, "Worcester", "after"))).toBe(true);
  });
  it("asks again for a changed word or persona, or another button", () => {
    const take = lexiconTake(june, "Worcester", "after");
    expect(replaysTake("try:after", "try:after", take, lexiconTake(june, "Beauchamp", "after"))).toBe(false);
    expect(replaysTake("try:after", "try:after", take, lexiconTake(mara, "Worcester", "after"))).toBe(false);
    expect(replaysTake("try:after", "try:before", take, lexiconTake(june, "Worcester", "before"))).toBe(false);
  });
});
