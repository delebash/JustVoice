// SPDX-License-Identifier: MIT
// Which build a Load actually fetches. View-local until 2026-08-21, and it
// shipped broken twice: first it sent nothing at all (so the Size dropdown was
// decorative), then it sent the capability row's id — which is a checkpoint
// FAMILY, not a loadable variant. The catalog ids below are the real ones from
// GET /v1/engines/{id}/models. (The grid's row-state rule is the same kind of
// thing and is tested in voiceGrid.test.js.)
import { describe, it, expect } from "vitest";
import { variantToLoad } from "./capabilities.js";

// The real catalogs — the manifests' variant ids (engines/<id>/manifest.py), re-checked
// 2026-10-04 after the audio.cpp switch renamed every build.
const KOKORO = [{ id: "kokoro-82m-q8" }, { id: "kokoro-82m-bf16" }];
const CHATTERBOX = [
  { id: "chatterbox-multilingual-v2-q8" },
  { id: "chatterbox-multilingual-v2-f16" },
  { id: "chatterbox-turbo-q8" },
  { id: "chatterbox-nano-q8" },
];
const QWEN3 = [
  { id: "qwen3-cv-1.7b-q8" }, { id: "qwen3-cv-0.6b-q8" },
  { id: "qwen3-base-1.7b-q8" }, { id: "qwen3-base-0.6b-q8" },
  { id: "qwen3-vd-1.7b-q8" },
];

describe("variantToLoad", () => {
  it("sends nothing when there is no row", () => {
    expect(variantToLoad(null, "", KOKORO)).toBe(null);
  });

  it("sends nothing when the engine has no catalog yet", () => {
    // Better a server-side default than a guessed id.
    expect(variantToLoad({ rowId: "kokoro", isVariant: false }, "", [])).toBe(null);
    expect(variantToLoad({ rowId: "kokoro", isVariant: false }, "", undefined)).toBe(null);
  });

  it("resolves a family row to a real build, NOT to the row id", () => {
    // The bug this function exists to prevent: "chatterbox-turbo" is not a
    // variant — no catalog row has that id, so sending it loads nothing the
    // user picked.
    expect(variantToLoad({ rowId: "chatterbox-turbo", isVariant: true }, "", CHATTERBOX))
      .toBe("chatterbox-turbo-q8");
    expect(variantToLoad({ rowId: "chatterbox-nano", isVariant: true }, "", CHATTERBOX))
      .toBe("chatterbox-nano-q8");
  });

  it("never returns a bare row id that the catalog does not contain", () => {
    for (const rowId of ["chatterbox-turbo", "chatterbox-nano"]) {
      expect(variantToLoad({ rowId, isVariant: true }, "", CHATTERBOX)).not.toBe(rowId);
    }
    expect(variantToLoad({ rowId: "kokoro", isVariant: false }, "", KOKORO)).not.toBe("kokoro");
  });

  it("takes the family's first build when Size is not showing", () => {
    // A single-build family has no Size dropdown, so this is the only path.
    expect(variantToLoad({ rowId: "qwen3-vd", isVariant: true }, "", QWEN3)).toBe("qwen3-vd-1.7b-q8");
  });

  it("lets an explicit Size choice win", () => {
    expect(variantToLoad({ rowId: "qwen3-base", isVariant: true }, "qwen3-base-0.6b-q8", QWEN3))
      .toBe("qwen3-base-0.6b-q8");
    expect(variantToLoad({ rowId: "kokoro", isVariant: false }, "kokoro-82m-bf16", KOKORO))
      .toBe("kokoro-82m-bf16");
  });

  it("ignores a Size that is not in this engine's catalog", () => {
    // A stale selection left over from the previously picked model must not be
    // sent to a different engine.
    expect(variantToLoad({ rowId: "kokoro", isVariant: false }, "qwen3-base-0.6b-q8", KOKORO))
      .toBe("kokoro-82m-q8");
  });

  it("does not let one family's prefix match another's builds", () => {
    // "qwen3-cv" must not pick up "qwen3-cv-…"'s siblings under "qwen3-".
    expect(variantToLoad({ rowId: "qwen3-cv", isVariant: true }, "", QWEN3)).toBe("qwen3-cv-1.7b-q8");
  });
});
