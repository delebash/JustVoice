# JV shared-LLM integration — DECISIONS RECORD (2026-07-15)

> ⛔ **EXECUTED HISTORY (archived 2026-08-06, code-verified).** F1 executed ~90% of
> this record as decided; the notable supersessions: §5.3's two host tabs became ONE
> "Speech engines" tab (the JV AI-settings pane dissolved into a kit feature panel +
> Capture settings), §1.7's "parked with F3" is dead (EPUB+DOCX shipped, F3 no longer
> exists), and §3's `identify` shipped as `speaker_discovery` with attribution split
> into guided/direct routed cards. The three items that were still live at archive
> time were extracted to `docs/dev/TASKS.md`: F4 VRAM-arbiter wiring, upstream
> pin-tier retirement in the runner, and the archived CONTRACT.md factual
> corrections (§4).

**What this is.** The decisions from the 2026-07-15 planning discussion about
integrating the current shared LLM stack (`just-llm-runner` + `@delebash/llm-ui`)
into JustVoice. This is NOT the implementation plan — the user deferred the full
plan until the other in-flight session's shared-stack changes landed. **They
landed the same day** (runner `8081539` — the preset one-source rewrite that
deleted the task tier — plus JW `40eaa10`), and every volatile kit/runner
citation below was re-verified against the post-landing tree on 2026-07-15
(§7.7 has the sweep record). Next step: the full implementation plan.

**How this doc was grounded.** Every claim was verified against code this
session (reads + executed imports), after the user caught doc-drift and decreed:
never guess, don't trust docs, verify with code. Where something remains
unverified it is listed in §7 as open, not asserted.

---

## 1. Product decisions (the user's calls, all made 2026-07-15)

