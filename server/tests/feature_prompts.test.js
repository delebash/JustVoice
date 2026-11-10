// SPDX-License-Identifier: MIT
// /v1/ai/prompts — every JV action is a SHARED template row (F1 Phase 2: the legacy shadow
// editor died; the kit's prompt router serves this path), the endpoints read their prompt from
// the DB, and tunables live on presets (the port of tests/test_feature_prompts.py).
import { render } from "@delebash/core/llm/prompts";
import { fingerprint } from "@delebash/core/platform";
import { afterEach, expect, test } from "vitest";
import * as projectsApi from "../src/api/projects_api.js";
import * as smartAssignApi from "../src/api/smart_assign_api.js";
import { seedWorkspace } from "../src/database/seed.js";
import { DEFAULT_FEATURE_PROMPTS as D, FEATURE_PROMPT_HEALS } from "../src/seed_feature_prompts.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

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

test("endpoints_have_no_hardcoded_system_constant", () => {
  // The migrated endpoints must not carry a SYSTEM_PROMPT constant anymore — the prompt comes
  // from the DB store. (Python's hasattr on the module; here the module's exports.)
  expect(smartAssignApi).not.toHaveProperty("SYSTEM_PROMPT");
  expect(projectsApi).not.toHaveProperty("SHOW_NOTES_SYSTEM");
});

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

test("extraction_config_serves_db_prompts", async () => {
  // The Speaker Lab's config endpoint now sources its prompt bodies from the DB.
  const { c } = await appClient(undefined, { seed: true });
  const r = await c.get("/v1/extraction/config");
  expect(r.status, r.text).toBe(200);
  const body = r.json();
  expect(body.system_prompts.guided).toContain("WORKED EXAMPLES");
  expect(body.system_prompts.direct).not.toContain("WORKED EXAMPLES");
  expect(body.user_template).toContain("{{paragraphs}}");
});

test("renamed_placeholders_keep_every_word_the_model_reads", () => {
  // 2026-09-29: the placeholders are named for speakers and personas so the Lab's boxes say so
  // ({{speakers}}, {{known_speakers}}, {{personas}}), but the words the model reads did not
  // change — "Known characters:", "Characters in this scene:", "Available voices:" stay. Checked
  // byte for byte against the templates before the rename; pinned here.
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
});

// A revised prompt reaches a database seeded before it; one its owner edited is never touched — and a prompt can't
// change without its old text kept (seed_feature_prompts.js FEATURE_PROMPT_HEALS, the kit's featurePromptHeals; the
// template's test, since 2026-11-10). Today's system text of EVERY prompt row: a change here means a prompt changed —
// add its OLD text, byte for byte, to FEATURE_PROMPT_HEALS, then update this line.
const TODAY = {
  "speaker_attribution.guided": "61523bc62987837e",
  "speaker_attribution.direct": "d81dca18b4e3b37d",
  "speaker_attribution.identify": "87cb36031e7999f0",
  "speaker_merge.local": "a5314f02fa826c3a",
  "speaker_merge.frontier": "08a8f87e3943abae",
  "smart_assign": "37675b06834ac8be",
  "show_notes": "0cfa2b11eab5b2d7",
  "compose": "0e4f08f42546f250",
  "persona_rewrite": "14eb8776221363b4",
  "refine.base": "f372963cebf73df4",
  "refine.smart_cleanup": "eb753be2228f4f45",
  "refine.self_correction": "cd93f84911d5f646",
  "refine.preserve_technical": "c2ca7fddd7f67d46",
  "speaker_second_look": "e1e4e43c675e58b8",
  "direction.local": "ae19475791c43a92",
  "direction.frontier": "e372dbc252b68f35",
  "speaker_group": "ab6213db04afe3be",
  "voice_gender": "41943ffe9d5f6045",
  "book_voices.speaker": "444a5419da0dbfb0",
  "book_voices.narrator": "19b17372d15ce2c1",
  "book_voices.cast": "2c35b2bed17e0626",
};

test("todays_prompts_are_the_ones_this_test_knows_and_none_is_listed_as_an_earlier_text", () => {
  expect(Object.fromEntries(Object.entries(D).map(([k, v]) => [k, fingerprint(v.system)]))).toEqual(TODAY);
  for (const [key, olds] of Object.entries(FEATURE_PROMPT_HEALS)) {
    expect(D[key], key).toBeTruthy();
    expect(olds, key).not.toContain(D[key].system);
  }
});

// The app hands its heals to the kit: an earlier text listed for a key (made up here — no prompt is revised yet) is
// replaced at the next seed, and an edited prompt is left alone. The rows are set as the AI Lab sets them.
const HEAL_KEY = "smart_assign";
const EARLIER = "You are a casting director. (an earlier text, for this test)";
afterEach(() => {
  delete FEATURE_PROMPT_HEALS[HEAL_KEY];
});

test("a_prompt_still_at_an_earlier_text_takes_todays_at_the_next_seed_and_an_edited_one_is_left_alone", async () => {
  FEATURE_PROMPT_HEALS[HEAL_KEY] = [EARLIER];
  const { c } = await appClient(undefined, { seed: true });
  const today = D[HEAL_KEY];
  const system = async () => (await c.get(`/v1/ai/prompts/${HEAL_KEY}`)).json().system;
  const set = (text) => c.put(`/v1/ai/prompts/${HEAL_KEY}`, { json: { feature: today.feature, system: text, userTemplate: today.user_template } });
  expect(await system()).toBe(today.system); // a fresh install holds today's
  await set(EARLIER); // as a database seeded before the revision
  await seedWorkspace();
  expect(await system()).toBe(today.system);
  const edited = `${EARLIER} Keep it short.`; // the owner's own words, never touched
  await set(edited);
  await seedWorkspace();
  expect(await system()).toBe(edited);
});
