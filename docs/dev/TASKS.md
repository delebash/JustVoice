# TASKS — open work (JustVoice)

> **This is JustVoice's live tracker.** One item per piece of open work, written
> so it can be read cold. **Close = delete** — git keeps the history, so nothing
> finished stays on this page. **An item lives where the code that closes it
> lives** — JustVoice work here; shared-kit and shared-server work in
> `../just-llm-runner/docs/dev/TASKS.md`; JustWrite work in
> `../justwrite-app/docs/dev/TASKS.md`. Unscheduled ideas go in `IDEAS.md`;
> adding an idea is never starting it.
>
> **THE FORMAT (user ruling, 2026-08-08).** Twice this file has failed: once as
> long prose that restated code and went stale, once as stubs that dropped the
> decision and made a later session re-derive it from a transcript. The rule that
> fixes both: **an item holds what code cannot tell you; everything else is a
> cite.** If the code can answer it, cite `file:line` — never retype it. If only
> the conversation can answer it, it is written here, verbatim, in the same reply
> the decision is made. Six fields, 25 lines max; longer means either code
> restatement (cut it) or a real plan (one line here, pointing at the plan doc):
>
> ```
> ### <the outcome, one line>
> STATE:  DECIDED <date> — "<your words>"  |  OPEN — your call  |  FINDING — code-verified <date>
> WHY:    <why this beat the alternative — 1-2 lines>
> NOT:    <what was rejected, one line each, so it stays rejected>
> BUILT:  <file:line>        OPEN: <the exact remaining change, one sentence>
> GO:     given <date> | needed
> ```
>
> **Never record a decision anywhere but here.** The session task tool is scratch
> and dies with the session — that is how the dictation-cleanup proposal was lost
> and had to be excavated from a 30 MB transcript on 2026-08-08.
>
> **A line here is a claim, not evidence — verify against the code before acting
> on it.** Every item below was re-verified against the code on 2026-08-08 **with
> two exceptions, each of which says so on its own line**: the contract-doc rows
> (they live under `docs/plans/archive/`, out of scope by the no-archives ruling)
> and whether `design-decisions.md` already covers the five rationales. The sweep
> deleted the lint-gate item (fixed), the ratified Lab-tunables item, the
> duplicate cleanup-card item, and one false claim about a missing npm script.
>
> **Nothing points into an archive.** If an item needs detail, that detail is
> either written here or lives in a live doc named on the item's own line.
>
> **The order of work (the user's ruling, 2026-07-26):** *"completely finish JW
> and all AI stuff, then we will work on JV."* Everything here is parked behind
> that unless the user says otherwise, and every item needs its own go.
>
> **GitHub Actions stay off (user ruling, re-issued 2026-08-05: "i asked you to
> turn off github actions when yo commit jv you ignored this fix it").** All
> three workflows — `CI`, `CodeQL`, `release.yml` — are `disabled_manually` on
> the remote. That is a repo setting (`gh workflow disable <file>`), not a file
> edit, and it is reversible with `gh workflow enable <file>`. It was ignored
> once and three pushes each triggered failing runs. **Before pushing JustVoice,
> confirm `gh workflow list --all` still shows all three disabled.** The workflow
> YAML is deliberately left untouched so turning CI back on is one command.

## Waiting on your decision

### `DatasetTab.vue` hand-rolls its JSON export — move it onto the kit's `saveBlob`
STATE:  DECIDED 2026-09-19 — "your rec go" on: "replace the six hand-rolled
        lines with saveBlob(blob, name, { filterName: "Dataset script",
        filterExt: "json" }), exactly as ExportPanel.vue already does."
WHY:    the family checker's one violation (predates today: `572a087`,
        2026-08-21), and two real defects beside the rule: the object URL is
        revoked in the same tick as click() (Safari/Firefox have aborted such
        downloads — the kit waits 30 s), and the desktop app never gets the
        native Save dialog `saveBlob` provides.
NOT:    a local helper; a new kit door.
BUILT:  2026-09-19 — `DatasetTab.vue` `exportJson` → `saveBlob` (title "Save
        dataset script", filter json; failures toast, the ExportPanel
        shape); `docs/voices.md` says where the file goes. `check-family`:
        **no violations**; biome clean. Close (delete) at commit.
GO:     given 2026-09-19.

### Voice modes: Alexandria parity + the defect list — Opus executes from the plan doc
STATE:  DECIDED 2026-08-22 — "i am not locking drift at desing time i want same
        as alexandria" (both designed paths coexist: frozen Designer→save→clone
        AND dynamic per-line design). The full session verification + per-item
        specs: `docs/plans/2026-08-22-voice-modes-truth-and-parity.md` (§5).
WHY:    Code-verified against upstream Qwen3-TTS + Alexandria clones, file by
        file: our qwen3 engine is faithful; the gaps are host-side. Items:
        A freeze bridge (save discards the designed WAV) · J design_prompt
        never reaches render (stored designed voices inert) · C qwen tags flag
        is false, promised translation never built · D docs/UI: clones ignore
        direction · E variant preflight for mixed casts · F verify Custom
        Voice UI path · G seed-stability ear test GATES Alder/Wren · K execute
        the §3.6 preset-delivery excision (tier still WINS the merge) ·
        I housekeeping (kit MTP message = kit TASKS).
NOT:    retiring the dynamic designed mode (user reversed: parity, not
        drift-lock) · auto variant swapping in E (later opt-in) · a qwen
        tag-translation layer inside C (separate item if ever).
BUILT:  2026-08-22 under "your rec update docs and go for coding" — A · J · E ·
        C · D · I built + gated (741 pytest, 15/15 smoke, vite, ruff); F walked
        and closed with nothing to fix (the Custom Voice path was already wired
        end to end). Execution record, deviations and what NO gate covered:
        plan doc §9. Nothing rendered by ear — see §9.6.
        COMMITTED + PUSHED 2026-09-19 as `108caac` (with `6c7cf57` persona
        sweep, `adfa3ea` smoke splash fix); every gate re-run fresh first —
        plan doc §9.8.
OPEN:   G (ear test, needs the user — still gates H) · H (blocked on G) ·
        K (untouched; largest blast radius; the delivery tier still WINS the
        merge) · one gap D does not name: after A, a designed voice WITH a
        frozen clip renders as a clone and drops direction, but the frontend
        cannot tell frozen from clip-less (`VoiceRecord` exposes no
        "has ref.wav"), so the persona hint still says "✓ takes direction" for
        it. Needs a decision — expose a computed field, or leave it to
        docs/voices.md, which now carries it. NOT filled in by assumption.
GO:     needed — per item, naming it.

### The fresh-install speech clean — scope agreed, two answers still open
STATE:  DECIDED 2026-08-22 — speech-only reset, shared LLM folder untouched:
        (1) delete `engines/.uv-python` · (2) clear tts/stt measurement rows ·
        (3) remove orphan `engines/pocket_tts/` · (4) assistant stops the
        server (kill by PID/port after verifying llama-server parentage) ·
        (5) delete JV's orphan `<data>/ai-cache` (24 GB, dead since the
        shared-cache switch) · plus `engines/{5 engines}/{.venv,models}` and
        `<data>/speech-cache`. Full manifest + evidence: plan doc §7.2-7.3.
WHY:    Test the whole install cold: engine venv installs, model downloads,
        QuickSetup shared-cache choice. Update check reads build-on-disk
        (QC-25), so a DB wipe cannot make the shared engine misreport.
NOT:    touching JW's ai-cache (197 GB) · `<data>/ai-runtime` (live, per-app
        by design) · git-tracked source · kill-by-image-name.
