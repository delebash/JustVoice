// SPDX-License-Identifier: MIT
// The shared prompt rows JustVoice seeds (the port of tests/test_feature_prompts.py). Five
// tests drive the app's routes (other slices). The placeholder test is ported whole and runs
// once seed_feature_prompts.js can load — it imports the extraction and refinement prompt
// texts from their own (other-slice) modules.
import { expect, test } from "vitest";
import { render } from "@delebash/llm-runner/llm/prompts";

let D = null;
try {
  ({ DEFAULT_FEATURE_PROMPTS: D } = await import("../src/seed_feature_prompts.js"));
} catch (e) {
  if (!/Cannot find module/.test(String(e?.message))) throw e;
}

test.todo("prompts_seeded_and_editable — waits for app.js + engines/llm/*");
test.todo("reset_and_get_unknown — waits for app.js + engines/llm/*");
test.todo("endpoints_have_no_hardcoded_system_constant — waits for api/projects_api.js + api/smart_assign_api.js");
test.todo("extraction_prompts_seeded — waits for app.js + extraction/prompts.js");
test.todo("extraction_config_serves_db_prompts — waits for app.js + extraction/*");

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
