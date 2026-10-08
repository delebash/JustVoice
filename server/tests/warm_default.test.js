// SPDX-License-Identifier: MIT
// JustVoice rides the family's warm-on-startup default (ON) since 2026-08-13 (the port of
// tests/test_warm_default.py). The 2026-08-05 warm-OFF override was a stopgap retired as the
// VRAM wiring's last step: with budgeted arbitration live, an idle warm LLM is simply
// evictable, so the shared seed's "1" reaches fresh databases. Seeds-only rule: an existing
// DB's stored value is never flipped either way.
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(closeApps);

async function warm(c) {
  const r = await c.get("/v1/ai/engine-config");
  expect(r.status).toBe(200);
  return r.json().warmDefaultOnStartup;
}

test("fresh_db_seeds_warm_on", async () => {
  // The family default reaches a fresh JustVoice DB — no override left to block it.
  const { c } = await appClient(tmpPath(), { seed: true });
  expect(await warm(c)).toBe(true);
});

test("stored_warm_off_survives_reboot", async () => {
  // Seeds-only honesty: a DB carrying warm OFF is NOT flipped by a boot — the shared seed is
  // insert-if-missing and no code rewrites the row.
  const dir = tmpPath();
  const { c } = await appClient(dir, { seed: true });
  const r = await c.put("/v1/ai/engine-config", { json: { warmDefaultOnStartup: false } });
  expect(r.status).toBe(200);
  expect(await warm(c)).toBe(false);
  const { c: c2 } = await appClient(dir, { seed: true });
  expect(await warm(c2)).toBe(false);
});