ANSWERED 2026-09-19 — *"wiped db for fresh install and backup alder and wren
        first"*: wipe `justvoice.db` = YES · back up Alder+Wren before
        anything is deleted = YES.
        Then *"your rec on both, go"* (2026-09-19) on the two points the
        answers left open: (1) backup destination =
        `E:\Dev\Web\_backups\jv-alder-wren-2026-09-19\` — durable, outside
        the data dir and outside the session scratchpad (temp, may be
        cleaned; these are the only copies); (2) Alder+Wren STAY in
        `<data>/justvoice/training/builder` — they do not affect what this
        test checks (engine installs, model downloads, QuickSetup), and the
        backup covers them.
        CORRECTION to plan §7.3: the "3 user-added gemma catalog rows re-add
        via UI" is wrong — they are JV's own seed (`seed_presets.py:56`
        `JV_MODEL_CATALOG` → kit `seed_extra_catalog`, insert-if-missing,
        `built_in=False` only because an app's seed shows as user rows), so a
        wiped DB re-creates them on first start.
BUILT:  2026-09-19 — backup DONE: both `project.json` copied to the
        destination above, sha256 identical to the originals (Alder 33 rows,
        Wren 33 rows). Pre-delete scan: nothing running; the only reparse
        point in the whole delete set is a junction INSIDE `.uv-python`
        pointing at its sibling there (both ends in the set); `pocket_tts/` =
        3 cpython-312 `.pyc`, untracked; free on E: 1216.33 GB.
        Claude Code's auto-mode classifier refused the delete, so the user ran
        the same script by hand (`! pwsh … speech-clean.ps1`): all 15 targets
        deleted, **44.66 GB freed** on E: (the ~19 GB the venvs report was
        mostly hardlinks into `E:\UV_CACHE_DIR`, which stays). Verified after:
        0 of 15 targets (+ db -wal/-shm) present · JW's ai-cache intact (414
        files) · JV `ai-runtime` intact (62 files) · Alder+Wren originals and
        backup both present, hashes equal · `E:\UV_CACHE_DIR` intact · git: 0
        tracked files deleted · each engine's `state/` and `voices/` empty, so
        no stale install marker survives.
OPEN:   the fresh run itself — start the app, choose the SHARED model folder
        in QuickSetup, install engines. Pass/fail: afterwards
        `<data>/ai-cache` must NOT exist. Venv rebuilds link from the kept uv
        cache, so Python packages will not re-download; CPython and every
        model will.
DECIDED 2026-09-29 — "do what you can without my intervention, then let me know the things
        that i have to do, so run whtever test scenerious you can automate yourself, do a full
        walkthrough and see how it works and let me know you have full permissions for
        anything, go", on the recs as given:
        1 "Push first … With your word I'll try once more. If it's blocked again, it needs
          you to type `! git push origin main`."
        2 "Then the fresh-install test, but start with a read-only look at `ai-cache` … what's
          in it, how big it is and when it was written, without deleting anything. … Then the
          test as written: open the app, choose the shared model folder in QuickSetup,
          install the engines. Order: Kokoro first … Then the other four in the background:
          Chatterbox, Qwen3, LuxTTS and Whisper. … Pass or fail gets recorded in the TASKS
          entry."
        3 "Then finish The Ninth Facet: Cast, then render The Keystone. … I make six personas
          from Kokoro voices, one for the Narrator and one for each of the 5 speakers with
          lines in The Keystone. The Narrator persona would be named 'Narrator' … The other
          five get plain voice-style names … Smart-assign casts them … Then I render The
          Keystone and check the audio exists and plays."
        Plus a full walkthrough of the app, automated where it can be.
RESULT 2026-09-29 — PASS, after one cleanup.
        · Speech: all five engines installed through the app's own Install doors (venv ~20 s
          each, linked from the kept uv cache; models 6-78 s) into `engines/<id>/.venv` and
          `<data>/speech-cache` (11 GB). `ai-cache` untouched. First it FAILED on every engine —
          "[WinError 193]" — see the uv FINDING below.
        · LLM, checked on an EMPTY data folder (a scratch server, API only, deleted after, its
          registry entry removed): first launch creates no `ai-cache` and downloads nothing (the
          presets name the local runner with no model, so warm-on-boot is a no-op); it detects
          JustWrite's cache as a shareable option; the choice applies at once when the engine is
          idle. The 29 GB `<data>/ai-cache` here was the 2026-09-19 first session downloading
          gemma BEFORE the shared folder was chosen (its two blobs = JustWrite's, same sha256
          names and sizes; llama.cpp b10750 unused; nothing referenced it) — DELETED 2026-09-29,
          28 GB freed, the model verified still running from JustWrite's cache. Pass condition
          now holds: `<data>/ai-cache` does not exist.
        · The Ninth Facet end to end on the real app: Discover + Analyze all four chapters,
          Cast (six personas via the Personas page, Smart-assign, three more by hand), Render
          all, ACX QC all_ok (RMS −20.1…−20.5, peak −3.5), M4B 36:29 with 4 named chapters;
          Whisper transcribed the render back to the text. Game + podcast demos: speakers only,
          voice-line manifest key `speaker`; both demo projects deleted after.
GO:     GIVEN 2026-09-19 · and 2026-09-29 for the above.

### The component-reuse sweep — DONE, and the git rule that came out of it
STATE:  DECIDED 2026-08-21 — "what is your rec on settingshell vs tabstrip, and jv
        subnav, it should default to prepareer" → "your rec do it all" → "go"
WHY:    CLAUDE.md said "form primitives", so tables, sliders, progress bars and tab
        strips were hand-rolled for months. The rule is widened; the sweep is done.
NOT:    Adopt SettingsShell in Voices/Labs — it brings a scroller those jv-fill
        views already own. Convert editable/headerless/bespoke tables — 4 stay,
        each with a written reason. Keep LoRA on Training — overruled.
BUILT:  JV `cb3e191`, kit `178dd32`. 22→4 hand-rolled tables, 10→0 raw sliders,
        `.jv-subnav` deleted. Kit: UiSlider · UiTabStrip · UiTable `:row-class` ·
        DownloadBar `:done-label` · createDownloadTask `armPhase`/`donePhase`.
        JV: `.jv-table-look`. Record: `docs/plans/2026-08-21-blend-rework-and-
        consistency-audit.md` §§17-23.
        OPEN: nothing visual has been VERIFIED — the gate never moves a slider,
        opens a dialog or expands a row (§23.4).
GO:     given 2026-08-21

### THE GIT RULE — a bare `git commit` publishes the other session's staged work
STATE:  FINDING — code-verified 2026-08-21 (it happened: `5465efa`)
WHY:    `git add <my files>` then `git commit` commits the whole INDEX. A parallel
        session had 406 lines of deletions STAGED; they rode into my commit under a
        message that never mentioned them, and `main` went red (5 server tests).
        Nothing was lost — `git show 0ff6578:<path>` still had all three files —
        and their next commit fixed it, but the failure mode is silent.
NOT:    Reverting — it would restore code their refactor no longer references.
BUILT:  n/a — this is a working rule: **always `git commit -F - -- <paths>`.**
        The `--` pathspec limits the commit whatever else is in the index. Proof:
        `4210f5f` was made that way with three more of their deletions staged, and
        none appeared. Watch for `D ` (D in the INDEX column) in `git status`.
        OPEN: none — apply it on every commit while a second session runs.
GO:     n/a

### FINDING — the dev data dir: what is really in it, and a trap that re-arms itself
STATE:  FINDING — measured 2026-08-22 ("clean it up" → "your rec go")
WHY:    Two claims carried for a day were both wrong. The live root is NOT "~50 GB
        of real user data": it is 45.7 GB re-downloadable HF model cache + 3.7 GB
        regenerable speech cache, and the user's own content in it was a 495 KB DB
        plus two 6 KB files — voices/personas/lexicons/generations held ZERO files.
        `cargo clean` costs a re-download, not the work. And the stale `<repo>/data`
        was NOT pure junk: it held the only copy of the Alder and Wren dataset-builder
        projects (33 rows each), which a size-based read would have deleted.
NOT:    Moving the live root out of `target/debug` — the user's call, item 4 of the
        recommendation: the risk is a re-download, not data loss. Reinstalling the
        global `justvoice-server` — it was already correct (`justvoice.serve:main`).
BUILT:  `<repo>/data` DELETED (1.18 GB) after the two projects were copied across and
        verified through `storage/dataset_builder.py`'s own `list_projects`.
        **Deleting it re-armed the trap rather than removing it** — a headless run
        with no `--data-dir` now CREATES a fresh empty one that looks healthy and is
        still the wrong database. `--data-dir src-tauri/target/debug/data` stays
        mandatory for the gate. Full record, all measurements, and the storage shape
        of a builder project: `docs/plans/2026-08-22-data-dirs-and-disk-reclaim.md`.
        OPEN: none here — the remaining piece is the kit's, see that repo's tracker.
GO:     n/a

### The LoRA tab is Alexandria-parity, and acceleration works on every roster engine

STATE:  GO 2026-08-21 — *"go on table your rec go"* on the full decision
        table, after *"i am sick of both you nad opus doing half a job, do
        it right"* · *"this is crossplatform app and all hardware
        acceleration should work for all modeles"* · *"yes ship adapters …
        a and b"* · *"it does not have to be exactly like alexandria it
        needs to fit our app, but you are lazy on words and features"* ·
        *"stop using small text, do a good ui design use your ux plugins"*.
        **BUILT 2026-08-21** — the full table, verbatim, lives in
        `docs/plans/2026-08-21-lora-alexandria-parity-and-acceleration.md`
        (§2), with the verification record (§4: 46 pins green, rendered
        label assertions, screenshots) and the staged built-in voices (§2-E2:
        Alder + Wren, ready to generate + train).
WHY:    The first LoRA build ported mechanics but invented vocabulary
        ("set" for Dataset) and dropped visible features (Upload ZIP, the
        dataset list, Import/Export JSON, per-run Confidence/Min SNR,
        built-ins); and Kokoro's CUDA/DirectML were declared-but-
        unreachable — no door ever installed the accelerated onnxruntime.
CORRECTION (2026-08-21, user's catch): *"Datasets are objects, not ZIP
        files (your 2026-08-20 ruling)"* — **that was never the user's
        ruling**; it was the assistant's design choice inside the broad
        2026-08-20 go, mis-cited as the user's (same foul as the blend
        mis-cite). Under "whatever your rec": folders server-side + ZIP
        transport both ways, Alexandria-interchangeable.
NOT:    Alexandria's jargon sentences in user copy (labels yes, "metadata
        .jsonl + WAV chunks" in a lede no — user's words) · torch-DirectML
        (upstream stalled; documented CPU on Windows AMD/Intel) · fake
        BUILTIN_ADAPTERS entries before real weights are published ·
        auto-running the Alder/Wren training on the user's live box.
BUILT:  src/views/lora/* · api/training_api.py (upload/archive/builtin) ·
        training_builtin.py · storage/training_datasets.py (build_zip/
        import_zip) · training_prep.py (overrides) · render_core.py +
        engines/kokoro/ipa.py (lexicon IPA, live at render) · kokoro
        manifest ACCEL_INSTALL + manager accel step + coreml-auto +
        provider pre-flight · styles.css (.jv-lede, 12.5px floor, the
        never-defined utilities) · docs/voices.md · docs/engines.md accel
        matrix · 12 new pins.
        OPEN: sidecar restart before the new endpoints answer · unify the
        two lexicon previews · train+publish Alder/Wren → fill
        BUILTIN_ADAPTERS · timestamps build (research recorded, plan §3) ·
        full gates + commit on the user's word only.
GO:     given 2026-08-21

### FINDING — engine loads that nobody announces: three doors skip jv:health-refresh
STATE:  FINDING — code-verified 2026-08-20, from your report: *"kokor is
loaded … but not showing loaded on voices … i bet you rolled your own
again"*. Half right: DETECTION is one shared door (the engines Pinia store
reloading on the `jv:health-refresh` event, `stores/engines.js:8-40`), and
the server has ONE truth (`GET /v1/engines` said kokoro "loaded" while your
page said not — verified live). The rot is three doors that CHANGE engine
state without dispatching the event, so every other surface keeps its stale
copy until an alt-tab (`App.vue` refreshes on visibilitychange — why the
topbar looked right while the Voices page looked wrong).
WHY:    the three silent doors —
  1. `VoicesView.previewVoice` with the "Always auto-load" pref
     (`VoicesView.vue:379-382`): ▶ on a preset loads the engine as a
     side effect of `preview?auto_load=true`, dispatches NOTHING. This is
     the exact case in your screenshots (Xiaobei playing, chip saying "no
     engine loaded", Blend saying "Kokoro (not loaded)").
  2. `VoicesView.loadEngine` (the acquire tabs' Load button): reloads its
     OWN stores, never dispatches — the rest of the app stays stale.
  3. `SpeechEnginesTab.unload` (~:340): refreshes its own list, no
     dispatch (its sibling at ~:620 dispatches correctly).
The dialog-confirmed auto-load path (`VoicesView.vue:404-411`) does it
RIGHT — proof the contract exists and these are pure omissions.
NOT:    a new detection mechanism — the store + event ARE the mechanism;
the fix is making every state-changing door announce.
PARTIAL (2026-08-21, "go" on the closure list): door 3 FIXED
(`SpeechEnginesTab.unload` now dispatches like load :330 / unloadKind
:620), and four MORE silent doors found in the new LoRA views were fixed
the same day (TrainingTab Test Voice auto_load + per-clip transcribe,
DatasetTab generate, PreparerTab run-end — each a whisper/design-engine
auto-load the pill never heard about).
OPEN:   doors 1-2 only (`VoicesView.previewVoice` ~:379 and
`VoicesView.loadEngine`) — left DELIBERATELY: VoicesView.vue is owned by
the parallel Blend session (user's word 2026-08-21, *"dont do anything on
blend tab another session is working on that"*); each is a one-line
dispatch, offered to that session in the cross-session handoff.
GO:     given for doors outside VoicesView; VoicesView doors ride the
Blend session

### FINDING — a blend of non-English voices auditions as English
STATE:  FINDING — code-verified 2026-08-20, from your report: *"blend doesnt
work with other language"* (two Mandarin Kokoro presets, Chinese text,
53 s of wrong-language audio).
WHY:    Two facts, verified: (1) SAVING a blend derives its language
correctly — unanimous across the source voices → that language, else the
configured default (`voices_api.py:358-370`), so the saved voice is zh.
(2) The pre-save AUDITION ("Hear it") sends
`language: selectedLanguage.value || "en-US"` (`VoicesView.vue:818`) — and
the Language dropdown was hidden on the Blend tab the same day (because it
never reached the SAVED voice), which removed the only override. So every
blend audition now forces en-US and Kokoro phonemizes Chinese text as
English. My hide made this path strictly worse for non-English blends.
NOT:    Resurrecting the dropdown — the audition should not need a control
the save doesn't need.
OPEN:   derive the AUDITION language the same way the save does — from the
picked source voices (unanimous → that language, else the default), one
rule behind both doors. Whether the SAVED blend then renders zh correctly
end-to-end is untested — verify when fixing.
OWNED:  by the parallel Blend session (user 2026-08-21: *"drop a4 and
anything on blend tab"*) — this session verified it still stands
(VoicesView.vue:821) and handed the fix path over cross-session.
GO:     needed (theirs)

### The engine roster: 4 TTS + 1 CPU cloner + 1 STT — TADA and MOSS marked, not deleted
STATE:  DECIDED 2026-08-17 — *"your rec but dont remove them now you can mark
them for removal and hide them if you want and ok oand the pcket tts swap"*.
**THE FULL RESEARCH AND REASONING IS `docs/plans/2026-08-17-engine-roster-and-platform.md`
— read it before re-deriving ANY engine fact. Do not redo that research.**
WHY:    One rule produced the whole roster — *keep an engine only if it is the
ONLY one that does something we need*. Nine variants collapse to six slots,
each uniquely filled: Kokoro (ready voices, any hardware) · Chatterbox Turbo
(cloning + 19 tags) · Chatterbox Multilingual (23 languages) · Qwen3 (prose
direction + voice design — the only one) · **LuxTTS (cloning with no GPU —
2026-08-22 reversal: Pocket TTS rejected over HF-gated cloning weights, LuxTTS
keeps the slot, render-proven on the new stack; see the item below)** ·
Whisper (STT). **29.60 GB** of download surface removed (default variants;
37.28 GB counting Dia's second checkpoint) — summed from the manifests' own
pinned `size_bytes`, table in the plan doc §1.
NOT:    Deleting TADA and MOSS now — your explicit instruction. They keep
working for anyone who installed them; they stop being offered.
NOT:    Keeping MOSS for multi-speaker dialogue. That capability has **never
been reachable** (see the finding below) and the architecture cannot use it —
`Block.persona_id` is one persona per block and render is a per-line loop.
NOT:    Dropping LuxTTS — the 2026-08-17 "measure Pocket first" gate fired and
REVERSED the swap (2026-08-22): LuxTTS stays, Pocket goes. Kokoro is not a
substitute (it cannot clone).
BUILT:  Dia excised (§8.2 of the plan doc). OPEN: the mark-and-hide mechanism —
a manifest deprecation flag → `EngineInfo` → UI badge + exclusion from
QuickSetup tiers, same shape as the OS gate shipped the same day.
GO:     given 2026-08-17 for mark-and-hide + the Pocket TTS swap

### The environment migration + Pocket TTS reversal — Opus codes from the hand-off doc
STATE:  DECIDED 2026-08-22. The 2026-08-17 swap is **REVERSED by the user**:
*"i dont like requireing hf auth so pocket tts is out"* + *"no supertonic no
pocket keep lux, verify lux works with our python and pytorch updgade"* —
verification RAN and PASSED (LuxTTS clone render on Python 3.13 + torch
2.9.1+cu128 CUDA, 2.39 s audio in 0.9 s, from the app's cached weights).
The measurement gate fired exactly as designed: Pocket's CLONING weights are
HF-gated (`kyutai/pocket-tts` gated:auto, anonymous 401 — presets ungated,
3.2× realtime measured, but cloning was the slot). Supertonic 3 also
rejected (no cloning in the OSS release). The wider decision — **ONE VENV
PER ENGINE** (2026-08-22 rethink, user: *"576mb is not bad so if you still
think per engine venvs is ok go with that"* — measured overhead ~576 MB via
uv hardlinks; family-wide torch pin guards the 4.3 GB divergence case) on
**Python 3.13**, **torch 2.13.0 + torchaudio 2.11.0** (proven band
2.9.1→2.13.0; chatterbox also proven at its declared transformers 5.2.0),
per-GPU-tier index cu126/cu130 via the kit rule, ROCm 7.2 Linux,
AMD-Windows override path, shared venv + constraints.txt DELETED, peft
arrives per-venv, UV_CACHE_DIR pinned, model revisions → SHAs, Pocket
excised, packaging onedir + MAX_PATH fix, `check:engines` dev command —
is specced step-by-step in
**`docs/plans/2026-08-22-env-migration-implementation.md`** (read it whole
before any edit; the WHY record is
`docs/plans/2026-08-22-engine-environment-and-platform-research.md`).
WHY:    User ruling: *"i expliciltly stated i want all working on crossplatfrom
andd all acceleration this is a limitation i will not accepts"* — torch 2.6.0
excluded RTX 50 (no cu128+ wheels) and ROCm 7.x; Python 3.12 caused the
numpy<2 war. Every load-bearing combination was render-proven 2026-08-22.
NOT:    TADA/MOSS un-marking or deletion (no word — they stay marked+hidden).
NOT:    Roadmap items (`docs/dev/ROADMAP.md`) — explicitly out of this scope.
NOT:    AMD-Windows auto-detect (documented override only; no hardware here).
BUILT:  Slices 0–5 and 7–8, 2026-08-22.
  · **Slice 0** — the one unproven combination: torch **2.13.0+cu126 renders
    chatterbox on CUDA** (RTX 2070 SUPER, 2.48 s audio in 14.0 s, rms 0.1214,
    transformers 5.2.0, numpy 2.5.2). PASS, so the pin stands at 2.13.0 /
    torchaudio 2.11.0 + rocm7.2; the pre-decided 2.9.1 fallback was not taken.
  · **Slice 1** — `_uv_env()`, cache + managed-python pinned beside the venvs,
    passed at every uv spawn (`setdefault`, so a user's own var still wins).
  · **Slice 2** — family torch pin in all four live manifests; the tier rule
    now comes from the kit (`concrete_gpu`), cu126/cu130/rocm7.2 replacing the
    dead cu124 and rocm6.2 indexes.
  · **Slice 3** — per-engine venvs everywhere. `shared_venv.py`, `constraints.txt`,
    `_install_engine_shared`, the shared branches and `SHARED_VENV_DIR` all
    deleted; chatterbox onto its declared transformers 5.2.0 (keeping
    `--no-deps`), numpy ceiling dropped; venvs now carry a **manifest
    fingerprint** so a manifest that gains a package flips the row to
    (re)Install — the peft class, closed; Uninstall on every engine row.
    `test_engine_constraints.py` repurposed into the family-pin guard.
  · **Slice 4** — Pocket TTS excised; code sweep returns empty.
  · **Slice 5** — every live-roster HF source pinned to a full commit sha
    (`server/scripts/harvest_revisions.py` harvests them; a test fails on any
    unpinned live row). TADA/MOSS left at `main` — see the deferral below.
  · **Slice 7** — engines.md, gpu.md, troubleshooting.md, quick-setup.md,
    voices.md, code-map.md.
  · **Slice 8** — `npm run check:engines` (drift · upstream · --test).
  · **The 576 MB estimate, now measured — and it came in under.** All five
    engines installed by the app. The venv folders REPORT 5,284 MB, but that
    counts cache-shared bytes once per venv; deduped against the uv cache they
    hardlink into, the five add **431 MB** (chatterbox 120 · luxtts 103 ·
    qwen3 102 · whisper 94 · kokoro 14), against **18,750 MB** if nothing were
    shared. Receipt: a 120 MB DLL inside chatterbox's venv has a link count of
    5 — four venvs plus the cache entry, one copy on the drive. Docs, the
    manifest comment, the guard test and `_uv_env` all carry both numbers now.
  · **Corollary, learned the hard way:** deleting `.shared-venv` reclaimed
    ~0.1 GB, not the 5.5 GB its folder size advertised — same reason. The
    bytes live in the uv cache; the venv held links. `uv cache prune` is the
    lever that actually reclaims, and it is the USER's cache (shared across
    projects), so it is not something this app should run on its own.
OPEN:   **Slice 6.2/6.3 — the packaging half, NOT done, needs your word.**
Slice 6.1 IS done and it is the part that fixes the actual bug: engine state
(venvs, models, uv cache) now roots at `<data_dir>/engines-runtime` when
frozen, via `engines_runtime_root()`, so it no longer lands in a PyInstaller
temp dir that the OS deletes on exit. What is left is `--onefile` →
`--onedir` plus the `longPathAware` manifest. Both change the release
pipeline, neither can be verified in this session (no PyInstaller build, no
CI run), and `--onedir` is not a drop-in: Tauri's `externalBin` copies a
single file, while onedir produces an exe **plus** an `_internal/` tree that
must sit beside it — which is a bundling question with a different answer on
macOS than on Windows. Recommendation: do it as its own change, where a
release build can actually be run.
OPEN:   Slice 9 — engine proof through the app (install → load → render each
engine). Gates that could run in-session all pass.
GO:     given 2026-08-22 — *"i want opus to code this so make doc that opus can
follow without thinking too much to do all these changes we have discussed"*

### DEFERRED from the environment migration (2026-08-22)
STATE:  NOT STARTED. Three items the migration deliberately left.
· **AMD-on-Windows auto-detect.** The override recipe is documented
  (`docs/engines.md` → AMD on Windows); detection is not wired, because AMD's
  Windows build needs a different torch (2.9.1) AND a different Python (3.12)
  than the family pin, and there is no AMD hardware here to verify any of it.
· **TADA / MOSS revision pins.** Both still say `"revision": "main"` on their
  HF sources while every live engine names a commit. Left alone deliberately —
  they are marked-for-removal and frozen; un-deprecating one means pinning it
  (`server/scripts/harvest_revisions.py`).
· **A per-engine interpreter health probe.** The shared venv had one
  (`shared_venv_healthy`): it caught a venv whose base Python had been deleted
  or upgraded, where every file is still on disk and the interpreter is dead.
  It died with the shared venv and has no per-engine replacement, so that
  narrow case now surfaces at Load instead of on the row. `npm run
  check:engines --drift` reports it (`VENV BROKEN`).

### FINDING — "✓ multi-speaker" is a false badge, true whatever happens to MOSS
STATE:  FINDING — code-verified 2026-08-17. Raised by your question: *"moss tts
what is multi speaker dialog when we identify 1 speaker per line do we need
it?"* The answer turned out to be that we never had it.
WHY:    `supports_multi_speaker=True` is served to the client and
`GenerateView.vue:845` renders a green **"✓ multi-speaker"** tag. Nothing backs
it. `speaker_prompts` exists in exactly two places repo-wide and **both are
prose** — a note string (`capability_details.py:435`) and a comment
(`models.py:906`). The adapter passes ONE `reference_audio`
(`moss_tts/engine.py:108-115`), so `[S1]`/`[S2]` both render from the same clip.
NOT:    Treating this as closed by removing MOSS. The badge is wrong today.
OPEN:   either drop the claim or wire a speaker→clip map. Wiring it means a
render call spanning blocks, per-speaker cast resolution and a new cache key —
against **line-is-the-unit**, which is already decided.
GO:     needed

### QuickSetup's tier recipe is hardcoded per engine, and it had drifted
STATE:  FINDING — code-verified 2026-08-17, raised by you: *"doesnt quick setup
just pull engine config info and or data in db, nothing is hardcoded to a
specific engine like dia in quick setup, correct?"* Correct instinct; the code
does the opposite.
WHY:    `QuickSetup.vue:43-80` holds `TIER_RECIPES` — a renderer-side constant
with hardcoded engine ids, hardcoded `estimatedDownloadGb`, and blurbs naming
engines in prose. It fetches `/v1/system` for VRAM and `/v1/engines` for the
list, but the recipe itself is typed. So the wizard cannot follow the
manifests, and dropping an engine means hand-editing a Vue file.
NOT:    Leaving it derived-looking. It is not derived, and the drift below is
what that costs.
BUILT:  the two drifts found and FIXED in the same pass —
  1. **`"moss_tts"` was a dead id.** The manifest is `ID = "moss-tts"`
     (`moss_tts/manifest.py:22`); the folder is `moss_tts`. The 24 GB and
     32 GB tiers named an engine the server does not serve.
  2. **Every download estimate was wrong**, before Dia was even removed:
     4.1 / 6.8 / 14.0 / 22.0 GB typed vs **8.1 / 9.3 / 13.4 / 33.0** summed
     from the manifests' own pinned `size_bytes`. Same invented-number class
     the `vram_mb` purge killed on 2026-08-14; this one survived.
OPEN:   derive the recipe from the manifests — sizes summed from `VARIANTS`
`sources`, ids from `discover_engines()`, tiers expressed as a capability
policy rather than an id list — so the numbers cannot be wrong and an engine
add/drop needs no renderer edit.
GO:     needed

### Dia was dropped; its external-provider entry was deliberately kept
STATE:  DECIDED 2026-08-17 — "drop dia stop testing for it". Engine excised.
WHY:    Dia and MOSS-TTSD were the same slot (multi-speaker dialogue); MOSS
does 3 speakers + pause tags + zh for 4.12 GB against Dia's 2 speakers at
4.69–8.07 GB. Independently, the ZipVoice-Dialog paper clocks Dia at **1.663
RTF on an H800** — slower than realtime on a datacentre GPU.
NOT:    Removing the **Dia-TTS-Server** entry from the self-hosted TTS provider
list (`TtsProviderForm.vue:76`, `docs/ai-providers.md`, `docs/engines.md`
providers row). That is a *different feature* — pointing JustVoice at someone
else's OpenAI-compatible server — and it costs us nothing to keep. Say the word
if you want it gone too.
BUILT:  `engines/dia/` deleted; capability row + `dia2` alias, model-catalog,
QuickSetup tiers, slash-menu comment, tauri longDescription, and the engines /
gpu / quick-setup / code-map / design-decisions docs all swept. Historical
mentions inside other tracker items and dated plan docs are left as record.
OPEN:   nothing.
GO:     given 2026-08-17

### Qwen3-TTS on macOS needs an ONNX variant, not a flag flip
STATE:  OPEN — your call. Raised by you 2026-08-17: *"we have cross platform
for qwen via qwen.cpp or Qwen3-TTS-ONNX not sure if onnx version reduces
quality or not"*.
WHY:    qwen3 is the ONLY engine that takes prose direction, so losing it on
macOS loses a whole capability there, not just one engine.
NOT:    Flipping `SUPPORTED_OSES` to include macOS — the adapter loads through
transformers with a CUDA-specific dtype branch and no mps path; the claim
would be false the moment anyone tried it.
FACTS (web-verified 2026-08-17, do not redo): ONNX exports EXIST but are all
COMMUNITY, not QwenLM — `romara-labs/Qwen3-TTS-12Hz-0.6B-Base-ONNX`,
`xkos/Qwen3-TTS-12Hz-1.7B-ONNX`, `arubeh/qwen3-tts-12hz-1.7b-base-onnx` (the
last one re-exported from PyTorch FP32, 9 components, self-described as
parity-verified). CPU inference reported **5–10× slower than GPU** — batch
work, not real-time. FP32 is the CPU precision; FP16 costs 9–13% overhead on
CPU. Quality-vs-PyTorch is UNMEASURED by us.
BUILT:  nothing. `qwen3/manifest.py` records the reasoning at SUPPORTED_OSES.
OPEN:   a variant row + an onnxruntime load branch in `qwen3/engine.py`, then
measure quality against the PyTorch checkpoint before it ships as equivalent.
GO:     needed

### Three device-picking defects found while wiring the OS gate — none fixed
STATE:  FINDING — code-verified 2026-08-17. Found while doing the declarations;
outside that go, so reported rather than touched.
WHY:    Each one makes a platform claim the code does not honour, which is the
same class of bug the OS gate itself was.
NOT:    Fixing them inside the gate change — that go covered declarations and
reachability only.
BUILT:  n/a. The three:
  1. `tada/engine.py:68` calls plain `pick_device()`, but `pick_device`'s own
     docstring names TADA in the `force_cpu_on_mac` set. Chatterbox has an
     override for exactly this; TADA never got one. (Moot while TADA excludes
     macOS, live again the moment it doesn't.)
  2. `chatterbox/engine.py:64-70` returns `"cpu"` on Darwin **before**
     delegating, so it overrides an EXPLICIT operator device request too —
     base `pick_device` honours `requested != "auto"` first, this never gets
     the chance. An operator who sets mps deliberately silently gets cpu.
  3. `tada/manifest.py`'s docstring says *"Per-engine venv makes that a
     non-issue"* about its torch>=2.7 pin colliding with chatterbox's 2.6.0 —
     but TADA declares no `ISOLATION`, so it defaults to **shared**, and
     `shared_venv.py:207-211` skips torch steps. TADA gets 2.6.0.
CLOSED (2026-08-21, "go" on the closure list): (1) FIXED —
`tada/engine.py` now passes `force_cpu_on_mac=True` (moot while TADA
excludes macOS, correct the moment it doesn't). (2) ALREADY FIXED by the
2026-08-19 mps_patch change — verified: `_pick_device_chatterbox`
delegates to `pick_device`, which honours an explicit request first.
(3) FIXED — `tada/manifest.py` now declares `ISOLATION = "venv"` so its
torch 2.7 pin actually installs, and the docstring records the year it
claimed a venv it never had. Delete this item next sweep.
GO:     done

### Settings → Capture is a localStorage mock — its controls never reach the server

STATE: FINDING — code-verified 2026-08-08 (found wiring the cleanup redesign's
live toggles).
WHY it matters: `SettingsView.vue:585-599` says it itself — "Persisted via
PATCH /v1/settings when wired; for now uses localStorage"
(`justvoice:capture_settings`). Every control on the card (STT model,
refinement mode, language, auto-paste, playback voice) writes only
localStorage; the SERVER's `captures.*` settings — the ones production reads —
never change. Worse, "Refinement mode" is a single-choice select over what the
server stores as THREE independent booleans (`smart_cleanup` /
`self_correction` / `preserve_technical`) — the control cannot even express
the real state. The cleanup card's pane toggles (2026-08-08) write the real
flags, so the two surfaces can now visibly disagree. Violates the
no-renderer-store law (the 2026-06-19 storage rewrite).
NOT: fixed as a rider on the redesign build — un-go'd scope, recorded instead.
OPEN: wire the card to PATCH `/v1/settings` (deep-merge proven), replace the
mode select with the three real toggles, delete the localStorage shim — or
strip the card to what's real.
GO: needed.

### Seed a pronunciation lexicon from the imported book's proper nouns

STATE: OPEN — your call. Raised and deliberately PULLED OUT of the 2026-08-08
JustWrite-zip build ("outside what you asked for, plus one unverified risk").
WHY: a book's proper nouns are the pronunciation problem, and "pronunciation
discipline" is a named audiobook differentiator (CLAUDE.md). JW hands over every
character, location and object name for free in `book.json`; import could
create the project lexicon pre-filled with them, pronunciation blank, as a
worklist.
NOT: folded into the zip build as a rider — un-go'd scope.
CLOSED (2026-08-21, "do all of c"): the blocking question resolved first —
an empty entry IS inert (the 2026-08-21 `_apply_lexicons` acts only on a
non-empty alias or IPA), so the roster seeds safely. Built:
`_materialize_lexicon` seeds every imported character name as a
blank-pronunciation row (import's own entries win over blank seeds;
"Narrator" skipped), PLUS the live scan —
`POST /v1/projects/{id}/pronunciation-report` (`pronunciation.py` heuristic:
capitalized where no sentence forced it, never seen lowercase, lexicon-
covered subtracted) with the 🔎 button + add-chips in LexiconsView.
Delete this item next sweep.
GO: done.

### A scene break could carry a real pause instead of a glyph

STATE: OPEN — your call. Noted 2026-08-08 during the JustWrite-zip build.
WHY: JW's `* * *` is display-only, but the boundary it marks is real structured
data (scene rows). In audio the equivalent is a longer silence, and
`StandardLine.pause_after_ms` already exists (`standard_schema.py:51`).
NOT: hardcoded in the adapter — that is exactly the "no hardcoded
operator-tunable values" law.
OPEN: add a settings knob (default scene-break pause, ms) and have the importer
stamp it on each scene's last line.
GO: needed.

### Script tab: reorder a line was deferred, not dropped

STATE: DEFERRED by your ruling in the restore's decision 6 ("Defer split,
merge and reorder"). Split and merge were BUILT 2026-09-30 (Script's "✎ Edit…"
→ "Split at the cursor", and "⇲ Merge" — `docs/plans/2026-09-30-script-
leftovers.md`); reorder was left out of that plan and needs its own word.
WHY it still matters: a line the segmenter put in the wrong order has no fix
but deleting and re-adding it, and nothing on Script adds a line.
NOT: built with split/merge — the 2026-09-30 plan said "Reorder isn't in this
plan and needs its own word."
OPEN: the design (where it lives, and whether a moved line keeps its
`paragraph_idx`), then the build.
GO: needed.

## The next build

### `npm run dev` always runs the latest audio.cpp — the dev app on our checkout, no release
STATE:  BUILT 2026-10-03 — one open finding (the tooltip, OPEN below).
BUILT:  our audio.cpp 6d1825eb (cmake/text_dictionaries.cmake, D3); JustVoice: scripts/tauri.js
        + scripts/audiocpp-dev.js (package.json `dev` / `tauri`), engines/audiocpp/dev_build.py,
        release.pinned_has / runtime / leftovers / the install job / the runtime info + row,
        tests/test_audiocpp_dev_build.py (12) + conftest drops the variable; CLAUDE.md, README,
        fork plan §6.
CHECKED: the first `build/jv-dev` build took 681 s and compiled the fork's head (so `6a2bb4c5`
        builds); a no-change `npm run dev` build takes ~4 s. Through `npm run dev` on the real
        data dir: the runtime info says `dev · 6d1825eb`, CUDA, no update; both audio.cpp
        processes run `..\audio.cpp\build\jv-dev\bin\audiocpp_server.exe`; read back by the app's
        own Qwen3-ASR — Kokoro English, `jf_alpha` Japanese, a Kokoro blend, Chatterbox Russian
        (е for ё), Chinese and Japanese cloned, and Chatterbox Turbo cloned (installed through
        the app, 840 MB) all exact; "Bochamp" → "Beecham" only with the lexicon's IPA (a
        temporary lexicon, deleted). Hebrew rendered; Qwen3-ASR has no Hebrew, so it is for the
        ear. The row renders as D4, with the row's existing backend label "CUDA (NVIDIA)". Server
        990 passed, ruff clean, vitest 122/122, biome clean, smoke passed.
OPEN:   the D4 tooltip on the disabled Backend choice never shows — the kit's UiSelect renders
        Reka's SelectRoot (no element) as its root, so a `title` passed to it is dropped. Every
        UiSelect tooltip is lost the same way (14 in JustVoice). The fix is in the kit (forward
        attrs to the trigger) — needs a go, since it changes the kit for all three apps.
ASKED:  "we need to fix it so when i run npm run dev it runs the app with the correct developmnet
        version of audio cpp just like your test server i should not have to do a release build
        so i can test the real app" · "the deve app should always ve running the latest dev
        version of audio cpp" · "same way we ran the latest llm runner version everything should
        just work" · "you should be running and test the app the same way i do with npm run dev
        instead of your own private server, we should do testing with real app and real data".
FINDING: the fork's head `6a2bb4c5` (jieba and MeCab moved into framework/text) was never
        compiled — a dry run of the local build re-configures for new source files since the last
        build (12:46). The gap 7 live checks ran the build from before that move. The first dev
        build compiles it; a failure is fixed in the fork.
PLAN (as shown and approved):
        1. One wrapper for `npm run dev` and `npm run tauri dev`. It builds `../audio.cpp` first,
           recompiling only what changed. Then it starts the app pointed at that build through an
           environment variable the server inherits.
           - `npm run tauri build` and the packaged app are unchanged and ignore the variable.
           - If there's no `../audio.cpp` checkout, dev runs the pinned release as today and
             prints one line saying so.
        2. The server uses the dev build instead of the downloaded release.
           - Every feature is on, since the dev build is the fork's latest code.
           - Its backend (CUDA, CPU…) is read from the build's own CMake settings.
           - The cleanup for leftover servers after a crash also covers the dev build's folder.
           - On a fresh data dir, Install fetches only eSpeak NG, since there's no binary to
             download.
        3. The dev build folder is complete.
           - The CUDA DLLs (`cudart`, `cublas`, `cublasLt`, `cufft`) are copied beside the exe,
             as the release ships them (`release.yml:534`).
           - So are `libmecab.dll` and `jieba/`.
        4. The runtime row says it's the dev build (the text is D4).
        5. Docs: CLAUDE.md and README dev commands, and the fork plan §6, where the wrapper
           replaces the manual build recipe.
        6. Tests: dev-mode tests. The existing tests run without the variable, so they're
           unchanged.
DECIDED: 2026-10-03 — "your rec go" on D1–D5 as shown:
        D1. If the build fails: the app doesn't start, and the compiler error shows in the
            terminal. Rec: yes. Starting on the old build would break "always the latest".
        D2. Which build folder: a new `../audio.cpp/build/jv-dev`. The wrapper sets it up on the
            first run: CUDA 12.4 if it's installed, otherwise CPU. That costs one full build of
            about 30 min now, and it works on any machine. (Not: reuse `windows-cuda12-local`.)
        D3. `libmecab.dll` and `jieba/`: a step in the fork's CMake build downloads both (pinned
            versions, checksummed) beside the binary. Every build gets them, including the
            release, so the release's own copy step isn't needed. Windows gets checked now; macOS
            and Linux get checked at the release. (Not: the wrapper copies them, for dev only.)
        D4. Runtime row text in dev:
            - version: `audio.cpp dev · 6a2bb4c5`, with `+ local changes` added when the checkout
              has uncommitted edits;
            - status: `CUDA · development build from ..\audio.cpp · running`;
            - no Update button. The Build choice is disabled, with the tooltip "The development
              build runs. Its backend is the one it was built with."
        D5. A dev server left over from a crash locks the exe, so the build can't replace it. The
            wrapper stops it if its JustVoice server is gone (the same rule the app's leftover
            cleanup uses). Otherwise the wrapper stops with "Close the running JustVoice first."
BLAST RADIUS (as shown):
        - `release.pinned_has` → true for every feature with a dev build: speech_runtime_api.py
          :69,132 · capability_details.py:93,96,401 · chatterbox/manifest.py:32,34,51,129 ·
          kokoro/manifest.py:37,39,51 · voxcpm2/manifest.py:34. Manifests read it at import, so
          the variable is set before the server starts (lib.rs:313-342 only adds
          JUSTVOICE_DATA_DIR and never clears the environment).
        - `runtime.installed_exe` / `installed_tag` → the dev exe and a "dev" tag:
          speech_runtime_api.py:91-93 · slot.py:156,166 · manager.py:220-222, 365-366, 582, 690.
          manager.py:365-368 would download the pinned binary and treat the dev build as
          "replaced"; in dev mode it skips both and installs eSpeak only.
        - `runtime.has_feature` → true with a dev build: slot.py:316-325 · render_core.py:403-405.
        - `runtime.backend_of(exe)` reads the CMake settings for a dev exe: speech_runtime_api.py
          :106,108 (`build=exe.parent.name` would say "bin") · slot.py:157 · manager.py:582,691 ·
          runtime.py:306.
        - Leftover cleanup matches the dev bin folder: leftovers.py:95 ← find_leftover_engines ←
          engines_api.py:465-467, leftovers.py:139 (today only paths under the runtime root,
          leftovers.py:54).
        - `npm run dev` / `npm run tauri` through the wrapper: package.json:13,15 · CLAUDE.md:21 ·
          README.md:44. `tauri build` passes straight through; beforeDevCommand unchanged.
        - Runtime row: SpeechEnginesTab.vue:232-235, :753, :757-765, :777.
        - The fork's build fetches libmecab and jieba: release.yml:534 (the release's packaging
          must keep the new files); macOS and Linux verified only at the release.
TEST:   through `npm run dev` with the real data: Turbo cloning, a Kokoro blend, a lexicon IPA
        word, a line each in Hebrew, Russian, Chinese and Japanese, and the dictionary row.
GO:     given 2026-10-03 ("your rec go").

### Every Python speech engine is replaced by our own copy of audio.cpp — one cut, then the gaps
STATE:  DECIDED 2026-10-01 — "we do a full switch"; "i dont want to do anything side by side";
        "maybe we just copy the repo and make it our own"; "the app is not in production so no need
        for it to remain running lets do the cut all at once then add the missing features";
        "as long as qwen asr is as good as whisper we can drop whisper"; "dont care about
        watermark"; on a one-author project: "1 author wroter our current code".
WHY:    measured 2026-10-01 on this RTX 2070 SUPER, same 20 Ninth Facet lines and seeds both sides:
        Qwen3 CustomVoice 1.7B 2.0× real time against ours 0.26× (6.5× at matched fp16, so the
        speed is the runtime, not the 8-bit file); Chatterbox Multilingual 2.08× against 0.92×;
        loads ~4 s against 24–34 s; the same seed repeats on all three engines; words-right level.
        One native runtime replaces five Python venvs + torch for rendering. Evidence lives in the
        session scratchpad (`scratchpad/abtest/`), which is temporary.
NOT:    both runtimes side by side · keeping the app working through the switch · sending every
        change upstream.
BUILT:  2026-10-01, UNCOMMITTED — under "run the pre-cut checks, go your rec do the design and
        coding go". The record is `docs/plans/2026-10-01-audiocpp-switch.md` (§4 R1–R15 the calls
        made under "your rec", §8 every check and the live run). Pre-cut checks A (whole book, 3
        engines, 0 failures), B (LLM alongside), C (Vulkan), D (recognition, 7 languages) all
        run. The cut: kit `acquire_runtime` + public `spawn_child`/`close_job`; `engines/audiocpp/`
        (runtime, slot, release, eSpeak); manifests → 8-bit GGUF; `asr` engine replaces Whisper;
        runtime row + Backend/GPU setting (`PUT /v1/speech-runtime`); luxtts/whisper/tada/
        moss_tts, every engine.py, justvoice_plugin, the venv/uv/torch installer, uv sidecar,
        check:engines, legacy model dirs and the URL arm removed; docs swept. Server 888 passed
        before the live-run fixes; live end to end through JustVoice on the real data dir passed
        after three fixes found there (caption times ×2/3 at 24 kHz; stale variant label;
        pre-switch footprints refusing Qwen3).
DECIDED: 2026-10-02 — Q2: "q2 remove traingin and rebuild" → "go on both removing" (with the
        old downloads). Removed everywhere: the training API and runner, both trainer scripts, the
        dataset preparer and builder screens and their settings, trained-voice render paths, the
        tests and the docs; rebuilt later on the speech runtime (a new item when it starts).
        Gates after the removal: ruff clean, server 852 passed (the training tests went), vitest
        122, biome clean, vite build, smoke 14/14 views zero JS errors on the real data dir; the
        moved Default voice language row rendered, measured and saved. Left: `legacy-gui/` (the
        old single-file reference GUI) still has its Train tab — untouched, a frozen reference;
        the live DB keeps an empty `training_jobs` table until a reset.
        Q3 became the item below ("Speech models run on the CPU or the GPU…").
DECIDED: 2026-10-02 — Q1 (CI on our copy's repo to publish binaries): "q1 yes but not now" — yes,
        when the first change needs C++, not before. "commit and push" — the switch, the training
        removal and CPU placement committed and pushed the same day.
OPEN:   gaps, in order: switch plan §5 (Turbo/Nano cloning, blends, single-word IPA, training
        rebuilt on the runtime, Chatterbox he/ja/ru/zh, our-copy fix for the aligner's seconds,
        and — added 2026-10-02 — our-copy fix so VoxCPM2 gets the clip's transcript: the server
        passes the clip as prompt audio when `reference_text` comes with it, gap 9 plan §6 C) —
        the CPU cloner (Pocket TTS) and Kokoro on the CPU landed with the item below; gap 8 (speed
        everywhere) and gap 4 (CustomVoice 0.6B, published + wired) shipped 2026-10-02
        (plan docs 2026-10-02-gap-8-speed.md, -gap-4-customvoice-0.6b.md) · Q1's CI when the
        first C++ gap starts.
        Presented 2026-10-02 after "continue with the current conversion in jv": no C++ needed —
        gap 8 speed on every engine (host-side time-stretch; today Speed reaches only Kokoro and
        KittenTTS), gap 4 Qwen3 CustomVoice 0.6B (convert with audiocpp_gguf), gap 9 16-bit rows /
        new engines (VoxCPM2 first); needs C++ (Q1, "not now") — gaps 1, 2, 3, 7, 10 and the
        training rebuild (5). Lean: gap 8 first, gap 4 second. Gates on the switch's final tree:
        ruff clean, server 894 passed, vitest 122 passed, biome clean, vite build, smoke 14/14
        views zero JS errors on the real data dir, kit binary 37 + spawn 6 passed; the runtime row
        was screenshotted and measured.
DECIDED: 2026-10-02 — the gaps: "your rec go" (the rec as shown: "Gap 8: Speed on every engine,
        done by time-stretching on our side. Today Speed only works on Kokoro and KittenTTS. This
        is my pick for first." · "Gap 4: Qwen3 CustomVoice 0.6B, converted with audiocpp_gguf. My
        pick for second.") → "continue with gap 8" → "you have a go for all gaps". Order as
        answered: 8 → 4 → 9, then the C++ gaps 1, 2, 3, 7, 10, then 5 (the training rebuild, its
        own item). 6 (Pocket TTS) and 11 (Kokoro on the CPU) already landed. Still asked first
        under this go: creating our audio.cpp repo on GitHub (fork or copy, name, public or
        private) before gap 1; any gap in a gap's decision text; commit and push.
DECIDED: 2026-10-02 — "all 4 , fork repo, public, your rec on all go". The four fixes as listed:
        "1. Slider end-labels collide ("sloweras written"). Fix it in the kit's UiSlider, so every
        app gets it. 2. Chapter renders through cloud voices use the placeholder 24000 sample
        rate. Read it from the WAV header, as Generate now does. 3. Pocket's dropped words in
        Portuguese and Spanish. Rerun them at 16-bit as part of gap 9. 4. The 8-bit vs 16-bit
        long-passage comparison. Also part of gap 9." The repo (Q1, now): a GitHub fork of
        0xShug0/audio.cpp under delebash, public, name kept `audio.cpp` (rec); GitHub Actions in
        the fork build and publish our binaries; the runtime pin moves to our releases when the
        first C++ change ships (rec). Order as answered: gap 4 → the four fixes → gap 9 → the fork
        and its build pipeline → the C++ gaps.
        Fixes 1 and 2 shipped 2026-10-02 with gaps 8 and 4 (kit `UiSlider` mark layout; the
        chapter render reads a cloud voice's WAV header). Fixes 3 and 4 ride gap 9.
        NEXT: gap 9 (with fixes 3 and 4 — its item below), then the fork.
GO:     given 2026-10-02 for every gap ("you have a go for all gaps"); decision-text gaps,
        commit and push still asked

### Our copy of audio.cpp — fork, releases, the app's pin, the C++ gaps
STATE:  OPEN — fork created 2026-10-02 (github.com/delebash/audio.cpp, public; branch `jv` at
        v0.9.0's 795c45fb; local clone E:\Dev\Web\audio.cpp); the plan and four questions are in
        docs/plans/2026-10-02-our-audiocpp-copy.md (§5: tag scheme v0.9.0-jv.N — rec yes · how
        installs move — rec keep the old build working and offer an update · first release =
        aligner seconds + VoxCPM2 transcript — rec yes · keep the app's 16 kHz aligner resample
        for now — rec keep).
BUILT:  2026-10-03 on `jv`, committed locally, not pushed — 0acac2b1 VoxCPM2 transcript reaches
        the model; cf08c14b aligner + Qwen3-ASR word spans at the input rate. Both checked through
        the server against v0.9.0 (plan §2). Local builds are CPU-only (VS 2026; no CUDA
        toolkit here that pairs with it); CUDA comes from CI.
DECIDED: 2026-10-03 — "your rec on all 5 go, commit and push" on the five as shown: 1 "Tag scheme
        v0.9.0-jv.N (our build N on upstream v0.9.0)? … yes." · 2 "How installs move to our build
        … keep the older build working and have the runtime row offer 'Update to v0.9.0-jv.1'." ·
        3 "First release = these two fixes? … yes." · 4 "Keep the app's 16 kHz resample for the
        aligner? … keep it." · 5 "Commit the doc corrections and the new plan doc, and push jv to
        the fork?"
        2026-10-03: dry run 37097796871 green on all 14 builds; v0.9.0-jv.1 tagged at adedc094 and
        published by run 37104734208 (09:09Z, every asset the app requests present; archive has a
        LICENSE, no NOTICE). Pin move APPLIED, UNCOMMITTED: TAG v0.9.0-jv.1 from our fork,
        PREVIOUS_TAGS ("v0.9.0",), FEATURES voxcpm2_transcript, VoxCPM2 "and its transcript" +
        transcript field, engines.md / NOTICE / LICENSES / whats-new, tests. Live on the real data
        dir (headless): the row offered "Update to v0.9.0-jv.1"; the update took 25 s and stopped
        the old process; VoxCPM2 clone, same seed — v0.9.0: real vs wrong transcript byte-
        identical; jv.1: different, real reads back word for word, wrong → gibberish. HELD on a
        found bug: an audition of a clone with an empty transcript sends "—" (VoicesView.vue:1025,
        the preview API requires a transcript), the server passes it as ref_text
        (voice_preview_api.py:290) and saving the audition stores it (:453) — Qwen3 Base already
        gets "—" today; VoxCPM2 on jv.1 would speak gibberish. Fix asked. Also noted: the runtime
        install job reports no bytes (0/0), and the old v0.9.0 folder (2 GB) stays on disk.
        Suite: 965 passed, 3 failed (the gap-1 capability rows, waiting on its manifest rows).
DECIDED: 2026-10-03 — "your rec on all go, commit and push" on the "—" fix as shown: "The Voices
        screen sends a transcript only when you typed one, and the preview API stops requiring one.
        An audition without a transcript renders from the clip alone, as a direct save already
        does. That works for Chatterbox and VoxCPM2. Qwen3 Base is the exception: it refuses a clip
        with no transcript unless x-vector only is ticked ("ICL mode requires reference text" in
        audio.cpp). For that case I'd have the app refuse by name: "Qwen3 Base needs what the clip
        says — type the transcript, or tick x-vector only."" Not covered (no rec was given, asked
        again): the runtime download's missing progress bytes; removing the old build after an
        update.
BUILT:  2026-10-03 — the "—" fix: VoicesView sends a transcript only when typed; the preview API
        no longer requires one; the slot sends Qwen3 Base's `x_vector_only_mode` when x-vector only
        is ticked (it never reached audio.cpp since the switch — audio.cpp then ran ICL and refused)
        and refuses a clip with neither, with the approved message. Live (headless, real data dir,
        jv.1): VoxCPM2 audition without a transcript read back word for word; Qwen3 Base with
        neither → the message; with x-vector only → rendered, read back word for word (that load
        downloaded Qwen3 Base 1.7B, 2.6 GB, into the data dir). voices.md + whats-new. Asked: the
        message says "tick x-vector only" but the checkbox reads "Skip the words — clone from the
        sound alone…"; and a voice saved from an x-vector audition keeps no x-vector flag, so its
        renders on Qwen3 Base are refused (renders never sent the flag — it lives on the audition
        only).
        Committed + pushed 2026-10-03: JV 806c7a6 (the pin move, the "—" fix, gaps 1–3 app code
        gated on jv.2 / jv.3, docs, TASKS); our audio.cpp `jv` at faf1ee03.
        Tags v0.9.0-jv.2 (42db68d9) and v0.9.0-jv.3 (3865d245) pushed 2026-10-03; both release
        runs FAILED on macOS — `std::to_string` of a 128-bit file time in the voice-pack cache key
        (86767dad; libc++ only, MSVC was fine; the dry run had built cf08c14b, before the gap
        commits). Fixed in faf1ee03; both runs cancelled, NOTHING PUBLISHED for jv.2/jv.3; dry run
        37123528985 of faf1ee03 (gaps 1–3 + the fix) on every platform. Asked: how to re-release
        (the pushed tags point at the broken commits).
DECIDED: 2026-10-03 — "your rec on all go, start gap 7, no more ci runs for now, download and
        install the correct cuda kit" on the recs as shown: re-release C — "Skip separate jv.2 and
        jv.3 releases, finish the next gaps locally, then make one release with everything. The
        app's feature table would then point at that single tag." · the running dry run "costs you
        nothing to let it finish … I won't start any more." · 2 "Change the Qwen3 Base refusal to
        say 'tick Skip the words', matching the checkbox's real label." · 3 "Store the x-vector
        choice on a saved voice, so a Qwen3 Base voice saved from an x-vector audition can
        render." · 4 "Show download progress on the runtime install … I'd find where the
        download's byte count is dropped and report it to the bar, likely in the kit." · 5
        "Delete the old 2 GB build after a successful update." · the CUDA toolkit installed here
        so audio.cpp builds for the GPU locally (users never need it — the release carries the
        CUDA runtime DLLs). Not covered: a dev-only override pointing the app at a local build
        (offered as "if you want", not recommended) — asked if needed.
BUILT:  2026-10-03, uncommitted (no commit named in that go) — 2 the refusal says "…or tick Skip
        the words."; 3 `VoiceRecord.xvector_only` (JSON manifest field, default False — old voices
        unaffected), set by a direct clone (`CloneVoiceRequest.xvector_only`, sent by VoicesView
        when ticked) and by a saved audition, read by `voice_synth_fields` (render, Generate, row
        preview); 4 the runtime install passes the kit's byte progress to the job (`on_bytes`
        through `mgr.install` → `_install_audiocpp_runtime`) — unit-tested, not watched live; 5
        `_remove_replaced_build` deletes the build an update replaced (only that backend's; the
        release folder once empty; path-guarded under the runtime root) — and removed today's
        leftover v0.9.0/cuda12 (2 GB; v0.9.0/vulkan kept, nothing replaced it). engines.md,
        voices.md, whats-new. CUDA 12.4.1 toolkit installed here (nvcc, cudart, cuBLAS, cuFFT,
        thrust, NVRTC; no driver — 610.88 stays), building with the VS 2022 toolset 14.44 that
        VS 2026 already had, as CI does; card stays on the cuda12 build (Turing; CUDA 13 dropped
        only pre-Turing — 12 vs 13 on this card is a measurable question, both builds in jv.1).
        Gap 7 — plan + record docs/plans/2026-10-03-gap-7-more-languages.md: our audio.cpp
        (uncommitted) adds he, ru, zh (Cangjie from the GGUF's own table); live on the local CUDA
        build ru read back one word off, zh exact, he rendered (ear). Asked: Q1 Chinese word
        segmentation (lean jieba, already in our copy), Q2 Japanese (lean one optional unidic-lite
        download + libmecab.dll in our release, shared by Kokoro and Chatterbox).
        Gap 1 GPU numbers (local CUDA build): Turbo q8 1.75 GB loaded / 2.3 GB peak / 2.9× real
        time; f16 2.2 / 2.8 GB / 2.8×; Nano q8 1.05 / 1.6 GB / 4.8×; f16 1.3 / 1.6 GB / 4.7×.
DECIDED: 2026-10-03 — "your rec on all go, commit and push" on the three as shown: 1 "Chinese word
        breaks … My recommendation is to reuse the word splitter (jieba) already in our audio.cpp:
        close to the original, no new files." · 2 "Japanese, for both Chatterbox and Kokoro's five
        Japanese voices. My recommendation is one optional 'Japanese dictionary' download, about
        250 MB, BSD-licensed, shared by both, plus a small library (libmecab.dll) shipped in our
        runtime. Chatterbox's kanji readings would then come from a different dictionary than
        the original's, so they'd be close but not identical." · 3 commit the JustVoice changes
        and the fork's gap 7 code, and push.
        Committed + pushed 2026-10-03: JV fbf6823 (decisions 2–5, the gap 7 plan); our audio.cpp
        fc55e1e6 (he, ru, zh). Found while building the decisions (plan §7): Q1's "no new files" was
        wrong — both jieba copies read a dictionary from their own model's package, Chatterbox's
        has none; MeCab 0.996 does not build on today's MSVC (three fixes in, still failing).
        Asked: where Chinese segmentation's dictionary comes from; which MeCab (fork / fugashi's
        prebuilt BSD DLL / patch 0.996); where the Japanese dictionary download lives in the UI.
DECIDED: 2026-10-03 — "your rec go" on the three as shown: 1 "(a) Ship jieba's dictionary (MIT,
        a few MB) as a data file beside the runtime." · 2 "(a) Use the prebuilt libmecab.dll from
        fugashi's Windows package on PyPI (BSD; fugashi is the MeCab wrapper Kokoro's own pipeline
        uses)" for now, "and (c) once our release build needs to compile it on every platform"
        (keep patching 0.996) · 3 "(a) Its own row under the Speech runtime row on AI Settings →
        Speech engines: 'Japanese dictionary · 250 MB · Install', with a progress bar. Japanese
        lines that need it would be refused with a message pointing there." (No commit named.)
BUILT:  2026-10-03, committed + pushed (our audio.cpp 6a2bb4c5; JV the same turn) — gap 7 plan
        §8: our audio.cpp (jieba moved to the framework,
        a shared MeCab helper, Kokoro + Chatterbox Japanese, Chatterbox Chinese word breaks); live
        on the local CUDA build every Japanese and Chinese render read back exactly. The app: the
        Japanese dictionary (unidic-lite, its own row under the runtime row, a job, the runtime's
        AUDIOCPP_UNIDIC_DIR, refusals by name), gated on the pin; the row checked live in the real
        UI (install 6 s, 260 MB on disk).
OPEN:   ONE release with everything (new tag name — jv.2/jv.3 exist on broken commits; the feature
        table points at its tag; libmecab on macOS/Linux — jieba/ everywhere and Windows'
        libmecab.dll now come from the fork's build, cmake/text_dictionaries.cmake; NOTICE/LICENSES;
        engines.md/whats-new; live in-app checks) → gap 5 (training rebuild) is the remaining gap.
        Local build recipe + release state: docs/plans/2026-10-02-our-audiocpp-copy.md §6.
        the app: an installed older build keeps working and the runtime row offers "Update to
        v0.9.0-jv.1"; the pin moves to our release; VoxCPM2's row gets "and its transcript" and
        the transcript field back.
GO:     given 2026-10-02 ("all 4 , fork repo, public, your rec on all go" · "you have a go for
        all gaps"); §5 asked

### Kokoro blends render again — a voice-pack input in our audio.cpp (gap 2)
STATE:  BUILT 2026-10-03 under "you have a go for all gaps" — plan + record:
        docs/plans/2026-10-03-gap-2-kokoro-blends.md (READ IT). Making a blend was broken since
        the switch (blending looked for the old voices file); hearing one was refused.
BUILT:  audio.cpp 86767dad on `jv` (the `voice_pack` request option, checked byte for byte
        through our server build); the app (uncommitted): voices read from the Kokoro GGUF's
        embedded files, the slot sends `voice_pack`, an older runtime refuses by name; the
        capability follows the pin (on at v0.9.0-jv.2).
OPEN:   ship v0.9.0-jv.2 (after jv.1) → move the pin → blends visible → voices.md / engines.md
        in that commit → live check through the app.
GO:     given 2026-10-02 ("you have a go for all gaps")

### A lexicon's IPA reaches Kokoro — inline pronunciations in our audio.cpp (gap 3)
STATE:  BUILT 2026-10-03 under "you have a go for all gaps" — plan + record:
        docs/plans/2026-10-03-gap-3-kokoro-ipa.md (READ IT).
BUILT:  audio.cpp 42db68d9 on `jv` ("[word](/phonemes/)", checked through our server build:
        "Bochamp" → "Beecham"); the app (uncommitted): IPA → Kokoro symbols, the splice by the
        host's own matching rule, used only when the installed runtime has it.
OPEN:   ships with v0.9.0-jv.2 (with gap 2) → pin move → lexicons.md / engines.md in that commit.
GO:     given 2026-10-02 ("you have a go for all gaps")

### Chatterbox Turbo and Nano clone again — core Chatterbox's encoders in our audio.cpp (gap 1)
STATE:  BUILT in our audio.cpp 2026-10-03 under "you have a go for all gaps" — plan + record:
        docs/plans/2026-10-03-gap-1-turbo-cloning.md (READ IT: §2 facts, §4 questions, §6 record).
        Restores the pre-switch rows: Turbo (350M) and Nano (110M), English, clone-only, the 19
        inline tags; training stays out (gap 5).
BUILT:  audio.cpp 3865d245 on `jv`, committed locally, not pushed — a converter from Resemble's
        own checkpoint that keeps the voice encoder, the S3 tokenizer and CAMPPlus (byte-identical
        to core Chatterbox's), the Turbo session cloning under upstream's settings (> 5 s clip,
        −27 LUFS, 375 tokens / 15 s), Nano's head count from the GGUF. Live on our CPU build:
        clones match their reference (0.92–0.95 vs 0.58–0.60), word-exact read-back, Turbo and
        Nano, q8_0 and f16. The app (uncommitted): FEATURES["turbo_clone"], the two capability
        rows, the slot's mapping + 409 + warm-up, tests.
DECIDED: 2026-10-03 — "your rec on all go, commit and push" on the two as shown: 1 "Publish the
        two converted models on Hugging Face? That's public repos delebash/chatterbox-turbo-GGUF
        and delebash/chatterbox-nano-GGUF, at 8-bit and 16-bit, the same way as CustomVoice 0.6B.
        My recommendation is yes: the weights are MIT, and the app needs a fixed download source."
        · 2 "Which release carries it? My recommendation is a new v0.9.0-jv.3, so jv.2 stays blends
        + IPA as decided and reaches you sooner."
BUILT:  2026-10-03 — published (public, MIT, model cards + LICENSE): huggingface.co/delebash/
        chatterbox-turbo-GGUF @ db9317b6f796c4d11112ee845a6189328e25fb15 and delebash/chatterbox-
        nano-GGUF @ e707626a9bb9d3cbb035abfaacb82616c4c3d2e7 (q8_0 + f16, sha256 matching the
        local files); the fork's `jv` pushed (3865d245). The manifest rows (Turbo, Nano, 8-bit +
        f16) wait in chatterbox `PENDING_VARIANTS` until the pin has `turbo_clone`; the knob-wiring
        test reads them there.
OPEN:   jv.3 → pin move → GPU measurements on the release build → docs (engines.md, whats-new,
        NOTICE/LICENSES).
GO:     given 2026-10-02 ("you have a go for all gaps") and 2026-10-03 ("your rec on all go,
        commit and push")

### 16-bit rows, the 8-bit vs 16-bit test, and VoxCPM2 (gap 9, with fixes 3 and 4)
STATE:  DECIDED 2026-10-02 — "your rec on all 3 go" on the plan as presented
        (docs/plans/2026-10-02-gap-9-16bit-and-voxcpm2.md — READ IT before coding): 1 "Which
        models get a 16-bit row? … all of them, except KittenTTS, which is already unquantized."
        · 2 "Defaults after the comparison? … keep 8-bit unless the test shows a real gap on an
        engine; any change comes back to you with its numbers." · 3 VoxCPM2's row text: name
        "VoxCPM2", description "OpenBMB's 2B model, 30 languages: clones a voice from a short
        clip and its transcript, or designs one from a written description. Runs in the
        audio.cpp speech runtime." (Amended below: "and its transcript" dropped until our copy
        of audio.cpp passes it.)
NOT:    changing any default without coming back with numbers · VoxCPM2 in the setup tiers
        before it is measured.
BUILT:  2026-10-02, uncommitted — plan §6: A 16-bit rows (14, our 0.6B bf16 published at repo
        revision 5c14bf4); B the comparison on a real chapter (no 8-bit penalty on Kokoro,
        Pocket, Qwen3; Chatterbox 16-bit read back better, 0.072 vs 0.108; Pocket pt/es drop
        words at both precisions — fix 3 answered); C VoxCPM2 (clone + design + direction on
        clones; brackets read as dashes; warm-up so memory is booked); D gates (server 927,
        vitest 122, smoke all views, engines tab rendered). Fixed on the way: a second variant
        of a loaded engine only relabelled the row (`manager.load`); a chapter mixing sample
        rates appended the odd line raw (`concat_lines`).
DECIDED: 2026-10-02 — "your rec on all 3 go, commit and push" on the three questions as shown:
        1 "VoxCPM2's row text … My recommendation: drop 'and its transcript' until our fork fixes
        it, which is a small C++ change I'd add to the C++ gaps." · 2 "Chatterbox: … the default
        stays 8-bit … My recommendation: before switching (16-bit is 3.7 GB against 2.1 GB), run
        a bigger test, three seeds over a full chapter." · 3 "Commit and push gap 9".
        The Chatterbox test ran 2026-10-02 (plan §6): the whole chapter × 3 seeds — 8-bit 10.8 %
        words wrong (19/150 lines > 20 %), 16-bit 11.2 % (18/150): level, the default stays 8-bit;
        engines.md / whats-new corrected (uncommitted).
OPEN:   the VoxCPM2 transcript fix ships with our first audio.cpp release (the item above),
        then the row text gets "and its transcript" back.
GO:     given 2026-10-02 ("you have a go for all gaps" → "your rec on all 3 go")

### Speech models run on the CPU or the GPU — chosen per model, automatically, measured
STATE:  DECIDED 2026-10-02 as direction, first steps under go. The user: "do others run well on cpu
        besides just kokoro, we should make this easy and universial, we still should have our
        recommendation engined that setsup the env based on pc specs and model, so if model runs
        better on cpu we run it on cpu, this should be something that just works and the use can
        be informed that they can choose to run on cpu or gpu" → "we are no longer limited to the
        models we originally had, we have access to all engines in audio.cpp so i am sure other
        models run well on cpu only, we dont need to test qwen chaterbox on cpu we already know
        they run poorly" → "go on your plan". The plan as presented:
          1. shortlist from audio.cpp's catalogue by our rules — weights that permit selling the
             output, no Hugging Face login to download, clones or preset voices — starting from
             docs/plans/2026-10-01-tts-engine-scan.md and audio.cpp's model specs + licence table;
          2. candidates to check: Piper, KittenTTS, Soprano, MOSS-TTS-Nano, NeuTTS, ZipVoice;
             re-check Pocket TTS (rejected on the HF-login rule) and Supertonic (no cloning);
             recognition: Parakeet, Moonshine;
          3. measure the shortlist on the CPU on this machine — speed, memory, a listen;
          4. then automatic placement: Auto / GPU / CPU per model, Auto from the measured numbers
             (GPU when it fits beside the AI model; else CPU if fast enough there; else GPU with
             the AI model unloaded and a toast), CPU models in a second CPU-only runtime process,
             each row saying where it runs and why; Voice engine setup recommends from the same
             numbers; built on the kit's measurement store and speed bands, not a second copy.
WHY:    on 8 GB a Kokoro render on the GPU evicted the whole 6.8 GB AI model (switch plan §8 B);
        on the CPU it measured 2.8× real time and costs no graphics memory.
NOT:    Qwen3 or Chatterbox on the CPU (they run poorly there — the user) · one backend for every
        model (the runtime row's Backend select alone).
BUILT:  steps 1–3 done 2026-10-02 — research, shortlist and CPU measurements in
        docs/plans/2026-10-02-cpu-placement.md (§4 shortlist, §6 numbers, §7 the step-4 proposal).
        Measured on the Ryzen 7 5700X: a CPU-backend runtime holds 0 MB of graphics memory; Kokoro
        3.15× real time at 8 threads (2.28× at the app's 4), KittenTTS 3.41×, Inflect 4.77×,
        MOSS-TTS-Nano 0.21× (no usable CPU cloner), Magpie 0.13×; every recogniser ≥ 10× real
        time on the CPU, Parakeet matching its GPU accuracy.
DECIDED: 2026-10-02 — "your rec on 1-5" (the step-4 decisions, plan doc §7 D1–D5), as presented:
          1. "fast enough" on the CPU for speech = 2× real time — Kokoro, Kitten and Inflect pass,
             everything else fails by a wide margin;
          2. CPU threads = the number of physical cores (8 on this machine), as a setting;
          3. add KittenTTS as a CPU voice, not Inflect (one voice);
          4. a CPU recogniser: measure Qwen3-ASR on the CPU first (whether the "qwen on cpu" ruling
             covers the recogniser is the research's §5 question 3, asked again); if it's too slow,
             Parakeet for English and European languages, Qwen3-ASR kept on the GPU for ja and zh;
          5. cloning stays GPU-only for now — nothing in audio.cpp clones fast enough on the CPU.
DECIDED: 2026-10-02 — research §5 question 1, Pocket TTS: "use the copy and show kyutai's terms
        before first clone". As presented: audio.cpp's own ungated copy (audio-cpp/audio.cpp-gguf)
        is downloaded with no login; Kyutai's gated repo (kyutai/pocket-tts) asks for a login and
        acceptance of its prohibited-use terms, so JustVoice shows those terms to the user, who
        accepts them before their first Pocket TTS clone. Presets: cosette and jean are
        non-commercial and giovanni, lola, juergen, rafael state no licence — 20 usable (plan doc
        §5). Unmeasured on the CPU, and whether the copy carries the cloning weights is unverified.
DECIDED: 2026-10-02 — "your rec on the rest go", on the research's §5 questions 2–4, as presented:
          2. Supertonic 3 — out: its licence makes every audiobook voiced with it carry a
             machine-generated disclosure, and Kokoro and Kitten cover CPU presets without that;
          3. Qwen3-ASR — measure both the 1.7B and the 0.6B on the CPU (this is D4's measurement);
          4. Chatterbox Turbo — out: audio.cpp's Turbo has one English voice and no cloning.
MEASURED: 2026-10-02, under the go above (plan doc §6):
        - Pocket TTS (audio.cpp's copy) CLONES, on the CPU, at 4.05× real time — a low reference
          (106 Hz) gave ~96 Hz, a high one (229 Hz) gave 226 Hz. Presets alba / estelle 3.90× /
          3.94×. audio.cpp's Pocket takes the clip on its plain speech task, not the clone task.
          This CONTRADICTS decision 5 above ("nothing in audio.cpp clones fast enough on the CPU"),
          which was made before Pocket was measured — back to the user.
        - Qwen3-ASR 1.7B on the CPU: 2.6× real time with its GPU accuracy (2.5 s per English clip,
          up to 5.7 s; 0.53 s on the GPU), 4.9 GB RAM peak. The 0.6B: 5.0×, clearly worse outside
          English and Chinese. Whether 2.6× is "too slow" for D4 is back to the user.
DECIDED: 2026-10-02 — "your rec on 1 and 2, go on 3 and go on build". As presented:
          1. decision 5 now that Pocket clones on the CPU — add Pocket TTS as an engine: CPU-capable
             cloning plus its 20 commercially usable presets, with Kyutai's terms shown before the
             first clone; English plus German, Italian, Portuguese and Spanish, each as its own
             download. Cloned voices on Chatterbox and Qwen3 stay GPU-only;
          2. the recogniser — keep Qwen3-ASR 1.7B as the only recogniser and let Auto move it to the
             CPU when the graphics card is busy, using the same 2× bar as speech; you keep its
             accuracy and its Japanese and Chinese, and dictation waits about 2 s longer; Parakeet
             isn't needed for now;
          3. build step 4: a second runtime process for the CPU, at 8 threads, as a setting;
             Auto / GPU / CPU on each model; KittenTTS and Pocket TTS added as engines, with the
             Kyutai terms prompt; Voice engine setup recommending from the numbers.
DECIDED: 2026-10-02 — "your rec on 1-3 go", on the three behaviours the build surfaced, as presented:
          1. Auto before a model has ever run on the graphics card: an unknown size counts as
             "doesn't fit" while an AI model is on the card — a model fast enough on the CPU goes
             there, any other takes the third step (GPU with the AI model unloaded, and a toast);
             with no AI model on the card it goes to the GPU and gets measured there;
          2. the Kyutai terms gate: the server refuses any Pocket TTS render from a reference clip
             until the terms have been accepted once; the Clone tab shows the terms with an Accept
             button when Pocket is the chosen model, and so does that refusal; JustWrite, MCP and
             API calls get the same refusal until the terms are accepted;
          3. Voice engine setup's tiers: CPU / low VRAM — Kokoro, KittenTTS and Pocket TTS, preset
             voices and cloning, all on the CPU; 8 GB — Kokoro and Pocket TTS on the CPU (keeps the
             card free for the AI model) plus Chatterbox on the GPU for cloning in 19 languages;
             12 GB+ — adds Qwen3-TTS on the GPU; each engine in the list says where it will run.
BUILT:  step 4, 2026-10-02, UNCOMMITTED — docs/plans/2026-10-02-cpu-placement.md §8 (design) and
        §9 (what landed, gates, the live run). Two runtime processes; Auto / GPU / CPU per model
        with its reason on the row; CPU speed recorded per load (kit `realtime_x`); KittenTTS and
        Pocket TTS (20 presets, five languages, Kyutai's terms gate → 403 terms-required →
        EngineTermsDialog, the Clone tab and the engine row); Voice engine setup's tiers; docs.
        Gates: server 895 passed, ruff, biome, vitest 122, vite build, smoke 14/14 on the real
        data dir; kit 1,027 passed; JustWrite builds and its 592 unit tests pass with the kit change. Live with Gemma
        resident: Kokoro and speech recognition loaded on the CPU without moving the card; the
        Pocket gate refused then rendered; the test acceptance was cleared afterwards.
OPEN:   Pocket TTS Portuguese and Spanish drop words (measured; documented) · speech recognition
        at 2.06× here, just over the bar · old speech load rows carry the LLM's backend. Committed
        and pushed 2026-10-02 ("commit and push").
GO:     given 2026-10-02 for steps 1–3 (done), D4's measurement (done) and the step-4 build

### THE 2026-08-20 VOICES FIX SESSION — layout delivered; fixes list approved "your rec"
STATE:  DECIDED 2026-08-20 — *"forget it just fix jv layout for the voices try
to do a professional job"* (delivered, rendered-verified) → *"do it go"* on
{Preparer/Dataset-Builder design · blend strategies + sliders · TASKS
correction · CustomVoice} → *"9 import voice for what engine"* (answered),
*"8 yes"* (Dataset Builder / synthetic training data IS a JV workflow),
*"13 no not until all work is done, i will tell you"* (NO gates, NO commit
until the user says), *"your rec"* (the remaining fixes proceed per the
recorded recommendations).
**THE FULL RECORD, RESEARCH, SPECS AND RESUME STATE ARE
`docs/plans/2026-08-20-voices-fixes-and-alexandria-train.md` — read it before
touching Voices, Train, blending, or tokens. Do not redo its research.**
WHY:    four sessions of layout complaints traced to hand-rolled per-view CSS,
wrong density (comfy vs the mock), a kit-prop bug (UiTag label=) rendering
empty pills app-wide, and a Train tab whose Alexandria parity was falsely
recorded as built.
NOT:    Recombine strategy (new server math, exploration toy) · restoring the
page ledes · a Fetch button · gates before the user's word.
BUILT:  canonical .jv-split/.jv-field-row/.jv-hint/.jv-col--start/.jv-stretch;
compact density + solid focus ring (kit tokenization, default-preserving);
fal-style reference group + self-fetching URL; Train pre-flight gates +
Whisper transcribe + adapters table (server: TrainJob.epochs/sample_count,
TrainingValidationSettings.max_clipping_ratio); UiTag sweep (6 views);
TASKS corrections. OPEN: blend strategies template wiring (script half is in —
plan doc §3) · import engine picker · hide Blend's dead Language dropdown ·
duplicate display names + capabilities OS gate · mark-and-hide · Preparer ·
Dataset Builder design pass · timestamps research · nav rail.
GO:     given 2026-08-20 ("do it go" + "your rec"); gates/commit withheld.

### THE STRUCTURAL RULINGS 12–16 — DECIDED 2026-08-15, specs in the plan doc §6

Your words, in order: **"12 your rec, 13 your rec, 14, your rec, 15 what do you
think and is stories only for podcast? 16 your rec"** → **"ok you rec add this
to ideas so we can design the proper timeline"** (15) → **"your rec for the
others go and code"** (12, 13, 14, 16). Each recommendation, as accepted:

- **12 — Studio steps reorder to Script → Cast → Render → Export for PROSE
  kinds; game keeps `[cast, render, export]`.** *(SUPERSEDED 2026-09-27: Overview
  first, then Discover → Script → Cast → Render → Export; game Lines → Cast →
  Render → Export — see "Build the mock's Studio in the app".)* WHY: the Script step is what
  *creates* the cast — `runDiscoverSpeakers` → `promoteDiscovered`
  (`StudioView.vue:1303-1351`) makes the personas and links them to the
  project. Cast-first means opening a cast holding only the Narrator, leaving
  to find the speakers, and coming back: a loop presented as a line. Game
  lines arrive with speakers attached, so there is nothing to discover.
  NOT: a signpost from Cast's empty state to Script — rejected as an admission
  the rooms are ordered wrong.
- **13 — Train becomes the fourth way to acquire a voice, inside Voices** —
  beside clone / design / import (`VoicesView.vue:513-525`), NOT a moved tab.
  You meet it when you want a voice, not as a separate destination. Labs keeps
  Compare / Render lab / Audio. The long-running job keeps reporting through
  the shared AI task strip.
- **14 — REJECTED as posed: Lines does NOT fold into Studio's Render step.**
  Lines is a structure view, not a render surface: stable line ids, derived
  take status, and a CSV re-import that merges the writers' next sheet by line
  id so only changed lines go stale (`LinesView.vue:218-225`). The real
  duplication is **Chapters ↔ Lines** — two structure views answering one
  question for different kinds. That comparison is the design pass worth doing;
  it is NOT a build and has no go.
- **16 — Effects + Presets consolidate near Render, resolution-first.** Item 2
  made a render preset carry format + master target + effects chain, all three
  live, so they are one decision wearing three tabs. NOT a tab merge: the
  RESOLVED answer belongs at the point of render (Studio's Render step already
  shows the master pill item 2 built), with Effects and Presets demoted to
  library pages beneath it. Merging tabs without surfacing the resolution just
  moves the guesswork.

Specs: `docs/plans/2026-08-15-pipeline-truth-and-first-run.md` §6, rewritten
from questions into build items in the same reply the rulings were given.
Ruling 12 BUILT same day (`bb4366b`); 13's build and 16's surface half are
SUPERSEDED into the voice-workbench plan below.

### THE VOICES ACQUISITION BUILD — five tabs, kokoro-onnx, VoiceDesign, LoRA training

STATE:  GO 2026-08-19 — *"build it go"*; tab set chosen the same day: *"Five
tabs, no Preset"* (Cloned · Designed · Imported · Blended · Trained — names =
the type filters). Training re-scoped mid-build by *"build train like
alexandria … go and and look and figure out best way to do it"* and, on
Chatterbox Turbo, *"you obviously thought you could do it or yo would not have
mocked it"* — the mock's Train screen (Base: Chatterbox Turbo) is the spec.
**BUILT 2026-08-19.** Gates green: ruff clean, 666 pytest passed, vite build,
Playwright smoke (16 views, zero JS errors), and the five tabs driven in a
real browser — Cloned offers 6 engines, Designed 1 (Qwen3 VoiceDesign),
Blended 1 (Kokoro), Imported none (no gate), Trained 2 bases whose knobs
seed from the verified per-engine defaults.
WHY:    VoicesView's acquisition surface was a Chatterbox-only banner plus a
details-fold whose Design and Blend buttons 400 on submit. Every dead path
traced to exactly one missing piece, each verified upstream in code this
session: Qwen Space `app.py` (VoiceDesign checkpoint + `generate_voice_design`),
`kokoro-onnx` source (`create()` takes a raw style vector), Alexandria
`train_lora.py` + `tts.py` (the whole LoRA loop and its inference), and
gokhaneraslan/chatterbox-finetuning (LoRA on t3, author-verified stable on
Turbo).
DECIDED:
- **Designed** = Qwen3 VoiceDesign variant `qwen3-vd-1.7b`
  (`Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`, 4,520,159,099 B summed from the HF
  tree, 1.7B only) → `generate_voice_design`; the stored `design_prompt` feeds
  the instruct slot. `/v1/voices/design` refuses with the way out when the
  variant is absent.
- **Blended** = Kokoro, on a runtime swap sherpa-onnx → `kokoro-onnx` 0.6.1
  (MIT; `create(text, voice: str | ndarray)`) — instant audition, weighted
  average only, slerp/lerp retired, recipe + vector on `VoiceRecord`.
  **CORRECTION 2026-08-20, your words: "no it wasnt you decided that, i gave
  you picture you ass" — "weighted average only" was MY design choice inside
  the umbrella go, not your ruling, and I later miscited it to you as yours.
  You showed the OfflineTTS/kokovoicelab strategy pictures. Strategies
  reinstated under the 2026-08-20 "do it go" (see the strategies item).** The swap
  also fixes the English-hardcoded-language finding (lang is per-call there)
  and keeps the same 54-voice v1.0 pack (`voices-v1.0.bin` 28,214,398 B;
  `kokoro-v1.0.onnx` 325,505,369 B).
- **Trained** = LoRA, two engines day one. Qwen3 Base 1.7B/0.6B — Alexandria's
  loop (MIT, attributed): PEFT on talker q/k/v/o, r32 α128, AdamW 5e-6, accum
  8, bf16, best-loss checkpoint; inference = Base + adapter + x-vector prompt
  from a saved ref sample + `instruct_ids`, so a trained voice takes written
  direction. Chatterbox Turbo — gokhaneraslan (Apache-2.0, attributed): LoRA
  on t3 (our adapter already reaches `model.t3.tfmr`); inference merges the
  adapter on load; tags keep working. Per-engine subprocess trainers in the
  engine's own env; speech engines unload first; progress as JSON lines into
  the existing TrainJob registry; `/v1/train` + `storage/training_jobs.py`
  finally get engines behind them.
  **CORRECTION 2026-08-20: the line that stood here — "Dataset prep in-tab:
  SNR / duration / clipping gates, Whisper auto-transcribe" — was FALSE as a
  BUILT claim. Code-verified 2026-08-20: the trainer scripts gated durations
  and emitted rejection reports (never shown in the UI); no SNR gate, no
  clipping gate, no transcription existed anywhere in the train path.
  Built for real 2026-08-20 under "do it go": pre-flight clip gates in-tab
  via `POST /v1/analyze` against `settings.training.validation` (duration /
  silence / new `max_clipping_ratio`), per-clip + all-clips Whisper
  transcribe via `/v1/transcribe`, trainer drops surfaced on job rows, and
  the Trained-adapters table (`TrainJob.epochs`/`sample_count` stamped at
  enqueue).**
- **Cloned** gains qwen3 `ref_text` (SynthRequest carries the stored
  transcript to `generate_voice_clone`) and per-variant qwen3 capability rows
  (kills CustomVoice's false clone tick — the tracked variant-aware item).
- `supports_embedding_blending` renames `supports_voice_blending`; blending +
  training flags join `EngineCapabilityDetail` per-variant;
  `get_embedding` + `synthesize_with_embedding` retire (zero implementations —
  blend lives engine-side).
NOT:    a Preset tab — presets aren't acquired. NOT Chatterbox Multilingual
training yet — same toolkit claims it, off until measured. NOT typed VRAM or
wall-clock numbers anywhere — measured on first run or absent. NOT touching
TADA / MOSS.
CORRECTED 2026-08-19 (same session, your words): *"i wanted tabs voices,
then all the other tabs, no new voices tab, you just did that on your own"*
and *"voices should be tab with grid then all other tabs"*. The first build
hid the five tabs behind a **+ New voice** toggle button I invented — the
page looked unchanged until you clicked it. The tab strip is now the page's
own: **Voices** (the grid) then Cloned / Designed / Imported / Blended /
Trained, visible on load, no toggle. Tab choice is session state, not a
saved pref (LabsView's precedent) so the page always opens on its library.
INVENTIONS FOUND AND REMOVED (self-audit, your ask):
  * the **+ New voice** toggle — never requested, and it hid the feature.
  * *"~60 MB Python install"* in the Kokoro description — a figure with no
    measurement behind it. Gone; the download size stays, summed from the
    release's own bytes and stated in the same MiB the UI shows.
  * kokoro's speed clamp at **2.0** while the declared Speed knob allows
    **3.0** — a value the UI accepts, silently ignored. Now clamps to the
    declared range.
  * chatterbox `grad_accum=8`, which made the effective batch 8 against
    upstream's 32 — a materially different training run. Now 1 x 32.
  * two claims asserted without proof, softened to what is actually known:
    that a trained voice sounds "much closer" than a clone, and that the
    clone transcript "measurably improves" the result.
  * docs listing only Qwen3 Base under Trained (Chatterbox Turbo ships too)
    and dropping TADA / MOSS from Cloned (both still clone, both marked).
NOT INVENTED, checked and kept: the espeak language codes kokoro-onnx gets
(`lang` goes straight to `phonemizer.phonemize` on the espeak-ng backend, so
they are real espeak voice codes) — with a note that the package documents
only en-us/en-gb, so non-English is correct-by-construction, not heard.
BUILT:  the tabs (`VoicesView.vue`, capability-driven via the shared
`services/capabilities.js` resolver — a variant row always beats its engine's
union row); `POST /v1/voices/blend` moved beside clone/design/import and
computes host-side (`engines/blending.py`) so no engine process is needed;
`phase5_api.py` renamed `training_api.py` (a plan-phase name was never an API
name); the kokoro-onnx runtime swap incl. per-call language, the IPA bypass
and instant blends; the qwen3 VoiceDesign variant + `generate_voice_design`
branch; `ref_text` reaching Qwen3's clone call through a new
`SynthRequest.ref_text`; the host-owned `training_runner.py` + two trainer
scripts; TrainView rebuilt against the real request contract and moved into
the Trained tab; docs/voices.md + docs/labs.md rewritten.
FIXED EN ROUTE (each was a control that reached nothing):
  * `POST /v1/voices/preview/{id}/save` returned `{"promoted": true, "note":
    "route stub"}` and wrote NOTHING — a Save that reported success and lost
    the voice. Now persists, stores the reference clip, and recomputes a
    blend from its recipe.
  * a blended or designed AUDITION passed only `__preview__`, so every
    candidate rendered in the engine's default voice.
  * TrainView sent `method` / `steps` / `qc` / `concurrent_jobs_limit`;
    `TrainVoiceRequest` has none of those, so pydantic dropped all four.
  * render / generate / audition each resolved only the reference clip, so a
    blended or trained voice rendered as its bare id — one resolver now
    (`render_core.voice_synth_fields`).
  * Turbo's LoRA target modules are `c_attn / c_proj / c_fc / spkr_enc`, not
    the llama-style names its sibling variants use: the wrong set would have
    attached ZERO adapters while the loss still fell from `modules_to_save`.
NOT:    a Preset tab (presets are not acquired). NOT Chatterbox Multilingual
training (same toolkit claims it; off until measured). NOT typed VRAM or
wall-clock numbers anywhere.
COSTS:  Kokoro moves to its own venv (kokoro-onnx wants numpy>=2.0.2, the
then-shared venv was pinned <2.0 by qwen3) and its model files change, so
**Kokoro re-installs and re-downloads once**. *(The venv half of this cost was
paid by the 2026-08-22 per-engine migration — `engines/kokoro/.venv` exists.
The model-file half still stands.)* A sherpa-era model dir is detected and
says so rather than failing deep inside np.load.
OPEN:   **Chatterbox training has never been heard** — the recipe follows a
working upstream one and every call is checked against the installed
package's surface, but no adapter trained by that script has been listened
to; the capability row says so in its notes. VoiceDesign identity stability
across renders (two-render check, needs the checkpoint downloaded). Whether
the qwen3 VoiceDesign download works end-to-end (its size is the summed HF
tree, and the multi-file URL arm is new).

### THE PLATFORM FOLLOW-ON — latest engines, every GPU, streamed auditions

STATE:  GO 2026-08-19 — *"go for it all, also we have acceleration for each
engine now, i am guesing this doesnt work based on the work we are doing
verify that this works and works for all platforms a drop down in engines
pages for acceleeration auto cuda cpu"*, riding the earlier same-day words
*"get latest means get latest chatterbox"*, *"crossplatform with all gpu
apple silicon supported… cuda apple silicone rocm ect"*, *"i should not have
to install anything these engines are built in"*, and *"can we run chattebox
in realtime?"*. Standing constraint: *"5 no gates until i say so"* — ruff /
pytest / build / smoke NOT run for any of this; parse-checks and live-app
verification only.
DECIDED:
- **Latest = pinned SHAs, bumped deliberately.** Chatterbox installs from
  upstream master `5de7a54aa4e5e2baadb0182dde554908b48b85c2` (2026-07-21,
  replaces PyPI 0.1.7): brings Multilingual **v3**
  (`t3_mtl23ls_v3.safetensors`, 3,208,951,924 B) and **Nano**
  (`ResembleAI/chatterbox-nano`, 1,942,108,236 B, Turbo architecture,
  byte-identical tag vocabulary). Perth pinned `ce86c49d029f`; qwen3 git
  overlay pinned `022e286b98fb`.
- **Acceleration dropdown is dynamic**: options = auto + (manifest
  `gpu_runtimes` ∩ `/v1/system/info` runtimes) + cpu, per engine per
  machine. system_info gains rocm detection (rocm-smi, Linux); the manager's
  torch installer gains the ROCm 6.2 wheel-index arm.
- **Chatterbox on Apple GPU** via the known float32 fix
  (`engines/chatterbox/mps_patch.py`, adapted from devnen's
  `_patch_chatterbox_mps_float32`, attributed): applied in load() BEFORE the
  model modules import; MPS load failure falls back to CPU; the blanket
  Darwin→cpu forcing is gone; manifest declares mps.
- **Qwen3 on Apple Silicon = the MLX arm** (roster doc 2026-08-17 §4's
  recorded route): five `-mlx` variant rows (mlx-community **8-bit** exports,
  sizes byte-exact from the HF trees — CV-1.7B 3,080,138,901 B, CV-0.6B
  1,973,572,801 B, Base-1.7B 3,104,156,243 B, Base-0.6B 1,991,296,593 B,
  VD-1.7B 3,080,138,280 B) through `mlx-audio>=0.5.0` (MIT, API verified in
  its v0.5.0 source: `load_model` + self-routing `generate()`). Variant rows
  and install steps carry an `"oses"` gate filtered at ONE door each
  (`model_catalog._variant_rows`, `manifest.install_steps`); qwen3 ISOLATION
  is per-OS — its macOS venv is mlx-audio only (mlx-audio needs
  transformers>=5.14, chatterbox pins ==5.2.0 in its own venv — it read "the
  shared venv" before the 2026-08-22 migration, and per-engine venvs are what
  make that pin legal rather than a conflict). The
  `-mlx` id SUFFIX keeps the capability suffix-walk on the right family row;
  explicit full-id rows drop training on the MLX Base variants (the trainer
  is PyTorch, Windows/Linux).
- **Streaming phase 1 = host-side pipelining on the audition path.**
  `GET /v1/voices/{id}/preview/stream` splits the line at sentence ends
  (`settings.generation.stream_piece_chars`, default 200, Settings slider),
  renders piece-by-piece through the SAME doors as POST /preview (routing
  factored into `_resolve_audition_target` — one door, both endpoints), and
  streams each piece as it finishes, crossfaded with the long-form math via
  a held-back window. Shares the audition cache both ways. The row transport
  tries the stream URL first; any failure (409, tokened remote, dead server)
  falls back to the POST door and its dialogs. The `streaming_generation`
  Feature flag is DELETED — no manifest ever declared it, and host-side
  streaming is per-render, not per-engine (sweep clean).
- ~~**Built-in means built at setup**: `spawn_shared_venv_setup` also builds
  venv-isolated engines' venvs, so no per-engine Install moment;
  `engines/constraints.txt` scoped to the SHARED venv only
  (`use_constraints=False` for isolated installs — the numpy<2 ceiling was
  exactly what blocked kokoro-onnx).~~ **DEAD 2026-08-22** — the per-engine
  migration deleted all three symbols; `grep -rn "spawn_shared_venv_setup\|
  use_constraints\|constraints.txt" server/justvoice --include=*.py` returns
  nothing and `engines/constraints.txt` does not exist. Every engine now has
  its own Install moment and its own venv, and the numpy<2 ceiling is gone
  with the shared environment that imposed it.
