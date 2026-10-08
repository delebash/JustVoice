// SPDX-License-Identifier: MIT
// The JustVoice SQLite schema (the port of justvoice/database/models.py). The tables are
// the DDL Python's create_all writes, captured in models_schema.js by the kit's
// scripts/capture-schema.py — re-generate it when a Python table changes:
//   cd server && .venv/Scripts/python.exe ../../just-llm-runner/server/scripts/capture-schema.py \
//       justvoice.database.models:Base src/database/models_schema.js
//
// Schema is the implementation of DESIGN_FREEZE.md §4. Every entity lives here, including
// operator settings (folded from settings.json) and renderer prefs.
//
// Convention:
// - Primary keys are UUID4 strings — easier to debug than autoincrement integers.
// - Foreign keys use ON DELETE CASCADE where the child has no meaning without its parent;
//   SET NULL where the child outlives it. Foreign keys are ON per connection
//   (database/session.js), as SQLAlchemy's connect hook set them.
// - JSON-shaped columns store a serialized payload as TEXT (Python's json.dumps — write it
//   with pyJson).
// - All datetimes are stored in UTC, as "YYYY-MM-DD HH:MM:SS.ffffff".
//
// Each ORM class name is exported as its table name (`Persona` → "personas"), so a port of
// `db.query(Persona)` reads `h.all(\`select * from ${Persona} …\`)` or `h.get(Persona, id)`.

import { randomUUID } from "node:crypto";
import { registerDefaultFn } from "@delebash/llm-runner/platform/sql";
import { utcNowNaive } from "../models.js";
import { TABLES } from "./models_schema.js";

export { TABLES };

/** `str(uuid.uuid4())` — the primary-key default. */
export const uuid = () => randomUUID();
/** `datetime.utcnow()` — naive UTC, microseconds (models.utcNowNaive). */
export const utcnow = () => utcNowNaive();

// The two Python-side callable defaults the capture lists, by their qualified names, so
// sql.js fills them on insert (and on update for `onupdate=_utcnow`).
registerDefaultFn("justvoice.database.models._uuid", uuid);
registerDefaultFn("justvoice.database.models._utcnow", utcnow);

// ── The ORM classes, as table names ───────────────────────────────────────

// Persona layer — the finished spoken voices (the library). Persona channels: which audio
// output channels a persona plays through.
export const PersonaChannel = "persona_channels";
export const Persona = "personas";
// Lexicon layer (pronunciation dictionaries)
export const Lexicon = "lexicons";
export const LexiconEntry = "lexicon_entries";
// Project layer (use-case generalized: audiobook + game + podcast)
export const Project = "projects";
export const Speaker = "speakers";
export const Scene = "scenes";
export const Block = "blocks";
// Generation + take layer
export const Generation = "generations";
export const Take = "takes";
export const GenerationVersion = "generation_versions";
// Render orchestration
export const RenderJob = "render_jobs";
export const RenderJobBlock = "render_job_blocks";
// Stories (DAW timeline) — kept; nothing reads them since 2026-10-06
export const Story = "stories";
export const StoryItem = "story_items";
// Audio output channels
export const Channel = "channels";
// MCP integration
export const MCPBinding = "mcp_bindings";
// Captures (dictation recordings)
export const Capture = "captures";
// Effects
export const EffectPreset = "effect_presets";
// Webhooks
export const Webhook = "webhooks";
// Speaker-attribution correction memory
export const SpeakerCorrection = "speaker_corrections";
// Renderer UI preferences (key/value JSON; replaces the renderer's localStorage)
export const Pref = "prefs";
// Operator/server settings (singleton row "singleton"; replaces the legacy settings.json)
export const SettingsRow = "settings";

/** Every table name, in creation order (`Base.metadata.tables`). */
export const TABLE_NAMES = TABLES.map((t) => t.name);
