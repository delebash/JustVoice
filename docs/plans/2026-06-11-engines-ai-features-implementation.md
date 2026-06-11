# Plan: Engines + AI-features implementation (approved mocks v7 + ai-features v1)

User approved 2026-06-11 after seven mock iterations. Contracts:
`preview/engines-redesign.html` (v7) and `preview/ai-features-redesign.html`.
Decision log lives in the mock headers. Headlines: free-vs-money two-tab
Engines (Local models / Online providers); one row per model, engines as
collapsed group headers; verb pairs Install/Uninstall engine (ISOLATED
only) · Download/Delete model · Load/Unload model; search + capability
chips (TTS/STT/LLM/EMBED) both tabs; provider rows w/ inline edit + live
/v1/models combobox; Loaded-now rail; fit dots. AI features page: Quick/
Accuracy roles (recommended, never hardcoded), plain-English routing
table, production configs (Lab promote = model + prompts, beats all),
precedence: config > override > role > tier-resolved; nudge after
provider save; External TTS settings tab REMOVED (lives on Engines).

## Slice 1 — backend

- `EngineManifest.kinds` (reads `KINDS`, falls back `[KIND]`);
  engines_api `EngineInfo.kinds` (keep `kind` = kinds[0]).
- `/v1/engines/{id}/models`: per-variant `on_disk` (HF-cache check —
  generalize capture_readiness's `_check_model_cached`).
- Settings: `EnginesSettings.llm_roles: {quick, accuracy}` of
  `{provider_id, model}`; `FeaturePinConfig.role` ("quick"/"accuracy");
  `EnginesSettings.production_configs: list[ProductionConfig]`
  {feature, name, provider_id, model, tier, temperature, system_prompt,
  user_prompt, promoted_at, source}.
- dispatch.resolve_pin precedence: production config (model part) >
  pin explicit provider/model > pin.role > DEFAULT_FEATURE_ROLES map
  (refine/compose/persona_rewrite/gender→quick; speaker_attribution/
  show_notes/smart_assign/render_preset_suggest→accuracy) > first
  registered adapter (current fallback). Extraction pipeline consumes
  the config's prompts/temperature when active.
- `GET /v1/llm-roles/recommendations` — candidates + recommended pair
  from registry adapters + local engines via tiers.py size classes.
- Speaker Lab promote upgraded: writes ProductionConfig (full freeze)
  + keeps pin write; `DELETE /v1/production-configs/{feature}` = revert.

## Slice 2 — EnginesView rebuild to v7

Two tabs; sections w/ counts; collapsed groups (loaded/downloading
auto-open); model rows w/ on_disk-driven verbs; rail (loaded_for per
kind + per-kind unload); fit dots (variant.vram_mb vs /v1/system VRAM
when known, REQUIREMENTS fallback; hide dot when unknown); search +
cap chips; ISOLATED badge via manifest.isolation; shared-runtime line
(setup-shared-venv status + rebuild/remove endpoints exist?); provider
rows JustWrite-style w/ inline edit, presets, live model fetch
(llm-providers models endpoint; voices for TTS), EMBED fields; nudge
handoff: after provider save → sessionStorage flag → Settings AI
features banner.

## Slice 3 — Settings · AI features rebuild + External TTS tab removal

Roles card (recommendations endpoint, RECOMMENDED tag), routing table
(feature rows w/ inherit-role/override, resolved display, CONFIG tag),
production configs card (active name, Open in Speaker Lab link, Revert),
usage strip (existing /v1/ai-usage), nudge banner consuming the
handoff flag. Delete the `external` subnav entry + its card (data stays
in settings.engines.external; UI home = Engines → Online providers).

## Slice 4 — verification + docs

pytest per slice (kinds back-compat, on_disk, role resolution order,
config precedence, recommendations); Playwright drive of both rebuilt
surfaces (zero JS errors, tab split, filters, rail unload, provider
edit fetch, roles save, revert); `node scripts/e2e.mjs` green;
IMPLEMENTATION_PLAN + CONCEPTS + MORNING_RECAP updated; commits per
slice with full gates.
