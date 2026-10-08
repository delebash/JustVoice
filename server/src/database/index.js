// SPDX-License-Identifier: MIT
// SQLite — the primary persistence layer (the port of justvoice/database/__init__.py).
// Every entity lives here; `settings.json` was folded into the `settings` table and renderer
// prefs into `prefs` (the 2026-06-19 storage rewrite). Migrations are hand-rolled
// idempotent column-existence checks (migrations.js).

export {
  Block,
  Capture,
  Channel,
  EffectPreset,
  Generation,
  GenerationVersion,
  Lexicon,
  LexiconEntry,
  MCPBinding,
  Persona,
  PersonaChannel,
  Pref,
  Project,
  RenderJob,
  RenderJobBlock,
  Scene,
  SettingsRow,
  Speaker,
  SpeakerCorrection,
  Story,
  StoryItem,
  TABLE_NAMES,
  TABLES,
  Take,
  Webhook,
} from "./models.js";
export { cfg, closeDb, getDb, getDbPath, initDb } from "./session.js";
