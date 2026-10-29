// SPDX-License-Identifier: MIT
// A folder the user linked into the data folder (an NTFS junction on Windows — it needs no special
// right — a symbolic link elsewhere) is removed as a link, never emptied: Node 24's recursive rmSync
// follows a junction and empties the folder it points to (the kit's RESEARCH §2, measured
// 2026-10-20), so the removers here are fs.promises.rm (decided 2026-10-20, the kit's sixteenth
// review). Each case links an outside folder under what it removes; its file must stay. The speech
// models' cache and its clear are the kit's since round E (docs/plans/2026-10-29-round-e-onto-the-
// kit.md §5 item 12), so the one remover left here is the factory reset's.
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { runFactoryReset } from "../src/data_admin.js";
import { generationsRoot } from "../src/paths.js";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(closeApps);

/** An outside folder with one file, linked at `at`. Returns the file. */
function linkedOutside(at) {
  const outside = path.join(tmpPath(), "outside");
  mkdirSync(outside, { recursive: true });
  const file = path.join(outside, "keep.txt");
  writeFileSync(file, "the user's own");
  mkdirSync(path.dirname(at), { recursive: true });
  symlinkSync(outside, at, "junction");
  return file;
}

test("a factory reset removes a linked folder inside the takes, not what it points to", async () => {
  const { dir } = await appClient();
  const kept = linkedOutside(path.join(generationsRoot(dir), "linked"));
  await runFactoryReset();
  expect(existsSync(kept)).toBe(true);
});