1. **JustVoice stays as it is — standalone, with its own book front door.**
   "Shape 2" (books must be imported and prepped in JustWrite first, JV reduced
   to convert-to-audio) was considered and **CLOSED by the user** ("close shape
   2"). JV keeps import → speaker attribution → Speaker Lab review → casting →
   render, working with or without JustWrite.
2. **Replace the current JV LLM stack with the integrated shared stack and
   features** (user: "keep jv the way it is and replace the current llm stack
   with the integrated stack and features"). All existing JV LLM features are
   kept, re-routed through the shared dispatch.
3. **compose + persona_rewrite are kept** (part of "keep jv the way it is").
   Scope frozen — they are point-of-production conveniences, not a writing
   surface to grow.
4. **voice_gender becomes a REAL feature** (user, 2026-07-15: "voice gender
   should be a feature"). Today it is dead config: a role default at
   `server/justvoice/engines/llm/config.py:32` and a Settings routing row at
   `src/renderer/src/views/SettingsView.vue:571`, with **no caller anywhere**
   (server grep = 1 hit total; VoicesView's gender logic is a local naming
   heuristic + user override, `VoicesView.vue:29,43-48,74-84`, no LLM). The
   integration builds the actual caller: label fetched provider voices whose
   gender the built-in heuristic can't determine. Trigger design (auto on voice
   fetch vs. explicit action in Voices) is an open plan item (§7).
5. **JustWrite stays writing-only.** No speaker analysis moves there. The user
   clarified the old "ban" was never sacred ("we dont have to ban speaker
   analysis") — the boundary is a scope choice, not dogma — but with Shape 2
   closed, nothing relocates.
6. **JW podcast-script / game-dialogue project types: parked.** Not pursued
   now; if ever, it's its own effort and doesn't affect this integration.
7. **JV EPUB/PDF book-import formats: still parked with F3** (the 2026-06-27
   research TODO). Not part of this integration.

## 2. The dependency truth (corrected this session)

The user corrected the assistant's framing "JV already runs on the shared
package" — and the code agrees with the user:

- `server/pyproject.toml:44` pins `llm-runner @ git+…just-llm-runner.git@e7d2f1ce…`
  — a **frozen commit SHA** from the June-16 era (comment at `:41-43`). 16 server
  files import `llm_runner`. No vendored copy exists in the JV tree.
- Against the **current** runner, JV cannot even import: executed 2026-07-15,
  `from llm_runner.llm.schema import LLMRolesSettings` and `…LLMRoleTarget` both
  raise `ImportError`; JV imports them at `server/justvoice/models.py:23-29`.
- JV therefore consumed a **snapshot** (functionally copied code with a version
  stamp) and never tracked the live shared package. JW, by contrast, co-evolved
  with the runner and mounts it via `install_llm`
  (`justwrite_server/app.py:164-203` — import at `:164`, the call `:177-203`,
  re-verified post-`40eaa10`).

**Planning frame that follows:** this is a FIRST-TIME real integration, not a
re-convergence. No old JV wiring gets benefit of the doubt; every seam is
rebuilt against the current stack and verified fresh.

## 3. Verified LLM feature inventory (what "the features" means)

Eight live features + one to build. The synth/render audio path itself is
LLM-free: `render_chapter_api.py` has zero LLM references, and in the generate
path a persona's `personality` becomes a TTS `instruct` delivery field —
explicitly "a TTS delivery instruction, not an LLM rewrite"
(`generate_api.py:240-244`).

| # | Feature key | What it does | Server | UI |
|---|---|---|---|---|
| 1 | `speaker_attribution` (guided/direct prompts) | who-says-what: segmentation → anchor propagation → LLM → confidence floor | `extraction/pipeline.py` | Studio Script "Analyze", Speaker Lab |
| 2 | `identify` (routes through the attribution feature) | "who exists in this text?" → new-character candidates | `extraction/identify.py` | Script discovered-speakers banner |
| 3 | `smart_assign` | character→voice matching | `api/smart_assign_api.py` | Studio Cast |
| 4 | `render_preset_suggest` | classify chapter tone → pick render preset | `api/preset_suggest_api.py` | Studio Render |
| 5 | `show_notes` | episode summary/chapters/quotes from timeline segments | `api/projects_api.py:1220` | podcast Export |
| 6 | `compose` | fresh in-character line from persona personality | `api/personas_api.py:242` | Generate view |
| 7 | `persona_rewrite` | rewrite typed text in character voice, preview-then-accept | `api/personas_api.py:285` | Generate view |
| 8 | `refinement` (settings key `refine`) | dictation transcript cleanup, flag-driven prompt | `refinement.py` + `api/captures_api.py` (auto-refine `:191-193`, manual `:249`) | Captures |
| 9 | `voice_gender` — **TO BUILD** (decision §1.4) | gender-label fetched provider voices the heuristic can't classify | none today (dead config) | Voices |

Seed catalog rows today: `database/seed.py:268-301` (smart_assign,
render_preset_suggest, show_notes, speaker_attribution ×3). Feature-pin catalog:
`api/feature_pins_api.py:32-70` (compose, persona_rewrite, speaker_attribution,
render_preset_suggest, show_notes, smart_assign). Settings routing table adds
`refine` + `voice_gender` (`SettingsView.vue:564-571`).

## 4. Server-side integration shape (verified line ranges)

Replace-surface in `server/justvoice/app.py` (all verified 2026-07-15):

- **Swap for `install_llm(...)`:** `:117-124` (`load_from_configs` over
  `settings.engines.llm` + the qwen3 local adapter registration), `:194-199`
  (old-era shared `llm_runner.llm.api` router + `make_provider_router` over JV's
  own provider store), `:232-234` (`llm_roles_api`, `feature_pins_api`,
  `ai_prompts_api` routers).
- **Keep + rewire to the current dispatch:** `:236-238` (`extraction_api`,
  `smart_assign_api`, `preset_suggest_api`) plus the personas compose/rewrite
  endpoints, captures refine, and projects show-notes.
- `install_llm` signature (RE-VERIFIED 2026-07-15 after the preset one-source
  rewrite landed, runner commit `8081539`): `llm_runner/llm/install.py:62-79`
  — `app, *, engine, session_factory, feature_catalog, feature_prompts,
  engine_presets, feature_presets, default_preset_id, model_catalog_extra,
  model_tunes_seed, test_samples, feature_prompt_heals, prefer_local_features,
  runner_catalog, data_dir`. The old `taskkind_presets`/`feature_task_kinds`
  params are GONE — the task tier was deleted. JW's call
  (`justwrite_server/app.py:177-203`) is the adoption template. JV passes its
  own feature seed and `prefer_local_features={"speaker_attribution"}` — still
  a first-class param (`install.py:76`, honored at `dispatch.py:142-145`), and
  JV is the named example (`config_builder.py:5`).
- **F2 (REFRAMED by the rewrite):** there is no shared task-kind taxonomy to
  extend any more (`task_kinds_api.py`, `TaskKinds.vue`, `tests/test_task_kinds.py`
  all deleted in `8081539`). Routing is per-ACTION: a `feature_preset_refs` row
  (action → preset_id) falls back to the global `default_preset_id`
  (`llm_runner/llm/preset_resolve.py:47-57`; dangling refs fall through `:37-44`;
  no preset → provider-default route with no tunables `:9-11`). The run path
  resolves + overlays the preset in `prompts.py:474,534` (provenance endpoint
  `:607`). F2 is therefore pure per-app seed data: JV authors its own
  `engine_presets` library + `feature_presets` refs + `default_preset_id` —
  no upstream change needed. JW's data shapes are the template:
  `seed_presets.py:44-78` (preset dicts: id/name/provider_id/model=""
  /temperature/top_p/position/samplers, optional think+reasoning_effort),
  `:133` (action→preset-id map), `:184` (default id). The JSON contract
  (json_mode/json_schema) stays on the ACTION's prompt row, never the preset
  (`seed_presets.py:9-11`).
- **Delete outright** (superseded private-era code): `engines/llm/*` (config,
  provider_store, prompt_store, local_managed), `api/llm_roles_api.py`,
  `api/feature_pins_api.py`, JV's `api/ai_prompts_api.py`, the `qwen3_llm`
  engine (its own manifest names the built-in runner as primary,
  `engines/qwen3_llm/manifest.py`) — with the `capture_readiness_api.py:46-48`
  Qwen3-model references repointed for dictation readiness.
- **Routing cascade** (RE-VERIFIED post-`8081539`): the ACTION's engine preset
  is resolved first (`preset_resolve.py:47-57`) and overlaid as
  provider/model/params onto the call; UNDER that overlay `resolve_pin` runs
  action-explicit → feature production-config → feature pin → prefer-local →
  first-adapter (`dispatch.py:95-155`; `_resolve_action_override` `:74-92`;
  `resolve_route` overrides `:166-205`). NEW since the rewrite: the reasoning
  system — presets carry `think`/`reasoning_effort`, resolved per
  provider/model by `_apply_reasoning` (`dispatch.py:208-231`) against the
  editable per-provider reasoning map (`reasoning_map_api.py`, mounted at
  `install.py:194`).
- **Pins are a bridge, not a surface:** the shared routing WIRE no longer
  carries pins at all (`FeaturePin`, `RoutingConfig.pins`,
  `RoutingResponse.pins` deleted from `routing_api.py` in `8081539`). The
  `FeaturePinConfig`/`LLMConfig.feature_pins`/`resolve_pin` contract is kept
  at dispatch-schema level explicitly for JV's CURRENT code
  (`config_builder.py:7-9` — "the pin tier is JustVoice-only"; JW leaves pins
  empty). Integration moves JV off pins onto preset refs; retiring the pin
  tier upstream afterwards is a post-integration cleanup item.
- **Transport fix (was ledger F1-a, now code-verified end-to-end):** the kit's
  `requestBlob` is path-first and auth-free (`ui/src/client.js:65-68`); JV's six
  callers are method-first and hit it unadapted via `stores/api.js:40`
  (re-export; bearer token held at `:16` but never attached):
  `services/projects.js:87,176`, `ExportPanel.vue:75`, `SettingsView.vue:155,1078`,
  `LinesView.vue:150` — broken today. `postForm` callers
  (`services/projects.js:49,186`) have correct arg order but the same auth gap
  (`client.js:80-81`). Fix = auth-capable path-first blob/form transport + fix
  all callers.
- **CONTRACT.md corrections:** `:83` claims JW computes attribution in
  `services/speakerAttribution.js` — no such file exists in JW (verified);
  `:99` claims render applies "personality LLM-rewrite" — actually the TTS
  `instruct` field (`generate_api.py:240-244`). Correct both when the plan
  executes.
- **F4 (VRAM arbiter hook for JV TTS engines)** follows after integration —
  decision already made earlier (2026-07-04), out of scope here.

## 5. Renderer / UI decisions (the user's calls, 2026-07-15)

1. **MERGED area.** One nav entry replaces "Engines" (`App.vue:57` — the entry
   is visible in every journey; no `visibleFor` filter). JV page chrome hosts
   the kit `AiModelsArea` — the pattern JW records at `AiView.vue:2-6,40-47`
   ("jw has its card layout, we just put the control in it… Same control
   JustVoice mounts in its own page chrome").
2. **Label: "AI Settings"** — identical to JW's sidebar label
   (`Sidebar.vue:143` → en.json `.sidebar.nav.ai = "AI Settings"`, JSON-parsed).
3. **Host tabs: TWO.** First and default: **Voice engines** — today's
   EnginesView content (TTS engine rows, `RecommendCard`, the TTS half of JV's
   `ProviderForm`). Second: a **JV AI-settings pane** (the app-specific knobs —
   attribution confidence/corrections, dictation cleanup defaults; final
   inventory swept at plan time), the JV counterpart of JW's "Writing AI" tab.
4. **Kit deltas required for 1+3** (RE-VERIFIED against `AiModelsArea.vue`
   post-`8081539` — the host-tab mechanics are unchanged by the rewrite; the
   internal tab strip is now Providers & models / **Presets** / Routing by
   feature / Usage / Server console, `Presets.vue` replacing the deleted
   `TaskKinds.vue` + `PromptLab.vue`):
   - multi-host-tab support (today: single `appTabLabel` prop + one `#app-tab`
     slot, `:42,595-597`);
   - host-tab position + default-tab control (host tab renders last `:380`;
     default hardcoded `tab = ref("providers")` `:55` — JV needs Voice engines
     first and default-active);
   - lazy mount for host tabs (`v-if` per tab like the internal tabs
     `:536,:543`, not the eager `v-show` at `:596`) so the engines pane doesn't
     boot its fetch loops when the area opens on another tab.
   JW's single "Writing AI" tab keeps working through the new API shape.
5. **Dies in the renderer:** Settings → "AI features" sub-tab
   (`SettingsView.vue:467`; production-configs promote/revert `:555-560`,
   DEFAULT_ROLES table `:564-568`, pins PUT `/v1/feature-pins` `:589-595`) →
   replaced by the kit Routing tabs; EnginesView's LLM kind-tab + its
   `/v1/llm-providers` CRUD (`EnginesView.vue:81,86,116`); `services/llmBackend.js`;
   QuickSetup's LLM auto-config half (`components/QuickSetup.vue` — kit
   QuickSetup replaces it; JW deep-links `/ai?quicksetup=1`, JV can mirror);
   ProviderForm's LLM half (`components/ProviderForm.vue:343` capLLM area).
6. **Stays JV-local:** all TTS halves (providers, engine management, wizard),
   the kit "Server console" tab (LLM runner log) coexists with JV Settings →
   Logs (the justvoice-server log) — two real sources, labeled distinctly.

## 6. Feature → routing notes for the plan

(REWRITTEN 2026-07-15 after runner `8081539` deleted the task tier — routing is
per-ACTION preset refs now, §4 F2.)

- attribution/identify → a JV-authored deterministic/extraction-style engine
  preset (JW's `p_extract` — temp 0.15, `min_p: 0`, pinned `seed` — is the
  reference shape, `seed_presets.py:66-68`), plus
  `prefer_local_features={"speaker_attribution"}` so the built-in runner is the
  smart default when nothing is configured (`dispatch.py:142-145`).
- The plan authors JV's OWN preset library + the action→preset refs map for
  smart_assign / preset_suggest / show_notes / compose / persona_rewrite /
  refine / voice_gender — per-app seed data, no upstream registration.
  Discussion candidates map naturally onto JW-style preset shapes
  (extraction-deterministic, grounded-summary, prose-generate/edit) but the JV
  library is authored fresh at plan time, NOT locked to JW's ten.
- Presets carry `think`/`reasoning_effort` (the new reasoning system) —
  JV's extraction-grain features likely want think off; decide per preset at
  plan time.
- `refinement`'s flag-driven prompt builder (`refinement.py`) vs. Lab-editable
  prompt rows — how it fits the shared prompt system is a plan design item.

## 7. Open items for the plan (explicitly undecided or unverified)

1. voice_gender trigger design (auto on provider voice fetch vs. explicit
   action in Voices) + its prompt/preset.
2. JV AI-settings host-tab content inventory (full sweep of the current
   Settings AI tab — only `:555-600` was read this session — plus knobs living
   on feature surfaces).
3. JV preset library + action→preset refs authoring (§6): preset shapes
   (temps/samplers/think per the JW reference at `seed_presets.py:44-78`),
   prompts, and test samples per the shared SAMPLE-LAW conventions.
4. `refinement` prompt-system fit (§6).
5. Whether kit "Server console" needs a source label/rename once two servers'
   logs are reachable in one app.
6. Per-journey nav: the merged entry inherits Engines' always-visible status —
   confirm that's wanted for dictation/accessibility journeys at plan time.
7. ~~Re-verify EVERY kit/runner citation in this doc after the in-flight
   session lands~~ — DONE 2026-07-15, same day: runner `8081539`
   (`feat(presets)!` — task tier deleted, presets own every tunable) + JW
   `40eaa10` pulled; §4 (install_llm signature, F2, cascade, pins-bridge),
   §5.4 (kit tab strip + line numbers), §6, and §7.3 rewritten against the
   new tree. Upstream drift found during the sweep: the runner's
   `schema.py:89` docstring points at `prompts._resolve_preset`, but the
   resolver actually lives in `preset_resolve.py` (imported at
   `prompts.py:43`, called at `:474,:534,:607`) — a one-line upstream
   docstring fix candidate, not a JV blocker.
   Per-citation ledger of the sweep (strict-diff, each checked against the
   live file — an independent rules-checker audit then re-checked every row
   and caught two of my line numbers, corrected below):
   | Citation group | Verified at | Status |
   |---|---|---|
   | install_llm signature (feature_presets + default_preset_id; no taskkind params) | `install.py:62-79`; prefer_local `:76`; reasoning router `:194` | ✅ |
   | preset cascade (ref → default; dangling fall-through; no-preset rule) | `preset_resolve.py:47-57,:37-44,:9-11` | ✅ |
   | run-path overlay + provenance | `prompts.py:43,:474,:534,:607` | ✅ |
   | dispatch cascade + reasoning + prefer-local | `dispatch.py:95-155,:74-92,:166-205,:208-231,:142-145` | ✅ |
   | pin tier = JustVoice-only bridge | `config_builder.py:5,:7-9` | ✅ |
   | pins gone from routing wire | `routing_api.py` (no FeaturePin/pins fields; removal note `:35`) | ✅ |
   | kit tab strip + host-tab mechanics | `AiModelsArea.vue:42,:55,:380,:536,:543,:595-597,:596`; TaskKinds/PromptLab deleted, Presets.vue present | ✅ |
   | JW adoption template | `justwrite_server/app.py:164-203` | ✅ |
   | JW seed shapes | `seed_presets.py:43-78` (dicts `:44-77`), refs `:133`, default `:184`, JSON-on-action `:9-11` | ✅ (audit corrected my `:44-80`) |
   | p_extract reference preset | `seed_presets.py:66-68` | ✅ (audit corrected my `:70-72`) |
   | landed commits | runner `8081539`, JW `40eaa10` (git log) | ✅ |
8. Migration of user data: existing feature-pin rows / roles settings /
   `settings.engines.llm[]` providers → shared-stack equivalents (or a clean
   drop with re-setup via Quick Setup) — user call at plan time.
9. `stores/api.js:15-16` uses `localStorage` for `jt:server`/`jt:token` —
   observed during verification; check against the storage rules when touching
   the transport. **RESOLVED with F1 Phase 1 (2026-08-05): localStorage IS the
   sanctioned store for these two.** They are thin-client RENDERER config (which
   server this window talks to + its bearer token), not app data — the server
   cannot hold the address used to reach it; every other pref lives server-side.
   The kit transport reads the token per request (`configureServerApi({
   authToken })`, main.js) and `jt:server` layers over the origin-aware resolver
   (config.js); since Phase 1 the public kit `requestBlob`/`postForm` ride the
   same auth headers, so thin-client blob downloads authenticate too.

## 8. Sequencing

~~Blocked behind: the other session's shared-stack changes landing.~~ LANDED
2026-07-15 (runner `8081539` + JW `40eaa10`, both pulled) and every volatile
citation re-verified same day (§7.7). Next: write the full implementation plan
(plan mode, rules-checker panel, tasks with acceptance criteria per the global
plan protocol), then execute on branch `claude/admiring-galileo-il3q0o`. The
user's explicit "go" is required before build (recap rule).
