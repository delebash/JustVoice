# JV shared-LLM integration — DECISIONS RECORD (2026-07-15)

**What this is.** The decisions from the 2026-07-15 planning discussion about
integrating the current shared LLM stack (`just-llm-runner` + `@delebash/llm-ui`)
into JustVoice. This is NOT the implementation plan — the user deferred the full
plan until the other in-flight session's shared-stack changes land. Every kit /
runner file:line cited below was verified against the working tree on
2026-07-15 and MUST be re-verified when the plan is written (the kit and runner
are being modified concurrently by another session).

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
  (`justwrite_server/app.py:164-190`).

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
- `install_llm` signature (current, volatile): `llm_runner/llm/install.py:64-81`
  — `app, engine, session_factory, feature_catalog, feature_prompts,
  engine_presets, taskkind_presets, feature_task_kinds, model_catalog_extra,
  model_tunes_seed, test_samples, feature_prompt_heals, prefer_local_features,
  runner_catalog, data_dir`. JW's call (`justwrite_server/app.py:177-190`) is the
  adoption template. JV passes its own feature seed and
  `prefer_local_features={"speaker_attribution"}` (the hook already named at
  `llm_runner/llm/schema.py:84`).
- **F2:** `speaker_attribution` task kind added to the shared taxonomy — absent
  from the current nine (`llm_runner/llm/seed.py:441-451`). Mapping of every JV
  feature → task kind is a plan-time table (open, §7).
- **Delete outright** (superseded private-era code): `engines/llm/*` (config,
  provider_store, prompt_store, local_managed), `api/llm_roles_api.py`,
  `api/feature_pins_api.py`, JV's `api/ai_prompts_api.py`, the `qwen3_llm`
  engine (its own manifest names the built-in runner as primary,
  `engines/qwen3_llm/manifest.py`) — with the `capture_readiness_api.py:46-48`
  Qwen3-model references repointed for dictation readiness.
- **Routing cascade** (exists in current code): action override →
  feature/preset resolution → first-registered fallback
  (`llm_runner/llm/dispatch.py:14,74,112-114`; `resolve_route` overrides
  `:166-187`).
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
4. **Kit deltas required for 1+3** (coordinate with the in-flight session; all
   in `ui/src/views/AiModelsArea.vue` as of today):
   - multi-host-tab support (today: single `appTabLabel` prop + one `#app-tab`
     slot, `:42,595-597`);
   - host-tab position + default-tab control (host tab renders last `:380`;
     default hardcoded `tab = ref("providers")` `:55` — JV needs Voice engines
     first and default-active);
   - lazy mount for host tabs (`v-if` per tab like Routing tabs `:535,:542`,
     not the eager `v-show` at `:595`) so the engines pane doesn't boot its
     fetch loops when the area opens on another tab.
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

- attribution/identify → the NEW `speaker_attribution` task kind (F2), seeded
  `prefer_local`.
- The exact task-kind mapping for smart_assign / preset_suggest / show_notes /
  compose / persona_rewrite / refine / voice_gender is decided in the plan
  against the then-current task-kind set (today's nine at `seed.py:441-451`) —
  candidates noted in discussion (extract.structured, summary.grounded,
  prose.generate/edit) but NOT locked.
- `refinement`'s flag-driven prompt builder (`refinement.py`) vs. Lab-editable
  prompt rows — how it fits the shared prompt system is a plan design item.

## 7. Open items for the plan (explicitly undecided or unverified)

1. voice_gender trigger design (auto on provider voice fetch vs. explicit
   action in Voices) + its prompt/task-kind.
2. JV AI-settings host-tab content inventory (full sweep of the current
   Settings AI tab — only `:555-600` was read this session — plus knobs living
   on feature surfaces).
3. Task-kind mapping table (§6) + seed authoring (prompts, temps, samples per
   the shared SAMPLE-LAW conventions).
4. `refinement` prompt-system fit (§6).
5. Whether kit "Server console" needs a source label/rename once two servers'
   logs are reachable in one app.
6. Per-journey nav: the merged entry inherits Engines' always-visible status —
   confirm that's wanted for dictation/accessibility journeys at plan time.
7. Re-verify EVERY kit/runner citation in this doc after the in-flight session
   lands; `install_llm`'s signature and the AiModelsArea internals are the two
   most volatile.
8. Migration of user data: existing feature-pin rows / roles settings /
   `settings.engines.llm[]` providers → shared-stack equivalents (or a clean
   drop with re-setup via Quick Setup) — user call at plan time.
9. `stores/api.js:15-16` uses `localStorage` for `jt:server`/`jt:token` —
   observed during verification; check against the storage rules when touching
   the transport.

## 8. Sequencing

Blocked behind: the other session's shared-stack changes landing. Then: write
the full implementation plan (plan mode, rules-checker panel, tasks with
acceptance criteria per the global plan protocol), re-verify all volatile
citations, and execute on branch `claude/admiring-galileo-il3q0o`. The user's
explicit "go" is required before build (recap rule).
