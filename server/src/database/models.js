// SPDX-License-Identifier: MIT
// Table names and the two computed column defaults.
//
// Every entity is exported as the name of its table, so a query reads `h.get(Persona, id)` or
// `select * from ${Persona}` and a table is renamed in one place. The schema itself — each
// table's DDL, column kinds and defaults — is `models_schema.js`; this module only re-exports it.
//
// The schema names two JavaScript defaults by a fixed string (`defaultFn` / `onupdateFn` on every
// `id`, `created_at` and `updated_at` column). They are registered with the kit's database helper
// as this module loads — `session.js` imports it, so the registration is in place before the first
// insert. Without them an insert that leaves an id or a timestamp out throws.

import { randomUUID } from "node:crypto";
import { registerDefaultFn } from "@delebash/llm-runner/platform/sql";
import { utcNowNaive } from "../models.js";
import { TABLES } from "./models_schema.js";

export { TABLES };

/** The table names, in the schema's order. */
export const TABLE_NAMES = TABLES.map((t) => t.name);

/** A new random id (UUID v4, with dashes). */
export const uuid = () => randomUUID();

/** Now, as naive UTC — the form every stored timestamp takes. */
export const utcnow = () => utcNowNaive();

// The names the schema refers to; they must match `models_schema.js` exactly.
registerDefaultFn("justvoice.database.models._uuid", uuid);
registerDefaultFn("justvoice.database.models._utcnow", utcnow);

export const Persona = "personas";
export const PersonaChannel = "persona_channels";
export const Lexicon = "lexicons";
export const LexiconEntry = "lexicon_entries";
export const Project = "projects";
export const Speaker = "speakers";
export const Scene = "scenes";
export const Block = "blocks";
export const Generation = "generations";
export const Take = "takes";
export const GenerationVersion = "generation_versions";
export const RenderJob = "render_jobs";
export const RenderJobBlock = "render_job_blocks";
export const Story = "stories";
export const StoryItem = "story_items";
export const Channel = "channels";
export const MCPBinding = "mcp_bindings";
export const Capture = "captures";
export const EffectPreset = "effect_presets";
export const Webhook = "webhooks";
export const SpeakerCorrection = "speaker_corrections";
export const Pref = "prefs";
export const SettingsRow = "settings";
