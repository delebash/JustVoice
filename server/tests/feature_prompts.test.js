// SPDX-License-Identifier: MIT
// The shared prompt rows JustVoice seeds (the port of tests/test_feature_prompts.py). Two
// tests wait for the API wave's later routers (projects / smart_assign, extraction).
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { render } from "@delebash/llm-runner/llm/prompts";

afterEach(closeApps);

let D = null;
try {
  ({ DEFAULT_FEATURE_PROMPTS: D } = await import("../src/seed_feature_prompts.js"));
} catch (e) {
  if (!/Cannot find module/.test(String(e?.message))) throw e;
}

test("prompts_seeded_and_editable", async () => {
  const { c } = await appClient(undefined, { seed: true });
  let r = await c.get("/v1/ai/prompts");
  expect(r.status, r.text).toBe(200);
  const byKey = Object.fromEntries(r.json().prompts.map((p) => [p.key, p]));
  // The one-shot features migrated this increment.
  expect(byKey).toHaveProperty("smart_assign");
  expect(byKey).toHaveProperty("show_notes");
  // The 💡 Suggest feature left with render presets (2026-10-03).
  expect(byKey).not.toHaveProperty("render_preset_suggest");
  expect(byKey.smart_assign.system).toContain("casting director");
  expect(byKey.smart_assign.builtIn).toBe(true);

  // An edit persists to the DB and reads back (tunables live on PRESETS — the shared wire
  // carries no temperature).
  r = await c.put("/v1/ai/prompts/smart_assign", { json: { feature: "smart_assign", system: "EDITED", userTemplate: "" } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().system).toBe("EDITED");
  expect((await c.get("/v1/ai/prompts/smart_assign")).json().system).toBe("EDITED");

  // Reset restores the seeded default.
  r = await c.post("/v1/ai/prompts/smart_assign/reset");
  expect(r.status, r.text).toBe(200);
  expect(r.json().system).toContain("casting director");
});

test("reset_and_get_unknown", async () => {
  const { c } = await appClient(undefined, { seed: true });
  expect((await c.post("/v1/ai/prompts/nope/reset")).status).toBe(400);
  expect((await c.get("/v1/ai/prompts/nope")).status).toBe(404);
});
test.todo("endpoints_have_no_hardcoded_system_constant — waits for api/projects_api.js + api/smart_assign_api.js");
test("extraction_prompts_seeded", async () => {
  // The speaker-attribution pipeline + /v1/extraction/config read tier-specific prompts from
  // the DB (speaker_attribution.guided/.direct). The old in-code selector systemFor() is gone.
  const { c } = await appClient(undefined, { seed: true });
  const byKey = Object.fromEntries((await c.get("/v1/ai/prompts")).json().prompts.map((p) => [p.key, p]));
  expect(byKey).toHaveProperty(["speaker_attribution.guided"]);
  expect(byKey).toHaveProperty(["speaker_attribution.direct"]);
  expect(byKey).toHaveProperty(["speaker_attribution.identify"]);
  expect(byKey["speaker_attribution.identify"].system).toContain("casting assistant");
  const g = byKey["speaker_attribution.guided"];
  const d = byKey["speaker_attribution.direct"];
  expect(g.system).toContain("attribute dialogue");
  expect(g.system).toContain("WORKED EXAMPLES");
  expect(d.system).toContain("attribute dialogue");
  expect(d.system).not.toContain("WORKED EXAMPLES");
  expect(g.userTemplate).toContain("{{speakers}}");
  expect(g.userTemplate).toContain("{{paragraphs}}");
  expect(g.feature).toBe("speaker_attribution");
  expect(g.builtIn).toBe(true);
  const prompts = await import("../src/extraction/prompts.js");
  expect(prompts).not.toHaveProperty("systemFor");
});
test.todo("extraction_config_serves_db_prompts — waits for app.js + api/extraction_api.js (GET /v1/extraction/config)");

test.skipIf(D === null)(
  "renamed_placeholders_keep_every_word_the_model_reads (waits for extraction/* + refinement.js)",
  () => {
    // 2026-09-29: the placeholders are named for speakers and personas so the Lab's boxes say
    // so, but the words the model reads did not change — pinned byte for byte.
    const cast = '- id="s1", name="Mara"';
    expect(render(D["speaker_attribution.guided"].user_template, { speakers: cast, corrections: "", paragraphs: "[D1] Hi." })).toBe(
      `Characters in this scene:\n${cast}\n\nParagraphs (dialogue segments tagged inline):\n\n[D1] Hi.\n\n` +
        "Return only the JSON array, one entry per [D#] in the order they appear.\n",
    );
    expect(render(D["speaker_attribution.identify"].user_template, { known_speakers: "- Mara", manuscript: "Text." })).toBe(
      "Known characters:\n- Mara\n\nManuscript text:\nText.",
    );
    expect(render(D.smart_assign.user_template, { speakers: cast, personas: '- id="p1", name="Slate"' })).toBe(
      `Characters:\n${cast}\n\nAvailable voices:\n- id="p1", name="Slate"\n\nReturn only the JSON object.`,
    );
  },
);
