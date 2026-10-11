// SPDX-License-Identifier: MIT
// The speech engine list built from audio.cpp's own files (scripts/audiocpp-catalog.js →
// engines/audiocpp/catalog.json; docs/plans/2026-10-11-audiocpp-engine-catalog.md slice 1).
// The file must match the pin, and every speech family in it must carry what the app shows
// before anything is downloaded: a name, a status, a model to register, its files' sizes, and a
// licence verdict in audio.cpp's own words.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseLicences } from "../../scripts/audiocpp-catalog.js";
import { cfg, MODEL_REPO, MODEL_REVISION } from "../src/engines/audiocpp/release.js";

const catalog = JSON.parse(readFileSync(new URL("../src/engines/audiocpp/catalog.json", import.meta.url), "utf8"));
const speech = Object.values(catalog.families).filter((f) => (f.tasks || []).some((t) => t === "tts" || t === "clone"));
const VERDICTS = ["Yes", "Conditional", "No", "Unclear"];

test("the catalog was built from the pinned release and model revision", () => {
  expect(catalog.generated_from.audiocpp_ref).toBe(cfg.TAG);
  expect(catalog.generated_from.model_repo).toBe(MODEL_REPO);
  expect(catalog.generated_from.model_revision).toBe(MODEL_REVISION);
});

test("every speech family says what it is and how sure audio.cpp is of it", () => {
  expect(speech.length).toBeGreaterThan(0);
  for (const f of speech) {
    expect(f.display_name, f.family).toBeTruthy();
    expect(["supported", "community", "experimental", "wip", "unsupported", "testing"], f.family).toContain(f.status);
    if (f.licence) expect(VERDICTS, f.family).toContain(f.licence.commercial_use);
  }
});

test("every speech entry names a task and a package the family has, with sized files", () => {
  for (const f of speech) {
    for (const e of f.entries) {
      expect(e.task, `${f.family}/${e.id}`).toBeTruthy();
      if (!e.package) continue; // audio.cpp offers no download for it (weights placed by hand)
      const pkg = f.packages.find((p) => p.id === e.package);
      expect(pkg, `${f.family}/${e.id} → ${e.package}`).toBeTruthy();
      for (const file of pkg.source.files) {
        if (file.missing) continue; // not at the pinned revision — the app leaves it out
        expect(file.size_bytes, `${pkg.id}: ${file.path}`).toBeGreaterThan(0);
      }
    }
  }
});

test("the licence table is read in audio.cpp's own words, every family of a row", () => {
  const md = [
    "| Family | Original weights | License | Commercial use | Notes | Checked |",
    "|---|---|---|---|---|---|",
    "| `a_tts` | [Org/A](https://hf.co/Org/A) | [A Licence](https://hf.co/Org/A/LICENSE) | Conditional | Under 1M users. | 2026-09-21 |",
    "| `b_tts`, `b_asr` | Not linked | Apache-2.0 | Yes | | 2026-09-22 |",
  ].join("\n");
  const rows = parseLicences(md);
  expect(rows.a_tts).toEqual({
    licence: "A Licence",
    licence_links: [{ name: "A Licence", url: "https://hf.co/Org/A/LICENSE" }],
    commercial_use: "Conditional",
    notes: "Under 1M users.",
    weights: [{ name: "Org/A", url: "https://hf.co/Org/A" }],
    checked: "2026-09-21",
  });
  expect(rows.b_asr.commercial_use).toBe("Yes");
  expect(rows.b_tts.licence).toBe("Apache-2.0");
});
