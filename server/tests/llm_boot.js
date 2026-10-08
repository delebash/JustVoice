// SPDX-License-Identifier: MIT
// The LLM half of `create_app` + `seed_workspace`, headless: the database at `dir`, the app
// state, the kit's installLlm with JustVoice's own seeds (feature prompts, presets, catalog),
// then the workspace seed — what Python's `TestClient(create_app(data_dir=tmp_path))` +
// `seed_workspace()` gave a test that reads the shared prompt or preset stores. (app.js is the
// API wave's; this is the same boot without the routes.)
import { installLlm } from "@delebash/llm-runner/llm";
import { AppState, setState } from "../src/app_state.js";
import { seedWorkspace } from "../src/database/seed.js";
import * as session from "../src/database/session.js";
import { FEATURE_CATALOG, PREFER_LOCAL_FEATURES } from "../src/feature_catalog.js";
import { DEFAULT_FEATURE_PROMPTS } from "../src/seed_feature_prompts.js";
import * as seedPresets from "../src/seed_presets.js";
import { PRODUCT } from "../src/version.js";

export async function llmBoot(dir, { seed = true } = {}) {
  session.closeDb();
  session.cfg.dbPath = null;
  session.initDb(dir);
  setState(new AppState(dir));
  await installLlm(null, {
    db: session.getDb(),
    featureCatalog: FEATURE_CATALOG,
    featurePrompts: DEFAULT_FEATURE_PROMPTS,
    enginePresets: seedPresets.DEFAULT_ENGINE_PRESETS,
    featurePresets: seedPresets.DEFAULT_FEATURE_PRESETS,
    defaultPresetId: seedPresets.DEFAULT_PRESET_ID,
    testSamples: seedPresets.DEFAULT_TEST_SAMPLES,
    modelCatalogExtra: seedPresets.JV_MODEL_CATALOG,
    classTunesSeed: seedPresets.JV_CLASS_TUNES,
    classTuneIdentity: seedPresets.JV_CLASS_TUNE_IDENTITY,
    preferLocalFeatures: PREFER_LOCAL_FEATURES,
    dataDir: dir,
    product: PRODUCT,
  });
  if (seed) await seedWorkspace();
}
