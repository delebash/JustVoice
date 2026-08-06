# TASKS — the live open-work tracker (JustVoice)

> **THIS is JustVoice's live tracker** — created 2026-08-04 by the family docs
> campaign (`just_ai_i18n_docgen/docs/plans/2026-08-04-docs-cleanup-campaign.md`),
> per the convention in `just-llm-runner/docs/app-structure.md` §13. One line per
> open item + a pointer to its detail doc. **Close = delete** — git and the plan
> docs keep history. **An item lives where the code that closes it lives** — JV
> work HERE; kit/shared-server → `../just-llm-runner/docs/dev/TASKS.md`; JW →
> `../justwrite-app/docs/dev/TASKS.md`. A tracker line is a claim, not evidence;
> lines are marked **[verified]** (code-checked 2026-08-04) or **[attributed]**
> (a plan doc's claim, not re-verified).
>
> **THE STANDING SEQUENCE (the user's roadmap ruling, 2026-07-26):** *"completely
> finish JW and all AI stuff, then we will work on JV."* Everything here is parked
> behind that unless the user says otherwise; every item needs its own go.
>
> **GITHUB ACTIONS STAY OFF (user ruling, re-issued 2026-08-05: "i asked you to
> turn off github actions when yo commit jv you ignored this fix it").** All
> three workflows — `CI`, `CodeQL`, `release.yml` — are `disabled_manually` on
> the remote (set via `gh workflow disable <file>`; a repo SETTING, no file
> edit, reversible with `gh workflow enable <file>`). This was ignored once and
> three pushes each triggered FAILING runs (CI red; `release.yml` firing twice
> per push and dying in 0 s). **Before pushing JV, confirm
> `gh workflow list --all` still shows all three disabled.** The workflow YAML
> is left untouched on purpose so re-enabling is one command when the CI
> pipeline is actually wanted again.

## QC finds 2026-08-05 (user's eyes, added on sight)

- **Sidebar nav items are cut off** — labels truncate/don't fit after the F1
  labels got longer ("AI Settings", "Voice engines", the "AI tasks" toggle +
  badge). The nav must SIZE ITSELF so words are never clipped (normal
  flex/column CSS — auto-fit, no hardcoded widths; the user hit this same
  class in JW's design work: hardcoded widths). Fix rides the parity go:
  make the sidebar layout flexible per the standard CSS conventions AND
  sweep every F1-added surface (sidebar button/badge, splash, AI area
  wrapper, Settings cards) for hardcoded-width violations. The truncation
  mechanism itself is pre-F1 sidebar CSS; the new longer labels exposed it —
  adding them without checking fit was the miss.

## Found by the 2026-08-05 family audit [verified by hand] — parked per the
## standing sequence, but the first one is REAL user-facing breakage
## (the keep-running param bug was fixed off-sequence 2026-08-05, Batch 1:
## SettingsView now drives useServerStore — one persistence, default false,
## correct `keepRunning` param, boot re-apply in App.vue)

- *(Tray fixed off-sequence 2026-08-05, Batch 4: icon set, Quit kills the
  sidecar, copy shows the window first, Open log file opens the logs folder
  Rust-side, and App.vue carries the `tray:*` listeners for
  settings/about/copy — the generic entries WORK now. `system-tray.md`
  rewritten to truth. Still JV's own: dictate/MCP entries remain unwired
  (parked with the standing sequence).)*
- **Server `ruff check` FAILS with 515 errors** (283 auto-fixable; top: UP045,
  B008, BLE001, I001) while JV's CLAUDE.md says ruff must pass before commit —
  pre-existing, not the kit's doing. pytest is green (383 passed).
- Dead code: `src/services/llmBackend.js` has zero importers (the kit deleted
  that contract); only `scripts/verify-llm-backend.js` exercises it.
- No `lint`/`test`/`smoke` entries in package.json — gates exist only as raw
  scripts + CLAUDE.md prose; the kit's new biome gate is chained by docgen's
  lint but by nothing in JV.

## The convergence arc (moved from JW's whole-system tracker 2026-08-04)

- **F1 — convergence onto the current shared stack (THE big one). APPROVED
  2026-08-05, NOT STARTED — no JV code touched.** The user's frame, verbatim:
  *"replacing jv current llm with shared llm runner the f1 convergance, i
  approve all per your rec"* + *"it should be simple drop in adn set jv routing
  features"* + *"also spash page and loading model, again this should all be
  same as jw and ai docgen"*. So: JV becomes the THIRD INSTALL of the same
  family app — docgen's `app.py` + `main.js` are the working templates — and
  the delta is JV's own features only.
  **Read BEFORE coding:** `docs/decisions/2026-07-15-jv-shared-llm-integration-decisions.md`
  — its PRODUCT rulings stand (JV standalone with its own book door; all 8 LLM
  features kept + `voice_gender` built; merged "AI Settings" nav hosting the kit
  `AiModelsArea`; compose/persona_rewrite frozen scope; the verified 8-feature
  inventory table). Its CODE CITATIONS are 3 weeks stale — **re-verify every one
  against the live tree** (the user's standing rule: docs go stale, verify in
  code).

  **Verified against the live tree 2026-08-05 — the import claim below was
  then REFUTED BY EXECUTION in the second session (2026-08-05 s2); the rest
  held:**
  - ~~JV's modules do NOT import against today's runner~~ **FALSE — refuted by
    running the imports (2026-08-05 s2):** in JV's real venv, `justvoice.app`
    itself plus extraction_api, smart_assign_api, engines.llm.config, models,
    llm_roles_api, feature_pins_api, refinement, capture_readiness_api,
    projects_api, personas_api and preset_suggest_api ALL import OK against the
    LIVE runner — the venv resolves the EDITABLE `E:\Dev\Web\just-llm-runner`
    (proved via `llm_runner.__file__`), so dev already runs the current stack;
    the `pyproject.toml:44` June pin only feeds the PyInstaller bundle.
    `llm_runner.llm.routing_api` exists (`FeatureCatalogEntry` at
    routing_api.py:63; the runner's own install.py:40 imports it), and
    models.py was repaired to live imports on 2026-08-01 (its comment,
    models.py:20-25). **There is no import cliff — and no swap at all; see the
    DISCOVERED bullet below.**
  - **DISCOVERED (2026-08-05 s2, convergence pass — the arc's biggest stale
    claim): JV ALREADY CALLS `install_llm` — app.py:208-215, "convergence
    part 2" (2026-08-01).** The call: engine + SessionLocal + FEATURE_CATALOG
    + feature_prompts={} + data_dir. Boot order matches JW:
    migrate_settings_providers_to_db → seed_llm() → load_from_configs(DB
    providers) (:219-221); the qwen3 local adapter registers AFTER the DB
    providers (:223-227). JV's own prompt editor deliberately SHADOWS the
    shared /v1/ai/prompts (ai_prompts_api mounted first, :204-206) — the
    file's own comment names folding it into the shared prompt/preset model
    "convergence part 3". config.py was REALIGNED the same day: providers
    come from the SHARED DB store, `settings.engines.llm` is dormant legacy
    "nothing reads" (config.py:60-65), PREFER_LOCAL_FEATURES=
    {"speaker_attribution"} rides the LLMConfig mapper (:31), and
    FEATURE_CATALOG already carries ALL NINE keys INCLUDING `voice_gender`
    (:52-53 — cataloged, no caller). What the call still LACKS vs the
    siblings: `product=` (family cache registry), `cache_root=`, and every
    preset seed (engine_presets / feature_presets / default_preset_id /
    test_samples); prefer-local moves onto the install param when config.py
    dies. Also: JV's log ring + file log are PRIVATE TWINS of the platform
    helpers (admin_api.py:58,72 — Phase 0 verifies wrap-vs-duplicate), and NO
    disk router is mounted. Features today call `dispatch.chat` DIRECTLY with
    config.py's LLMConfig (pins/production-config cascade) — the preset tier
    exists only on the shared HTTP run routes; that gap is exactly what the
    rewire closes (the run-helper delta in PHASE CORRECTIONS). **So the
    brief's frame is stale for the server half — the server already IS the
    third install; Phase 2 = "complete the call + convergence part 3 +
    chrome", not a swap.**
  - `install_llm`'s required args are satisfied: JV has `SessionLocal` + `engine`
    (`database/session.py`). Live signature adds params the doc never mentions —
    `seed_default_model_catalog`, `cache_root`, `product`, `allow_key_reveal`.
    BOTH siblings pass `product=` (family cache registry — a sibling can offer to
    share the downloaded engine/models) and `data_dir=`; JV must too.
    `allow_key_reveal` stays OFF (JV has no CSRF/origin middleware).
  - JV's vite dev port is **1430** (hmr 1431) — `installLlmUi({devPorts:["1430"]})`,
    NOT docgen's 1420.
  - 7 renderer files bind the dying LLM shape: `ProviderForm.vue`,
    `QuickSetup.vue`, `RecommendCard.vue`, `services/llmBackend.js`,
    `EnginesView.vue`, `SettingsView.vue`, **`SpeakerLabView.vue`** (a core
    workflow surface — the last two were never in the 7-15 doc's list).
  - 5 of 54 server test files touch dying surfaces: `test_llm_roles`,
    `test_local_llamacpp`, `test_persona_rewrite`, `test_camel_aliases`,
    `test_settings_patch_merge`.
  - MCP (`justvoice/mcp/`, `mcp_bindings_api.py`) and `webhooks_api.py` are
    CLEAR of the dying surfaces.
  - Chrome parity gaps (re-confirmed by read, 2026-08-05 s2): `index.html`
    boot layer is a green spinner (`#2f8f63`, index.html:22), not a static
    plate → no `BootModelLoad`/`startWarmOnBoot`; JV mounts ZERO kit chrome
    (no `SettingsShell`, `LogsPanel`, `DataManagement`, `UpdatesPanel`,
    `AiStatusButton`, kit `TitleBar`) — but it DOES already consume the kit
    TRANSPORT: `stores/api.js:10-12` imports request/verbs/requestBlob/postForm
    from `@delebash/llm-ui`, and `config.js:15` builds
    `makeOriginAwareResolver({devPorts:["1430","1431"], fallback:
    "http://127.0.0.1:17494"})` which main.js feeds to `configureServerApi` —
    only `configureLlmUi` (client.js) is never fed. The Rust shell has NO
    `storage_get_root`/`storage_relocate`/data-root pointer (no portable data
    root at all). Settings' REAL section list (SettingsView.vue:462-475):
    general · **ai "AI features" (the sub-tab F1 deletes — still alive)** ·
    mastering · generation · capture · mcp · gpu · appearance · cache ·
    channels · webhooks · logs · changelog · about — no Storage, no Server
    (the `/v1/server-auth` door has no UI; the route itself exists —
    `server_auth_api.py` + the auth.py:54 loopback escape).
  - Kit host tabs today: ONE `appTabLabel` + one `#app-tab` slot, eager
    `v-show`, default tab hardcoded `"providers"`, host tab renders LAST. So
    "two host tabs, Voice engines first" needs 3 kit deltas (multi-tab,
    default-tab control, lazy mount); ONE host tab needs zero kit changes —
    and JW has exactly one, docgen zero.

  **Intended build order** (each phase leaves JV working; adversarial rethink
  after each; instant gates only, full suites at the end):
  0. Verify the drop-in premise against live signatures (minutes).
  1. Renderer chrome FIRST (works against the old server): `installLlmUi`
     (fixes transport base + token + the six method-first `requestBlob` calls),
     `ConnectionError` boot gate, static plate + `BootModelLoad` +
     `startWarmOnBoot`, `LlmUiHosts`, window-state plugin.
  2. Server swap + AI area TOGETHER (one working-state series): `install_llm`
     with JV's catalog/prompts/preset library/refs/default +
     `prefer_local_features={"speaker_attribution"}`; rewire the 8 features to
     the shared dispatch; delete the private-era stack (roles/pins/prompt-store/
     provider-store/qwen3 engine, repoint dictation readiness); health baseline
     keys; shared logs+disk routers; nav "Engines" → "AI Settings" hosting
     `AiModelsArea`; kit QuickSetup (LLM) with `?quicksetup=1`; `AiStatusButton`
     + AI-tasks nav row; Settings gains Storage + Server (tokens UI on
     `/v1/server-auth`), loses "AI features"; once-ever `AiSetupOffer`.
  3. `voice_gender` (the one new feature) + the Rust portable-data-root work.

  **BUILD LOG (the go was given 2026-08-05 s3 — "you have a go for coding"):**
  - **Phase 0 ✓ (verification, all 8 checks answered, no plan changes):**
    route overlap = only the known three (ai_prompts shadow · llm-roles +
    feature-pins · qwen3), JV's own `/v1/cache/*` clear of the shared `/v1/ai`
    cache router · cache registry = `llm_runner/runner/cache_registry.py`,
    keyed (product, dataDir), JV will pass `product=PRODUCT` ("JustVoice",
    version.py:3) · all 8 dispatch.chat callers mapped (extraction/pipeline
    :167, identify :100, refinement :237, smart_assign :135, personas :265+
    :318, projects :1260, preset_suggest :120) · log twins = confirmed private
    duplicates, zero platform imports · **shared warm default is ON** (seed
    "1", model True, reset "1"; ABSENT row reads ON) → ruling-7 contingency
    fired · Engines nav omits visibleFor = always visible (the mechanism
    ruling 4 + 8 need) · **render() is silent-empty** (prompts.py:89) →
    ruling-9's kit fail-loud hardening gates Phase 2's row work ·
    `[project.scripts]` = `justvoice-server = "justvoice.cli:app"` only.
  - **Phase 1 ✓ SHIPPED (renderer chrome; all instant gates green: JV vite
    build, docgen vite build, JW blob-guard vitest 3/3, new pytest 3/3 + 386
    collected, ruff app.py 6=6 no new, biome kit+JV clean, cargo check 8s):**
    `installLlmUi` in main.js — BOTH boot branches incl. the dictate webview —
    with JV's `resolveBase` (jt:server layering preserved), `{embeddings:
    false}`, plugin-shell opener, JV catalogCopy/quickSetupCopy VOICE (my
    words, review welcome; the wizard's "LLM engine setup" NAME lands with the
    Phase-2 labels feed) · `configureServerApi({authToken})` kept as JV's
    layer on top · the AUTHED path-first `requestBlob` added to kit serverApi
    + public blob/form pair re-pointed there (index.js exports via
    common/index.js; client.js keeps auth-free twins for kit-internal relative
    imports; JW/docgen behavior unchanged — same base, no token; JW's two
    guard tests still pass; 3 stale JW comment cites fixed) · six blob call
    sites flipped path-first (sweep: zero method-first remain) · index.html
    minimal brand plate (ruling 5: logo + name, today's palette, no spinner)
    synced with new App.vue `.splash` + `<BootModelLoad/>` overlay on
    `warmModelId` · hand-mounted Toast/AppDialog → `<LlmUiHosts/>` ·
    `startWarmOnBoot()` pre-mount + boot-error plate teardown (docgen's
    lesson) · window-state plugin in Cargo.toml + lib.rs (no denylist — the
    dictate window is never actually created today) · **ruling 7 landed
    server-side**: `_apply_jv_warm_default()` in app.py (explicit "0" row,
    marker-guarded one-time so a user's later ON survives; before seed_llm so
    insert-if-missing skips it) + `tests/test_warm_default.py` (fresh OFF ·
    legacy flip · user-ON survives) · §7.9 RESOLVED in the decisions doc
    (localStorage sanctioned for jt:server/jt:token). NOT in Phase 1 (correct,
    later phases): AiSetupOffer (Phase 2, first-project moment), kit QuickSetup
    mount, nav/AI-area work. User docs: checked — the download docs describe
    the now-restored behavior; no wording changed.
  - **Phase 2 in progress — server half DONE in three commits (runner
    `7d72aff`, JV `e7f35a7` + `906e865`; JW test fix `1450842`):**
    (a) kit render() FAILS LOUD (MissingTemplateVariables, routes→400, union
    via _render_pair) + `run_action` extracted (the route rides it via
    to_thread; exported with UnknownActionError/RunRequest; five
    incomplete-variables tests the silence hid were fixed in runner+JW).
    (b) install call COMPLETE (product=/prefer_local_features=/all seeds);
    13 rows / 9 features seeded (the count is 13 not 12 — the brief's tally
    missed the EXISTING `identify` row, now `speaker_attribution.identify`;
    ruling 9's principle covers it) + 6 presets (p_extract 0.2 · p_classify
    0.0/200 · p_notes 0.4 · p_compose 0.9/300 · p_voiced_edit 0.6 ·
    p_refine 0.2/2048) + 13 refs + samples per row; migrate_prompts.py
    (edits win, brace-convert, key rename, tunable lift, table DROP after
    success); all 8 features rewired through engines/llm/run.py's
    run_feature; extraction tier choice = pick_tier (override or
    model-classify — resolve_tier's pin path died); refine = the ×4 row
    composition via the explicit-system door, few-shot as history.
    (c) deletions: ai_prompts shadow, prompt_store, config.py, local_managed
    + the qwen3_llm engine (+ manager hook + catalog variants), old
    seeder/model (texts moved to seed_feature_prompts.py/refinement.py),
    llmBackend.js + verify-llm-backend.js; capture readiness repointed to
    what refine.base resolves to; factory-reset re-seeds BOTH sets via
    llm_bootstrap.reseed_shared_llm (the dual-table lesson — reset was
    leaving shared tables absent + storage on a disposed engine). Tests:
    test_llm_roles + test_local_llamacpp retired; feature_prompts /
    variant_wiring / captures / persona_rewrite / extraction_config /
    discover_speakers rewritten to the shared truth. Suite 379 passed.
    Behavior deltas recorded honestly: smart_assign/preset_suggest/
    voice_gender rows run json_mode (response_format json_object — new);
    attribution rows do NOT (array output); pre-QuickSetup runs now say
    "run Quick Setup" (preset model "" — ruling 1's accepted clean-drop);
    a Speaker-Lab CUSTOM user prompt now uses {{var}} not {brace} syntax.
  - **Phase 2 route+UI half + Phase 3 + docs: DONE (2026-08-05 s3 continued,
    under the all-phases go; commits `54c6941` → `f917133` + the build-log
    one):** the AI Settings area (/ai + kit AiModelsArea, ONE host tab
    **"Speech AI"** = the rehomed Speaker-corrections card), nav AI Settings
    (always visible, icon **🤖**) + Engines → "Voice engines", AiStatusButton
    in the topbar, the kit AI-tasks sidebar row, once-ever AiSetupOffer at the
    first-project moment (server-pref flag, silent-mark when a default
    exists), ruling 6's words via configureFamilyLabels ("LLM engine setup"/
    "Re-run LLM engine setup" + the offer button), the old wizard renamed
    "Voice engine setup" with its pins recipe stripped, Settings −"AI
    features" +family Storage (data location/relocate + disk usage) +family
    Server (headless URL + /v1/server-auth tokens + rehomed Connection/
    Lifecycle/Server-bind) + kit LogsPanel; SpeakerLab's promote flow died
    with production-configs; llm_roles_api + feature_pins_api deleted;
    EnginesSettings dropped feature_pins/production_configs (stray keys
    tolerated, llm_roles pattern; engines.llm stays for migrate_providers);
    platform log ring/file + make_logs_router(PRODUCT) + make_disk_router
    replaced admin_api's twins; health = product + camel apiVersion + snake
    extras; the Rust portable data root (pointer/resolve/relocate commands,
    spawn sets JUSTVOICE_DATA_DIR on every arm, venv-first debug arm; JV's
    DEFAULT deliberately stays the server's platformdirs dir — existing
    installs' data lives there, portable is one Change-folder click); the
    llm-runner pin → bundle extra @main (update-pydeps declobbered by
    construction); **Phase 3 voice_gender shipped** (POST
    /v1/voices/gender-guess over the seeded row; Voices "✨ Guess unknown
    genders" button, explicit-only per ruling 2, applies via the manual-click
    persistence paths); user docs swept (ai-features rewritten,
    quick-setup → Voice engine setup, providers/troubleshooting/voices/toc)
    and the archived CONTRACT's two wrong claims corrected at their LIVE
    homes (CONCEPTS.md, core-concepts.md, personas.md).
    **The four word-gaps the user approved as recs ("your rec on those, go"):**
    (1) the Phase-1 catalogCopy/quickSetupCopy voice sentences as written in
    main.js; (2) the voice_gender seed prompt as written; (3) host tab label
    "Speech AI"; (4) AI Settings nav icon 🤖.
    **REAL-APP CHECK RUN (the rule-7 gate):** the real venv server booted on
    the REAL data dir — /v1/health carries product+apiVersion; /v1/ai/prompts
    serves the 13 shared rows (the shadow is gone); the 6 presets at the
    decided temps; warmDefaultOnStartup=False ON THE REAL previously-ON DB
    (the one-time flip worked); platform /v1/logs/tail + /v1/disk/usage live;
    readiness says "AI engine not set up" (honest pre-QuickSetup state).
    Eyes-on QC still the user's: the webview walk of the new chrome (AI
    Settings, wizards, Storage/Server, the offer, the gender button).
  - **Phase 2 leftovers folded forward (small, non-blocking):** JV still has
    no scripts/py.js + lint/test scripts (pre-recorded family-contract gap) ·
    capture.llm_model settings field is dormant residue (kept — not in the
    decided drop list; the UI picker is gone) · the labels-feed adoption
    beyond ruling 6's keys + SettingsShell/PaneHeader ride their family
    items · JV e2e harness item unchanged.
  - **(Historical — the itemized remainder below was the pre-execution plan:)**
    · llm_roles_api + feature_pins_api mounts+files die WITH their renderer
      bindings (QuickSetup.vue:276, SpeakerLabView.vue:414+:48+:439,
      SettingsView.vue:497+:535-550+:585-728) — same slice as the chrome.
    · Settings-tree residue: drop feature_pins/production_configs/roles (+
      dormant engines.llm[] read path stays for migrate_providers); refine
      FLAGS + auto-refine toggle SURVIVE; test_camel_aliases +
      test_settings_patch_merge + test_system_info adjust then.
    · CHROME: nav "AI Settings" entry (always visible, no visibleFor) +
      route hosting kit AiModelsArea (ONE host tab per ruling 8; today's
      Engines page renames "Voice engines", keeps no-visibleFor); kit
      QuickSetup + ?quicksetup=1 + ruling 6's words via the labels feed
      ("LLM engine setup"/"Voice engine setup"); AiStatusButton +
      useAiTasksNav row in JV's topbar; Settings gains Storage + Server,
      loses "AI features" (rehome app-specific knobs first — ruling 8);
      kit LogsPanel + platform install_log_ring/install_file_log +
      make_logs_router(PRODUCT) + make_disk_router replacing admin_api's
      twins; AiSetupOffer at the first-project moment; health gains
      product + camel apiVersion.
    · Rust: portable data root (storage_get_root/relocate + pointer) +
      spawn sets JUSTVOICE_DATA_DIR + venv-first debug spawn arm.
    · Housekeeping: llm-runner pin → bundle extra (@main) + update-pydeps
      fix; the app.py "convergence part 2" boot-order comment block near
      the provider migration still references the old order (minor).
    · Docs sweep for everything above (FEATURES.md / docs/*) + the two
      CONTRACT.md corrections (decisions doc §4).
    · Then Phase 3: voice_gender (its row + preset + sample already seed).

  **THE NINE RULINGS — ALL DECIDED 2026-08-05 s2 (chat, item by item; the
  final converged text below IS the decision — the "owed" framing below it is
  historical).**

  1. **Clean drop** of the old routing leftovers: settings-tree feature-pins,
     production-configs, roles data, dormant `engines.llm[]`. Providers are
     SAFE either way (migrated to the shared DB on every boot since
     2026-08-01, app.py:219). **Surviving explicitly:** the refine FLAGS +
     the auto-refine-after-capture toggle (behavior config, not routing
     residue). Prompt TEXT always migrates preserving user edits
     (seed-if-missing semantics, never clobber); a row's hand-changed
     temperature/think lifts into that feature's assigned preset.
  2. **voice_gender triggers by explicit button in Voices** — never auto on
     fetch.
  3. **"AI engine console" — FAMILY-WIDE rename of the kit console tab, all
     three apps** (the AI-engine process exists in every app; JV additionally
     runs TTS engine processes, whose logs stay JV's own surface). Blast
     radius: familyContract.js manifest + JW en/es keys + both contract
     tests + docs mentions. Kit-side item recorded in the runner's TASKS.
  4. **AI Settings nav entry: always visible** in every journey. Phase-0
     check: today's Engines-entry visibleFor behavior. **Voice engines (its
     own page per ruling 8) keeps TODAY'S visibility behavior** — never part
     of this ruling.
  5. **JV splash plate: minimal brand plate** (name/logo on brand background;
     dark-mode variant like today's boot layer). No artwork invention.
  6. **JV-only wizard words: "LLM engine setup"** beside "Voice engine setup"
     (JV has two engine kinds; the pair names them). Visible words only, via
     the per-app word feeds that already exist (quickSetupCopy voice seam +
     JV's labels feed); siblings keep "Quick Setup"; code identifiers
     (`?quicksetup=1`, seam names) unchanged.
  7. **Warm-on-startup default OFF in JV** (TTS owns the GPU until F4's
     arbiter; mechanics ship identically; user can flip it on). Phase-0
     checkbox: verify the shared `warmDefaultOnStartup` default — if the
     shared seed defaults ON, Phase 1 seeds JV's explicitly false. The
     shared routes are live TODAY, so this matters from Phase 1, not 2.
  8. **ONE host tab** (JW's exact shape, zero kit changes); Voice engines
     stays its own nav page. Phase-2 rehoming step: inventory the dying
     Settings "AI features" section — anything app-specific (attribution
     confidence etc.) rehomes to a JV-owned section or its feature surface,
     never dropped.
  9. **EVERYTHING IS A TEMPLATE ROW, in every app — nothing hardcoded**
     (decided over several passes; JW's `{{characterName}}`/`{{excerpts}}`
     pattern is the family shape; code computes variable VALUES, rows own
     the WORDING, presets own every tunable):
     - **JV: 12 rows over 9 features** — `speaker_attribution.guided` +
       `.direct` (exist) · `smart_assign` (exists) · `render_preset_suggest`
       (exists) · `show_notes` (exists) · `compose` (new — `{{personality}}`;
       its hardcoded `temperature=0.9` at personas_api.py:270 moves onto its
       preset) · `persona_rewrite` (new — `{{personality}}` + `{{text}}`) ·
       `voice_gender` (new feature, new row) · **refine ×4**: `refine.base`
       (base instructions + the Forbidden block; user template
       `{{transcript}}`; carries "if no transformation sections follow,
       return the transcript unchanged" — retiring the builder's hardcoded
       fallback by construction) + `refine.smart_cleanup` +
       `refine.self_correction` + `refine.preserve_technical` (each section's
       full text from refinement.py:131-154 becomes its row; each carries its
       own `{{transcript}}` user template so it is STANDALONE-testable in
       the Lab with a sample demonstrating exactly its behavior).
     - **The refine composition:** the Settings checkboxes keep choosing
       which section rows ride; a ~10-line JV composer concatenates base +
       enabled sections' system texts and uses base's user half; the call
       runs through the run helper's EXISTING explicit-system door (the
       A922 body-supplied-system path — zero new runner mechanism). The Lab
       tests each PART; production runs the COMPOSITION — stated honestly;
       the assembled prompt is visible in the AI-task detail after a real
       run. Routing lists ONE "Dictation cleanup" (catalog entry); the
       Workbench lists the four rows under it — VERIFIED first-class in the
       kit (FeatureWorkbench.vue:56-57 groups rows per feature, :94 group
       heads; zero-row features are dropped :59-60).
     - **REFINEMENT_EXAMPLES stay code-side data** (few-shot sent as real
       chat turns, refinement.py:180-209; measured rationale: small models
       echo inline examples, order matters — last slots pin hardest rules).
       Revisitable; recorded, not hidden.
     - Row keys pin to the catalog key spelling (`refine.*`). Every row
       gets `test_samples` sample data, JW-style. jsonMode/schema lives on
       the row where a feature needs a JSON contract.
     - **Docgen converges too** — its own follow-on item (docgen TASKS),
       right AFTER F1 delivers the run helper (decided sequencing: NOT
       folded into F1). The promptless mode retires family-wide with it.
     - Hard gate before ANY row conversion: verify shared `render()`'s
       missing-placeholder behavior; if silent, the kit fail-loud hardening
       lands first.

  *(Historical — the pre-decision framing and recs, kept for context:)*
  1. Old JV LLM rows — clean drop + Quick Setup, incl. the
     `settings.engines.llm[]` residue (rec). **Stakes corrected (s2): the
     user-configured PROVIDERS already live in the shared DB** —
     `migrate_settings_providers_to_db` has run on every boot since 2026-08-01
     (app.py:219) — so they survive either answer; the drop's real object is
     only the settings-tree feature-pins / production-configs / roles data +
     the dormant `engines.llm[]` (config.py:60-65 "nothing reads").
  2. `voice_gender` trigger — explicit button in Voices (rec).
  3. Kit console tab label in JV — "AI engine console" (rec).
  4. Merged AI nav always visible — yes (rec). **Phase-0 fact-check added
     (s2): JV's nav is journey-filtered (App.vue:34-40) and the July "Engines
     has no visibleFor filter" claim is unverified in today's tree — verify
     before wording the entry's visibility.**
  5. JV splash plate — minimal brand plate, no artwork invention (rec).
  6. JV's TTS wizard renamed "Voice engine setup" so "Quick Setup" stays the
     family LLM wizard (rec).
  7. Warm-on-startup default in JV — OFF until F4's VRAM arbiter (rec; note
     s2: the shared routes are live TODAY, so warm is a real behavior from
     Phase 1, not a Phase-2 latency — the default matters immediately).
  8. ONE host tab vs the July ruling's two (rec: one — JW's shape, zero kit
     changes; Voice engines stays its own page). Whichever way this lands,
     Phase 2's nav wording rewrites with it (two entries under one-tab, one
     merged entry under two-tab).
  9. Rows vs code-built prompts — **rec REFINED by code (s2): rows = what is
     ALREADY rowed + the new feature** — `smart_assign`,
     `render_preset_suggest`, `show_notes`, `speaker_attribution.guided` +
     `.direct` (all five are Lab-editable `jv_feature_prompts` rows today,
     seed.py:270-301; my earlier "code-built for attribution" would have
     REMOVED editability the design deliberately has, prompt_store.py:2-9) +
     `voice_gender` (new row); **code-built = `compose`, `persona_rewrite`
     (NOT rowed today — built from persona fields, personas_api.py:242,285;
     frozen scope says don't grow them) and `refinement.py`'s flag-driven
     builder.**

  **SETTLED BY DONOR PRECEDENT, no ruling needed (s2):** §11's "AiStatusButton
  in the TitleBar" is satisfied JW-style — the kit BUTTON inside the app's OWN
  topbar (JW TitleBar.vue:7,159); JV mounts kit `AiStatusButton` in its
  existing topbar. The kit TitleBar FRAME (docgen's shape) is optional dedup,
  not F1 scope. · JV's Settings → Logs adopts kit `LogsPanel` over the shared
  `make_logs_router` (both siblings' shape); JV's private ring/file twins
  (admin_api.py:58-96 — CONFIRMED duplicates, zero platform imports) swap to
  platform `install_log_ring`/`install_file_log` + `make_logs_router` +
  `make_disk_router` (JV mounts NO disk router today).

  **NAMED EXCLUSIONS (s2) — consistent with the family, not oversights:**
  kit `SettingsShell` + `PaneHeader` adoption and the `configureFamilyLabels`
  feed ride their FAMILY-WIDE items, not F1 (JW itself defers SettingsShell;
  docgen owes PaneHeader on five views; JW alone feeds labels today). Note:
  JV HAS vue-i18n live (main.js:11,70 — real locale files), so its labels
  feed and the tray-localization gap are UNBLOCKED for that later pass.

  **PHASE CORRECTIONS — execution-verified 2026-08-05 s2, recorded under the
  approved "write everything down"; they amend the intended build order above
  without changing its shape (0 → renderer chrome → server swap + AI area →
  tail):**
  - Phase 1's "fixes transport base + token" overstates `installLlmUi`: as
    built (installLlmUi.js:79-117) it fixes the BASE (+ catalog/quick-setup
    copy, capabilities, external opener) and has NO token handling. The token
    half is the kit's own recorded later-work (serverApi.js:144-148): an
    ADDITIVE authed path-first blob/form seam so JV's thin-client mode
    (`jt:server` override, config.js:17-21) can authenticate downloads. JV
    passes `resolveBase` (its config.js resolver, which layers the `jt:server`
    override) rather than bare `devPorts`, so the override keeps winning.
    The delta is an EXPORT-SURFACE design, not one function: serverApi
    already has an AUTHED postForm (:149-159) that is NOT the public export —
    index.js:14 exports client.js's auth-free pair — so the build decides
    which module owns the public blob/form pair without breaking kit-internal
    consumers (kit components import client.js's directly).
  - ~~Phase 1's warm/boot pieces are inert against the old server~~ REVERSED
    by the install_llm discovery: the server ALREADY serves the shared routes
    (`/v1/ai/engine-config` included), so `startWarmOnBoot`/`BootModelLoad`
    are LIVE from day one of Phase 1. Whether anything actually warms is
    ruling 7's default (rec OFF); warmBoot.js:29-48 try/catches regardless.
  - NO import cliff AND no swap (the DISCOVERED bullet above — install_llm is
    already mounted; the pyproject pin affects any NON-EDITABLE install —
    bundle/CI/fresh box — and its bump/removal stays F1 work). The residual
    overlap list is short and known: the DELIBERATE ai_prompts shadow
    (:204-206 — dies in convergence part 3, shaped by ruling 9),
    llm_roles_api + feature_pins_api (:259-260 — die with the pin
    retirement), the qwen3 local_managed adapter (:227 — dies per the
    deletion list with the capture-readiness repoint). Phase 2 is a
    per-commit working-state series by construction: complete the install
    params → author the seeds → rewire features one by one through the run
    helper → deletions last.
  - NEW runner delta (verified 2026-08-05 s2): the preset tier's RESOLVE is
    importable (`preset_resolve.resolve_feature_preset`, prompts.py:43) but
    the OVERLAY-onto-chat lives only inside the run route's closure
    (prompts.py:455+, private `_plane2_extra`/`_effective_think`/
    `_response_format`). JV's features run IN-SERVER, so Phase 2 extracts a
    callable run helper (resolve → overlay → dispatch.chat) shared by the
    route and in-server callers — small, additive, route behavior unchanged.
    This is HOW "rewire the 8 features" actually lands.
  - The Rust portable-data-root work MOVES Phase 3 → Phase 2: Settings gains
    Storage in Phase 2 and its data-root/relocate rows bind those Rust
    commands. Phase 3 shrinks to `voice_gender` alone.
  - Phase 2's test scope, named: the 5 dying-surface files (test_llm_roles,
    test_local_llamacpp, test_persona_rewrite, test_camel_aliases,
    test_settings_patch_merge) PLUS the other 4 that import llm_runner
    (test_discover_speakers, test_captures, test_extraction_config,
    test_system_info) are rewritten/retired in the same series — pytest must
    COLLECT at every commit of the series.
  - Phase 2's nav line ("Engines" → "AI Settings") encodes the July merged-nav
    ruling; under ruling 8's rec (ONE host tab, Voice engines stays its own
    page) the nav keeps TWO entries. Whichever way ruling 8 lands, the nav
    text rewrites with it — the ruling's answer settles this line too.
  - Health, corrected fact: JV ALREADY returns `api_version`
    (models.py:43-48 — plain pydantic, NO camel alias, so it serializes
    snake_case) plus status/version/current_engine/engines; it lacks
    `product`. The baseline delta = add `product`, serve `apiVersion`
    (camel), keep JV's extras.
  - Also in Phase 2's delete list: `scripts/verify-llm-backend.js` (sole
    importer of the dead `services/llmBackend.js`). The `jt:server`/`jt:token`
    localStorage question (decisions doc §7.9) resolves in Phase 1 with the
    transport work. Ruff gate for every JV phase: NO NEW errors in touched
    files (515 pre-existing). Every phase updates the user docs it touches
    (FEATURES.md / docs/*) in the same change, per the family docs rule; the
    two CONTRACT.md corrections (decisions doc §4) land with Phase 2. A
    per-phase eyes-on QC checklist is OWED at plan time — JV has NO e2e
    harness (scripts/shots.js + verify_all.js are browser-driven and predate
    the browser-driving ban; not an acceptance surface).

  **RENDERER PRECISION (s2 read-verified — corrects the "7 files bind the
  dying LLM shape" frame and the "zero kit chrome" line):** JV pervasively
  consumes kit PRIMITIVES (UiButton/UiTag/UiSelect/UiInput/UiTextarea/UiToggle/
  UiChip/AppModal), hand-mounts a WORKING Toast + AppDialog pair (App.vue:510-
  511), runs the kit Help system (configureHelp main.js:64; HelpDrawer/
  HelpTrigger App.vue:487,514) and the kit tooltip directive. What's missing is
  the LLM/chrome set specifically: AiModelsArea · kit QuickSetup ·
  AiStatusButton · SettingsShell · LogsPanel · DataManagement · UpdatesPanel ·
  BootModelLoad/warm · LlmUiHosts-as-one · AiSetupOffer · installLlmUi.
  The genuinely DYING private bindings narrow to: `/v1/feature-pins`
  (QuickSetup.vue:276, SpeakerLabView.vue:414, SettingsView.vue:585-728),
  `/v1/production-configs` (SpeakerLab:48,439, Settings:535-550),
  `/v1/llm-roles/recommendations` (Settings:497), and dead `llmBackend.js`.
  Everything else those views call is LIVE SHARED routes (detect-local
  provider_api.py:222 · classify-tier api.py:74 · llm-providers CRUD/models/
  ping) — they die only as duplicated UI, replaced by the kit area. The
  `ai_prompts` shadow router has ZERO renderer callers (no `/v1/ai/` string in
  src at all) — convergence part 3 deletes it losing no surface; the kit Lab
  becomes JV's first prompt UI. Phase 1 is SMALLER than briefed: the
  ConnectionError boot gate + checkServer + configureServerApi WITH bearer
  token already run (main.js:34-51); §7.9 narrows to "is localStorage the
  sanctioned store" (jt:token is deliberately consumed, main.js:36).
  `installLlmUi`'s own configureServerApi call leaves an already-set authToken
  intact (serverApi.js:25-28) — boot order stays safe.

  **DB/SEED TRUTH (s2 read-verified — the "is the db changed and seeded
  correctly" answer):** NO table collisions — the shared stack's 26 tables
  (db.py) vs JV's are disjoint; `jv_feature_prompts` was already renamed per
  §9(5) (models.py:513; the shared `feature_prompts` is db.py:571).
  Boot seeding today: shared `seed_llm()` with `feature_prompts={}` (no shared
  prompt rows) + JV's own `seed_feature_prompts` = 5 rows over 4 features
  (seed.py:270-301). Phase 2's DB delta: migrate the 5 rows into shared
  `feature_prompts` (schemas nearly match; per-row temperature/think move onto
  PRESETS per one-source), seed the preset library + action→preset refs +
  default + test samples, add the `voice_gender` row, drop
  `jv_feature_prompts`; pins/production-configs die with the SETTINGS tree,
  not the DB. Stale docstring queued: prompt_store.py:2-3 still says "the
  `feature_prompts` table" (dies with the store). Parity-C JV half: when
  `/v1/data` reset arrives, reset must re-seed BOTH seed sets (JV's own +
  the shared) — JW's recorded lesson generalized to dual tables.

  **AUDIT 2026-08-05 s2 (three-app parity audit) — JV findings beyond the LLM
  slice** (fixed now where one-line: `@vueuse/core` declared + deduped —
  package.json + vite.config.js — the kit's AppModal.vue:16 imported it while
  JV never declared it, resolving by hoisting luck):
  - **`update-pydeps` is a live footgun** (package.json:11): `pip install -e .`
    re-resolves the June direct-URL runner pin (pyproject:48), which an
    editable install does NOT satisfy — running it CLOBBERS the editable
    runner with July code. Fix rides F1's pin work (adopt the siblings'
    not-a-hard-dep pattern; bundle extra only).
  - **Debug spawn lacks the venv-first arm** (lib.rs:107-113): tries PATH
    `justvoice-server`, falls back to bare `python` — never
    `server/.venv/Scripts/justvoice-server` resolved from CARGO_MANIFEST_DIR
    (§5's pattern; both siblings have it). A PATH-stale server is the failure.
  - **The shell sets NO data-dir env on spawn** (spawn_sidecar passes no env;
    server reads `JUSTVOICE_DATA_DIR` at paths.py:31) — shell and server agree
    today only because both default through platformdirs. §5 says the shell
    SETS it; lands with F1's data-root phase.
  - **Console-script module path deviation** (grandfathered-class, now
    recorded): `justvoice.cli` not `<snake>.serve` — same class as JW's
    recorded exception.
  - JV has no e2e harness (§10) — recorded; its `scripts/shots.js` +
    `verify_all.js` are BROWSER-driven (banned surface since the 2026-08-02
    ruling): not an acceptance path, retire-or-replace rides the harness item.

  **RECOVERED CHAT RULINGS — agreed 2026-08-05 first session, never written
  here, recovered from the session transcript 2026-08-05 s2:**
  - JV's `AiSetupOffer` moment = JW's donor semantics VERBATIM: right after
    the FIRST PROJECT is created or opened (JV is project-based like JW;
    docgen's Setup-save variant was only ever the substitute for having no
    projects).
  - JV's kit capabilities value = `{ embeddings: false }` (nothing in JV
    embeds). The seam exists: installLlmUi.js:29-42, honored today via the
    catalog's `showEmbedding` flag.

  **Stale-comment fixes queued by this verification (one-line code edits,
  awaiting a code go):** docgen `server/just_ai_i18n_docgen/app.py:51` port
  comment says "JV 8741" and the kit's `ui/src/client.js:6` says "JV :8741" —
  JV's real server port is 17494 (config.js:14).

  Ledger history: `just-llm-runner/docs/plans/archive/2026-07-06-outstanding-master-plan.md` §F1.
- **F2 — `speaker_attribution` task scaffolding** (a JV need; JW bans speaker
  analysis) — after F1. Ledger §F2.
- **F4 — `EngineManager.load()` → shared VRAM-arbiter hook** — the decision was
  made 2026-07-04 and the arbiter is BUILT in the runner; only the JV-side wiring
  remains. After F1. Ledger §F4.
- **F5 — Appearance knob-set gap** — JV exposes Theme/size/accent/language while
  the shared engine supports the full JW set. Independent of F1. Ledger §F5.
  (Related: the user's 2026-08-04 ruling that the appearance SURFACE should be
  shared JV + i18n-docgen — tracked in docgen's TASKS.)
- **F3 — audiobook converters + speaker-attribution deep research** — PARKED by
  the user's word 2026-06-27 (`docs/plans/archive/2026-06-27-audiobook-tools-research-todo.md`).
- **I6 — the JV tail beyond F1–F5** — ledger §I6.

## Product decisions still open — extracted from the archived DESIGN_FREEZE §10

The freeze said "code resumes on user's answer"; these were never answered and had
no tracker line until the docs campaign. All yours:

- **Brand-name clearance** — USPTO TESS + Google check (the old "task #58"), then
  the rename PR (the `justvoice`/`justvoice-server` console-script split survives
  any rename — the Windows spawn-loop guard).
- **Code signing** — Windows-only EV cert ($200-400/yr) at v1.0 vs all platforms
  day 1 (±4-6 weeks of launch timeline).
- **Audio-channels UI** in v1 (gated toggle) vs v1.1 — REFRAMED by code: bindings
  are persona-level now, so the question is about the persona-channels surface.
- **External provider per-character** in v1 vs v1.1.
- **Tab discovery order** — the freeze's 13-tab question is moot (14 routes +
  Labs/Settings collapse today); the underlying "does discovery order match
  intent?" question stands for the current nav.
- **Loading-message tone** (playful pro-tool vs too playful) · **v1 scope check** —
  anything in the deferred list (IDEAS) that belongs in v1.0.

## Repo hygiene (found by the 2026-08-04 campaign)

- **The Stories nav lede SELLS an inert view [verified]** — the tab's own copy
  reads "Multi-track timeline editor. For podcasting…" (`App.vue:44`) while
  `StoriesView.vue` is a gated placeholder. Reword the lede or hide the tab until
  it's built; app copy is code, so this is your call. (User docs were corrected
  2026-08-04 to stop routing podcasters there.)
- **Dev-doc gaps from the coverage audit [attributed]** — record when convenient:
  the Stories gating why (lives only in `StoriesView.vue:4-14`) → design-decisions
  §5 · the backup schema-v1/4 GB design → a decisions record · the settings→SQLite
  fold comment (`settings_store.py:31-64`) → `docs/decisions/` · the
  engine-source-overrides "no hardcoded operator values" law · corrections-as-
  few-shot · the feature-pin catalog vs SettingsView row divergence
  (`SettingsView.vue:570-574`).

- **F1's concrete artifact: `server/pyproject.toml:44` pins a June commit SHA** of
  the shared stack [verified by the recap; the pin is the stale-snapshot mechanism
  F1 removes].
- **Hardware-gated runner work** [attributed: the recap]: the built-in runner's
  P1.5b auto-spawn + P1.6 benchmark + working-config cache need building/verifying
  on the user's GPU box.
- **Layer C anti-divergence guard + parity sweep** [attributed: the convergence
  outcomes, `docs/dev/design-decisions.md` §4]: a lint/CI check that fails on a new
  hand-rolled fetch / forked primitive / second `init_db` copy · the server-basics
  parity sweep (camelCase responses, health/settings shape).
- **CI contract enforcement is CLAIMED but not found** [verified]: the archived
  CONTRACT cites `server/justvoice/openapi.json` + `tests/test_contract.py` —
  neither exists. Build it or strike the claim.
- **Missing user docs** [verified vs toc.json]: stories (tracked above) · backup/
  restore · render presets · a settings reference · troubleshooting · run-modes
  (desktop vs headless). The archived FEATURES.md §s name the content to lift.

- **Family-contract gaps [verified against `app-structure.md` §1/§2]:** no
  `scripts/py.js` (the `server` script calls bare `python`); no `lint` /
  `test:server` / `test` / `screenshots` npm scripts; no e2e harness. Port is
  17494 (the standard's registry was wrong until 2026-08-04, not this app).
- **`docs/stories.md` is missing while `toc.json` listed a `stories` slug
  [verified]** — the entry was removed from the TOC 2026-08-04 (it 404'd in-app);
  write the doc for `StoriesView` and restore the entry.
- **Root strays need your classification:** `DESIGN_FREEZE.md` (940 lines,
  ⏳-pending legend, touched Aug 1) · `CONTRACT.md` (JV↔JW boundary, last revised
  2026-06-09) · `FEATURES.md` (911-line user guide overlapping `docs/*`). Too
  big/live-looking for the light pass — keep / update / archive is your call.
- **`2026-06-12-justwrite-roundtrip-slice1.md` — "JW side MISSING" [attributed]:**
  the JW half lives in the other repo and no status was ever written back; verify
  in JW's code, then close or queue.
- **`2026-06-20-deep-audit.md` (JV) — a backlog posing as a plan [attributed]:**
  self-described "ordered by value/effort", never triaged; fold what's live into
  this tracker or archive it.
- **June QC queues presumed complete [attributed]:** `2026-06-12-qc-round-2-queue`,
  `2026-06-13-qc-batch-1`, `2026-06-14-deep-audit-v2` were banner'd
  "presumed complete" (sibling round-3 is explicitly complete; their own items
  were never marked). If one still bites on your box, it comes back as a line here.
- **VOICEBOX_PARITY G1–G5 gap list [attributed]** — the live residue of the
  archived 2026-06-11 parity audit; re-verify against today's app before acting.