- Chatterbox conds cache keyed `(ref_audio, mtime_ns, exaggeration)` —
  repeat renders of one voice skip prepare_conditionals.
VERIFIED LIVE (user's real app, dev sidecar 17494, data dir
`src-tauri/target/debug/data`):
  * Windows catalog shows exactly the 5 torch qwen rows — no `-mlx` leak;
    declared runtimes over the wire: kokoro cuda/coreml/directml/cpu →
    dropdown Auto/CUDA/DirectML/CPU here; chatterbox cuda/mps/cpu/rocm and
    qwen3 cuda/rocm/mlx → Auto/CUDA/CPU here. `/v1/system/info` runtimes on
    this box: cpu/cuda/vulkan/directml.
  * Streamed audition, 285-char 3-sentence line on `af_heart`: first bytes
    at **2.2 s** (including the kokoro load), full 16.16 s WAV at 6.3 s —
    playback can start ~4 s before the render ends. Same call again: **4 ms**
    from cache with a real seekable header, byte-identical PCM. 409
    `engine_not_loaded:` and 404 contracts intact for the client fallback.
  * `stream_piece_chars` present in `GET /v1/settings` (PATCH door reaches it).
UNMEASURED (declared in code where it matters): MPS, ROCm, MLX — no Apple or
AMD hardware here; Nano/v3 never listened to; chatterbox-trained adapters
never heard.
NOT:    engine-native token streaming (chatterbox `generate_stream` /
mlx-audio `stream=True`) — tracked below; MLX LoRA inference; Chatterbox
Multilingual training.
OPEN:   engine-native streaming as phase 2 (both surfaces exist upstream);
first-Mac-run truth for the MPS patch and the MLX arm; Nano/v3 listening
pass; a visual pass over the new Voices UI in a browser (Chrome extension
was not connected this session; the smoke gate is paused by your word — the
Tauri dev window has everything HMR-live).

### ~~The smoke gate went red on a healthy app — the boot splash ate every click~~ — FIXED 2026-08-22

STATE: FIXED. `scripts/smoke.js` now dismisses the boot splash, and the NAV-FAIL
line no longer truncates away the reason.

WHAT HAPPENED: on any data dir with `warmDefaultOnStartup: true` — which the
real dev data dir has — `App.vue`'s `.splash` overlay is up while warm-on-boot
loads the default local chat model (here `gemma-4-26b-a4b-qat`). It covers the
app and intercepts every pointer event, so all 14 nav clicks timed out and the
gate reported `SMOKE FAILED: 14 view(s) errored` on an app that was rendering
perfectly, with zero console errors and a complete rail.

**The app was never at fault, and neither was the kit** — `BootModelLoad` ships
the escape ("Continue without waiting") and it was present the whole time. This
is the same false-red family as the 2026-08-14 `.ui-modal-overlay` one that was
"blamed on machine contention twice"; the splash is not a modal, so that Escape
loop never touched it.

WHY IT COST A FULL DIAGNOSIS: the NAV-FAIL log sliced Playwright's message at
100 chars, which cut it off immediately before
`<div class="splash"> intercepts pointer events` — the line that names the
cause. Fourteen identical "Timeout 5000ms exceeded" lines that explained
nothing. **That truncation is fixed too**: any interception line is now printed
under the failure.

NOT: waiting the splash out. Warming a 26B model takes minutes and is not what
this gate measures — clicking the escape is what a user does.

### Build the mock's Studio in the app — Slices 1 + 2 (Overview, Discover)
STATE:  DECIDED 2026-09-27 — "your rec go", on the plan presented that day (pasted below).
        Studio becomes the project's home. Opening any project lands on its Overview (settings,
        where each step stands, Continue). Then Discover · Script · Cast · Render · Export; game
        kinds skip Discover and Script. Projects becomes a plain list.
        Slice 1 — Overview + Studio as the project home. `studioSteps.js`: Overview first,
        unnumbered. Status only from data already loaded: chapters analyzed (block has a source),
        lines with no speaker, personas voiced / lines blocked on a voice, render cache
        cached/total. Settings: title, description, kind read-only, mastering target, lexicon,
        Re-import, Export .justvoice.zip, Delete — existing services, same autosave. Every "open
        a project" path goes to Studio Overview: Projects row Open and Open in Studio,
        create/import, Home Resume, the title-bar switcher, Import review. The Projects detail
        pane goes; its fields move to Overview; the cast pills go (Cast is the one editor).
        Slice 2 — Discover as its own step: chapter grid with checkboxes + live estimate,
        "Scan N chapters" (the existing per-chapter endpoint per chapter), a Proposed speakers
        table (name, lines, chapters) with Add (existing promote) and Ignore. Analyze stops
        auto-running Discover.
        The six decisions, all "your rec":
        1. Author: wire it into the M4B artist tag (small server change). Webhook: off Overview
           until webhooks are project-linked.
        2. Export and Discover status rows show no counts, just a link — nothing records an export
           or a scan.
        3. Chapters and Lines stay in the rail for now; decide after using it.
        4. Game projects: the Lines grid goes inside Studio as "1 · Lines".
        5. Discover Merge: left out (personas have no aliases).
        6. Slices 1 + 2 now; Script (3) and Render (4) after trying them.
WHY:    The mock is the design; the user wants to "see how it works for real".
NOT:    Discover "Last scanned"/"N of 14 scanned" and Export "not exported yet" (no backing
        data). Merge. A second cast editor on Overview. Webhook field on Overview.
BUILT:  2026-09-27, COMMITTED + PUSHED in JV `df15ecf` (2026-09-28). `studioSteps.js` (+test) · `studioStatus.js` (+test) ·
        `components/StudioOverview.vue` · `components/StudioDiscover.vue` · `services/openProject.js`
        (the one "open a project" door: Projects, Home Resume, switcher, create/import, Import
        review) · `StudioView.vue` (Overview/Discover/Lines steps, lands on Overview on every
        project change, follows the active project; old discover banner + auto-run deleted) ·
        `LinesView.vue` (`:project-id` embeds it) · `ProjectsView.vue` (plain list, pane deleted) ·
        `ChapterView.vue` (dead `jv.chapter.sceneId` reader deleted) · server
        `projects_api.m4b_author` (+test). Docs: projects.md, studio.md, toc.json,
        getting-started.md, CONCEPTS.md, code-map.md.
