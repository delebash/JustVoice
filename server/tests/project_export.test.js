// SPDX-License-Identifier: MIT
// The project archive — Studio → Overview → Export .justvoice.zip (the port of
// tests/test_project_export.py).
//
// What this pins (2026-10-05): a persona saved with no delivery settings (Cast's batch makes
// them so) exports `{}` — it used to crash the whole export with a 500; and the archive is named
// `<name>-<time>.justvoice.zip`, as the button says (the name as written since 2026-10-15).
import { ZipReader } from "@delebash/llm-runner/platform/zip";
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(closeApps);

test("a_persona_with_no_delivery_exports_and_the_archive_is_named_for_the_button", async () => {
  const { c } = await appClient(undefined, { seed: true });
  let r = await c.post("/v1/projects/import?source=justwrite", {
    json: bookJson({ chapters: [["ch1", "One", [scene("scn1", "“We leave at dawn,” said Mara Vance.")]]] }),
  });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const speaker = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers[0];
  const persona = (await c.post("/v1/personas", { json: { name: "Mara" } })).json();
  expect((await c.patch(`/v1/speakers/${speaker.id}`, { json: { persona_id: persona.id } })).status).toBe(200);

  r = await c.get(`/v1/projects/${pid}/export`);
  expect(r.status, r.text).toBe(200);
  expect(r.headers["content-disposition"].endsWith('.justvoice.zip"')).toBe(true);
  const z = ZipReader.fromBuffer(r.content);
  const saved = JSON.parse(z.read(`personas/${persona.id}.json`).toString("utf8"));
  expect(saved.name).toBe("Mara");
  // Python's `isinstance(saved["default_delivery"], dict)` — a JSON object, not null or a list.
  const delivery = saved.default_delivery;
  expect(delivery !== null && typeof delivery === "object" && !Array.isArray(delivery), JSON.stringify(delivery)).toBe(true);
});

test("the_archive_is_named_by_the_projects_name_as_written", async () => {
  // 2026-10-15 (the narrowings review R7): the name as written, minus only what a Windows file
  // name can't hold (the kit's safeTitle), then the time and .justvoice.zip as before; the header
  // carries it RFC 5987-encoded. It was a lowercase slug of letters and digits.
  const { c } = await appClient(undefined, { seed: true });
  let r = await c.post("/v1/projects/import?source=justwrite", {
    json: bookJson({ chapters: [["ch1", "One", [scene("scn1", "Hello.")]]] }),
  });
  const pid = r.json().project_id;
  expect((await c.patch(`/v1/projects/${pid}`, { json: { name: `Война: "the" Wizard's Tale?` } })).status).toBe(200);
  r = await c.get(`/v1/projects/${pid}/export?include_audio=false`);
  expect(r.status, r.text).toBe(200);
  const header = r.headers["content-disposition"];
  expect([...header].every((ch) => ch >= " " && ch <= "~")).toBe(true);
  expect(decodeURIComponent(header.split("filename*=UTF-8''")[1])).toMatch(/^Война the Wizard's Tale-\d{8}T\d{6}Z\.justvoice\.zip$/);
  // Nothing left of the name: "project", as before.
  expect((await c.patch(`/v1/projects/${pid}`, { json: { name: "???" } })).status).toBe(200);
  r = await c.get(`/v1/projects/${pid}/export?include_audio=false`);
  expect(r.headers["content-disposition"]).toMatch(/^attachment; filename="project-\d{8}T\d{6}Z\.justvoice\.zip"$/);
});