DECIDED 2026-09-27 — "both", on this (user asked why Discover → Script → back lost the scan):
        1. Keep results while you move around Studio — keep the Discover section alive between
           step switches instead of rebuilding it (the v-if unmount was the bug).
        2. Save results on the server — store each chapter's scan (candidates + when it was
           scanned) on the chapter, so results survive restarts and Overview/Discover get real
           "scanned / last scanned" data. This reverses decision 2 for Discover only.
DECIDED 2026-09-27 — "A your rec go": finish "both", and put the kit task strip (Cancel +
        per-chapter progress) on the Discover page, as Script has for Analyze. Then investigate
        the false speakers as a separate step — read the discover prompt and run it on the
        Stillwater chapters against the loaded model; findings before any fix. User's report: "in
        the sample there are 2 easy speakers maria and edith, it does not identify edit and tries
        to identify 2 unknonw speakers". (Mara + Edith are already cast there, and Discover
        excludes cast names by design — the two invented speakers are the real defect.)
INVESTIGATED 2026-09-27 (findings only, no fix — needs the user's word). Ran
        discover 3x per chapter through the user's own app server (17494, gemma-4-26b-a4b-qat;
        cast at that moment = Narrator only). Identical every run:
        · "The Lake House" (231 chars, 2 dialogue lines, NO name anywhere) → "child", "the elder".
          Invented descriptors. The prompt invites them: IDENTIFY_SYSTEM says 'Use the name the
          text itself uses for them (e.g. "the stranger" → "The Stranger")'
          (`extraction/identify.py:26-36`, the system of template `speaker_attribution.identify`).
        · "Old Debts" (168 chars, 1 untagged line) → "Mara" (wrong — the context makes Edith the
          speaker), Edith missed. The prompt keeps only "characters who actually speak dialogue",
          so a named-but-judged-silent character is dropped and one wrong call loses her.
        · Per-chapter scanning cannot connect chapter 1's unnamed speakers to chapter 2's names —
          each call sees one chapter only.
        · The demo is 5 lines, 4 untagged; a human cannot name ch. 1's speakers without ch. 2.
        DECIDED 2026-09-27 — "your rec": fix options 1 + 2 + 4. (1) propose only real names or
        a consistently used title, never descriptors like "child"; (2) propose every named
        character who appears, not only those judged to speak — Script decides who speaks;
        (4) return the line that shows each name, so a proposal can be judged at a glance.
        Option 3 (other chapters' names as context) NOT chosen. Then re-run on the sample.
        User asked the same turn whether the change lands in the feature routing (the live
        `feature_prompts` row) — answered: the seed is insert-if-missing, so it needs the kit's
        stale-heal registry (JV has none; JW has FEATURE_PROMPT_HEALS). CORRECTED + DECIDED
        2026-09-27 — "this is not prodicutioun you do not need to do any migration seed data
        happens 1 time on a new database that is all. yes you have it correct": the change goes
        into the LIVE feature row (as if saved in AI Settings → Features — the only thing that
        runs); the shipped default gets the same text for new databases only; no heal, no
        migration. Option 4 is code (parser, saved scan, Discover column).
        BUILT 2026-09-27: new text saved into the live `speaker_attribution.identify` row via
        PUT /v1/ai/prompts (user template + JSON setting kept, still built-in so Reset works);
        the same text is the shipped default (`extraction/identify.py` IDENTIFY_SYSTEM);
        `evidence` carried by parser → API → saved scan → Discover "First appearance".
        Re-run on the sample, in the real UI: The Lake House → none; Old Debts → Edith +
        Mara, each with its quote; with Mara cast → Edith only; results survived a reload.
        Side finding: from the gate server (8741) the same model failed to load its MTP draft
        (502), while the user's app loads it fine — not diagnosed; memory's MTP-regression note.
TESTED 2026-09-27 on the Ninth Facet demo (user: "run the tests on discovery on the demo
        project delete some of the exisiting charactera after import and test if the new prompt
        works correctly"). Real data dir, live prompt, gemma-4-26b-a4b-qat, project 42081980….
        Removed from cast (NOT deleted): Nettle, Brick Halvorn, Haldane Threll, Iven Sarraz.
        · Recall 13/13 — every removed character found in every chapter that names them; no
          cast member proposed by a name the known list holds; scans saved on all 4 chapters.
        · Sedge / "Old Sedge" (a road-warden who speaks, not in JW's list) — a TRUE find, but it
          shows as two proposals: the merge keys on the exact name.
        · "Ode" — FALSE: Odeline Marran's nickname ("Odeline Marran," she said. "Ode.") and she
          IS cast; that chapter never says "Odeline", and personas carry no aliases.
        · "Gudgeon" — FALSE: JW lists it as an OBJECT (Brick's enchanted maul), 0 lines, 2 chapters.
        · First names only ("Brick", "Iven") where the chapter uses them.
        · DEFECT (not the prompt): ＋ Add → promote matches personas only on
          (imported_from="discovered", slug) (`_persona_helpers.ensure_project_persona`), so
          adding "Brick" — or even the exact "Haldane Threll" — would CREATE a duplicate persona
          instead of re-linking the library's JustWrite-imported one. Add was NOT pressed.
        No fix made — needs the user's word.
        DECIDED 2026-09-27 — "go on all your recs a b c d and 1-5", on:
          A. Add re-uses your library — match proposals against every library persona, show
             "Brick → Brick Halvorn (in your library)", Add re-links it.
          B. Prompt: only people or creatures that can speak; never a named object, place or
             weapon.
          C. Personas get nicknames/aliases, so "Ode" matches Odeline Marran — and Analyze's
             anchors get them too (`_resolve_cast` hardcodes aliases []).
          D. Merge "Sedge" + "Old Sedge" (one name contains the other) into one proposal.
          1. Learn aliases from Add — adding "Brick" onto Brick Halvorn saves "Brick" as his alias.
          2. Send the model a richer cast list — aliases and a one-line description per persona.
          3. Check the quote is real — the server confirms each quote appears in the chapter.
          4. Remember Ignore per project — a re-scan does not re-propose an ignored name.
          5. A repeatable prompt test — the Ninth Facet + expected answers, run on demand
             against the real model, scored.
          (6, long chapters, was a check, not in this go.)
        BUILT 2026-09-27, uncommitted: `extraction/names.py` (+test_names) · `Persona.aliases`
        + `Project.discover_ignored` columns (NO migration — the dev DB 500s with "no such
        column" until the user resets) · API/store/editor "Also called" · JW import aliases ·
        discover: rich known list, cast drop, library_match, evidence_found, ignore remembered
        + /discover/unignore · promote persona_id re-link + alias learning + aliases for new
        personas · Discover UI (library tag, merged spellings, quote flag, Ignored + Restore) ·
        live prompt row + shipped default updated (B) · `npm run eval:discover`.
        MEASURED (eval, real model, 2 runs/chapter): recall 26/28 (the 2 = Haldane Threll named
        once by surname inside dialogue in "Bigger Inside"; found in ch.1), "Ode" GONE (fix 2),
        quotes 34/34 real, Sedge + Old Sedge found (merged in the UI). NOT fixed: "Gudgeon" —
        three wordings tried (B; a sharper object rule; a person/creature/thing label the parser
        filtered); the model labels it "creature"/"person" — the book calls it "the great
        enchanted head of the maul", genuinely ambiguous. Label code reverted; Ignore covers it.
        VERIFIED in the real UI 2026-09-28 (after the user's reset): headless scan in the
        running app — AI task strip, per-chapter rows, zero JS errors.
        LATER THE SAME DAY (all committed; records in the plan docs, not here — close = delete):
        speaker attribution 55-64% → 99.8% (`docs/plans/2026-09-28-speaker-attribution-tuning.md`);
        failures show instead of blank lines; Discover gets the library as a second list
        (eval 18/28 → 28/28, "Ode" → Odeline Marran, Gudgeon no longer proposed);
        long chapters read in pieces (`docs/plans/2026-09-28-chapter-splitting.md`).
FOUND WHILE BUILDING — needs the user's word, NOT decided:
        · Mastering options now say what they do: "" = the kind's default (was labelled "None",
          which on an audiobook meant ACX), "none" = raw, and "Custom" dropped (server renders it
          raw with a warning).
DECIDED 2026-09-28 — "go", on: "Overview mastering options: switch to what the app now
        offers: 'This kind's default (ACX)', 'None — raw', ACX, iAudio, Podcast, YouTube, with
        'Custom' gone. This is the wording still waiting on your approval. Say go only if you
        accept that wording." The mastering wording above stands as built; the mock matches it.
OPEN:   the Personas work FIRST (decided 2026-10-03, "we need to do the persona first that is
        before slice 4" — the FINDING "a persona's pace, pitch and gain can't be edited"), then
        Slice 4 (Render owns direction/takes/Gen/Compare), Slice 5 (presets excision — ruled,
        needs go). (Slice 3 was BUILT 2026-09-29, `86eb21d` — its entry is below.) The
        Lexicon-on-Overview question was ANSWERED ("ok mark that as to be wired") and BUILT
        2026-09-30: `docs/plans/2026-09-30-project-lexicon.md` (its §7 holds the closed item).
        Game "1 · Lines" is unverified in the real app — the real data has no game project.
        Slice 4 ALSO moves "rewrite in character" off Script: it stays on Script as today's
        right-click until then (decided 2026-09-29, next item); Slice 4 builds it in Render's
        line panel and DELETES the Script right-click (`rewriteRow`, its modal, the
        `@contextmenu` on the Script row).
        Slice 4 ALSO DELETES the old Chapters page (`views/ChapterView.vue`, route `/chapter`)
        — decided 2026-09-30, "go", verbatim in `docs/plans/2026-09-30-script-leftovers.md` §1
        "Changed". Where its features go: takes, Generate/Regenerate, compare, direction and
        "Fix pronunciation" → Render's line panel (mock `_s4.html`); paste text → Script's
        "＋ Add text" (mock `_new_chapters.html`); Words / Est. audio columns → dropped.
        GAP, not in the mock: add / rename / reorder / delete a chapter. Rec (not decided):
        Script's chapter grid — "＋ Add chapter", and Rename · Move · Delete per row; mock first.
        Slice 4 ALSO builds "📕 Pronunciation" in the line panel right — the book's chosen
        lexicon, one made for the book if none (decided 2026-09-30, `2026-09-30-project-lexicon.md`
        §6 item 4) — and D4 carries stale-vs-re-render for lexicon edits (§6 item 7).
        NEXT (2026-09-30, user "lets move to the next slice"): Slice 4 is researched, not planned —
        `docs/plans/2026-09-30-mock-vs-app-and-slice-4.md` §3 (what exists, what the mock shows)
        and §3.4 (D1–D8, the decisions to put to the user before any plan). Resume at its §4.
GO:     given 2026-09-27 for Slices 1 + 2 and decisions 1-6 | needed for 3, 4, 5
        Slice 3 was re-thought on 2026-09-28 — see the next item.

### Studio Slice 3 — Script, redesigned against the 09-28 measurements (mock first)
STATE:  DECIDED 2026-09-28. The user asked "think on the design again … is there feature
        functionality missing for the script processor better ui?"; the review was presented;
        then "update mock first"; then "1 your rec 2 move it 3 your rec 4 your rec"; then "go".
        1 → every rec goes into the mock:
          M1 loud marks go to Flagged + No speaker, not Guessed (badges stay on every line)
          M2 a row is a paragraph, not a segment (spoken part marked, the tag grey inline)
          M3 one "No speaker" filter replaces Below the floor + No answer (reason on the row)
          M4 persona strip = the 1–9 legend, per-chapter counts, click to filter, find past 9
          M5 one shared speaker picker, not a dropdown on every row
          M6 real values: routes Auto/Guided/Direct, floor 0.5/0.7 read-only, no invented time
          A1 row states: failed (server's reason) · can't re-cut (takes) · no text · no dialogue
             found · cast changed since analyzed
          A2 "No dialogue found" when quote marks exist but no dialogue was cut
          A3 stale after Discover adds a persona — only the chapters that name them
          A4 Double-check replaces Review the guesses (second run, flag disagreements)
          A5 flag lines where the anchor and the model disagree
          A6 "your fixes teach the next Analyze: N · Clear"
          A7 Undo for bulk changes — the undo must not be saved as a fix
          A8 the batch outlives the page (a service, not the component)
          A9 Overview's Script row uses the grid's words
          Keep the bulk "no speaker → Narrator". D1 Review the guesses out · D2 Confidence
          column out · D3 rewrite in character off Script.
        2 → "rewrite in character" MOVES to Render's line panel.  3 → A4 + A6 go in the mock
        now; the build carries them only if their measurements hold.  4 → the go covers this
        record, the mock, rebuild, validate, republish; no app code.
        The full review as presented (verbatim), its evidence and its blast radius:
        `docs/plans/2026-08-15-voice-workflow-redesign.md` §8.23 — READ IT before building.
DECIDED 2026-09-29 — "your recs go", after measuring both against the user's app (numbers in
        §8.23 "Measured, then dropped"). Presented: "Double-check: drop it for now. With the
        model at 99.6%, doubling the time bought one catch in 268 lines, and it can't see the
        stable kind of miss. The flag checks (§8.14) cost nothing extra. Revisit it if a harder
        book shows misses that change between runs." and "'Your fixes teach the next Analyze':
        drop the line. The mechanism does no harm, but the line would promise a benefit the
        measurement doesn't show. Keeping the 'Clear' button alone isn't worth it either."
        → A4 and A6 are OUT of Slice 3; removed from the mock (v26).
DECIDED 2026-09-29 — "you rec on all go", on the three gaps and two steps presented:
        1 "a speaker not yet in the chapter" (§8.14) → "don't choose now. Put both versions,
          (a) 'not named yet' and (b) 'never named in the chapter', into the flag measurement,
          and keep whichever catches real misses with fewer false alarms, or neither."
        2 "three in a row" → "three or more back-to-back spoken paragraphs, with no
          narration-only paragraph between them, all given to the same persona, flag the
          third and any after it." (count paragraphs, not lines; narration breaks a run; 3)
        3 Undo → "a `no_fix` flag on the line update", so an undo is never saved as a fix.
        Measure the flags first, no model: on the answer keys (perfect attribution — every
          flag there is noise) and on the saved wrong runs (does it catch Brass Rank D24 and
          "Quartermaster."?).
        Then a build plan in the plan doc — pieces 3a server · 3b grid · 3c chapter, with
          files and blast radius — for approval BEFORE any app code.
DECIDED 2026-09-29 (later) — "your rec on all go", on a second review of Slice 3 (asked:
        "do you have any other recommnedations for the script slice 3 to make it better more
        accurate user friendly feature rich"). The review as presented, verbatim, with its
        evidence and blast radius: redesign doc §8.25 — READ IT before building. The five
        decisions and the recs they took:
        1 Flags → "A flag marks a group (the run, or the paragraph) with one reason on it."
          · "Add 'one paragraph, two speakers', skipping paragraphs where the prose names
          both speakers." · "One key accepts a flagged group as right. Lines you set or
          confirmed never flag." · "Correct the record." This REPLACES the same day's "flag
          the third and any after it".
        2 Measure the prompt rule for lines that only address someone — measure only;
          promoting it needs its own go.
        3 Into the mock and the plan: "next/previous chapter, jump to next problem, swap
          speakers, the 'Changed' filter, all five missing states, and the first four build
          items" (flags in Python with the eval importing the same function · one shared
          chapter-run service for Discover and Analyze · keyboard, selection and Undo as a
          pure tested module · Undo also removes the fix the undone change saved).
        4 A third answer-keyed book that isn't a JustWrite sample — which book is NOT decided.
        5 "Added since" → "search each analyzed chapter's text for her name and her 'also
          called' names", for every chapter; Discover's scan is not consulted.
        And the plan's two gaps: "rewrite in character" → "keep it on Script, but only as the
          right-click it already is today. No new visible control … Slice 4 moves it to
          Render's line panel and deletes the right-click"; "added since" → as 5.
DECIDED 2026-09-29 — "i approve", then "go", on the chapter page's layout. The user, on the
        mock's paragraph rows: "for me this looks like it assings june to this whole text which
        is not correct, june whould be assigned to only the part in quotes and the narrator
        would get the rest, this is how it currently worsk … it is not intuitive". Presented:
        (1) one row per line, as the app works today; (2) keep the paragraph row and label
        every part inside it; (3) "One row per line, grouped by paragraph. My rec. — Each row
        is one line with one speaker, as you're used to. — The lines of a paragraph sit
        together, with a divider only between paragraphs. — Narrator rows stay grey, so they
        recede. — The flags still work, because they need to know where a paragraph starts and
        ends." → OPTION 3. This REPLACES M2 ("a row is a paragraph, not a segment").
        Also that turn: "go with the speckled band" → the third answer-keyed book.
DECIDED 2026-09-29 (after seeing v28) — "1 your rec 2 keep confidence its good useful info,
        if confidence is 50% but user only sees it on hover it hides errror, dont be lazy. 3
        your rec   go". The user on v28: "there is no whay to change an incorrect speaker we
        had drop down before … this design is poor, it was easier before you had 1 line per
        speaker and you could change the speaker that was selected, this grid is cramped llm
        0.91 what does that mean, you need to make it easy and intuitive … see original is
        easy to understand". The three questions and their answers:
        1 "Use the original table as the base, with the additions above?" → YES. As
          presented: "Kept from the original: one row per line, a speaker dropdown on every
          row, column headings, roomy rows. · 'Decided by' in plain words: Narration, The text
          named them, The model, You. · A 'Check' column: a flagged row gets a tint and a
          short reason. There are no group boxes. · A checkbox per row: tick several, then
          set one speaker for all of them or swap their two speakers. · Kept from the new
          work: the chapter grid as the landing page; filters All, To check, No speaker,
          Changed; 'Next to check' and next/previous chapter; Undo. · Removed: the numbered
          speaker strip, the badges, the hover pencil and the pop-up picker. · Keyboard
          shortcuts stay as an optional extra behind a 'Shortcuts' link."
        2 The confidence number → a VISIBLE Confidence column, as in the original. This
          REVERSES D2 and §8.13's "no confidence column".
        3 The two-speakers flag → kept, reworded "Two speakers in this paragraph" (the claim
          "a new speaker usually starts a new paragraph" is dropped; the user: "bull plenty
          of times speakers in one paragraph").
        This REPLACES the screenplay rows of v27/v28 and M4 (the speaker strip), M5 (the one
        shared picker).
WHY:    the mock's review design dates from 2026-08-16 (55–64% right). Measured 09-28: 22 of
        272 dialogue lines anchored, 937/940 right, every miss at 0.70/1.00 and none repeated —
        so "Guessed" is nearly all dialogue and cannot be the review signal.
NOT:    Review the guesses. Double-check (A4) and the "your fixes" line (A6) — measured,
        dropped 2026-09-29. A gold mark on every guess. Two no-speaker filters. A dropdown on
        every row. The mock's "Direct / Chunked", "0.55" and "about 4m 3s". Rewrite on Script.
        B1–B6 (split/merge, text edit, single quotes, dialogue tags, ChapterView duplication,
        custom-kind Narrator) — out of this slice, each needs its own word.
BUILT:  mock only — published 2026-09-28 as version 24 (v25 fixed the pre-existing
        mismatches, v26 dropped A4/A6, v27 carries the second review; §8.18); where each item
        landed: the tables in §8.23 and §8.25 "Built in the mock"; validate.py on v27: 19
        routes · 171 controls · 0 dead. The eval gained `--fixes-from/--fixes/--fixes-pick`
        (`server/scripts/eval_attribution.py`). App code: nothing.
        v27 also FIXED the mock's shared script: no glyph control (play, download, row menus,
        chevrons) had ever fired — the validator counts the attribute, it never clicks.
MEASURED 2026-09-29 (the prompt rule, real model, 2 runs/chapter, both books — §8.25): 534/536
        with the rule, 533/536 without. "Quartermaster." wrong in 1 of 2 runs instead of 2 of
        2; a self-introduction line lost its speaker in 1 of 2. Inside the noise — NOT promoted.
BUILT 2026-09-29 — the third answer-keyed book: `samples/the-speckled-band/` (`book.txt` +
        `attribution-truth.json`, 247 lines). Conan Doyle, 1892; Project Gutenberg eBook #1661,
        whose page states "Public domain in the USA." (checked on the web that day); no
        Gutenberg header, licence or name in the copy. The eval reads a key's `book`, `adapter`
        and cast objects; `docs/dev/code-map.md` names the three samples. Mock v28 redraws the
        chapter as one row per line.
BUILT 2026-09-29 — mock v29: the chapter page is the app's own table (tick · Speaker dropdown
        · Decided by · Text · Confidence · Check), the two banners, the ticked-rows actions,
        "Next to check", the Shortcuts list. The grid and chapter use the app's route words
        ("rules only" / "with examples", `services/attribution.js` ROUTE_WORDS), not "Direct" /
        "Guided". validate.py on v29: 19 routes · 179 controls · 0 dead. Driven headless: the
        dropdown, ✓ OK on a run, filters, tick + swap, keys — 0 JS errors. Record: §8.25
        "Back to the table"; the plan §8.24 follows it.
MEASURED 2026-09-29 (The Speckled Band, real model, 2 runs — §8.25): 490/494 (99.2%), no
        blanks; 62 of 62 tag-decided lines right. The flags, out of sample: 0 false alarms
        for three in a row and for two speakers in a paragraph, but only 1 of 4 wrong lines
        caught — a swapped pair in a two-person exchange is invisible to every check. Three
        in a row needs "a speech over several paragraphs is one turn" (2 false alarms
        without it) — a PROPOSAL in §8.24, not yet ruled.
        Straight quotes (no model): 14 paragraphs of speech, 1,247 of 6,473 spoken words
        (19%), are read as narration when the same story uses straight quotes.
FINDING 2026-09-29 — Discover's scan blocks the server: `/v1/health` timed out while an
        analyze-text call ran, and `discover_speakers_endpoint` (`extraction_api.py:960`) is
        built the same way (no worker thread; the Analyze stream has one, `:575-615`). The fix
        is in the plan's 3a. Not fixed.
MEASURED 2026-09-29 (flags, no model — §8.23 "The flag checks, measured", CORRECTED in
        §8.25): the first scoring said no check catches either remaining miss; that was the
        scoring, not the checks. Re-scored on the same keys and saved runs: three in a row
        (whole run flagged) catches "Quartermaster." 4 of 4, "one paragraph, two speakers"
        catches Brass Rank D24 2 of 2, both with 0 false alarms on 268 keyed lines. C3a/C3b
        and "a line says its own speaker's name" raise false alarms and catch nothing → not
        built. A5 unmeasured.
DECIDED 2026-09-29 — "1 do it the six items your rec i told you this many times go", then
        "do all 3 and commint" + "go" (the three: the six items, the build plan, a commit).
        The six items, as the recs were given:
          1 Grid filters by state, select-all acts on what's shown → YES
          2 Links into Script land on the problem → YES
          3 "Read by you" per chapter → NOT NOW — "decide after using the new Script on a
            real book. It adds saved state and touches your no-completion-state ruling."
          4 Measure the chapter page on the longest chapter → YES, first step of piece 3c
          5 "Chapter" / "episode" from `useCopy()` → YES
          6 A quote mark left inside narration → YES, "the better fix is in the segmenter,
            not a warning" — backed by the straight-quote measurement (§8.25)
        The build plan §8.24 and its table of proposals → APPROVED as written.
DECIDED 2026-09-29 — "1 yes drop it 2 yes go". The user on the table: "all a user sees is line
        by line, i dont know about a paragraph unless i look at real text … why are we bringing
        this up as a possible error, what is the logic to mark it differently for approval, it
        seems confusing". The two questions and answers:
        1 "Drop the 'two speakers in a paragraph' flag?" → DROPPED. It reverses the earlier
          "keep, reworded". Kept: only flags whose reason can be checked from the rows shown —
          3 lines in a row, a persona's only line in the chapter, the text and the model naming
          different speakers, no speaker.
        2 "Keep '✓ OK', renamed 'Looks right'?" → YES. It only removes the mark and takes the
          line out of "To check"; the line renders the same either way.
        With the same go, the Check reasons become plain questions naming the people:
          "Marius has 3 lines in a row — did someone else say one?" · "Harbek's only line in
          this chapter — is it his?" · "The text says June, the model says Marius" (kept).
DECIDED 2026-09-29 — "yes go", on the user's "what does named in text mean and 3 Marius lines
        in a row, these things are not being helpful in determining who spoke what and if it is
        correct, please explain better what you are doing and why". The two changes as offered:
        1 "Show the evidence instead of a category. For a named line, show the words themselves,
          e.g. `said Marius`, so you can check it at a glance. For the AI's lines: 'AI, from the
          story around it'."
        2 "Say the flag in terms of the conversation, e.g. 'Marius speaks 3 times with no reply —
          is one of these the other person's?', with 'Show the lines around' beside it so you can
          read the exchange."
        Carried through for one vocabulary: "model" becomes "AI" in the Check reasons, and the
        grid's Anchored / Guessed columns take the same words as the chapter's Decided by.
DECIDED 2026-09-29 — "2 no  the ai change wording just leave it, go code the app". The
        offered rename to "AI Model" is NOT made: "AI, from the story around it" and the other
        labels stay as in the mock v30. GO for the app build of Slice 3, per §8.24.
BUILT:  2026-09-29, pieces 3a · 3b · 3c per §8.24 — committed and pushed the same day
        ("commit and push"), in the commit that carries this line.
        3a — `extraction/segmentation.py` reads a straight quote left open as speech to the
        paragraph's end (the straightened Speckled Band now finds all 247 lines, identical to
        the curly text; every sample file's split unchanged) · `anchors.Anchor.words` +
        `AttributionRow.anchor_words` · `_persist_attribution` writes `analyzed_at`,
        `analyzed_cast` and per line `paragraph_idx`, `anchor_words`, `llm_speaker`,
        `prev_persona_id` · new `extraction/flags.py` (`flag_groups`, `lines_from_rows`,
        `spoken_block`) · `GET /v1/projects/{id}/script`, `GET /v1/scenes/{id}/script` ·
        block PATCH `no_fix`, `fix_id`, explicit null clears speaker/source/confidence ·
        `DELETE /v1/projects/{id}/corrections/{fix_id}` · Discover's model call in a worker
        thread · the eval prints flags. Tests: `test_segmentation.py`, `test_script_flags.py`
        (hand-made runs + the three answer keys), `test_script_api.py`.
        3b — `components/StudioScript.vue` (grid, chips, select-all on what's shown, run row,
        route select, the two blocked states) · `services/chapterRun.js` (Discover and
        Analyze share it) · Overview's Script row + two tags and Home's "need a speaker" open
        the grid on To check · render-stopped modal "Fix in Script ➜" · one "analyzed" rule
        (`attribution.chapterAnalyzed` / `speakersFromImport`; `hasSpeakerInfo` deleted).
        3c — measured first (§8.24 table: 78-line chapter opens in 183–326 ms, 60 fps scroll →
        no virtualization) · `components/StudioScriptChapter.vue` · `views/scriptReview.js` +
        test · the old Script table, its step-bar controls and label guide deleted from
        StudioView; Rewrite stays a right-click on a line's text.
        Checked: ruff + pytest, `npm run test:unit`, the renderer gate on the real data dir,
        Analyze of Brass Rank + The Keystone through the real app's grid (86 s, rows filled
        in, Keystone re-cut 25 → 50 lines), set speaker → Undo on a real line (fixes 0 → 1 → 0).
DECIDED 2026-09-29 — "your rec on all the wording". The rec was to keep the built copy, so
        all four stand as shipped in 86eb21d:
          · the Narrator check's question: "Spoken, but given to the Narrator — whose line is it?"
            (the check itself was DROPPED later the same day — "Any cast member can be the narrator")
          · "AI named no one in the cast" / "The AI didn't name anyone in the cast." for a line
            the model answered with someone not in the cast (the approved "AI gave no answer"
            would have been false there)
          · "is it theirs?" / "are theirs" / "Put them back in the cast" — personas carry no
            pronouns, so the mock's "his" can't be known
          · "later in the same paragraph" for a line whose tag comes after it
OPEN:   Not measured: a chapter of several hundred lines on the chapter page.
DECIDED 2026-09-29 — "your rec go" (then "go all three"): the rec was to move the model call
        off the event loop in all three blocking endpoints, not only analyze-text.
BUILT:  2026-09-29 — `asyncio.to_thread` around the pipeline in `POST /v1/extraction/analyze-text`,
        `POST /v1/scenes/{id}/analyze` and `POST /v1/extraction/discover-speakers`
        (`extraction_api.py`); docs/whats-new.md, docs/dev/code-map.md. Committed and pushed
        the same day ("commit and push"). Live check on the real app: 109 health polls during
        a 58 s analyze-text call, none failed, median 3 ms.
        The prompt rule: result in §8.25; not promoted.
GO:     given 2026-09-28 for the record + the mock; 2026-09-29 for the measurements, the drop,
        the flag measurement, the plan, the second review's mock + plan changes, the
        prompt-rule measurement, the third book and the chapter's rows | needed for app code,
        the prompt change, the six items

### FINDING — a persona's pace, pitch and gain can't be edited anywhere in the app
STATE:  FINDING — code-verified 2026-09-30 (found by the mock-vs-app comparison). The persona
        editor's "+ Edit" beside the delivery chips only toasts "Edit delivery in Generate · Tune
        Speed / Pitch / Pause-after on the Generate tab, then save as the persona default"
        (`PersonasView.vue:436-441`); Generate has no save-to-persona path (`default_delivery`
        appears in `src/` only in PersonasView's display and `components/VoiceParamsModal.vue`,
        which nothing imports — orphaned, apparently by the speakers split). Yet Cast says "Pace,
        pitch, gain, delivery, effects — all of it lives there." (`StudioCast.vue:599`).
WHY:    the persona layer (§8.3, §8.22 — the tuning that survives a recast) has no editor; Slice
        4's per-line override would sit on top of it.
DECIDED: 2026-10-03, the order — "we need to do the persona first that is before slice 4, why do
        you keep forgeting this?" Personas come before Slice 4 (D8 answered). Until then this
        was recorded only as an open question, so every session read "next is Slice 4".
DECIDED: 2026-10-03, the scope — "whole redesign per mock" (the index `_s9` and the persona
        editor `workbench` / `_s7`, carrying "Voice gender in every voice dropdown, and speaker
        pronouns").
DECIDED: 2026-10-03, follow the mock — "we did the mock on purpos and you are ignoring it" (after
        "…so where do you pick engine or model, i dont think you thougth this through"). Read as:
        the kind radios, then a voice that names its model; the model is set where the voice is
        made, not on the persona (doc §5.2). The review's persona Model card and its Q1, Q2, Q12
        are withdrawn (§5.3).
DECIDED: 2026-10-03, Built-in stays one radio; the need is a direction filter — "The mock's
        Built-in radio already covers Qwen3 CustomVoice's speakers, what we need is a way to
        determine if user can direct voice either wither words or like chatterbox with specific
        works, so built in means kokoro which you cant do anything with but also qwen3 custom
        which takes directions, so some way for the user to filter out what types of voices they
        want to use". The proposal for it is doc §5.5 (not decided).
DECIDED: 2026-10-03, the build — "your rec on all save the plan and go code". Every question in
        doc §5.6 and the three answers after it (tags, language, everything-on-the-persona +
        presets) took its recommendation; the questions as presented, with the user's own words,
        are doc §6.2, and the design is §6.1 — read both before coding a slice. Language: "the
        language the persona is in our cause the voice … we need to let user know this persona is
        speaking japanese or engilish". Everything on the persona: "everthing should be able to to
        done on persona with slice 4 as override". Presets: removed with this work (already ruled
        2026-09-27, "2 presets die"). §6.2 also lists eleven calls the plan made that no question
        named — surfaced for the user to overrule.
OPEN:   the build, slices P1–P9 (doc §6.3): P1 a voice knows its model · P2 render presets
        removed everywhere · P3 the persona's data and the one resolver · P4 the editor page ·
        P5 the index · P6 Voices + gender · P7 Cast + the book's language · P8 the Turbo tag
        check · P9 speaker pronouns (asks before its data reset). Blast radius: doc §6.4.
        Not in it: Slice 4's per-line overrides, persona-by-scene, Generate's fate, gap 5.
BUILT:  P1 (2026-10-03) — a voice knows its model: `server/justvoice/voice_model.py` (the one
        answer: model, its name, directed_by words/tags/sliders, the languages it speaks);
        `VoiceRecord.model`, set by clone/design/import/blend/preview-save; `POST
        /v1/voices/{id}/copy` (Copy to another model — Turbo/Nano >5 s clip, Qwen3 Base needs
        the words or Skip the words); renders, auditions and Generate load the voice's model
        (size from AI Settings); tags/emotion tags follow the voice's model; the scheduler
        groups by model, so a mixed cast renders model by model (the mixed-Qwen3 refusal and
        `qwen_family_*` are gone); Import's picker lists models. Plan §6.2 call 4 amended (a
        missing model is fetched on load, as before). Tests: test_voice_model.py (13) + rewrites;
        test_cpu_placement made hermetic (a full suite run downloaded 2.3 GB of real models when
        an earlier test's app state lingered — pre-existing). Gates: ruff, server 1003 passed,
        vitest 122, biome, vite build, smoke 15/15 on the real data dir.
BUILT:  P2 (2026-10-03) — render presets removed everywhere: the table model, `/v1/presets`,
        `/v1/llm/preset-suggest` and its LLM feature (catalog, seed prompt, preset ref, Lab
        sample, Lab fill), the built-in seed and reseed, the two render_presets migrations
        and `generations.preset_id`, the preset tier of the delivery merge, Generate, the
        chapter render and the mastering target, the Presets page + route + rail entry,
        Render's preset column + 💡 Suggest, Render Lab's "Save as preset", the scripts'
        PRESETS entries, `parse_chain`/`resolve_chain` (→ `chain_entries`), the user docs'
        page and every mention (history lines kept). The user's DB keeps its
        render_presets table and the suggest prompt row until the next reset (no
        migrations). Gates: ruff, server suite, vitest 122, biome, vite build, smoke 14/14.
GO:     given 2026-10-03 for P1–P8 and P9's checks; P9's data reset asks first

### FINDING — language never reaches Chatterbox or Qwen3: every render on them is told English
STATE:  FINDING — code-verified 2026-10-01 (found by the persona review). Added to this list at
        the user's word: "add your persona bugs to list to be fixed". Chapter renders build each
        line with no language (`render_chapter_api.py:256-266`) and pass `language=line.language`
        (`:442`, `:514`, `:607`); Generate sends none (`GenerateView.vue:482-488`; it only shows
        the voice's at `:778`). The engines then default: Chatterbox `req.language or "en"`
        (`chatterbox/engine.py:274`), Qwen3 the same (`qwen3/engine.py:361-362`). So a German
        clone on Chatterbox Multilingual, or Sohee / Ono Anna on Qwen3, is told English, and the
        persona's own Language field (`models.py:604`) is never read at render. Kokoro is
        unaffected — it falls back to its voice's language (`kokoro/engine.py:220`).
WHY:    two of our three cloning engines are multilingual, and neither gets the language.
OPEN:   which wins — the persona's language, the voice's, or the book's — then send it from
        both doors (the chapter resolver and Generate).
GO:     needed

### FINDING — a persona's seed is ignored when a chapter renders
STATE:  FINDING — code-verified 2026-10-01 (found by the persona review); added at the user's
        word, as above. A seed saved in the persona's delivery stays inside `delivery`; the
        chapter resolver never sets the line's own seed (`render_chapter_api.py:256-266`) and
        renders pass `seed=line.seed` (`:444`, `:516`, `:609`), which is empty. The engines read
        only that one (`chatterbox/engine.py:285`, `qwen3/engine.py:371`, `luxtts/engine.py:90`),
        so every chapter render samples at random. Generate resolves the delivery's seed on its
        managed-engine path (`generate_api.py:324`) but not on its in-process one (`:440`).
WHY:    a seed is how a sampled voice (Chatterbox, Qwen3) is made to repeat itself.
OPEN:   resolve the delivery's seed into the line's seed in the chapter resolver, and on
        Generate's in-process path, the way `generate_api.py:324` already does.
GO:     needed

### FINDING — the persona's "Engine override" is read by nothing
STATE:  FINDING — code-verified 2026-10-01 (found by the persona review); added at the user's
        word, as above. The Personas editor offers it (`PersonasView.vue:620-624`) and it is
        stored (`database/models.py:123`), but no render path reads it — `engine_override` has no
        hit in `render_core.py`, `generate_api.py`, `delivery_merge.py`, `synth_scheduler.py`,
        `render_jobs.py` or the exports. Cast does read it, as the persona's engine label
        (`StudioCast.vue:67`), so setting it makes Cast show an engine the audio never uses.
        Redesign doc §10.4 already flagged it: "a persona reaching past its instrument".
WHY:    a control that changes nothing, and mislabels Cast when set.
OPEN:   remove it everywhere (editor, Cast's label, API, export, column), or replace it with
        the model pin the persona review will propose.
GO:     needed

### FINDING — the lexicon previews still show IPA as if an engine spoke it
STATE:  FINDING — code-verified 2026-10-01 (surfaced by the audio.cpp switch). Since the switch no
        engine takes phonemes (`phoneme_override` False on every manifest), so the render uses an
        entry's respelling and an IPA-only entry does nothing (`render_core._apply_lexicons`). The
        previews (`services/lexiconPreview.js`, used by GenerateView and LexiconsView) still count
        and display IPA entries as applied. docs/lexicons.md now says so in words.
WHY:    a preview that promises a pronunciation the audio won't have.
OPEN:   which engine a preview assumes — GenerateView knows the picked voice's engine;
        LexiconsView has none (a lexicon is engine-free) · until IPA returns (switch plan §5.3),
        mark IPA-only entries "not spoken yet"?
GO:     needed

### FINDING — Settings → Capture's fields are kept in the browser and never reach the server
STATE:  FINDING — code-verified 2026-10-01 (surfaced while replacing its dead Whisper picker).
        Refinement mode, capture language and auto-paste live in `localStorage`
        (`SettingsView.vue`, `CAPTURE_KEY`) — the comment says "Persisted via PATCH /v1/settings
        when wired; for now uses localStorage". The server's `settings.captures` (language,
        stt_model, refinement flags) is what dictation reads. The switch removed the picker that
        offered faster-whisper sizes the server never used; the rest predates it.
WHY:    controls that look like settings and change nothing.
OPEN:   wire them to `settings.captures` via PATCH, or remove them.
GO:     needed

### Voice gender in every voice dropdown, and speaker pronouns — with the Personas redesign
STATE:  DECIDED 2026-09-30 as a to-do — "add that as todo possbile wehn we do the redesign of
        persona per mock". The answers as presented, verbatim: `docs/plans/2026-09-30-voice-gender-
        and-pronouns.md`. In short: one shared voice-gender service (today only VoicesView has
        it); every voice dropdown's label shows it ("Bella · Female · Kokoro", "?" when unknown);
        Cast's persona card uses the same answer; a gender filter on the Personas voice dropdown
        only. Speakers get Pronouns (he / she / they / blank), filled from JustWrite's sheet and
        Discover, fed to the attribution prompt's empty pronouns slot; personas get no field.
WHY:    a voice's gender is only visible on the Voices page; the attribution prompt has a
        pronouns slot that is always empty (`_resolve_cast` sends None).
NOT:    a male/female "sex" dropdown on speakers; a gender field on personas.
BUILT:  nothing. OPEN: the two checks in the doc's §2, then a plan — when the Personas page is
        redesigned per the mock.
GO:     needed

### Slice 3's leftovers — edit, split and merge lines; speech marks; dialogue tags; the old Chapters page; one narrator rule
STATE:  DECIDED 2026-09-30 — "finish slice 3 and related items", then "go" on the plan as
        presented. The plan, verbatim, with its blast-radius table: `docs/plans/2026-09-30-script-
        leftovers.md` §1 — READ IT before building any part. In short: A re-analyzing an edited
        chapter keeps its lines · B3 Speech marks (Auto · Double · Single · Guillemets · German)
        · B2+B1 "✎ Edit…" (Save · Split at the cursor · Cancel) and "⇲ Merge" in the ticked-lines
        bar · B4 "Leave out dialogue tags" (off by default) · B6 one narrator rule (the role
        only; custom imports adopt a "Narrator") · the long-chapter measurement on The Speckled
        Band. B5 DROPPED the same day ("go", §1 "Changed"): the old Chapters page is deleted in
        Slice 4 instead — recorded on the Slice 4 lines of "Build the mock's Studio".
WHY:    B1–B6 were left out of Slice 3 (§8.23); the checks found an edit quietly strips every
        "said X" anchor from the next Analyze, and two dead buttons on the old Chapters page.
NOT:    Reorder of lines. Speech after a dash. Undo for split/merge. "Read by you" (parked).
        Any change to the old Chapters page in this build — B5 dropped; it goes in Slice 4.
BUILT:  2026-09-30, JV `e323997` — what, where and the checks: the plan doc §2. Server suite
        914 passed; unit 115; gate clean; live pass on the real app (one window): The Speckled
        Band as one chapter = 361 lines, opens in 102-105 ms, scrolls at 16.7 ms/frame — no
        virtualization needed.
DECIDED 2026-09-30 — "your rec on all", then "go", on the choices the plan didn't name (verbatim:
        plan doc §3): keep Auto's first-mark rule, the wording and the split's copied marks; add a
        hint under Speech marks and the edited-chapter caveat to "no dialogue found"; an IDEAS
        entry for "Cut again from the text"; push once those land.
GO:     given 2026-09-30 for all of §1 and §3, the push included

### Discover: remove one Ignored name or one cast member with ✕, and "Clear all" on both
STATE:  DECIDED 2026-09-29, for next — "add to task for next, on app discover for ignore and
        alrady in cast tags should have x to click to remove individualt tags from that section
        both sectons should have clear all button instead of restore".
        · Ignored: each name gets an ✕ that takes it off the list (the job Restore does today);
          a "Clear all" button empties the list. Restore goes.
        · Already in the cast: each name gets an ✕ that removes that persona from this
          project's cast; a "Clear all" button removes every one.
WHY:    One click on the thing itself, where today Ignored needs a separate Restore button per
        name and the cast can only be edited on the Cast step.
NOT:    A Restore button beside each ignored name.
BUILT:  2026-09-29 — `StudioDiscover.vue`: kit `UiTag removable` on each ignored name
        (`unignore([n])`) and each cast member (`uncast([c])`, DELETE per persona, no confirm);
        "Clear all" on Ignored (unignore every name) and on the cast (everyone but the Narrator);
        Restore deleted. docs/studio.md Discover section.
DECIDED 2026-09-29 — "1 no clear all does not remove narraotor, 2 no … go code the app":
        · "Clear all" in the cast removes every persona EXCEPT the Narrator.
        · Neither ✕ nor "Clear all" asks for confirmation (removing from the cast asks today —
          on Discover it won't).
DECIDED 2026-09-29 — "narrator keeps its x": the Narrator's tag keeps its ✕, as built
        ("each name gets an ✕"); only "Clear all" spares it.
CHECKED 2026-09-29 on a test project (deleted after): each ✕ and both Clear alls work on page and
        server, no dialog, Clear all keeps the Narrator, removed personas stay in the library.
DECIDED 2026-09-29 — "do it all your rec go": the header spacer before "Clear all" goes — the
        card title already takes the free space, so the spacer split it and put the count
        mid-header. BUILT 2026-09-29 (`StudioDiscover.vue`, both headers); on screen the count
        now sits beside "Clear all", as in the other cards.
GO:     given 2026-09-29 ("go code the app", in the message that answered its two questions)

### No built-in personas — the Narrator is an ordinary persona, one per project
SUPERSEDED by "Speakers and personas become two things" (below, 2026-09-29, fd593f8): the narrator is now a SPEAKER with the narrator role, and a
        persona is a voice — nothing about the narrator lives on a persona any more. What
        still holds: no built-in personas; deleting one needs no guard.
STATE:  DECIDED 2026-09-29 — "your rec", on the two questions after the user hit "Delete failed:
        400 Bad Request: persona … is built-in" on the Personas page ("there should be no built in
        personas as far as i know, unluess we have 1 narrator built in, even importing a book
        should not consider the persona built in"). The recs, as given:
        · Option 1, no built-in personas: "The Narrator becomes an ordinary persona you can
          delete like any other. The flag is removed everywhere: the database column, the delete
          guard, the three places that set it, the hidden ✕ in Studio, `test_builtin_narrator.py`
          and the docs. A new project still gets a Narrator, and Cast keeps '+ Add Narrator'.
          Deleting the Narrator leaves the project's narration lines with no speaker. The render
          then stops on them, as it does for any unassigned line, and 'Assign → Narrator' fixes
          it after '+ Add Narrator'."
        · One Narrator per project (as today), not one shared across all projects — "each book
          usually has its own narrator voice".
WHY:    The flag protected only the Narrator, surprised the user, and the Personas page offered a
        Delete it could never honour.
NOT:    Option 2 — keep the Narrator protected and hide its Delete on the Personas page.
        One app-wide Narrator shared by every project.
BUILT:  2026-09-29 ("your rec on all go") — the flag is gone from the API model, persona
        storage, the delete guard, the three setters (`projects_api.py` create/import and
        "Add Narrator", `database/session.py` startup fill-in) and Studio's hidden ✕;
        `test_builtin_narrator.py` → `test_project_narrator.py` (the Narrator deletes, leaves the
        cast, comes back via "Add Narrator"); docs/personas.md, whats-new, code-map.
DECIDED 2026-09-29 — "your rec go on both", on the two gaps the first build surfaced:
        · The column: "a one-time drop, so you keep your data" (the live DB has
          `personas.is_builtin NOT NULL` with no default, so every insert fails while it stays —
          a reset or a drop). An exception to the no-migrations rule, by this word.
        · The startup fill-in: "remove the fill-in, so deleting sticks and 'Add Narrator' is the
          only way back".
BUILT:  2026-09-29 — `database/migrations.py` `_migrate_drop_personas_is_builtin` (DROP COLUMN;
        replaces the add-column migration; delete it once no DB carries the column) · the model
        column gone (`database/models.py`) · `_backfill_narrator_personas` and its boot call gone
        (`database/session.py`) · tests: the drop on an old-shape DB, a deleted Narrator stays
        deleted across a restart · run first on a copy of the live DB (column gone, rows kept,
        an insert without it works), then on the live DB at the app's restart. Committed and
        pushed the same day ("commit anbd push").
GO:     given 2026-09-29

### Any cast member can be the narrator
SUPERSEDED in part by "Speakers and personas become two things" (below, 2026-09-29, fd593f8): still one narrator per book and still the
        Narrator tick on each card, but the tick is on a SPEAKER's card and
        `PUT /v1/projects/{id}/narrator` takes `speaker_id`; narration moves between speakers.
STATE:  DECIDED 2026-09-29 — "do it all your rec go", on the user's "i think any persona should
        be able to be set as the narrator, what do you think?" and the rec as given:
        · "A 'Narrator: [persona ▾]' picker on Studio's Cast step (the Narrator card), listing
          everyone in the cast."
        · "One narrator per project. Choosing a new one takes the role off the old one. The old
          persona stays in the cast as an ordinary member."
        · "Narration follows the role. Lines Analyze decided are narration move to the new
          narrator. Lines you set yourself stay as they are."
        · "New projects still start with a persona called 'Narrator', which you can then replace
          with anyone."
WHY:    A first-person narrator (Watson in The Speckled Band) narrates and speaks: one persona,
        one voice. Until now only a persona named "Narrator" or "Add Narrator" could hold it.
NOT:    Narration staying on the old narrator until the next Analyze.
BUILT:  2026-09-29 — `PUT /v1/projects/{id}/narrator` (`projects_api.set_narrator`: role moves,
        `source == "narration"` lines of the old narrator or of nobody move, `corrected` stay,
        returns `moved_lines`); "Add Narrator" (`ensure_narrator`) checks the role before the
        name, so it never makes a second narrator; Studio Cast's `UiField` "Narrator" picker +
        the narrator card's letter from its name (`StudioView.vue`); tests in
        `test_project_narrator.py`; docs personas.md, studio.md (Cast), whats-new, code-map.
        Checked on a throwaway podcast demo (deleted after): picking Sarah moved the role, the
        old Narrator stayed cast without it, card + toast followed.
DECIDED 2026-09-29 — "your rec on both go", on the interaction the picker raised (Script's
        "Spoken, but given to the Narrator" marked every line of a narrator who speaks): "limit
        that check to a narrator persona that isn't also a speaking character".
BUILT:  2026-09-29 — `extraction_api._chapter_script`: the check runs while the narrator is
        the persona called "Narrator" (the name the app already uses for the generic narrator:
        the lookup's fallback, Discover's parser, import); any other narrator is a character
        and counts like anyone for every check. Tests in `test_script_api.py`; studio.md marks.
        A renamed Narrator ("Main Narrator") therefore loses this one check.
DECIDED 2026-09-29 — "your rec go on both", after the user's "i dont understand this narrator
        stuff, it sounds likke it is complicated, why dont we just have a check box on the
        persona that says this is the narrator, and only 1 narrator can be selected". The recs:
        1 "Replace the dropdown with a 'Narrator' checkbox on each cast card, one narrator per
          project." (On the cast card, not the Personas page — a persona is in many projects.)
        2 "Drop the 'given to the Narrator' check and its name rule." It caught nothing on The
          Speckled Band (0 caught, 0 false alarms). The narrator is then an ordinary persona in
          every check: three in a row and a persona's only line count it like anyone.
        This REPLACES the picker dropdown and the name rule built earlier the same day.
BUILT:  2026-09-29 — Studio Cast: a `UiCheckbox` "Narrator" on every card (the narrator's own
        ticked and locked; ticking another calls `PUT /v1/projects/{id}/narrator`); the dropdown
        gone. `flags.py`: the "narrator" check and `narrator_id` gone — the narrator counts like
        any persona (its one spoken line is an only line, three in a row a run); the name rule
        gone from `_chapter_script`; `ScriptFlag.check` loses "narrator"; the eval call; the
        Check question and both "what the columns mean" cards; tests; studio.md, personas.md,
        whats-new, code-map.
GO:     given 2026-09-29

### Download cancel: remove the partial files before the job says "cancelled"
STATE:  DECIDED 2026-09-29 — "do it all your rec go". FINDING the same day: the flaky
        `test_prefetch_cancel_via_http_endpoint` (1 in 15 under load) is a real ordering bug —
        `installer.py` marks the job failed/"cancelled by user" and only then `rmtree`s the URL
        partials, so a watcher sees "cancelled" while the files remain, and a download started
        in that window could have its new files deleted. Rec: delete first, then mark.
BUILT:  2026-09-29 — `installer.py` prefetch cancel: wipe (URL) / log (HF), then mark failed.
        The test passed 20 of 20 after (no model running at the time; it had failed 1 in 15
        with the model busy). The other "cancelled by user" paths delete nothing after marking.
GO:     given 2026-09-29

### Discover missed Sherlock Holmes on The Speckled Band
STATE:  DECIDED 2026-09-29 — "do it all your rec go": look into why. FINDING the same day, on a
        test import: Discover proposed nine names and not Holmes, the story's main speaker, so
        Analyze left 143 of 361 lines with no speaker. It also proposed "Percy Armitage" and
        "Mr. Armitage" as two people. (Watson not proposed is expected: he narrates as "I".)
FINDING 2026-09-29 (live prompt through /v1/ai/run, writes nothing, 2 runs each):
        · With the cast = the project's persona named "Narrator" (description "The book's
          narrator: reads everything…"): Holmes 0/2, Watson 0/2 — reproduced.
        · Same prompt without "the narrator and" in "Leave out the narrator and every known
          character": Holmes 2/2, Watson 2/2.
        · Live prompt with an empty cast: Holmes 2/2, Watson 2/2.
        So the instruction to leave out "the narrator", with a cast member called Narrator,
        drops the first-person narrator (Watson) and Holmes with him.
DECIDED 2026-09-29 — "your rec on both go": drop "the narrator and", measured first.
BUILT:  2026-09-29 — measured `npm run eval:discover --runs 2`: live 28/28, all linked, 0
        wrong; candidate 28/28, all linked, 0 wrong, one stray label ("a Warden") in 1 of 8
        chapter runs. Then `identify.IDENTIFY_SYSTEM` changed, and the live row
        `speaker_attribution.identify` PUT to the same text (it equalled the old code text, so
        no edit of the user's was overwritten; template and JSON settings kept). Through the
        app's Lab discover path on The Speckled Band: Holmes + Watson found 2/2.
GO:     given 2026-09-29

### Discover: tick several proposed speakers and add (or ignore) them at once
STATE:  DECIDED 2026-09-29 — "go", on the user's "proposed speakers should have checkbox so we
        can select multiple at a time and then click add button normal select and select all
        checbox and add button" and the rec as given: "a checkbox on each row, a select-all box
        in the header that ticks only the rows shown, and an '＋ Add N selected' button under
        the table … also 'Ignore N selected', and keep each row's own Add and Ignore for
        one-off use".
BUILT:  2026-09-29 — `StudioDiscover.vue`: a pick column (`UiCheckbox`, header ticks all),
        "＋ Add N selected" = one promote call with every ticked row (`toCandidate`, shared with
        the row's Add), "Ignore N selected" = one ignore call; docs studio.md, whats-new. Not
        yet seen on screen (the live project had no proposals waiting).
GO:     given 2026-09-29

### The engine indicators live in the main header; Studio's two chips go
STATE:  DECIDED 2026-09-29 — "go", on the user's "in studio header we have TTS · none Script ·
        AI features we also have no voice engine in main header these ar eredundent, i think in
        main header we have indication of speech and llm engine loaded and click on it takes you
        to engines page like it does now" and the rec: "remove those two chips from Studio. The
        main header would then show two indicators, the speech engine and the language model,
        each opening its engines page as the voice one does now."
BUILT:  2026-09-29 — `App.vue`: a language-model pill beside the voice one (🔊 voice → Speech
        engines, 🧠 model → AI Settings), fed by `/v1/llm-runner/status` on the same refresh
        events plus every AI task start/end, no timer; Studio's project-bar chips and their
        `headerTts`/`headerLlm` gone (`StudioView.vue`); whats-new. Seen on screen by the user.
GO:     given 2026-09-29

### "Operational" in the main header is status, not a button
STATE:  DECIDED 2026-09-29 — "go", on the user's "the word operationail in header when you clcikc
        it opens ai tasks this is wrong it shouldnt be a click at all". Rec: plain text; AI
        Tasks stays in the sidebar.
BUILT:  2026-09-29 — `App.vue`: the status is a `span` (no click, no panel toggle),
        `styles.css` `.jv-topbar__status` loses its cursor and hover; generate.md.
GO:     given 2026-09-29

### Discover records everyone each chapter names, and keeps it
SUPERSEDED in part by "Speakers and personas become two things" (below, 2026-09-29, fd593f8): the record and its statuses stand, but they are
        worked out against the book's SPEAKERS; "In your library" means a persona with exactly
        that name (matched in code — the model is no longer sent the library) and Add makes a
        speaker already cast with it; the list is "Speakers found"; In-the-cast rows gained
        Remove from cast / Remove N selected (ask first).
STATE:  DECIDED 2026-09-29 — "your rec go", on the user's "when you scan it should shwo results
        consustantly each time, regardless of in cast or not … when i click scan and get nothing
        it seems broken … i think we should always keep data so if i sacn it shows characters per
        each chapter and it persetistsl". The rec as given:
        · "Per chapter, the scan saves everyone: people already in your cast, people in your
          library but not in this cast, and new names. It's saved with the chapter, so it
          survives switching steps, restarts and rescans."
        · "Cast members are found without the AI: by matching their names and 'also called'
          names in the chapter text … The AI keeps doing only what it was measured on: finding
          the new names."
        · "One list, each person once, with a status: In the cast (which persona) · In your
          library (Add links that persona) · New (Add, Ignore) · Ignored (Undo)."
        · "Add and Ignore change the status; they don't remove the row."
        · "Filter chips: All · New · In the cast · Ignored. The grid's column becomes 'Found'
          (everyone) with the number of new names beside it."
NOT:    Adding someone already in the cast as a separate new persona ("not them — add as new")
        — a possible later addition.
BUILT:  2026-09-29 — server: `names.cast_named_in` (full name / alias phrase, or a first or
        last name of 3+ letters, capitalised, owned by one cast member; one mention per place,
        not per word) · the discover endpoint saves and returns `named_cast`, keeps ignored
        names in `candidates`, and nothing prunes the record (`prune_discovered` deleted;
        ignore/unignore return `{ignored}` only). Renderer: `studioStatus.foundSpeakers`
        (replaces `proposedSpeakers`; status worked out now against the cast + ignore list;
        `isWaiting`) · `projectState` takes `ignored` · StudioDiscover: "Characters found" with a
        Status column, chips All · New · In the cast · Ignored (New = new names AND library
        personas — both still wait on Add), Add/Ignore on waiting rows, Undo on Ignored rows,
        ticks only on waiting rows, grid column "Found" (N + "M new"), `pruneLocally` and the
        `scans` emit gone · Studio passes aliases and the ignore list, and carries `named_cast`
        from a finished scan. Tests: test_discover_speakers.py (30), studioStatus.test.js (15).
        Checked on the real app with a throwaway import (deleted after): a scan of Bigger Inside
        found 6 (5 In the cast by name, Old Sedge In your library), Ignore kept the row as
        Ignored across a reload, Undo put it back, the chips and Overview's "1 to review" moved,
        a step switch kept the list. Docs studio.md, projects.md, whats-new, code-map.
GO:     given 2026-09-29

### No automatic narrator; persona names are unique within a book
SUPERSEDED in part by "Speakers and personas become two things" (below, 2026-09-29, fd593f8): still no automatic narrator; names are unique
        within a book for SPEAKERS, and personas have no name rule at all. + Add Narrator now
        makes (or adopts) a speaker called Narrator, cast with a persona of exactly that name
        if the library has one — it no longer looks for a free library Narrator.
STATE:  DECIDED 2026-09-29 — "go", on the user's "duplicate narrator in persona, we should not
        allow duplicate names", "maybe we can have duplicate names but not per project per project
        only unique names, what do you think? and if no project? what do you think?" and "i dont
        think each project should automatically create a narrator". The recs as given:
        1 No automatic narrator
        · "Neither import nor New book creates a narrator persona any more."
        · "One case stays: if the book itself has a character called 'Narrator', that character
          is marked as the narrator. Nothing new is created."
        · "You choose the narrator in Cast, either by ticking Narrator on any cast member or with
          + Add Narrator."
        · "+ Add Narrator first uses a 'Narrator' from your library that isn't in any book. It
          only makes a new one if there isn't one free."
        · "Choosing a narrator moves the book's narration lines to it. That's already built."
        · "Not checked yet: whether Analyze runs cleanly on a book with no narrator. Its
          narration lines would just be left without a speaker. I'll check that first, and if it
          doesn't work, fixing it becomes part of this change."
        2 Names are unique within a book
        · "Adding someone to a cast is refused if the book already has someone with that name.
          That covers Cast's add, Discover's Add and the narrator. Case and extra spaces don't
          count."
        · "Renaming a persona is refused if any book it's in already has someone with the new
          name."
        · "An import keeps the book's characters exactly as they are. It never refuses them."
        · "A persona that's in no book has no rule."
        · "The Personas page already asks the server which books each persona is in
          (/v1/personas/usage). I'll make sure the book names show, so two personas with the
          same name can be told apart."
        4 "Deleting a book keeps its personas."
        5 "Your two leftover Narrators stay until you delete them. The Ninth Facet keeps its
          narrator."
        6 "The out-of-date comment in _ensure_narrator gets fixed."
        Order: Discover first, then this; only the test files these changes touch.
        This REVERSES "A new project still gets a Narrator" (No built-in personas, above) and
        "New projects still start with a persona called 'Narrator'" (Any cast member can be the
        narrator, above).
FINDING 2026-09-29 (live app): three personas named Narrator — `11359b0b` made 8 ms after The
        Ninth Facet's import (its narrator), `e08979c7` (09-28 17:51) and `46aec889` (09-29 16:33)
        in no cast, left by earlier imports whose books were deleted. `_ensure_narrator` made a
        new one on every import (it checked only the importing book); characters did not
        duplicate, because `ensure_project_persona` reuses them by the book's character id; and
        `delete_project` keeps a book's personas.
NOT:    Names unique across the whole library (the first rec, replaced by per book). Deleting a
        book offering to delete the personas only it used.
BUILT:  2026-09-29 — 1: `create_project` makes no narrator; import calls `_adopt_book_narrator`
        (role to a book character called Narrator, never a new persona); `POST /narrator` links a
        library "Narrator" in no cast (oldest first) before creating one, and moves the unowned
        narration (`move_narration`, shared with the PUT; returns `moved_lines`); Studio's Add
        Narrator card copy + toast. Checked first: Analyze on a book with no narrator runs and
        leaves narration with no speaker (`persona_for` → None) — now a test. 2:
        `_persona_helpers.same_name` / `cast_member_named` / `refuse_same_name` (409) in
        `POST /cast`, Discover's promote (library link + `ensure_project_persona(unique_in_cast=
        True)`) and `PUT /v1/personas/{id}` on a name change; import paths unchecked. Personas
        page "Used in" = book names. 6: the stale docstring went with the function. Tests:
        test_project_narrator.py, test_narrator_on_import.py, new test_unique_names_in_a_book.py,
        fixtures in test_analyze_persist / test_script_api / test_cast_names (they relied on the
        automatic narrator). Checked on the real app with the throwaway import: no narrator after
        import, Add Narrator made one (yours is in a book, so not free), adding your real
        Narrator to that cast → 409. Docs personas.md (The Narrator, Names), studio.md,
        projects.md, whats-new, code-map.
FINDING 2026-09-29, at the live check: the two leftover Narrators (`e08979c7`, `46aec889`) were
        no longer in the library (13 → 11 personas). Nothing this session ran deletes a persona;
        the server log records only failed requests, so it cannot say who did. Asked the user.
GO:     given 2026-09-29

### Personas: tick several and delete them at once
SUPERSEDED in part by "Speakers and personas become two things" (below, 2026-09-29, fd593f8): the ticks and Delete N selected stand, but a
        deleted persona now leaves the speakers it played with no persona — their lines keep
        their speaker — and the confirmation names those speakers.
STATE:  DECIDED 2026-09-29 — "go", on the user's "checkbox for persona so we can delete multople
        at a time". The rec as given:
        · "A checkbox on each persona, a select-all box, and a Delete (N) button."
        · "One confirmation lists the names and says which ones are in a book's cast."
        · "Each is deleted the same way a single Delete works now: it leaves the cast, and its
          lines lose their speaker."
BUILT:  2026-09-29 — `PersonasView.vue`: a pick column (`UiCheckbox`, header ticks every persona
        the filter shows; a tick doesn't open the editor), "Delete N selected" under the table
        (Discover's bulk-row precedent), one `confirmDialog` naming them with their books and
        counting those in a cast, then one DELETE each (no server change; no Undo, unlike the
        single Delete). Checked on the real app: ticked two throwaway personas and the test
        book's Narrator, the confirmation read "Narrator (in ZZ test — delete me), ZZ Delete Test
        A, ZZ Delete Test B. One is in a book's cast …", exactly those three went. Docs
        personas.md, whats-new.
GO:     given 2026-09-29

### Script: "Next to check" wraps around, and always reaches a lone line to check
STATE:  DECIDED 2026-09-29 — "go", on the user's report (two screenshots): a chapter with "To
        check 1", and "Next to check" answered "Nothing more to check below." FINDING:
        `scriptReview.nextToCheck` searched only AFTER the selected line, so a lone line to
        check that is the selected one, or above it, was never reached. The rec as given:
        · "Next to check wraps around. After the last line to check, it goes back to the first
          one from the top. Previous (Shift+N) wraps to the bottom."
        · "With only one line to check, it always scrolls to that line and selects it, even if
          it's already selected."
        · "When it wraps and there's more than one line to check, a short note says 'Back to
          the first line to check'."
        · "'Nothing to check' appears only when the chapter has none. The button is already
          disabled in that case."
BUILT:  2026-09-29 — `scriptReview.nextToCheck` wraps (modulo walk from the selected line; null
        only when no line needs checking); `StudioScriptChapter.nextCheck` selects and scrolls to
        it even when already selected, notes "Back to the first/last line to check" on a wrap
        when there is more than one, and says "Nothing to check in this chapter." otherwise.
        Tests: scriptReview.test.js (21 — wrap both ways, a lone line from above/below/itself,
        none). By the time of the check the user had fixed that line (every chapter 0 to
        check), so it was checked on Bigger Inside with one line's speaker blanked in the
        headless browser's copy only (nothing saved): from the last row Next jumped to it in
        view with no note, again after scrolling away, and Shift+N; with two, a wrap showed
        "Back to the first line to check". Gate 16/16. Docs studio.md, whats-new.
GO:     given 2026-09-29

### Speakers and personas become two things: Cast gives each speaker a persona
STATE:  DECIDED 2026-09-29 — "option a, go ahead and plan and code it". The user, on the Cast
        step: "a voice is all tied to a persona you set voice pitch engine in persona … a persona
        is the actual spoken voice adjusted with pitch speed and other settings", "i think
        persona is the single point for an actual spoken voice that is then assigned to cast",
        and "the mock already has it correct, persona on right, cast on left assign cast a
        persona". The model as given (Fable's, restated and agreed):
        · "Persona: a finished spoken voice. It's a voice and its engine, plus speed, pitch,
          gain, direction and effects. It lives in your library and can be reused anywhere."
        · "Speaker: a person in one book, with a name, aliases and who they are. Discover finds
          speakers, and Script gives lines to them."
        · "Cast: gives each speaker a persona. One persona can play many speakers, so change it
          once and all of them change. This is exactly the mock: speakers on the left, personas
          on the right." — the mock's Cast needs no redraw.
        What the build changes, as given:
        · "Lines, the cast link and the remembered speaker fixes point at a speaker, and the
          speaker points at its persona."
        · "Generations, lexicons, channels and training jobs stay on the persona."
        · "Your data gets reset."
        · "The per-book unique-name rule moves to speakers, and the narrator becomes a speaker
          cast like anyone."
        · Option A: "who she is" moves to the speaker, and the persona keeps a short note on how
          it sounds; "Compose and Rewrite on the Generate page have no book, so they would read
          the persona's note instead of the character sheet."
        · "When a Discover name exactly matches a persona in your library, the speaker arrives
          already cast with it … Cast would show that assignment so you can change it."
        Also said by Fable, NOT part of this go (offered as additions): tick several speakers →
        one persona; audition a persona on the speaker's own line; Smart-assign suggests instead
        of applying; "New persona…" from Cast; a speaker with no lines doesn't count as
        blocking; a table for a game's hundreds of NPCs.
DECIDED 2026-09-29, while planning (plan §5):
        · Auto-cast — "Every new speaker": a new speaker whose name exactly matches a persona in
          the library arrives cast with it — Discover's Add, a book import, + Add Narrator and
          Cast's ＋ Add alike.
        · Words — "speakers everythwere": the people in a book are SPEAKERS on every screen and
          in every doc, never "characters" — including game and podcast projects (no "NPCs",
          no "Hosts"). The new record is a speaker (`speakers` in code); a line's Speaker is one
          of the book's speakers; "Cast" is the step and the act of giving speakers personas.
          (Asked on the user's "we have characters found in discovery so either we call them
          characters or speakers but not both"; "Characters found" was a breach of §8.4 made
          earlier the same day.)
        · Removing — "yes ask first": removing a speaker (Discover's "Already in the cast" ✕ and
          Clear all, Cast's ✕) deletes it from the book and its lines go back to No speaker, so
          it asks first — "one confirmation that names who goes and how many lines each has,
          for example 'Remove Nettle? 22 lines will have no speaker.'"
        · Library — "your rec": "In your library" in Discover means an exact persona name,
          matched in code; the model is no longer sent the library, and that paragraph of the
          Discover prompt goes, measured before and after.
        · Commit — "your rec": commit today's work first, no push, so the split is its own
          change.
        · Discover's "In the cast" rows — "so add selected button and remove selected button,
          you rec go", on the user's "ones that are already in cast should have button remove
          from cast and note in cast already" and the rec as given: "The action cell says
          'already in the cast' in grey, with a Remove from cast button beside it. Remove asks
          first, as you ruled: 'Remove Cael Ferren from the cast? 21 lines will have no
          speaker.' After removal the row turns New and stays in the list, with ＋ Add to bring
          them back. The Already in the cast card at the bottom stays." Built as part of the
          split. Plus a bulk "Remove N selected": In-the-cast rows get a tick too, beside
          "＋ Add N selected" and "Ignore N selected"; one confirmation names who goes and each
          one's lines.
        · The selected speaker's card on Cast — "ok add also called there, continue with the
          split", on the rec as given: "Name: editable, so a rename happens here. Also called:
          the other names the text uses, separated by commas ('Sedge'). Who they are: the text
          box the mock already has. Edit their persona →: as in the mock, for the voice
          settings." Each speaker's card in the grid also shows "also called Sedge" under the
          name. The app says "Who they are" / "Edit their persona" (the mock's "she"/"her" —
          the app knows no one's gender). The mock's Cast gets the same field.
DECIDED 2026-09-29, after the build — "go on all three", on the recs as given:
        1. The hint under Who they are: "reword it to 'Read by Discover, Smart-assign and
           Rewrite in character. Never heard.' — it names the features that actually read
           it, the same way the persona note's hint does. The mock and the docs that quote
           the hint change with it."
        2. The Lab's "Characters" / "Known characters" boxes: "rename only the prompt
           placeholders: `{{characters}}` becomes `{{speakers}}`, `{{known_characters}}`
           becomes `{{known_speakers}}`, Smart-assign's `{{voices}}` becomes
           `{{personas}}`. Every word the model reads stays the same, including 'Known
           characters:' and 'Available voices:', so no prompt re-measure is needed. A test
           will check that each prompt sent to the model is byte-identical to before. The
           live prompt rows get updated only after checking they still match the code, as
           last time. The Lab boxes would then read 'Speakers', 'Known speakers' and
           'Personas'."
        3. Commit: "finish 1 and 2, then commit the whole split as one change, with
           explicit paths and no push. The full server suite waits, as you said."
PLAN:   docs/plans/2026-09-29-speakers-and-personas.md — READ IT before coding any part.
BUILT:  2026-09-29, JV `fd593f8` (pushed later that day). Server: `speakers` table + `api/speakers_api.py` +
        `api/_speaker_helpers.py` (replaces `_persona_helpers.py`); `ProjectPersona` and
        the `/cast` routes gone; blocks and corrections carry `speaker_id`; render, takes,
        voice-line export (manifest key `speaker`) and project export follow line →
        speaker → persona; persona `personality` → `note`, `aliases` dropped; imports and
        Discover's Add make speakers (exact persona name casts them); the Discover prompt's
        library paragraph removed (measured, plan §6). Renderer: new
        `components/StudioCast.vue` (the mock's Cast), StudioView's old Cast + voice
        library + tuner removed; Discover's In-the-cast rows get Remove from cast / Remove N
        selected (ask first); Script, Chapters, Home, Lines ("Speaker" column), Generate
        (note), Personas (Note, Used by, `?open=`), the Lab, Settings/App/cheatsheet words;
        `copy.js` per-kind cast words removed. Mock: Cast's Name / Also called, "speakers"
        on Lines and Overview (published v31). Live DB: backed up to
        `justvoice.db.bak-2026-09-29-before-speakers-split`, book + personas deleted, four
        tables recreated; the identify prompt row PUT and three prompt rows reset (each
        checked equal to the code first). Verified: targeted pytest (52 files) and vitest,
        ruff, biome, vite build, the renderer gate (14 views + 3 shell checks, 0 JS errors), a live walk of every
        new door on the real app, and headless screenshots of Cast, Discover and Personas.
        NOT run at the time: the full server suite (held by the user's word). It ran later
        the same day: 865 passed, then 880 after the engine-lifetime work.
        Then, on "go on all three": (1) the hint reads "Read by Discover, Smart-assign
        and Rewrite in character. Never heard." in the app, the mock (published v32) and
        studio.md; (2) the placeholders are `{{speakers}}`, `{{known_speakers}}` and
        Smart-assign's `{{personas}}` in the seeds, the pipeline, identify, smart-assign,
        the legacy prompt migrator, the Lab adapter and fills, the eval script, tests and
        docs — every rendered prompt proved byte-identical to before (scratch check) and
        pinned by `test_renamed_placeholders_keep_every_word_the_model_reads`; the four
        live prompt rows and four Lab sample rows were each checked equal to the code
        first, then switched (the identify sample's leftover `library` value went with
        it); (3) committed as one change (`fd593f8`), pushed once the user gave the word.
        Walkthrough fix (2026-09-29): the selected speaker's card lost text typed in the next
        field — a save reloaded the speakers and the card reset every field. It now resets only
        when a different speaker is selected, and a save updates only its own field.
GO:     given 2026-09-29

### ~~ACX mastering failed ACX~~ — FIXED 2026-09-29
STATE:  FIXED on "do what you can without my intervention … go" (the walkthrough). Every
        chapter mastered "acx" by this app came out out of spec: The Keystone measured −16.8
        LUFS, RMS −17.11, peak −0.47, and the app's own ACX QC said fail.
WHY:    `mastering._run_master` ran `dynaudnorm=g=15:p=0.95` AFTER `loudnorm`, so it
        renormalised toward a 0.95 (−0.45 dB) peak and undid the preset. Since the first commit.
BUILT:  `dynaudnorm` first, `loudnorm` last (same audio: −19.9 LUFS / −3.5 dBTP); live QC after:
        all four chapters ok. `tests/test_mastering_chain.py` runs the real chain (fails on the old
        order, passes on the new; skipped without ffmpeg). Docs mastering.md (chain order).
GO:     given 2026-09-29

### FINDING — the chapter you audition is paced differently from the one that ships
STATE:  FINDING 2026-09-29 (walkthrough). Studio's Render (`POST /v1/render_chapter`) joins lines
        with `BetweenLines.silence_ms = 250`; export and ACX QC (`render_scene_to_wav`) join them
        with a hardcoded `600`. The Keystone: 505 s auditioned, 522 s exported.
WHY:    Both are hardcoded, against the "no hardcoded operator-tunable values" invariant; and
        what you listen to is not what ships.
DECIDED 2026-09-29 — "your rec both go", on the rec as given: "one setting, Pause between
        lines, default 600 ms, used by Studio's Render, export and ACX QC alike. It would sit in
        Settings with the other render settings. A line's own pause from an import still
        overrides it. Effect: what you audition matches what ships. Export stays exactly as it
        is today; Studio's Render gets longer pauses."
BUILT:  2026-09-29 — `GenerationSettings.pause_between_lines_ms = 600`; `BetweenLines.silence_ms`
        is None by default (= the setting; a caller's value still wins); `render_chapter` and
        `render_scene_to_wav` (export + QC) both read it. Settings → Generation pipeline:
        "Pause between lines" slider (0-3000 ms). Tests `test_pause_between_lines.py` (both paths
        take the setting; a sent value wins); the render_truth fake gained the setting. Live:
        The Keystone's Render 505.19 s → 522.34 s = QC's figure; at 800 ms 532.14 s (+49 × 0.2 s);
        set back to 600; QC all_ok. Docs studio.md (Render), settings-reference, whats-new.

### Persona names are unique across the library, and a persona must have a name
STATE:  DECIDED 2026-09-29 — "go and your rec on the other fixes", on the user's "I thought we
        are not allowing duplicate names in persona? do you think we should allow dup or did we
        decided unique name per project" and the rec as given: "persona names unique across the
        whole library (ignoring case and extra spaces), plus a persona must have a name."
        · "A persona is a library item now, not a person in a book. Per-book uniqueness doesn't
          mean anything for personas any more. The per-book identity lives on the speaker
          ('Narrator' in each book), and the persona names the voice ('Narrator (warm)', 'Gravel
          old man')."
        · "The exact-name auto-cast depends on it. With two personas called 'Narrator', a new
          Narrator speaker silently matches neither and arrives uncast."
        · "Creating or renaming into a taken name would be refused with a clear message, the
          same way speakers work. The same change fixes the empty-name bug the walkthrough
          found."
        · The trade-off, as given: "you can have only one 'Narrator' persona. If different books
          need different narrator voices, you'd name them for the voice … and cast each book's
          Narrator speaker yourself."
        Supersedes, for personas, the split's "personas have no name rule". Speaker names stay
        unique within a book.
FINDING 2026-09-29 (walkthrough, adversarial), folded in: Personas → + New persona, type a name,
        clear it, Save → "Persona created", a row with "?" and no name. (The blank row was
        deleted.)
BUILT:  2026-09-29 — `personas_api._persona_name` on POST and PUT: trims, refuses blank (400
        "A persona needs a name."), refuses a name another persona has (409 'A persona called
        "X" already exists. Persona names are unique — rename one of them first.'), case and
        extra spaces aside; PUT on an unknown id stays 404. PersonasView: Save off while the
        name is blank. Tests in test_unique_names_in_a_book.py (unique, blank, rename);
        test_discover_speakers makes its two same-named personas through the store (older data
        can hold them; `persona_named` still matches neither). Checked by clicks on the real
        app: blank → Save off; "narrator" and a rename into "steady BIG man" refused, nothing
        changed. Your 9 personas were already distinct. Full server suite 855 passed. Docs
        personas.md (Names), ai-features.md, code-map, whats-new.

### FINDING — unknown inline tags are read aloud
STATE:  FINDING 2026-09-29 (walkthrough). The podcast demo's first line ends "[warm]"
        (`demo_projects.py:97`); no engine declares `warm`, and `inline_tags.strip` removes only
        KNOWN tags, so it is spoken — Kokoro + Whisper: "Welcome back to the show. Warm, it is
        good to have you here."
DECIDED 2026-09-29 — "your rec both go", on the rec as given: "when rendering, drop every
        [word] tag the chosen engine doesn't list, not only the ones the app recognises. A tag
        the engine doesn't know can never be performed, only spoken. Tags an engine does know
        ([sigh] on Chatterbox, for example) keep working. Also take [warm] out of the podcast
        demo's text. One consequence: bracketed text like [sic] would also be silent. In
        narration that's usually what you want."
BUILT:  2026-09-29 — `inline_tags.strip(text, keep=…)` drops every bracket tag not in `keep`
        (multi-word ones like `[clear throat]` too); `render_core.performable_text` keeps exactly
        the bracket tags the RENDERING variant lists (`_capability_row`, shared with the emotion
        path) — none for an engine without tags, none for tokenless Chatterbox Multilingual (the
        code-map's "latent, not fixed" `[laugh]` gap closes with it). `render_line`,
        `probe_line_cached` and both Generate paths call it (Generate used to send text
        untouched). The podcast demo loses "[warm]". Tests `test_performable_tags.py`; the
        lockstep guard in test_emotion_wiring names `performable_text`. Live: Kokoro +
        "Welcome back to the show. [warm] It is good to have you here." → Whisper: "Welcome
        back to the show. It is good to have you here." Docs engines.md, code-map, whats-new.

### FINDING — every engine install failed under tauri dev: a 0-byte uv.exe
STATE:  FINDING 2026-09-29 (walkthrough). Install → "[WinError 193] %1 is not a valid Win32
        application". `src-tauri/target/debug/uv.exe` was a 0-byte placeholder left on 2026-07-29
        (uv added as a Tauri sidecar in 2cf0924, removed in fcccd95); `cargo run` puts
        `target/debug` first on PATH, so `engines/manager._check_uv_available` →
        `shutil.which("uv")` found it. The file (untracked build output) was deleted; installs
        then worked.
DECIDED 2026-09-29 — "your rec on the other fixes": "skip an empty/non-runnable candidate
        (probe `uv --version`) and name the bad file" (this entry's OPEN, as written).
BUILT:  2026-09-29 — `engines/manager.py`: `_uv_runs` (non-empty and `--version` says uv),
        `_path_uvs` (every uv on PATH, not only which()'s first), `_check_uv_available` skips a
        candidate that doesn't run (logged) and, when none runs, says "uv was found but doesn't
        run: <file> … delete it, or reinstall uv". Tests in test_uv_resolution.py (skip, name
        the file, empty never counts). Checked for real: a 0-byte uv.exe first on PATH is
        skipped and E:\UV_TOOL_DIR\uv.exe is used. Docs whats-new.

### Switching Studio steps keeps Script where you left it
STATE:  DECIDED 2026-09-29 — "your rec go", on the user's "this is a spa and navigating a in a
        spa shouldnt reset the state unless we tell it to" and the rec as given: "keep the
        Script pages alive the same way Discover is. Switching steps and coming back would then
        return you to the same page (grid or chapter), with the same ticks, filters, selected
        line and scroll. Undo would still clear when you open a different chapter, as approved;
        it would no longer clear just because you switched steps." (Discover's empty list after
        adding Old Sedge was checked with the user and is correct.)
BUILT:  2026-09-29 — `StudioView.vue`: StudioScript and StudioScriptChapter each in a
        `<KeepAlive>` (as Discover); new `composables/useKeptScroll.js` (records the shared
        scroller's position while shown, puts it back on return) used by both; the chapter
        page's Undo still clears when `sceneId` changes. Checked on the real app (nothing
        saved): grid tick, chapter chip, ticked line and scroll all survive Script → Overview →
        Script. Docs studio.md, whats-new.
GO:     given 2026-09-29

### Overview: no "This kind's default" mastering option; no "Continue" button
STATE:  DECIDED 2026-09-29 — "go", twice:
        · on the user's "this kinds defau;lt no reason to have that as option" (the Overview's
          mastering list) and the rec: "New projects get their kind's target written in when
          they're created (ACX for an audiobook, Podcast for a podcast, None — raw otherwise),
          so the dropdown always shows the real target. Remove the 'This kind's default'
          option." This REVERSES the 2026-09-28 wording ruling that listed that option.
        · on the user's "remove the reduncent button on project continue to script".
BUILT:  2026-09-29 — `mastering.kind_master`, written by both project-create doors
        (`projects_api` create + import); the Overview's list loses the "" option and shows
        an older project's kind target when it stored none (`StudioOverview.masterShown`); the
        render's resolver is unchanged, so such a project still renders to its kind's target.
        The Continue button and `studioStatus.continueStep` (+ its tests) are gone; the "No
        text yet" hint reads `state.lines` directly. Docs studio.md, whats-new.
GO:     given 2026-09-29

### The audiobook demo is JustWrite's sample, The Ninth Facet
STATE:  DECIDED 2026-09-27 — "2 make a folder called samples just like jw and the load demo just
        imports the project per existing code remove silwater". Option 2 of: (1) just import it,
        (2) make it JustVoice's built-in demo, replacing "Demo — Stillwater".
WHY:    Stillwater is 2 chapters / 5 lines / 3 characters, too thin to test Discover or Script;
        The Ninth Facet is 4 chapters, 8 characters, hundreds of dialogue lines.
NOT:    Keeping Stillwater. A new import path — the demo runs the existing JustWrite import.
BUILT:  2026-09-27, committed in JV `df15ecf`. `samples/the-ninth-facet/book.json` (byte-identical copy of
        JW's) · `demo_projects._book` runs `run_adapter("justwrite", …)` on it, resolved by
        `_bundled_samples_dir` (`JUSTVOICE_SAMPLES_SRC` or repo-root `samples/`, mirroring JW's
        `demo_seed`) · test `test_the_audiobook_demo_is_the_ninth_facet_…` · docs/projects.md.
OPEN:   packaged builds: `samples/` is outside the Python package, so a frozen sidecar needs
        `JUSTVOICE_SAMPLES_SRC` pointed at a bundled copy — deferred, exactly as in JW. The
        user's existing "Demo — Stillwater" project in the dev DB is NOT deleted (data; ask).
GO:     given 2026-09-27

### Redesign: Studio stays a container, a project opens on its Overview, presets die
STATE:  DECIDED 2026-09-27, in the mock. The questions and the user's answers, verbatim:
        1. Studio container vs dissolved (§8.19) → *"1 studio stays as container"*
        2. Where a project opens → *"open project always lands on overview"*
        3. Render preset on Overview, since whether presets die was unruled → *"2 presets die"*
        4. Overview shows the cast as a count linking to Cast, not a second editor? → *"3 not sure"*
        Overview as presented and approved (*"go record it and add overview to the mock"*):
        a tab in front of the steps, the project's own page. It holds settings (title, author,
        description, kind read-only, mastering target, lexicon, webhook), where each step stands
        (each row opens its step), "Continue →" to the next step with work left, and delete. Projects
        stays a plain list, and a row opens that project's Overview. Author and mastering move off
        Export; Export reads them and says where to edit them.
WHY:    With Studio as the container, the project's home belongs inside it. A pane on Projects plus
        a separate Studio would give one project two homes, which the two-places tuning ruling rejected.
NOT:    Dissolved Studio (Chapters · Cast · Render · Export as rail items). Opening a project straight
        into the chapter grid (the mock's old `openProject`). Render presets, in any form.
BUILT:  mock only. `docs/plans/mock/_new_overview.html`, route `overview` in `build_mock.py`
        ROUTES, `openProject()` → `nav('overview')`. Published 2026-09-27 (version 21).
        App code: nothing. `ProjectsView.vue:534-656` is still the detail pane plus "Open in Studio".
OPEN:   (4) cast on Overview is unruled; the mock shows only the Cast step's status row.
        (The Dissolved toggle was deleted from the mock 2026-09-27: *"2 delete,"*.)
        Presets excision in code (`RenderPresetsView.vue`, `/presets`, `RENDER_PRESETS` in
        `ProjectsView.vue:162`, `metadata.render_preset`) has no go.
GO:     given 2026-09-27 for the record and the mock | needed for app code and the presets excision

### THE VOICE-WORKFLOW REDESIGN — the resume surface

STATE: PARTLY BUILT (corrected 2026-09-30 — this line said "nothing built in app code"): Studio's
Overview, Discover, Script and Cast match the mock; Render, Scene, New project and the library
screens (Personas + its editor, Voices, Lexicons, Effects, Engines) do not, or only partly.
**Screen by screen, with what is missing: `docs/plans/2026-09-30-mock-vs-app-and-slice-4.md` §1.**
**`docs/plans/2026-08-15-voice-workflow-redesign.md` §8 is THE resume surface** —
the mock is the design, and §8 carries every ruling made while walking it, the
reasoning, the mock's exact state (§8.18) and how to build it (§8.1). §1–§7 of
that doc are prior thinking, superseded where they disagree. It supersedes the
voice-workbench plan, whose tracker item was CLOSED 2026-08-22 (*"1-5 are done
close that out since we are doing redesign"*) — its Slices A and B shipped,
C and D never will, and E landed piecemeal through the 2026-08-19/20/21 voices
sessions. The one piece of it still undone is recorded in that plan's own
closing banner: Labs still carries compare + renderlab + audio as three subs
where the plan wanted one "Audio tools". This doc also supersedes pipeline
item 6. Mock: `https://claude.ai/code/artifact/534a16a2-af40-438b-a64d-34baaf31f838`
— counts in §8.18 only (last measured 2026-09-27). **Source lives at
`docs/plans/mock/`** (moved out of the session scratchpad 2026-08-17, with a
README for the edit → build → validate → republish loop). The counts are
maintained in the doc's §8.18 and nowhere else — do not re-state them here.
The `scene` route, unreachable from 2026-08-16, was re-linked 2026-09-19
(`6c7cf57`; §8.18, §8.21 item 10).

THE VOICE-LAYER ARGUMENT is §8.22 of that doc — why a persona earns its place
(it is the layer that survives a recast), which half of it actually survives
(only the host-side: gain, effects, lexicon, pitch), why a voice-level
correction must exist anyway (a clone's artifact is a conditioning input, so
loudness can only be fixed at render), and the workbench conclusion that
follows (make · hear · calibrate · derive — not a second knob panel).
**OPEN, user 2026-08-17 "i dont know yet": can a character's persona vary by
scene, or is it one per character?** Nothing may assume either answer. Left in
the pre-ruling wording deliberately — it uses "character" for the fictional
person and "persona" for the record, and whether those are one thing or two is
the unruled question. Rewording it would answer it.

**RULED WHILE WALKING THE MOCK (2026-08-15/16).** Recovered from the transcript
2026-08-16 after an autocompact; the first two had been recorded NOWHERE. Full
reasoning at the cited section.

- **Inline is chosen; page-first is deleted.** *"yes and i choose your rec inline
  so drop the othe mock"*. One interaction model. Cost accepted, with two
  mitigations that are part of the ruling: a collapsed row shows only what differs
  from the default, and cells become inputs on focus. §8.2. **Not to be confused
  with the still-open Studio container/dissolved toggle (§8.19).**
- **Tuning lives in two places, not four.** *"again i am confused we have tunning
  on 4 different places chapter cast workbench persona, why"* → *"yes"*. Cast and
  Personas are ONE editor with two doors (a cast row IS a persona); Personas
  becomes a library index; the line's numbers collapse to a closed
  `⚙ Override this line` hatch with a dot on the row, because **direction is the
  per-line tool**. The hatch survives only because Kokoro and Chatterbox take no
  written direction — on those engines it is the only per-line control. §8.3.
- **Persona · cast · speaker. Never "character".** *"be consistant you have words
  cast character persona which is which"*. Code-verified: `Persona` is the entity,
  `ProjectPersona`/`get_cast` the project's set and the verb, `speaker` the
  attribution word. **CORRECTED 2026-08-22: this said "'character' is nowhere in
  the codebase" — false.** 221 occurrences in server `*.py` (venvs excluded), 145
  in `src/`, and one of them is schema: `database/models.py:632`
  `character_id = Column(String, ForeignKey("personas.id", …))` on
  `SpeakerCorrection`, with matching API/Lab call sites. The ruling stands (it is
  the user's), but the sweep has a **code** target the record denied, and
  `character_id` → `persona_id` is a rename + reset, not prose. **The mock half of
  the sweep IS DONE** — `sweep_persona.py` applied the 25 replacements and
  `validate.py` now reports 0 character / 72 persona (state corrected
  2026-08-22; this line had said the sweep was never given a go). The prose half
  — this tracker and the doc's §2.3 / §2.2 / §2.5 / §3 / §8.21 / §8.22 —
  followed the same day (§8.4). **SWEEP DONE 2026-08-22, committed `6c7cf57`
  2026-09-19** — mock, this tracker, the redesign doc, and
  `SpeakerCorrection.character_id` → `persona_id` in code. A schema rename with
  no migration, so a data reset is the price — but the real dev DB
  (`src-tauri/target/debug/data/justvoice.db`) already carries `persona_id`
  (`pragma table_info`, read-only, 2026-09-19), so no reset is outstanding there.
  Deliberately NOT swept, each a separate contract: `format_characters` /
  `find_anchors(segments, characters)` / `{{characters}}` (code + prompt
  template) · `StandardLine.character_id` (the external import wire format,
  documented in `import-and-export.md`) · `SmartAssignCharacter` and
  `body.characters` on `POST /v1/llm/smart-assign` (live API + a template row
  in the shared llm-runner catalog, cross-repo) · `prompts.py:23`'s
  `"<character_id>"` (prompt text — changing it would confound the open
  gemma-MoE question) · "character sheet" (a UI label, `App.vue:53`). Those
  five have NO go.
- **Five steps: Discover → Script → Cast → Render → Export.** *"i would say
  discover speakers hould be its owne thing script should have anaylize and
  review"*. Discover creates personas; Analyze can only choose from personas that
  exist — two separate endpoints. §8.5. NOTE: an earlier half-sentence about
  script/cast/render being right was explicitly retracted (*"no i didnt say script
  cast render is correct"*) — this ruling rests on the user's own proposal plus a
  go, not on that.
- **Script does exactly one thing — who says what.** *"we purposely sepeate script
  it is for 1 thinkg only determining who says what and what they say, that is it,
  no the direction they say it in not the voice just 1 simple task"*. Direction,
  pause, state, take, Gen, the voice chip and the takes panel all move to
  **Render**. **This kills the §2.2 merge and "render is a panel, not a place".**
  §8.6.
- **Scope a run with an inline grid, never a modal.** *"no one has three tags that
  say all none this chapter only, we just have a checkbox for select/unselect all
  and individual checkboxes … i say drop the popu have the grid above the
  results"*. §8.7.
- **Multi-chapter results fill the same grid in, streaming, and must not imply
  correctness.** Columns are Anchored · Guessed · Flagged · No speaker. **No
  completion tick, no confidence column** — because *"model can and has said with
  100% confidence that it is correct when it is clearly wrong"*, so a
  confidently-wrong model produces exactly the row that looks finished. §8.8,
  §8.13.
- **Review (the second LLM pass) is manual**, scoped to guessed + flagged lines.
  *"review second llm pass should be manaul"*. §8.9.
- **Analyzing inside one chapter must not bounce you to the grid.** §8.10.
- **The user must always be able to see every line, by chapter, in order** —
  filters are lenses, never the view. Default is the chapter read as a script,
  with guesses marked and flags louder. §8.13, §8.15.

**NEW WORK this implies, not in the code:** the deterministic suspicion checks
(three consecutive lines by one persona · a persona with one line · a speaker not
yet in the scene · dialogue on the Narrator · `propagated` after another
persona's name). They are what makes the **Flagged** column real, and confidence
cannot substitute for them. §8.14.

WHY IT EXISTS: the workbench plan was 416 lines of implementation with no design
section; the design died in a compact and two slices were built against nothing,
passing every gate and producing the wrong thing. The user: *"i think we really
are doing a full redesing of the app from a voice workflow standpoint whihc is
most of the app"*.

THE SHAPE (full reasoning in §2 of the doc): identity → hear → make · **the line
is the unit** — Chapters + Studio·Script + Studio·Render merge into one chapter
surface with two modes (Script-with-playhead for QC listening, Table for triage)
and the old steps as **filter states**, not tabs · render is a **panel**, not a
place · inline for the line, pages for library objects · casting is **pick the
kind, then the voice** (the kind fixes the engine and therefore what the
persona can do) with cloning inline on the cast row · **no per-line voice
override** — a different voice is a different persona · the workbench is a
**finishing bench** (hear · tune · save-as · derive · samples).

**THE FIVE ITEMS BELOW ARE APPROVED** — user, 2026-08-15, after reviewing this
entry: *"i do agree with wat you recordded so those are approved"*. They are
approved **as recorded** — two constraints, one idea kept in the design, two
facts. **The redesign's SHAPE is still unruled** (see PROPOSED, below): nothing
in §2/§3 of the redesign doc is approved to build.

Context, kept because it matters: the user's own summary of the session was
*"i really dont think i decided anything on this session as we where doing
mockups and testing a redesing"*. An earlier version of this entry listed seven
"rulings" — that was me converting conversation into decisions because a tracker
wants decisions. Do not repeat it.

On Alexandria, the user's clarification (2026-08-15): *"the alexadria i just
meant if it makes sense its desing we use it if not dont, but that was part of
testing the mockup using alexandrias desing however that may be old now since we
have come up with new ideas and found flaws in our desing"*. So §5 of the
redesign doc is a **working read, not a frozen verdict** — revisit any of its
skip calls if the design moves under it.

**CONSTRAINTS — binding on the design.** Both are rejections of a proposal I
made; if a future session proposes either again, this record stops it:

1. *"but i do want a voice tuning page this is part of creating a new voice for
   a persona to consume"* → **do not remove voice tuning from the voice.** Kills
   my rethink that moved the knobs to the persona. The case behind it: a clone
   that comes out quiet must be fixed once on the artifact, not five times across
   five personas. This constrains the design; it does not approve the workbench
   as drawn.
2. *"damint we want a voice designer we have qwen and other tts that do that why
   would you drop it"* → **do not drop the Voice Designer.** My "we don't ship
   the checkpoint" was backwards — the path is built and gated
   (`voice_design: False` in every manifest pending one download).

**ENDORSED IDEA — kept in the design, not approved to build:**

3. *"a fifth way to make a voice yes i like that"* → the **derived voice** (tune
   a voice, Save as new voice; `{parent_id, name, calibration, effects}`; also
   makes preset voices renameable). Guardrail in the doc: a correction to an
   artifact, never a mood.

**VERIFIED FACTS — not decisions; recorded with their source:**

4. Qwen3 VoiceDesign is the only description-to-voice engine. The user's *"i
   **think** qwen is the only one"* was a belief; verified 2026-08-15 against
   Voice-Clone-Studio (github.com/FranckyB/Voice-Clone-Studio), which supports
   six TTS engines and routes design to Qwen3-TTS's dedicated model alone. TADA
   question dropped.
5. **JV is not an audiobook app** — *"jv is not just pipeline for book yes that is
   main feature but it can be anything that is why we have project types"*. A
   correction of my error, not a decision. `project_type` is
   `audiobook | game_voicelines | podcast | custom`
   (`database/models.py:174`). Forced one correction and two refinements to the
   design (redesign doc §2.0): the **cast surface must be a table with the card
   as a row expansion** (a stack of cards dies at 50–500 game NPCs, where bulk
   selection is the primary action); Script/Table modes have a **default per
   kind**; and the filter chips derive from the kind, since game and podcast
   arrive with speakers already attached.

**WORKING INSTRUCTIONS TO ME** — not product decisions, recorded so they survive
a compact: don't overengineer · don't adopt from Alexandria for symmetry · no
code without an explicit go · save the design in detail *before* compacting.

PROPOSED BY ME, NOT YET RULED — all of §2/§3 of the redesign doc. Do NOT record
these as decisions and do NOT build them:
the line is the unit and Chapters+Script+Render merge · two modes
(Script-with-playhead / Table) · steps become filter states · render as a panel ·
inline-for-the-line vs pages-for-library-objects · casting as
pick-the-kind-then-the-voice · no per-line voice override · ~~render presets
deleted~~ **RULED 2026-09-27: "2 presets die"** (item above; earlier the user's
words were only a lean, *"i think presets die… i am not saying get rid of it…
give me your rec"*) · the composes-vs-replaces rule · gain/pitch/tempo folded into the
effects chain.

OPEN (§4 of the doc): ~~does "Studio" survive as a container (undoing ruling 12)?~~
**RULED 2026-09-27: it stays a container** (item above) ·
does Chapters die outright? · row-expands vs row-links? · the real VoiceDesign
download size · samples API · is there any undo for an Analyze pass?

CANDIDATE FROM VOICE-CLONE-STUDIO (2026-08-15, not ruled): a **Prep Audio**
workspace — trim on a waveform, normalize, mono, DeepFilterNet denoise, extract
from video, ASR sentence-split, batch transcribe. JV accepts a clone upload and
flags SNR *after*; cleaning *before* is worth more, since clones inherit room
tone, and the same workspace feeds training-dataset prep. That app has **no
speaker attribution at all** (manual `[1]:`/`[2]:` prefixes), so there is nothing
in it for the attribution work.

GO: needed, per phase. (The workbench plan it used to defer to was closed
2026-08-22 — the redesign doc is the surface now.)

### ~~FINDING — Block.direction is stored, editable, and never rendered~~ — FIXED

STATE: **FIXED 2026-08-17** under "go", together with the other two dead
delivery paths. `render_chapter_api` composes **persona `voice_instruct` →
`delivery.emotion` → this line's `direction`** into `delivery.instruct`, most
specific last, **appending rather than replacing** — the persona says who they
are, the line says how this one is delivered. An explicit preset/request
instruct still wins the base slot, and a lone hint passes through verbatim so a
hand-written instruct is never reformatted.

Two more dead paths went with it:

- **`Delivery.emotion`** had no reader at all; it now rides the same
  composition. This also completes the IMPORT path — every adapter's
  emotion/style column lands in `Block.direction`
  (`projects_api._materialize_standard`) and stopped there.
- **`Delivery.pause_before` / `pause_after`** were stored and ignored:
  `concat_lines` used one fixed project gap. Each join now takes the previous
  line's `pause_after` plus the next line's `pause_before`, falling back to the
  project gap only when neither is set — blank means "as the project", `0`
  means a deliberate butt-join. The producer side was broken too: every import
  adapter parses `pause_after_ms` (`standard_schema.StandardLine`) and
  `_materialize_standard` dropped it. It now rides on the block's metadata, so
  **no schema change and no reset** were needed.

Pinned by `server/tests/test_line_pause_and_direction.py` (13 tests). Gates
green: ruff · **605 pytest** · biome · 69 vitest · vite build · smoke 16/16
zero JS errors.
DOCS: `docs/generate.md` (pause semantics), `docs/dev/code-map.md` §5 + findings
1, 11, 12.

ORIGINAL FINDING, kept as the record — code-verified 2026-08-15.
`database/models.py:238` documents it
as *"Emotion/style hint passed through to the engine's instruct field."* It is
written (`projects_api.py:498`, `:536-537`), returned (`:140`), exported
(`project_export_api.py:104`) and preserved across splits
(`extraction_api.py:406`) — and `render_chapter_api.py` and `render_core.py`
contain **zero** references to it. The "+ direction" button on the Chapters
screen writes a column no render reads. Per-line direction is not a future
feature; it is built and disconnected.
GO: needed. Bears directly on the redesign — per-line direction is load-bearing
in the new chapter surface.

### style_prompt is deleted; emotion becomes the cross-engine direction control

STATE: DECIDED 2026-08-17 — *"so we should just remove style prompt and keep
spoken delivery?"* … *"go and wire emotion"*
WHY:    Five prose fields fed ONE Qwen `instruct=` argument, and the user could
not see the difference between two of them because there is none downstream:
`qwen3/engine.py` glued `style_prompt` onto `instruct` one line before sending.
The standing-vs-this-line axis it wanted is persona-vs-line, which the app
already has (`voice_instruct` + `Block.direction`). Emotion went the other way:
it is the ONE control with a cross-engine meaning, because an enum compiles two
ways where prose compiles one — and it had no writer in `src/` at all.
NOT:    Keeping style_prompt as "the persona's field on the Generate page" —
that is what the persona already is, and Generate can save its delivery as a
persona default. NOT mapping `sad`→`[crying]` on Turbo: crying is a behaviour,
not a state, and a near-neighbour substitution is the lie this pass removes.
NOT changing the ruled composition order (persona → emotion → line).
NOT a kit change for per-option `disabled` in `UiSelect` — the picker offers
only what the engine can say and names the gap in the hint instead.
BUILT:  `models.py` (field gone, `EMOTION_VALUES` served) ·
`delivery_merge.compose_instruct` (one composer, both render paths — the
one-off path composed nothing before) · `capability_details.py`
chatterbox-turbo (**4 of 19 tags declared → all 19**, in three categories, with
`value_map`) · `render_core._emotion_tagset` / `_apply_emotion_tag`
(variant-precise via `manager.current_variant_id`, mirrored in
`probe_line_cached`) · `GenerateView.vue` Emotion picker.
Pinned by `server/tests/test_emotion_wiring.py` (25 tests).
OPEN:   Turbo's other 16 tokens are declared from reserved ids and **never
rendered here** — upstream names only three. `_tags_supported` is still
engine-level, so a hand-typed `[laugh]` is not stripped for Multilingual, which
has no such token. Per-line emotion needs a `blocks` column and is NOT built —
today the line carries prose `direction`, the persona carries the emotion.
GO:     given 2026-08-17

### Voice design — the call is already installed; it needs a variant row

STATE: OPEN — your call. User 2026-08-17: *"we dont have the model but we need
to add it, qwen does."* Researched and verified the same day.
WHY:    Every manifest says `voice_design: False` and `POST /v1/voices/design`
has nothing behind it. `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` is real, and
`generate_voice_design(text, instruct, language, …)` is **already in the
installed `qwen_tts`** in `engines/qwen3/.venv` (this said `engines/.shared-venv`
until 2026-08-22; the per-engine migration deleted that path) — gated at
`qwen3_tts_model.py:686` on `tts_model_type == "voice_design"`. **No new
dependency.** What is missing: a variant row, the ~4.52 GB download, and one
adapter branch.
NOT:    Treating it as a call that returns a voice. It is **per-call
synthesis** — description in, *audio* out, no embedding to store. Alexandria
(also Qwen3-based) does the only thing that works: synthesize a reference,
save the WAV, and assign the speaker as a **clone** of it. So the door is a
four-step pipeline — describe → synthesize probe → save WAV → clone → `Voice`
— and the result is a clone, inheriting the cloning engine's abilities, not
Qwen's. Anything else re-derives this the hard way.
BUILT:  nothing. Full record incl. the file list, the Alexandria quotes, and
the three-routes-to-a-directable-voice table: redesign doc §9.
OPEN:   the byte total needs one re-pull — the HF file list sums to
4,520,159,099 but the API's own total differs by ~3 MB, and facts-only means
neither is typed until they agree.
GO:     needed

### FINDING — the synth scheduler has no UI at all

STATE: FINDING — code-verified 2026-08-15 on the user's *"synth scheduler what is
this, i dont see it"*. `synth_scheduler.py` (shipped `3a5a23d`) is real: one
worker thread, one pending pool, draining **engine-major** — stay on the loaded
engine while anything needs it, then jump to the engine of the oldest pending
line; interactive singles jump the queue at line boundaries. Seven callers
(`generate_api:304`, `takes_api:313`, `voice_preview_api:221`,
`render_chapter_api:398`, `projects_api:1031/1143/1165`, `render_jobs.py`).
Tested in `test_synth_scheduler.py`.
BUT: **nothing in `src/` references it**, and no endpoint exposes queue depth or
the current engine. `/v1/render_jobs/{id}` reports a job's progress, not the
pool. So when a render waits behind another engine's batch, the app shows
nothing and the user cannot know why.
OPEN: surface it in the chapter render panel — *"waiting — Chatterbox is
finishing 40 lines"*.
GO: needed.

### FINDING — 4 of the Voices table's 11 columns are wired to nothing

STATE: FINDING — code-verified 2026-08-15 on the user's report *"the voices
table today is wrong it has things like effects cast as even langauge like
italian dont actually work"*. `GET /v1/voices` returns the `Voice` shape
(`models.py:464-471`) — id · engine · source · name · language · gender ·
sample_url. That is ALL of it. The table reads four fields that are not on
that payload and do not exist server-side:

- **Samples** → `v.sample_count`. Real on the STORED record
  (`VoiceRecord.sample_count`, written by `storage/voices.py:94-96`) but
  `_stored_to_dto` (`voices_api.py:32-40`) drops it. Renders `—` for presets
  and `0` for everything else, permanently.
- **Gens** → `v.generation_count`. No such field anywhere in
  `server/justvoice`. Always `0`.
- **Effects** → `v.default_effects`. Zero hits in the entire server. Always
  `—`. Effects chains live on the PERSONA (`Persona.effects_chain`), never on
  a voice.
- **Channel** → `v.channel_id`. Voices have no channel. Audio-channel routing
  is per-PERSONA (`PersonaChannel`, `database/models.py:67-77`). Always
  `Default`.

Real columns: Name, Gender (incl. the override paths), Type, Engine, Cast as
(computed client-side from personas' `voice_id`), and the ▶ preview.

### FINDING — every Kokoro voice speaks English, whatever language it claims

STATE: FINDING — code-verified 2026-08-15, same report. Two separate causes,
both provable:

1. **The engine hardcodes the language.** `kokoro/engine.py:107` sets
   `lang = "en-us" if lexicon else ""`, once, at LOAD, into
   `OfflineTtsKokoroModelConfig(lang=…)`. `synth()` never touches language.
   So Sara (Italian), Nicola (Italian) and every Japanese / Mandarin /
   Spanish / French / Hindi / Portuguese preset is phonemized with English
   rules on the multilingual model. The voice's own `language` tag
   (`kokoro/voices.py`) is decoration.
2. **The catalog is variant-blind.** `STATIC_VOICES` is the full 54-voice
   multilingual list unconditionally (`kokoro/manifest.py:66`), and
   `list_voices` (`voices_api.py:51-62`) iterates `manifest.static_voices`
   with no check on which variant is installed. Install the English-only
   `kokoro-en-v0_19` and the table still offers eight languages of voices.

OPEN: (a) pass the voice's language per-synth (sherpa-onnx takes `lang` on
the model config, so this may need a reload-per-language or a config rebuild —
verify against sherpa-onnx before speccing); (b) filter the catalog by
installed variant; (c) meanwhile say so in the UI rather than listing voices
that cannot work.
GO: needed. Bears directly on the workbench design — the new Voices index
must not carry the four dead columns forward, and the workbench's "what this
engine can do" panel is where the language truth belongs.

### ~~FINDING — engine-private knobs are saved flat and reach no engine~~ — FIXED

STATE: **FIXED 2026-08-17** under "go", as part of the full engine-knob sweep.
Routed on the way OUT, as the open question below offered: `nest_engine_keys()`
in `delivery_merge.py` normalises every tier before the merge, so a flat save
arrives nested and deliveries ALREADY stored flat in
`personas.default_delivery` / `render_presets.delivery_json` are repaired with
no re-entry. `render_chapter_api`'s `Delivery.model_fields` filter keeps them
because `engine` is itself a declared field. The audition panel and the render
now agree.

The same pass audited all nine capability rows against their adapters, with
the installed packages introspected (they lived in `engines/.shared-venv` at
the time; since the 2026-08-22 per-engine migration `chatterbox` is in
`engines/chatterbox/.venv`, `zipvoice` in `engines/luxtts/.venv` and `qwen_tts`
in `engines/qwen3/.venv`). Corrections: `min_p`/`top_p` now forwarded
(chatterbox) · `num_inference_steps` → `num_steps`, which had pinned steps at
4 forever (luxtts) · `max_ref_length` wired to `encode_prompt(duration=)`
rather than dropped (luxtts) · `volume` removed, it is not a parameter
(luxtts) · **`t_shift` is NOT pitch** — upstream ZipVoice defines it as the
flow-matching schedule, domain (0, 1.0], default 0.5, so the −6..+6 semitone
declaration and `pitch_native_st_range` were both wrong and are gone ·
`cfg_scale`→`guidance_scale` and `speed_factor` removed, the adapter drives
HF's Dia not nari-labs' (dia) · `max_new_tokens` declared (dia) ·
`silence_duration` removed and its four real knobs declared (moss) · three
fake sliders removed from tada, whose adapter reads no delivery at all ·
`repetition_penalty` forwarded (qwen3) · turbo's hardcoded `top_k`/`top_p`
declared and its `repetition_penalty` default corrected 2.0 → 1.2 ·
`lookup()` now walks `-` suffixes so `chatterbox-turbo-v1` stops resolving to
the base row. **`Delivery.pitch` was read by nobody and is now applied
post-render as a `pitch_shift` effect**, making `pitch_post_process` true
everywhere it is advertised.

Pinned by `server/tests/test_engine_knob_wiring.py` (21 tests) — it fails the
build in both directions: a declared knob with no adapter reader, or an
adapter override with no declaration. Gates green: ruff · 595 pytest · biome ·
69 vitest · vite build · smoke 16/16 zero JS errors.
COST: nesting changes `canonical_json(delivery)`, which is the render cache
key — lines rendered before this re-render once.
DOCS: `docs/engines.md` gained the per-engine tuning matrix; `docs/generate.md`
corrected (pitch is post-process on every engine, not native on LuxTTS);
`docs/dev/code-map.md` §5 carries the declaration↔adapter matrix.

STILL OPEN from this area, NOT fixed: TADA has no installed venv of its own
(it read "is not in the shared venv" before the 2026-08-22 migration), so its
upstream knob surface could not be introspected — re-add knobs there only
alongside the adapter change that passes them. (The pause, direction and
emotion gaps listed here are closed — see the two findings above and the
emotion item below.)

ORIGINAL FINDING, kept as the record — code-verified 2026-08-15 while building
workbench Slice B.
Every engine reads its own knobs from the `delivery.engine` SUBDICT
(`qwen3/engine.py:154`, `chatterbox/engine.py:185-206`,
`moss_tts/engine.py:114`). But `VoiceParamsModal.vue` saves the capability
schema's keys FLAT into `persona.default_delivery`, `merge_delivery` merges
them flat, and nothing anywhere nests them. So every engine-private override
— exaggeration, cfg_weight, repetition_penalty, talker_temperature, top_k,
top_p — has been silently doing nothing at render. Only the cross-engine
Delivery fields (speed, pitch, gain_db, temperature, instruct, style_prompt)
ever worked. `render_chapter_api` additionally filters merged keys to
`Delivery.model_fields`, which would drop them a second time.
The audition panel routes them correctly (`services/audition.js
canonicalDelivery`), so a knob turned there is heard — which means the panel
and the render currently disagree for those knobs.
~~OPEN: route on the way IN (nest at save time in the persona editor) or on the
way OUT (nest in `merge_delivery`).~~ Resolved: routed on the way OUT.

### FINDING — the analyze prompt gets id + name and nothing else

STATE: FINDING — code-verified 2026-08-15. `_resolve_cast`
(`extraction_api.py:145-167`) hardcodes role/gender/pronouns=None, aliases=[];
`format_characters` (`extraction/prompts.py:82-97`) reads those empty fields.
So production attribution has NEVER seen a persona description or alias —
the fields exist for the Lab's typed cast only. Aliases squashed into prose
by the JW import (`justwrite.py:129-139`) are invisible to attribution too.
(The dead description key `_resolve_cast` used to ship went out with workbench
Slice A; the hardcoded Nones are untouched — wiring them IS this item.)
OPEN: wire `personality[:200]` + real aliases into the prompt — changes every
analyze run's tokens and behavior, so it is a product call, not a cleanup.
GO: needed.

### THE 2026-08-15 PLAN — pipeline truth + first-run speech + Alexandria adoptions

STATE: PLANNED IN FULL — the executable plan (design decisions MADE, per-item
implementation specs, verified research) is
**`docs/plans/2026-08-15-pipeline-truth-and-first-run.md`**. The user is
switching models to code from that doc; read it FIRST, build items in order,
per-batch go. Items 12–16 in it are OPEN RULINGS — never build without the
user's word.
RULINGS (user, verbatim, 2026-08-15): Generate tab — *"i aggree with A
dissolbe it your rec on it"* · setup sample playback — *"3 no"* ·
kokoro-as-universal-first — *"accepted rule 1 is wrong kokoro does not do
cloning"* (goal-first lanes; Kokoro = ready-made lane only; never offer
Kokoro as a cloning fallback) · cloning-lane pick — *"But yeah language
branch might be better"* (en→Turbo, other→Multilingual, Qwen3 Base the named
alternative with "reported strongest on zh/ja/ko" guidance only) · personas —
*"i think i like havibng it as a persona for reuse as a saved persona"* (the
Cast card = INLINE PERSONA EDITING, no new entity — research confirmed cast
rows ARE personas, Profile-kill LD#1) · *"dont take easy way out just becuase
we have something coded"* (hence the structural open rulings).
KEY RESEARCH LOCKED IN THE PLAN DOC (do not redo): web-verified Qwen3-TTS
family (Base clones / CustomVoice = 9 presets NO cloning / VoiceDesign 1.7B;
10 languages — our manifest's 17 and its CV cloning flags are FICTION to fix
in item 1) · Chatterbox Multilingual is at V3 upstream (we pin v2; item 1
decision tree) · Alexandria feature/GUI record (review pass taxonomy,
per-line instruct JSON, per-speaker card, Generate-Personas = auto-cast,
training UI, pauses, exports) · the code seams with line numbers (demo
activation bug, AI-offer trigger, Generate's guards, Studio cast=personas,
render-truth gaps, TrainView shape, preview endpoint).
BUILT 2026-08-15 on your *"build items 0–2 go"* — items 0, 1 and 2 are DONE
(full server suite 549 green, biome, vitest 48, build, renderer smoke).
Decisions taken while building, all recorded here because they extend or
redirect the plan:
- **Multilingual V3 is NOT shipped** — the decision tree's own answer. The
  repo carries `t3_mtl23ls_v3.safetensors`; upstream git master can load it
  (`from_local(..., t3_model=…)`); the LATEST PyPI release is still 0.1.7 —
  our pin — and its `from_local` hardcodes the v2 filename. A v3 row would
  download 2 GB this engine cannot open. Recorded in the manifest with the
  exact conditions for revisiting.
- **Qwen catalog truth**: languages 17 → the real 10; `voice_cloning` is now
  per checkpoint family (CustomVoice False, Base True); CustomVoice + a
  reference clip now REFUSES in the engine instead of calling
  `generate_voice_clone` on weights that cannot honour it; `voice_design`
  turned off everywhere (manifest, engine meta, capability_details) until the
  VoiceDesign checkpoint ships with item 9.
- **Dia's cloning claim excised** — found in the same sweep and verified in
  code: `dia/engine.py synth()` never reads `req.audio_prompt_path`, so every
  cloned voice pointed at Dia rendered in the stock voice, silently, while
  the catalog's Cloning filter listed it. Manifest + docstrings corrected; a
  new test asserts every engine claiming cloning actually reads the clip.
- **Scene renders return WAV, always** — the mastering *processing* applies,
  the encoding does not. The .m4b then carries one lossy generation instead
  of two, and auditioning is not done through an MP3. The encoded deliverable
  stays with Export and with direct-mode `/v1/render_chapter` (`lines[]`
  passed literally — byte-identical behavior, the JustWrite adapter path).
- **`"none"`, not null, means raw.** Omitting `master` in scene mode now
  means "server decides"; `"none"` at any level is a real answer that stops
  the search.
- **The render preset's `master` field is honored** — it was stored and never
  read. Precedence: request → preset → project → kind default (audiobook
  acx · podcast podcast · game_voicelines none · custom none).
- **Effects also apply to the game voiceline export** (`export_voicelines`) —
  a persona's chain is part of how that persona sounds; mastering is the
  part game exports skip.
- **The render cache key gained the chain hash**, so every existing cache
  entry is cold once. One full re-render after this lands; that is the cost
  of the key finally describing the audio.
- QC now measures the MASTERED chapter and reports `master_preset` /
  `mastered` / `note`; without ffmpeg it still runs and says the numbers are
  raw. New read-only endpoint `GET /v1/render/master-target` feeds the Studio
  pill, which no longer hard-codes ACX numbers.
NEXT: items 3–6 (demo activation → setup lanes → Voices audition + TTS
ensure-load → Generate dissolution), per-batch go. Items 12–16 stay OPEN
RULINGS.
FLAKE seen once, not reproduced: `test_prefetch_cancel_via_http_endpoint`
failed in one full-suite run and passed alone, as a file, and in a clean
full re-run. Untouched by this work; noted in case it recurs.
DOCS PASS 2026-08-15 (after the three commits): `mastering.md` (the preset
numbers were wrong for iAudio, the chain "trimmed" silence it actually PADS,
a noise gate was described that does not exist, and the page said mastering
happens at export and never on a chapter render) · `chapter.md` (both dead
links — `stories.md`, `profiles.md` — the real render flow, the global player
that no longer exists) · `effects.md` (the four-layer cascade was fiction:
chains live on personas and render presets, they STACK, and voices carry none
at all) · `render-presets.md` (the preset's master target and effects chain,
both now real) · `import-and-export.md` (ACX numbers, the resolution, WAV vs
encoded, the global player) · `generate.md` (dead `profiles.md` /
`stories.md` links). Two findings the pass could not fix are filed below.


**Deferred by your word (2026-08-06):** the real-webview test harness and the
deep exhaustive audit — *"for now we are not doing jv harness or deep audit i
want to finish all features and complete the jv llm runner conversion."*

### VRAM: STOP AND THINK before any arbiter wiring

STATE: the 2026-07-04 decision stands (one shared VRAM budget family-wide; an
LLM **or** a TTS engine on the GPU, never both) — but the user ORDERED A STOP
first, 2026-08-08: *"once done with those tasks we need to stop and think about
vram, has that already been planned? some tts engines can run direclyt on cpu
and dont need vram, same with some of our modles so we need to take that into
consideration as well as the fact that we dont autoload the lmm model so how
does a user know what they can and cannot load if llm model is not even
selected or loaded, as we have it load on demand"*.
WHY: the old item assumed the wiring was the remaining work; the user names two
unplanned dimensions — CPU-resident engines/models that need NO budget, and the
load-on-demand LLM meaning the budget's biggest consumer is invisible until it
runs.
BUILT: the arbiter itself, in the runner (`runner/arbiter.py`); JustVoice's
`EngineManager.load()` neither reserves nor releases ("arbiter" appears nowhere
in `server/`, verified 2026-08-08). The engines are OS subprocesses, not
in-process (design-doc correction rides along).
OPEN: the THINK is DELIVERED, then twice hardened by ordered adversarial
passes — `docs/plans/2026-08-08-vram-think.md`. Pass 2 found the budgeted
policy ALREADY RUNS in JV's process for the LLM (`lifecycle.py:491`), reversing
Q1 to budgeted-from-the-start and cutting two overbuilt pieces. Pass 3 found
the decisive structural fact: naive TTS reservations would CORRUPT the runner's
`_admit` (it would "evict" a foreign key via router_unload no-op + release —
the ledger lies, overcommit returns), so the wiring's PREREQUISITE is the
kit-side eviction-executor seam (reservation kind + evict_fn + a shared
make_room; `_admit` refactored onto it). Pass 3 also disproved pass 2's
self-shrink assumption (the load fits against the FULL card and EVICTS —
`lifecycle.py:1937` + `_admit`) and found the shipped in-runner precedent for
Q2's policy shape (the #274 embed placement). The workflow pass (the user's
"how does the flow work" question) added §4 + two more calls: Q6 — Quick Setup
UNCHANGED (family-canon charter; TTS has no default-model concept, voices are
the unit and engines follow them), but the 2026-08-05 warm-boot stopgap
("TTS owns the GPU until F4's arbiter", main.js:208-214) comes back — rec:
flip LLM warm-boot ON as the wiring's last step; Q7 — mixed-GPU-engine casts
thrash full model loads per engine crossing (one-slot-per-kind +
per-line auto-load, verified) — rec: chapter render synthesizes grouped by
engine. Pass 4 verified the newest pieces in code: Q7's premise holds (the
chapter render is collect-then-assemble, `render_chapter_api.py:250-264`, so
grouping is just iteration order); Q6's mechanics corrected (warm is a per-DB
SETTING — kit default ON, JV's `llm_bootstrap.py:34-36` seeds it 0; the flip
reaches fresh DBs only, seeds-only rule); and Q8 found the deeper limiter —
`synth()` is slot-coupled (`manager.py:1415-1417`), so CPU-kokoro + GPU-engine
can never co-reside; multi-resident engines recorded as the later refactor,
NOT built. make_room's busy protection also closes the pre-existing same-kind
hole (loading LLM B could evict busy LLM A). Pass 5 produced ZERO design
reversals and four wiring corrections (§5 of the doc — convergence): whisper
IS the third kind and AUTO-LOADS today (`captures_api.py:48-60`, stt slot,
1500 MB cuda-only manifest) so dictation's resident set is stt+llm at once;
there are TWO engine-load doors and `render_core.render_line`'s direct
`engine.load` would BYPASS arbitration — door unification onto
`EngineManager.load()` is wiring prerequisite #2; `models_max`'s count cap
must be kind-scoped or a TTS resident eats a llama.cpp child slot; TTS
admission reuses the existing `safety_margin_mb` knob; and the claim line's
two sources are verified (measurements record `vram_total_mb`; `compute_fit`
prices an on-disk gguf). llm-busy lands in the KIT dispatch layer (JW inherits
the protection free); tts/stt-busy at the manager chokes. Your calls on Q1–Q8
are the gate. NO code before those decisions.
DECIDED (2026-08-08, round 1 — user words verbatim: *"q1 your rec, q2 how does
this work are you adding gui it sound good but how does it really work dont
likme stuff that is hidden or hardocded, q3 your rec, q4 your rec, q5 i dont
understnad your rec, q6 your rec, q7 this was suppored to already be done the
grouping so that anything synthized by engine got grouped together, that is not
just chapters but if you runn multople chapters it need to take wahter is being
run or queed to be run and gourp it effectiantly, you need to think on this
again and show me what you find, q8 your rec, no coding yet"*):
**Q1 ✓** budgeted + never-evict-busy · **Q3 ✓** claim line + event-driven
eviction toasts, no predictive warnings · **Q4 ✓** one budget strip on the
Speech-engines tab, one endpoint · **Q6 ✓** warm-boot flip as the wiring's
last step, seeds-only · **Q8 ✓** multi-resident engines recorded, NOT built.
**Q2 OPEN** — mechanics re-explained (engine FACTS in manifests: cpu_adequate
beside vram_min_mb/gpu_runtimes; the operator PREFERENCE is a real setting
`engines.engine_overrides[id].device` auto|cuda|cpu with a Device select on
each Speech-engines card; resolution in the ONE load door; resolved device +
reservation always shown on card/strip/toast; today's hidden torch greedy-cuda
is the thing being REMOVED) — DECIDED round 2, user: *"q2 ok"*.
**Q5 OPEN** — re-explained (the admission's "how much does this engine need"
number comes from the manifest's declared vram_min_mb; it is a first guess —
the spawn OOM back-off is the real safety net; the NVML measure-after-load
subsystem stays cut, parked in IDEAS) — DECIDED round 2, user: *"q5 your rec"*.
**Q7 REOPENED and SWEPT** (go round 2: *"i did not mean to sotp that sweep …
go and finis anwwering quesitns"*) — full findings + design in §7 of the plan
doc. The short truth: NOTHING groups anywhere (all five multi-line producers
verified sequential — scene render, M4B assembly, voiceline ZIP, the Lines
CLIENT loop, singles; every one funnels through per-line
`engine.load("auto")`); the user's "supposed to already be done" memory is
RIGHT twice over — the design freeze shipped `RenderJob`/`RenderJobBlock`
tables (`database/models.py:330-364`, DESIGN_FREEZE §3.7) with NO orchestrator
ever built (exports-only, dead in every DB), and Decision 13 of the 2026-06-20
shared-ai-stack plan promised job-level render/batch settings (parallel
workers, sub-batching, batch seed) that have ZERO code hits; engine-grouping
itself was never planned before this doc. Bonus debt found: Generation's
active-status machine (queued|loading_model|generating) is set by NOBODY —
both creators write "completed" directly, `active_tasks_api.py:51` filters on
states that never occur. REC (awaits the word): Option B in §7 — ONE
synthesis scheduler, engine-major across the whole pending pool; Stage 1 the
in-process scheduler core replacing wiring step 7 (producers submit sets and
wait; interactive singles jump at line boundaries); Stage 2 resurrect
RenderJob as the persistent face (retry-failed, resume, Lines client loop
retires). Sub-batching stays distinct (within-engine perf, IDEAS).
PASS 2 (*"think on the desing again"*, same day — §7b of the plan doc): found
a LIVE defect — the synth endpoints are async-def with sync bodies over sync
httpx (`manager.py:999`), so a chapter render blocks the ENTIRE server (even
accepting an Analyze; §4's mid-render story is impossible today — the
scheduler is what makes it real); found the big simplification — the render
cache is the hand-off (all producers verified `use_cache=True`, disk tier
never auto-evicts, `cache.py:96-135`), so the scheduler is a WARM PASS with
no result plumbing and assembly code unchanged; M4B needs WHOLE-submission
grouping (per-chapter was insufficient even single-producer); drain policy
concretized (oldest-pending-line engine first + pool-wide free-riding +
interactive jumps at line boundaries, no knobs); and the freed loop FORCES
all synthesis through the scheduler (the accidental serialization is the only
thing preventing load-terminates-engine-mid-synth today; previews are a sixth
synth door, `voice_preview_api.py:168`). Shape unchanged: Option B, two
stages. One pass-1 claim corrected: cross-producer line-level interleave
exists only between per-line-request flows; whole-request producers serialize
accidentally by blocking the loop.
PASS 3 (*"think on it again"*, same day — §7c): NO reversals. Three
corrections: Stage 1 is INDEPENDENT of the VRAM wiring and REC'd to ship
FIRST (the wiring's admission/busy plug into the scheduler's switch points
afterward); the Lines re-render stays UNgrouped until Stage 2 (per-line
requests = one-line sets — the named gap that makes Stage 2 debt, not
polish); the synth funnel covers MANAGED engines only (external/remote-API
singles stay direct — nothing to kill, nothing to group). Two alternatives
rejected on record: the `def`-endpoints one-keyword freeze fix (creates the
mid-synth kill race it cannot manage) and a manager synth/load lock (prevents
the kill, buys no cooperation).
PROCESS RULE (2026-08-08, mid-turn, verbatim): *"never do anycoding unless i
give you exact word 'go' never do anyting research unless i give go"* — both
gates are the literal word.
Q7 DECIDED round 3, user verbatim: *"your rec go"* (2026-08-08, after pass 3)
— Option B, scheduler-FIRST order. The go covers STAGE 1: the SynthScheduler
(pool + worker thread + engine-major drain per §7b P2-4 + submit-and-wait +
interactive jump), the managed-synth funnel (§7c P3-3 scope), and the manager
per-kind guard as safety back-stop. Stage 2 (RenderJob resurrection) and the
VRAM wiring each still need their own go.
BUILD-PREP DISCOVERY (§7d of the plan doc): `render_line` has NO local-engine
door — the registry it drives holds ONLY external cloud providers
(`app.py:438`; managed adapters were never re-registered when engines became
plugins), so chapter/M4B/QC/ZIP/Lines/take-re-roll 404 for EVERY local voice
and only ever worked with cloud voices; the new-voice preview door breaks the
same way (`voice_preview_api.py:134`); tests never caught it (fakes occupy
the registry slot production leaves empty). Stage 1 opens with the managed
bridge in render_core (= wiring step 2's render_core half, landing early).
STAGE 1 BUILT 2026-08-08, gates green (ruff clean · 453 pytest, all passing):
the managed bridge — `render_core.py` render_line/probe_line_cached route
managed engines via the manager (registry branch stays first: external
providers + test fakes untouched), tag-strip from manifest CAPABILITIES,
cloned-voice reference WAV via `resolve_audio_prompt_for_stored` (moved to
render_core, generate_api wraps it) · the scheduler — `synth_scheduler.py`
(SynthScheduler + SetHandle + warm_lines/warm_specs, engine-major oldest-first
free-riding drain, interactive jump, abort-on-first-error, cancel-withdraws) ·
the guard — `engines/manager.py` per-kind `_activity` locks around
synth/clone/transcribe and load/unload terminates (`_unload_kind` refactor) ·
the conversions — render_chapter + QC + M4B (`collect_project_line_kwargs`,
strict-mirroring, aborts warm if any scene refuses) + voiceline ZIP
(`collect_block_specs`, [] on first unvoiced block) warm sets;
render_block / generate-managed / managed new-voice preview are interactive
singles through the one synth door; all five endpoints now await instead of
blocking the event loop · tests — `test_synth_scheduler.py` (9),
`test_render_managed_bridge.py` (7), `test_engine_activity_guard.py` (2).
NOTE: built alongside the parallel Script-tab-restore session's work in the
same tree (its strict=True refusal composes with the warm; the book-warm
mirrors it). COMMITTED with Stage 2 + the Script-tab restore in `3a5a23d`
(2026-08-09, user word "commit and push all").
STAGE 2 GO GIVEN 2026-08-08, user verbatim: *"go"* (immediately after the
Stage-1 report listing Stage 2 first among the open gos — the decided
scheduler-first order's next step). Scope per §7 Finding 3 + §7c P3-2:
resurrect `RenderJob`/`RenderJobBlock` as the persistent face — job API
(create/status/cancel/resume), runner submits every block as its OWN
one-item set so the pool groups engine-major while failures isolate
per-block, per-block Generation+Take persistence identical to the single
door, boot sweep marks interrupted jobs paused, resume re-runs
failed+pending only, and the LinesView client loop retires onto one job
POST + poll with real n/m on the kit task.
STAGE 2 BUILT 2026-08-09, gates green (ruff · biome · 48 vitest · vite build ·
smoke 15/15 zero JS errors · pytest FULL SUITE 469 passed, zero failures —
both sessions' work green together): `render_jobs.py` (create_job
scope project|scene|blocks · `persist_block_take` = THE one block-persistence
shape, takes_api refactored onto it · runner submits each block as its own
one-item set — engine-major grouping pool-wide, per-block failure isolation ·
counters recomputed from rows so resume never lies · cancel withdraws pending
at the line boundary via live handles · `sweep_stale_jobs` boot sweep wired in
`app.py` after init) · `api/render_jobs_api.py` (POST create / GET
?include_blocks / cancel / resume) · `LinesView.vue` re-render = one job POST
+ 1s poll with real n/m, Cancel → job cancel, partial-failure toast, button
disabled-not-spinning · `docs/lines.md` updated · `tests/test_render_jobs.py`
(8: complete+persist, failure isolation, resume-only-unfinished,
cancel-withdraws, boot sweep, empty scope, API roundtrip, unknown-ids).
Composed live with the parallel Script-tab session's moving edits: warm
mirrors QC's skip_unrenderable/strict split (collector grew the flag); their
render_scene_to_wav strict= signature landed mid-build (two test stubs
updated to `**kw`, their session then evolved the same tests further).
COMMITTED + PUSHED as `3a5a23d` (2026-08-09, both sessions' work, final
gates green on the settled tree; workflows verified disabled before/after).
GO: Stages 1+2 BUILT · a job-list / resume UI surface beyond the Lines button
was NOT ordered and is not built.
DECIDED + GO 2026-08-13, user words verbatim: *"your rec go and go for the
full vram phase"* — after the ordered re-think ("think on the design again
including the new fit") and its adversarial cross-verification (Fable → Opus →
Fable, every claim run in code). The rec approved, THE ONE-POOL RULING: **on
one-pool boxes the ledger tracks POOL OCCUPANCY, not device placement.** Kit
half: `process.py`'s one-pool booking clamp — whose own comment and whose own
test (`test_arch_arm_one_pool_booking_never_exceeds_ledger`) both said "until
Phase 4 makes the ledger arch-aware", a debt Phase 4 then never collected —
changes ceiling from `max_vram_mb` (the iGPU carve-out: bookings of 0–128 MB,
admission dead, claim line reading 0, `__overhead__` calibration poisoned) to
`budget_total_mb` (the pool), the two carve-out-era test pins re-pinned to
pool truth + a new real-booking pin. JV half: on one-pool boxes a managed
engine load books its declared `vram_min_mb` WHICHEVER device it resolves
(CPU and GPU are the same physical bytes there); discrete keeps
cpu-resolves-books-nothing. "The full vram phase" = wiring steps 3–6 of
`docs/plans/2026-08-08-vram-think.md` §6 as amended by the re-think: step 1
(kit seam) and step 4's llm-busy half verified ALREADY BUILT during the fit
redesign; the claim line comes from the kit's `preview_fit` four-arm resolver,
never hand-rolled (P5-5's ladder is superseded); `declared_claim_fn` is DEAD
plumbing (assigned once, read nowhere, and `preview_fit` can't resolve
non-catalog ids anyway) — NOT used, left untouched, recorded as a gap; JV
prices its engines from its OWN manifests; tts-busy lives at the scheduler
worker (idle→active transitions), stt-busy at the manager's transcribe;
`cpu_adequate: true` lands on kokoro (certain), luxtts stays UNFLAGGED until
its real-time-on-CPU claim is verified, whisper stays cuda-declared (P5-1's
per-variant refinement recorded, not built); warm-boot flip is the LAST step,
seeds-only.
BUILT 2026-08-13, same session as the go — full stamp in
`docs/plans/2026-08-08-vram-think.md` §6 (STATUS STAMP 2). The pieces:
KIT — the one-pool clamp fix (`process.py` ceiling → `budget_total_mb`) +
two re-pins + the physics-equality pin (suite 847; steps 1 + 4-llm were
already built there during the fit redesign). JV server — device policy /
admission / declared reservation / release-on-every-exit in
`engines/manager.py` (`_resolve_device` · `_books_memory` one-pool ruling ·
`_admit_memory` no-locks-held (lock-order inversion avoided; a refused
admission leaves the world untouched) · `_reserve_engine` source="declared"
kind-mapped tts|stt · `_evict_for_arbiter` occupant-checked) + `cpu_adequate`
on kokoro + `EngineOverrides.device` (models.py) + tts-busy at the scheduler
worker's idle↔active transitions (`synth_scheduler.py`) + stt-busy at
`transcribe` + `GET /v1/engines/vram` (`engines_api.py`: snapshot + the
routed-default claim — routing store + production configs, NOT
resolve_feature; preview_fit's four arms do the pricing; claim_reason
distinguishes cloud-routed from not-configured) + `resolved_device` on
EngineInfo. JV UI — the budget strip (VRAM/Memory label off mem_arch,
provenance tooltip, busy chips), eviction-toast poller (4s, primed silently
on mount), Device select per card (read-modify-write PATCH), resolved-device
on the loaded badge, the client-guessed "est. VRAM" total replaced by ledger
truth. Warm-boot: `apply_jv_warm_default` DELETED (seed.py + reseed path),
`test_warm_default.py` re-pinned warm-ON-fresh / stored-choice-survives.
Docs: `docs/gpu.md` "The shared memory budget" (real section) +
`docs/engines.md` loading rewrite. Tests: `test_engine_vram_wiring.py` (17:
device policy · booking both arches · slot-replacement release · honest
refusal · idle-LLM eviction + event feed · never-evict-busy · evictor
occupant check · scheduler/transcribe busy · the endpoint incl. the claim).
GATES: kit ruff+847 · JV ruff+485 + vitest 48 + build + smoke 15 views zero
JS errors · JW 128 + build · check-family 0 violations · verify-model-pick
48. HONEST LIMITS, recorded: eviction toasts surface only while the
Speech-engines tab polls (no app-global poller was ordered); a crashed
engine's reservation lingers until its slot next loads/unloads
(conservative, over-counts); clone singles are protected by the activity
lock, not a busy flag (an evictor waits, then terminates); GPU-less
CPU-only boxes still book 0 (recorded gap, serving-design.md).
GO: BUILT — then SUPERSEDED IN PART the same day: the user's first live
look at the strip (350M turbo showing 4 GB "in use") exposed the declared-
pricing currency as invented scaffold data, and the ordered rethink
replaced it with measured-first pricing + a strip that shows only reality
(the Speech-engines convergence item below + `docs/plans/
2026-08-13-speech-catalog-redesign.md`). The wiring's MACHINERY — device
policy, admission seam, busy flags, eviction executor + toasts, endpoint,
one-pool ruling — stands and is what the redesign builds on. The laptops
walk (kit checkpoint) remains open, user-paced.

### Speech-engines model management converges on the kit's download/load GUI + machinery

STATE: ORDERED 2026-08-08, user words verbatim: *"the model download load
unload for speech engines should be same gui desing and llm runner a download
button thre dot menue, and all the other feature such as model loaded unloaded
ect, can we resues any llm stuff i think that was in plane to resue the
progress downloadeder since llm has download manager, think or resues instead
of rewrite and wwe can consolidate, both speech engines nad llm runner
download load and unload models we should be able to use same mechanisms"*.
Think delivered same day: the 2026-06-20 cutover boundary DECIDED TTS/STT
sections stay native while LLM went to llm-ui
(`docs/plans/archive/2026-06-20-engines-llmui-cutover-boundary.md:234-235`) —
this order revisits that boundary. Reuse has three layers: (1) GUI
vocabulary — the kit card grammar (download button, three-dot overflow menu,
loaded/unloaded state chip, inline progress row) applied to the
Speech-engines cards; pure renderer, highest value, kit pieces that exist:
`LuModelCatalog` (model rows with download/load/unload/state),
`LuModelPicker`, `LuEngineInstallButton`/`LuEngineUpdateButton`,
`LuRunnerBinaries`; (2) client task machinery — ALREADY shared since
2026-08-08 (withAiTask + `setProgress(done,total,text)` + AiTaskStrip + the
`bridgeJobProgress` install bridge in `SpeechEnginesTab.vue`); (3) the server
download manager — a REAL open design question: the kit downloads
ggufs/runner binaries with its own progress machinery, JV downloads HF
snapshots + builds venvs via its own `/v1/engines/*` job system; whether one
download manager can own both needs its own pass, no claim made.
WHY: two model-management surfaces in one app answering the same verbs
(download/load/unload/delete/progress) with different control vocabularies is
exactly the divergence class the family convention exists to kill; reuse
instead of rewrite is the standing law.
NOT: moving TTS engines INTO the kit's runner/catalog (they are not llama.cpp
children — the pool stays JV's); claiming the server halves are one system
today (they are not).
BUILT: nothing — think only.
ORDERED ADDITIONS 2026-08-13 (user words verbatim, during the chatterbox
download failure — WinError 1314, hub's cache-symlink fragility at load
time): *"one of the tasks is to make the speech engine use the same
interface and services of the llm runner, the download progressbar, re
dowload, load unload, the three dot menu, ect."* · *"we should have the
model catalog for each engine and so on"* · *"and the location we have data
directory and ai-cache for llm why not have a tts version in same loacation,
also we should have the same types of clear data directory ect"*. The
failure is the argument for the SERVER half: the LLM never breaks because
the kit downloads models as PLAIN FILES (progress/resume/per-file on-disk
truth) and loads from disk — speech engines fetch through HF's cache
machinery at load time inside the engine subprocess.
THE FAILURE, diagnosed in code (2026-08-13, chatterbox-turbo first load):
hub 0.36.2 has exactly two symlink sites — a per-directory PROBE and the
real pointer creation that runs only when the probe said yes. Proven live
in the shared venv unelevated: the probe honestly answers NO on this box
and hub degrades to copying — which is how ~3.9 GB of turbo files landed
as REAL files (all stamped 22:38, moved not linked; blobs/ held exactly 1
orphan = the failed file's already-downloaded blob). The raise is a HOLE
in hub's fallback: Windows delivers WinError 1314 as plain OSError while
the symlink branch catches only PermissionError — so the one file whose
process believed symlinks were supported crashed instead of degrading. A
FRESH engine process re-probes honestly → RETRY completes the load (the
missing file's blob is already on disk). UI contributor: `modelOnDisk`
treats a non-empty folder as downloaded, so the partial snapshot skipped
the download phase and the ENGINE fetched stragglers itself — per-file
on-disk truth (the catalog's declared file list) kills this class.
REJECTED SOLUTIONS (user, verbatim — so they stay rejected): Developer
Mode ("no way a user needs to set developer mode") and
HF_HUB_DISABLE_SYMLINKS ("no on the hf_hub disable symlinks, we download
from hf all the time with the llm" — the LLM works because the kit
streams plain files, never the hub cache layout; that is the CORRECT
solution's shape, i.e. this item).
FINDING (code-verified 2026-08-13): speech models live INSIDE the installed
package tree — `ENGINES_DIR = Path(__file__).parent`, models at
`engines/<id>/models/`, and the interpreters at `engines/<id>/.venv/` (this read
"the shared venv at `engines/.shared-venv/`" until the 2026-08-22 per-engine
migration deleted it; the finding itself is unaffected) — while
the LLM's cache correctly lives at `<data_dir>/ai-cache` (app.py:221). An
app upgrade/reinstall strands or nukes gigabytes; factory reset and the
backups page cannot see them; `is_installed`/uninstall/prefetch all route
through `models_dir`, so the relocation has ONE seam.
FINDING 2 (user question + code-verified 2026-08-13): JV's default data dir
is `AppData\Roaming\justvoice\justvoice\data` while JW's is
`AppData\Local\JustWrite\JustWrite` — `paths.py` deliberately mimics the
RETIRED Rust core's `ProjectDirs::from("dev","justvoice","justvoice")` so
the June port found existing data; that rationale is dead (Rust core gone,
pre-release reset rule). Its comment also lies ("Set roaming=False … we use
Local" while the code passes roaming=True). REC: converge on the JW shape —
`platformdirs.user_data_dir("JustVoice")` → Local\JustVoice\JustVoice; one
function; JUSTVOICE_DATA_DIR/--data-dir unaffected; decide together with
the speech-cache location (same resolved dir).
REC (awaits the word): speech models move under the data dir beside
ai-cache (e.g. `<data_dir>/speech-cache/<engine>/<variant>/`, per-variant
pinned revision + declared file list, fetched by the KIT downloader —
network leaves the load path entirely); kokoro's `model_dir_override` is
the per-engine escape precedent; the venvs' location is decided at the
design pass (rebuildable runtime, not user data); the data-management
surface grows per-store clear verbs (LLM cache · speech cache · render
cache) in one grammar. Pre-release no-migrations rule: the path change is
a default change — existing files re-download or the user resets.
DECIDED 2026-08-13 (late — the design pass RAN, triggered by the user
loading 350M chatterbox-turbo and the budget strip showing 4 GB "in use";
full record: `docs/plans/2026-08-13-speech-catalog-redesign.md`). The
diagnosis: `vram_min_mb: 4096` was INVENTED in the 2026-06-08 scaffold
(`de592a7`, git-blamed) — never sourced, never measured, same for every
engine's declared number — and the wiring booked + displayed it. User words
verbatim through the rethink: *"that makes no sense … what is using 4gb if
the model is only 350mb"* · *"from a user perspective this is exptemely
misleading"* · *"i dont like this booked reserver too confusing for user,
we need to think of better way, poor design you did on this manager"* ·
*"rethink this manager process i do not like it at all rethink this
manifest too"* · *"why should this be any diffent then the way we load llm
models and show what vram is used"* (answer verified in code: it
shouldn't — kit `lifecycle.py` measures the before/after pool delta and
reserves THAT, `source="measured"`; the speech wiring ported the declared
arm without the ladder). THE RULINGS: **own catalog** (*"the speech can
have its own catalog just reuse what makes sense to do and desing it so it
feels similiar but taking into account what is different about speach"*) —
grouped engine→variant rows built from kit primitives (DownloadBar, chip
mapping, three-dot menu) with the identical verb set, NOT LuModelCatalog
itself; **no quants / no model-card machinery** (variants are one fixed
artifact each; add-by-link dies — engine code pins the catalog; "View on
Hugging Face" replaces the card); **cloning distinction** (*"i would like
a way to distingush between engines models that can do voice cloning vs
not"*) — per-variant voice_cloning/preset_voices facts, first-class chips,
filter row, consumers repointed (GenerateView.vue:61 reads engine-level
today); **facts-only manifests** — vram_min_mb DELETED from the format,
weight-file sizes verifiable from disk/HF-tree, per-variant languages/
capabilities/license; **measured-first pricing** — probe the engine PID
after load, reserve + display the measured number, estimate only before
first load and LABELED; **admission on measured free**; **strip shows
reality only** (used/free/per-row measured + "other apps"); **slots stay**.
OPUS ADVERSARIAL PASS (user-ordered, both directions): 4 findings adopted —
don't replace invented 4096 with quoted ~1.5 GB (only measurement counts;
engine.py:107 loads the full pipeline, "350M" is the backbone alone);
**raise-only high-water re-probe** at busy→idle (TTS allocates at
generate(), not load — post-load delta alone would over-admit into render
peak; torch's caching allocator makes the lazy probe forgiving);
**per-process attribution** (Fable's amendment over a shared lock:
query-compute-apps on Linux/NVIDIA, per-PID GPU Process Memory counters on
Windows WDDM where nvidia-smi says N/A, RSS on one-pool; fallback
device-delta labeled computed) kills the cross-charging race with
concurrent LLM loads; **file-sizes-not-params** for the estimate;
**TTL-cache the probes** (used_device_mem_mb calls detect() + nvidia-smi —
never raw under a 4 s poll); **sequencing flip** — true-up FIRST (zero
downloader dependency: sizes come from disk for installed engines).
PHASES: ① measured true-up + strip truth + `vram_min_mb` deleted outright
(GO GIVEN 2026-08-13, verbatim: *"save in docs in detail and go for
coding"*; the deletion pulled forward from ② on the user's mid-build check
*"vram_min_mb i thought this was inventied and not going to be used?"* —
zero code readers, grep-receipted) · ② kit downloader
generalization + speech-cache + facts-only manifests + load-from-local-
paths (kills 1314; needs go) · ③ the catalog UI per the plan doc's anatomy
(needs go) · ④ data-dir convergence on JW shape + per-store clear verbs +
venv location (needs go).
PHASE ① BUILT 2026-08-13/14 (same session; full inventory in the plan
doc's §9): kit per-process probes (`process_device_mem_mb` — nvidia
compute-apps arm + the vendor-neutral WDDM `GPU Process Memory` typeperf
arm — and `process_rss_mb`; kit suite 851) · JV estimate ladder + measured-
free admission (+settle loop, honest refusal quoting measured numbers) +
per-PID true-up at the load door + raise-only high-water bumps
(synth/clone/transcribe async + scheduler busy→idle fresh, daemon threads)
+ measurement rows into the kit store (`tts:<engine>:<variant>`) ·
`used_mb`/`other_mb` on the vram endpoint · the strip reworked to measured
truth (used-of-total · Free · per-engine cells · Other apps · busy) ·
`vram_min_mb` deleted from all seven manifests · wiring tests REWRITTEN
(24 green) · gpu.md/engines.md updated.
THEN THE SECOND RETHINK (user: *"rethink the desing if you are screwing
this up mid code then what else in the desing did you nad opus get
wrong??"*) + Opus's EMPIRICAL pass + Fable's live experiments — full
record + the amended design in the plan doc's §10. The short truth: the
estimator priced turbo at 4,455 MB (WORSE than the deleted 4,096 — turbo
never loads `s3gen.safetensors`, 1 GB dead in the file sum); and the live
CUDA-child experiment found THE LAUNCHER-SHIM BUG — uv's venv python.exe
on Windows is a trampoline, the Popen pid is a 4 MB shim, the real
interpreter is its CHILD (probing the child: device 1131 MB via the WDDM
counter arm — the mechanism WORKS aimed right; as built it would book
"computed" forever on discrete Windows and 4 MB on one-pool). ADOPTED:
Opus's cut — the pre-load estimate DIES (first-ever load = no arithmetic,
no number, attempt→measure→book→remember, "not measured yet" on
strip/card; prior-measured loads admit AND book early). Platform answer:
Windows all vendors ✓, Linux NVIDIA ✓, Linux AMD needs the device-delta
fallback (must now be implemented — the estimate it fell back to is
gone), Mac RSS-on-pool ✓ with the MPS-in-RSS caveat on the laptops-walk
list. `recommend_for_vram` is the DOWNLOAD-variant picker
(engines_models_api.py:99) — its invented numbers can't be zeroed without
replacing the picker (manifest default variant, else smallest).
THE AMENDED FIX SET: BUILT 2026-08-14 (as-built record item-by-item in
plan doc §10's BUILT stamp): kit process-TREE probes (pid+descendants —
psutil → wmic/CIM/ps table walk; nvidia set-query + per-pid WDDM counter
arm; suite 858) · the pre-load estimate DELETED (prior-measured admits AND
books EARLY with release-on-failure; first-ever load = no arithmetic,
"not measured yet" on the strip, which now joins loaded engines with
reservations) · device-delta fallback (computed, never persisted, never
overrides an early prior booking) · the second nest DEAD (model_catalog
vram_mb + ModelVariant field + fit dots + est. span + the
/models/recommended endpoint deleted; picker replaced by
default_variant_for over the manager's resolved default; legacy-gui
repaired) · gpu.md "1–1.5 GB" struck · bump occupant re-check + booking
CREATE when measurement first lands (policy-gated) · the kit booking-gap
half (reserve computed at admission, true-up upserts; zero kit test
changes) · junk files deleted · KFD idea recorded. Wiring tests REWRITTEN
(29 green). Gates: kit ruff+858 · JV ruff+pytest+vitest 48+biome+build +
THE RENDERER SMOKE (passed, zero JS errors).
SPEED TABLES: CUT 2026-08-14 per the rec the go adopted (gpu.md CPU
realtime factors + engines.md Speed column + GB→engine tiers — same
invented-number class as vram_min_mb; honest qualitative split kept:
Kokoro is built for CPU, the PyTorch cloning engines want a GPU).
GO: given 2026-08-14, verbatim: *"go on everything your rec"* — covers
THE AMENDED FIX SET (built, above), the speed-tables ruling (cut, above),
and phases ② → ③ → ④ in order, recs governing open sub-decisions;
stop-and-ask only where a genuine new user ruling appears. NEXT: phase ②
IN PROGRESS — the build design + THE VERIFIED WEB FACTS are in plan doc
§12 (read it first on resume): kit `select_repo_files` + JV
`speech_cache.py` (plain files + files.json truth, kit downloader, no
symlinks) are BUILT + TESTED (kit models 28 · JV speech-cache 6); the
web pass verified every ENGINE-map repo real and exposed the old catalog
rows for dia/moss/tada/luxtts as unwired fiction (real: Dia-1.6B-0626 ·
OpenMOSS-Team/MOSS-TTSD-v0 · HumeAI tada-codec+tada-3b-ml ·
YatharthS/LuxTTS); pinned per-variant file sets recorded (§12; raw trees
in the session scratchpad hf-trees/). ②a+②b BUILT: spawn_prefetch + the manager load door acquire through
speech_cache (fetch-before-spawn; `_hf_snapshot_to` + its symlink
machinery DELETED; the old prefetch tests were also writing junk into
the REPO models_dir — the "scaffold junk" mystery solved, pins now
assert the repo tree stays clean) · plugin SDK v0.2.0 (`/load` carries
`model_dir`, signature-aware pass-through, old SDKs ignore it
gracefully; `_ensure_plugin_current` auto-refreshes stale venv installs
at spawn) · ALL 8 engines grew local load doors (chatterbox
from_local · whisper/qwen3/dia/moss from_pretrained(local dir) ·
tada 3-source nested dirs incl. the Llama-tokenizer mirror, hub calls
only on the legacy branch · luxtts model_path · kokoro model_dir
override) · models_api on_disk = speech-cache truth first, then the
PER-ENGINE legacy hub cache (models/hf/hub — the env-based probe was
checking the wrong root) · Delete model handles both worlds ·
docs (gpu.md 1314 entry = structural fix landed; engines.md speech-cache
paragraph). ②c BUILT (PHASE ② COMPLETE): every manifest carries facts-only VARIANTS
rows (languages · per-variant voice_cloning/preset_voices · weights
license · pinned sources with verified files + real summed bytes — from
the scratchpad `pinned-variant-files.txt`, all 16 repos + 2 HEAD-verified
kokoro tarballs); model_catalog is a READER over manifests (the
hand-typed nests + `_hf_placeholder` fakes died — four engines' rows had
pointed at repos that never existed); resolve_source serves the pinned
`files` + full multi-source list (an operator override honestly carries
none — whole fork tree); the wire ModelVariant grew
voice_cloning/preset_voices/weights_license/hf_repo/url;
`disk_space_mb` excised end to end (manifests, wire Prerequisites,
engines_api reader, dormant catalog rows, legacy-gui column); MOSS
renamed to what actually loads (MOSS-TTSD v0 — "v1.5" never existed);
kokoro/engines.md sizes corrected to verified downloads (multilingual is
333 MB, not "~700"; turbo's real download is 3.0 GB, not "350 MB");
variant-wiring pins STRENGTHENED to exact repo equality via hf_repo.
Gates: full pytest 504 · vitest 48 · biome · build. Then ③ the catalog
UI, then ④ locations + verbs.
SESSION 2026-08-14 COMMIT INVENTORY (all pushed, JV workflows verified
disabled_manually before AND after every JV push; both trees clean at
session end): KIT `e173256` (process-TREE probes + the runner's early
booking; suite 858) · KIT `ad5c66e` (select_repo_files + the
hf_download_headers door; models tests 28) · JV `d00bb9c` (the amended
fix set + the speed-tables cut; renderer smoke PASSED) · JV `bba5cc1`
(②-groundwork: speech_cache.py + plan §12 + the verified web facts) ·
JV `82d59fb` (②a wired + ②b: SDK 0.2.0, 8 local load doors, the
fetch-before-spawn door; pytest 504) · JV `8f4463d` (②c facts-only
manifests; pytest 504 · vitest 48). Cross-app kit gate: JW pytest 128
green against the new kit. RESUME SURFACES for ③/④: plan doc §6 (the
decided anatomy) + §13 (the grounded resume brief: what the wire serves,
what SpeechEnginesTab already has, the kit primitives incl. the Reka
DropdownMenu import shape from LuModelCatalog.vue:49, the
GenerateView/voices capability repoint, ④'s scope, and the four carried
open edges — kokoro's load-door tarball path still writes the legacy
location · the dormant known_engines/spawn_install legacy registry is
an excision candidate · is_installed heuristics could become
cache-truth-driven · MPS-in-RSS stays on the laptops walk).
PHASE ③ BUILT 2026-08-14 (the catalog UI, under the standing go — a
RESHAPE of SpeechEnginesTab per §6/§13, not a new view): the variant
rows grew the facts chips read straight off the ②c wire (language chip
`en`/`N langs` with full-list hover · CLONING · PRESETS · N · the
weights-licence chip with the kit's gold use-limited warn pattern
retold honestly for JV — every bundled engine permits commercial
output, so ⚠ means an OBLIGATION rides the licence, TADA's "Built with
Llama" spelled out in the hover) · ONE merged filter row (rec under the
go: §6's All · Cloning · Preset voices JOINED with the pre-existing
TTS/STT kind chips — two side-by-side "All" chips would be worse;
capability filters work on variant facts, auto-expand groups, drop
engines with no matching variant) · the three-dot menu per row
(reka-ui DropdownMenu, the LuModelCatalog import shape; canonical
.ev-kebab/.ev-menu classes in styles.css since the portal escapes
scoping): Re-download (delete + fresh fetch via the same job-channel
task; also the legacy→speech-cache migration verb; disabled while
loaded) · Open folder (desktop-only, the SettingsView log-opener
precedent; the SERVER resolves the folder — ModelVariant grew
`local_dir`, populated by models_api across all four arms speech-cache/
per-engine hub/env hub/tarball, so the cache layout never leaks into
the client) · View on Hugging Face (kit openExternal on v.hf_repo) ·
Delete files (moved in from the old inline button; now honestly gated
on_disk AND not loaded — deleting a resident model's files was always
dubious) · `size · on disk` in the row meta · the per-row measured-
memory hint on the LOADED row ("X GB measured" / "~X GB in memory" /
"not measured yet" — joins the vram reservations exactly like the
strip's speechRows; §13's story, not §6's pre-rethink "needs ~X GB").
THE CAPABILITY REPOINT (the §4 cloning ruling's second half):
GenerateView's lookupCapability now prefers the LOADED VARIANT's row
and walks "-" suffixes off each candidate (manifest ids carry a version
tail the capability map doesn't: chatterbox-turbo-v1 → chatterbox-turbo)
— before this, a loaded Turbo served Multilingual's knob set (wrong
sliders, missing paralinguistic tags). The voices flow's engine-level
`capabilities` read was VERIFIED factually fine (no engine's variants
differ on cloning) and left alone. Docs same change: engines.md "The
catalog rows" section (chips · filters · licence semantics · the ⋯
verbs) + generate.md loaded-variant note. GATES: ruff · full pytest 505
(new pin: models list serves speech-cache local_dir) · biome 113 ·
vitest 48 · build:vite · THE RENDERER SMOKE (all views, zero JS
errors) · PLUS a targeted headless drive of the reshaped tab itself
(smoke.js never clicks the sub-tab): chips render, first group expands
to the §6 row anatomy exactly ("23 langs · CLONING · MIT"), the kebab
menu opens with the honest verb set for a not-downloaded variant, the
Cloning filter fans to 10 rows, zero JS errors, screenshots taken.
Open edges: unchanged (the four above — kokoro tarball path and
is_installed now explicitly ④'s). NEXT: phase ④ locations + verbs.
PHASE ④ BUILT 2026-08-14 (the final phase — the redesign is COMPLETE):
THE LOCATION converged on the JW shape — `default_data_dir()` = env
else `Path(platformdirs.user_data_dir("JustVoice"))` (Windows
%LOCALAPPDATA%\JustVoice\JustVoice · Local never Roaming; macOS
~/Library/Application Support/JustVoice; Linux ~/.local/share/
JustVoice), the Rust shell's `default_data_root` changed in lockstep
(the old pair disagreed with each other); JUSTVOICE_DATA_DIR /
--data-dir / dataroot.txt untouched; NO migration (pre-release rule —
env-var at the old folder, or fresh + backup). THE VERBS: the KIT
`make_disk_router` grew `extra_buckets` ({name: dir} → measured,
served under `extras`, counted into total; JW byte-identical when
unused); JV mounts speechCache + renderCache; Settings → Storage →
Disk usage = AI models cache · Speech models · Render cache · Engine
spawn logs, each Clear in the ONE kit grammar (confirm-with-size,
refuse-while-loaded); new POST /v1/engines/speech-cache/clear
({ok:false, detail:"unload engines first"} while loaded; {ok:true,
bytes}); render clear rides /v1/cache/clear, Labs → Cache stays the
scoped surface. THE VENV RULING (rec under the go): venvs STAY with
the runtime tree (engines/<id>/.venv + shared) — interpreter-bound
rebuildable runtime, never user data; known edge recorded: admin-
located installs can't write venvs (today's behavior, unchanged).
THE KOKORO EDGE CONVERGED: `_ensure_variant_local` URL arm via new
`installer.fetch_url_variant` (same primitives as the prefetch
worker's job twin) → tarballs land in the SPEECH CACHE at the load
door too; load door reordered acquisition-first (legacy
_install_engine_shared model steps only when local_dir None and not
installed); pre-④ engine-dir installs keep serving (legacy guard);
`is_installed` learned cache truth (any_variant_on_disk) — prefetched
shared engines read installed. DEFERRED BY REC: the known_engines/
spawn_install excision — shares paths with the LIVE external-engine
flow; its own verified pass, never a rider. DOCS: backups-and-data.md
"Where your data lives" + "Disk usage" sections (the panel was
undocumented before); engines.md links the whole-store clear.
GATES: kit pytest 862 (extras pin) · JW pytest 128 (JW's repo-root
.venv — bare F:\Python312 lacks the xdist its addopts want; kit-source
resolution verified live in that venv) · JV ruff + full pytest 510
(5 new pins) · biome 113 · vitest 48 · build:vite · cargo check · the
renderer smoke (first run failed ALL views — resource contention with
the concurrent full pytest, nothing rendered within timeouts; the
immediate rerun passed everything, zero JS errors) · headless
Settings drive verified the Disk-usage rows + /v1/disk/usage extras.
REMAINING out of plan: the user's laptops walk (MPS-in-RSS).
THE known_engines EXCISION — DONE 2026-08-14 (user: "go on all of it").
It was a SECOND catalog beside engines/<id>/manifest.py, and every one of
its seven ids had a real manifest — so `_is_managed()` returned first and
NONE of its arms could run. Verified unreachable before cutting, not
assumed: the /install legacy branch, the DELETE-engine legacy branch (which
carried `uninstall_deps` → `pip_uninstall_engine_deps`, the one reader I had
earlier called "live" — it is not, the managed branch returns above it), the
engines list fallback loop, the /engines/current fallback loop, and the
models_api existence guard. EXCISED: `known_engines()` + its 7 EngineInfo
builders; `_enrich_legacy`; installer's `spawn_install`, `_missing_modules`,
`_pip_install`, `_run_install`, `_register_engine_after_install`,
`uninstall_engine`, `_pkg_name`, `_PKG_VERSION_RE`,
`pip_uninstall_engine_deps` (installer.py 851 → 513 lines). KEPT
deliberately: `compute_status` — it serves RUNTIME-registered external
OpenAI-compatible engines, which have no manifest by design. `uninstall_deps`
stays on the DELETE route as an accepted-and-ignored query flag (documented
in the docstring) rather than a breaking signature change. Receipted sweep:
zero references to any excised name in server/, src/, tests/ — only the
tombstone comments and the plan-doc history. Gates: ruff · pytest 521 ·
vitest 48 · build · smoke.
2026-08-14 FOLLOW-UP RULINGS (user, verbatim, after seeing the built
catalog live) + the same-day build:
RULING 1: "i meant i wanted it to be like the llm catalog, meaning i
want a download button not a load button with an arrow, also the
storeage location is that supposed to be the same as jw, check you
work you messed up things". RULING 2: "ai models cache is showing 0,
i want the jv model catalog to feel and work similiarly to the shared
llm runner catalog, do you understand, i undertand there are
differences that need to be but it all should work the same clear
cache for llm models clear cache for tts models ect". RULING 3:
"server logs, database ect all 0 nothing works correctly". RULING 4:
"dataroot.txt this should all be in the database and a seed file".
THE STANDING PRINCIPLE these establish: the JV speech catalog FEELS
AND WORKS like the shared LLM-runner catalog everywhere — verb split,
cache rows, clear verbs — differing only where speech genuinely
differs.
AS BUILT: (1) THE VERB SPLIT — a not-on-disk model shows "Download
(N GB)" (download only, the kit's 'available' shape); "Load model"
appears once files are on disk; the one-step "⬇ Load (N GB)" died
(loadButtonLabel deleted, runLoad is load-only now, downloadOnly is
the download door). (2) THE STORAGE MESS-UP root-caused: the location
CHANGE was correct (both apps double the name — Local\JustWrite\
JustWrite ↔ Local\JustVoice\JustVoice) but the shell's FIRST-RUN
POINTER LOCK (dataroot.txt, docgen §5 shape) had pinned the user's
install to the old Roaming root, silently vetoing the new default —
my ④ report claimed convergence without accounting for it. FIX per
ruling 4's intent: the first-run lock is REMOVED (the default is
computed, never persisted — no scattered state files); dataroot.txt
now exists ONLY as the record of an explicit Change-folder
(storage_relocate writes it); a pointer holding exactly the OLD
default is residue of the removed lock → deleted on resolve, falls to
the new default. The one datum that CANNOT live in the DB is the DB's
own address — recorded as the bootstrap constraint answering ruling
4's letter. (3) THE ALL-ZERO PANEL, two real faults: kit fmtBytes
floored sub-MB to "0 MB" (a 484 KB database read as nothing) → now
shows KB below 1 MB (kit-wide honest display, JW gets it too); and
the Speech models bucket measured ONLY the new speech cache while the
user's real gigabytes sit in the LEGACY per-engine stores → the kit
extras hook grew list-of-roots buckets (summed per name), JV's
speechCache bucket = speech-cache root + every manifest's models_dir,
and /v1/engines/speech-cache/clear deletes across the same roots
(voices/state untouched). AI models cache 0 was verified HONEST on
the current root (post-reset, llama.cpp engine not reinstalled — no
GGUFs on disk anywhere). TEST-SAFETY catch: the widened clear would
have let the existing test rmtree the REPO-TREE engine models (a dev
box's real legacy models) — the test now empties the manifest map,
and the legacy arm is pinned against tmp dirs only.
2026-08-14 THE DATA-LOCATION RULING (user, verbatim): *"none of the
apps should have anything stored in C:\Users\danel\AppData\Local —
absolutely no data for any of these apps should be stored anywhere but
where the user has set the storage directory, which by default will be
the install directory for the app, for now that is the debug directory
for tauri"*, corrected immediately after: *"dont hardcode anything
appdata is not band what is banned is anything that the user has not
decided meaning the user chooses the data directory with default being
same location as app is installed"*; and the standing law behind it:
*"all that can be the same should be, this includes how data is
stored"*.
WHAT I GOT WRONG (recorded because the user has had to say it
repeatedly): phase ④ "converged JV onto JW's shape" by reading an
AppData FOLDER a headless test boot had created and taking it for JW's
real location — JW's desktop shell has always run PORTABLE (`data/`
beside the exe; the user's real JW data is in
src-tauri/target/debug/data). The convergence target was residue, and
"the two apps now match" was mistaken for the real goal: ONE shared
implementation.
AS BUILT (all three repos): the policy lives in the KIT —
`llm_runner/platform/data_paths.py` `resolve_data_dir(app_name,
env_var, source_root)`, ladder = the app's DATA_DIR env var (the
user's choice; also how each shell hands down Change-folder) →
`data/` in the install dir (frozen: beside the exe; source: beside the
checkout root) → the OS app-data dir ONLY when the install dir is
unwritable (read-only-install necessity, never a preference).
`justvoice/paths.py` and `justwrite_server/paths.py` are now
three-line callers (JW's platformdirs default was itself creating
AppData\Local\JustWrite\JustWrite behind the user's back). BOTH Tauri
shells implement the identical ladder in Rust (they resolve before the
server exists) and BOTH lost the first-run pointer lock — writing the
computed default into dataroot.txt is what pinned this install to
Roaming and silently vetoed every later default; the pointer now
records ONLY an explicit Change-folder, and one equal to a
computed/former default is deleted as residue on resolve. `data/`
gitignored in both apps.
NORMATIVE DOC UPDATED: kit `docs/app-structure.md` §6 (the paths.py
contract — it had said "platformdirs", which is what I followed) + §5
(the shell's pointer rule). USER DOCS: JV backups-and-data.md "Where
your data lives" rewritten (you decide; default = beside the app; the
three overrides; the unwritable-install fallback; both apps behave
identically); JW storage.md gained the headless half.
GATES: kit ruff + pytest 872 (9 new data_paths pins: env-wins ·
default-beside-app · blank-env-is-not-a-choice ·
OS-dir-only-when-unwritable · frozen-lands-beside-exe ·
probe-leaves-nothing · per-app-roots) · JV ruff + pytest 511 · JW
pytest 128 + vitest 578 · JV biome + vitest 48 + build:vite · BOTH
shells cargo check · JV renderer smoke (first run failed all views on
contention with JW's concurrent suites; the quiet re-run passed
everything, zero JS errors) · verified LIVE: JV headless default
resolves to the checkout `data/`, an env var overrides it, and a full
gate-server boot + smoke created NO AppData folder.
CLEANUP: deleted `AppData\Local\JustVoice` (my own gate residue,
verified file-empty first). The user's pre-④ Roaming data is untouched
and reachable via JUSTVOICE_DATA_DIR. UNEXPLAINED, reported not
guessed: `AppData\Local\JustWrite` also disappeared during this
session — I ran no command against it, JW's tests all use tmp_path,
and it held no files when first inspected; JW's real data (32 MB db,
projects, ai-cache, book files) is verified intact in
target/debug/data.

## Features the docs promise and the code does not do

### The YouTube master target is labelled AAC and encodes MP3

STATE: FINDING — code-verified 2026-08-15 during the docs pass.
WHY it matters: a caller asking for the YouTube target gets a response typed
`audio/aac` holding an MP3 (`media_map` in `render_chapter_api.py` and
`master_api.py` both map youtube → audio/aac; `MasterPresetSettings.youtube`
has `format="mp3"`, and `master()` encodes the preset's format). A browser
copes; a pipeline that trusts the content type does not.
OPEN: one of the two — either the preset should be m4a/AAC (its
`bitrate_kbps=192` and 48 kHz suggest that was the intent) or both media maps
should say `audio/mpeg`. Docs currently describe the MP3 reality.
GO: needed — it is a one-line change either way, but which line is a product
call.

### `effects.md`'s "apply a chain to a take → new take version" is unverified

STATE: FINDING — noticed 2026-08-15 while correcting that page; NOT checked
against code. The take/generation rows do carry `effects_chain` columns, so it
is plausible, but the page states a whole workflow (bake, `source_take_id`
link, revert by setting the source take default) that nobody has traced. The
rest of the page was corrected: chains live on personas and render presets
only, they stack rather than override, and they now run on every render.
OPEN: trace it, then keep or cut the section.
GO: needed.

## Docs and repo debt

### The Stories tab advertises a feature that isn't built

STATE: **DECIDED 2026-08-15 — *"ok you rec add this to ideas so we can design
the proper timeline"***, on the recommendation to RETRACT rather than build:
hide the tab, keep the tables, design the real thing first. The design is
written in full at the top of `IDEAS.md` (2026-08-15 entry) — what it does,
what it looks like, which kinds, and the four open questions. Two facts that
forced the rec, both code-verified that day: `story_items` points at
`generations`/`generation_versions` and carries no `take_id`/`block_id`/
`scene_id` (`database/models.py:396-412`), so the inherited timeline cannot
arrange what the production pipeline makes; and it anchors to the entity plan
item 6 dissolves. The retraction itself is NOT built — it needs its own go.
WHY it matters: app copy is code. `App.vue:43` sells "Multi-track timeline editor.
For podcasting, game-dialogue assembly, and per-chapter multi-voice arrangement."
BUILT: nothing behind it — `StoriesView.vue` has been deliberately inert since
2026-06-13, and the live server's `openapi.json` has **no `/v1/stories*` route at
all** (verified 2026-08-08). The tab's ? button also 404s: `App.vue:143` maps it
to help slug `stories`, and `docs/stories.md` does not exist.
OPEN: the copy decision, then either write `docs/stories.md` + restore its
`toc.json` entry, or remove the tab and leave both out.
GO: needed. (User docs were corrected 2026-08-04 to stop sending podcasters there.)

### Design rationale that exists only as code comments

STATE: FINDING — the comments verified present 2026-08-08; whether
`design-decisions.md` already covers each one is **not** verified.
WHY: a comment does not survive the next refactor of the file it sits in.
OPEN: write these into `design-decisions.md` — why Stories is gated
(`StoriesView.vue:3-15`, belongs in §5) · the backup schema-v1 / 4 GB design ·
why settings folded from JSON into SQLite (`storage/settings_store.py:4-8`) · the
"no hardcoded operator-tunable values" law and how engine source overrides
implement it · corrections used as few-shot examples.
GO: needed.

### The `screenshots` npm script is broken two independent ways

STATE: FINDING — hit live 2026-08-08 (left unfixed: no go was given to edit it).
BUILT: nothing. `scripts/smoke_gui.js` hardcodes `127.0.0.1:17497` and ignores
`JV_BASE` (CLAUDE.md's "JV_BASE overrides the base URL" is true of `smoke.js`
only), and even on the right port it times out waiting for a
`getByRole('button', { name: 'Engines' })` that no longer resolves.
OPEN: fix the port to honor `JV_BASE` and update the stale selectors — or
retire the script into the deferred harness decision (it is browser-driven,
the banned acceptance class).
GO: needed.

### §3 wording tension: "speaker attribution = JW" vs "JV does its own casting"

STATE: OPEN — observed 2026-08-08 during the contract-rows work, **unverified**
which reading is right.
WHY it matters: `design-decisions.md:105` lists speaker attribution under JW's
data ownership, while CLAUDE.md says "JW hands over the prose, JV does its own
casting and narration" and JV's extraction pipeline computes attribution.
Possibly ownership-of-data vs where-computation-runs — but the two sentences
read as contradicting each other and one page should say which.
OPEN: reconcile the §3 wording (one look at what JW actually exports).
GO: needed.

### The JW→JV book-format contract has no lock on the JustWrite side

STATE: OPEN — your call, and the concrete successor to the "book-zip import
format" item §3 records as a future decision. Became real 2026-08-08 when the
`justwrite` adapter started parsing JW's actual `book.json`.
WHY: JV's own fixture test catches JV regressions but cannot catch JW CHANGING
the shape — a rename of `scenes[].body` or a re-nesting of `parts[].chapters[]`
would break JV silently, and the two repos share no code by design (see the
zip-import item's NOT list).
OPEN: a shape-lock test in JW's suite asserting `book_io.assemble()` still emits
the exact key paths JV reads, naming JustVoice in its failure message. Lives in
`../justwrite-app/docs/dev/TASKS.md` once you take it — JW work belongs there.
GO: needed.

### ElevenLabs import: build it or drop it — the research says it is small

STATE: OPEN — your call. Its picker row was removed 2026-08-08 (a 501 in a menu),
but the module's own docstring is WRONG about why it was never built.
WHY: `imports/adapters/elevenlabs.py` claimed the mapping needs "an account-side
voice manifest" or a hand-mapping step and is "out of scope". JustVoice's own
research doc contradicts it — `docs/dev/external-import-formats.md` says the
Studio export is a ZIP of `manifest.json` (name, `voice_assignments`, chapters) +
per-chapter HTML with `<span data-speaker>` turns, maps "directly to Project /
Scene / Block", and rates the importer effort **Small**. The same doc surveys
Resemble, Speechify, Murf, Coqui and OpenVoice the same way.
OPEN: build it from the research doc (it also unlocks the four other tools), or
decide the whole external-tool import family is not wanted and retire the
research doc's claim. Either way the stub is gone — git holds it.
GO: needed.

## Known deviations, recorded so they aren't re-litigated

- **No real-webview end-to-end harness** — deferred by your word above. When it
  is picked up, docgen's harness is the donor, and `scripts/shots.js`,
  `scripts/verify_all.js` and `scripts/e2e.js` retire or get replaced with it:
  they are browser-driven, which was banned as an acceptance surface on
  2026-08-02.
- **`capture.llm_model` is a dormant settings field** — decided KEEP. Its UI
  picker is gone but the field stays (`models.py:330`).

## VRAM wiring DEPENDENCY (2026-08-09): the fit redesign lands first

The family fit redesign (`../just-llm-runner/docs/plans/2026-08-09-fit-redesign.md`)
is the wiring's prerequisite: it fixes BOTH of the claim line's verified sources —
the computed arm (compute_fit physics) and the measured arm (which does not exist
today: `model_measurements.vram_total_mb` is the CARD total, not a footprint; the
true-up dies in-memory — the redesign persists it as `vram_model_mb` + adds the
claim resolver the strip consumes). Q1-Q8 rulings STAND untouched; the
eviction-executor seam remains this repo's own prerequisite (disjoint functions,
same lifecycle.py). Resume the wiring after the redesign's Phase 5.
2026-08-13 consensus update (plan §13): claims carry `{vram_mb, ram_mb}` + a
provenance source (measured|declared|computed — a manifest-priced TTS reservation
must never read as live truth on the strip); RAM co-residency on DISCRETE boxes is
priced but unbudgeted — DECIDED (plan §8.18): the strip DISPLAYS the RAM sum,
never enforces it in v1 (mmap'd weights make a summed ledger over-count; enforcement
only on evidence, mlock/no_mmap-keyed), and the display half is THIS repo's wiring
work, not the kit's. CPU-adequate engines confirmed first-class (claim follows the
resolved device → CPU = 0 VRAM).
STATE STAMP 2026-08-13 (late): the redesign's BUILD PHASES ARE COMPLETE —
Phases 0–7 BUILT + pushed (6 = the joint MoE solve + ncmoe-first shed; 7 =
the uncurated-path gate + evidence-keyed ranking + the one-authority dev-doc
story, now standing in the kit's `docs/dev/serving-design.md` fit section —
read THAT for the current fit architecture, the plan for history) — THIS
ITEM IS UNBLOCKED with no kit prerequisite left. What Phase 5 delivered for the wiring (full record in the kit
tracker's fit item): the claim resolver lives in `preview_fit` (four arms:
resident-live with §13.1 provenance on the arbiter snapshot → persisted-
measured median over fingerprint-matched source='load' rows → physics computed
with learned per-backend overhead → declared); claims are {vramMb, ramMb,
source, matches} (RAM display-only §8.18); the arbiter snapshot is arch-aware
(mem_arch, one-pool pools counted once — Phase 4) and each reservation row
carries its source. CORRECTED 2026-08-13 (the re-think's code verification):
`configure_service(declared_claim_fn=…)` is DEAD plumbing — assigned once,
read nowhere, and `preview_fit` resolves catalog ids only, so it can never
answer a foreign kind. JV does NOT register it; JV prices its engines from
its OWN manifests (vram_min_mb · cpu_adequate · gpu_runtimes — Q2's facts)
and the strip reads the resident snapshot + `preview_fit` claims for the LLM.
GO GIVEN 2026-08-13 (see the VRAM item above for the decision record).
