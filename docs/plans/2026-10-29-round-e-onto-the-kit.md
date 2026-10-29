# Round E — JustVoice's audio.cpp engine, its Speech engines tab and its jobs onto the kit's (J1)

**State: DECIDED 2026-10-29 — the user on §5: "think adverserilly on you recs make sure you check facts, then your
rec go".** The re-attack's changes are marked "Re-attacked" in §5. The kit took §3 from this file the same day
(its session: B1–B13 and G1–G12 being built; B14 dropped — the per-line pass covers a rise; B11 settled as one
field, the row's `peakVramMb`). JustVoice's §4 starts when the kit sends its final shapes and a green run.
Nothing is built. The go given was for this plan only
(TASKS "Round E"): "your rec go" on "reading and writing the plan only … No code changes until the kit's tests pass
and you've approved the plan". The kit's half landed (just-core adb9805 … ed72ce6, 3dc2db9) and is green at
just-core `75d07f8` (its session, 2026-10-29: core 1593, template unit 126 + e2e 15, the guard clean, and
JustVoice's own server 1384 / unit 261 / build:unpacked on it).

Records this plan is built on: just-core `docs/plans/2026-10-24-engines-the-llama-way.md` (J1), just-core
`docs/dev/TASKS.md` "Round E" and "Finish the kit" item 30 (the user's decisions there), just-core
`docs/app-structure.md` §19, just-core `docs/dev/RESEARCH.md` §12, and this repo's RESEARCH §1–§2. Every claim
below was read in code at just-core `75d07f8` / JustVoice `78ca4a0e`; **INFERRED** marks what follows from code but
was not run.

---

## 1 · What round E is

**After round E JustVoice runs no speech engine of its own.** The kit's `audiocpp` runtime (`runner/runtimes.js`)
installs the pinned fork build (`v0.9.2-jv.6`) with eSpeak NG, runs up to four servers (GPU/CPU × speech/
transcription, `runner/audiocpp.js` `AudioCppPool`), decides where each model runs and books its memory
(`runner/speech_placement.js`), and holds the per-kind locks for a line (`RuntimeService.useModel`). The
Japanese dictionary is the runtime's add-on.

JustVoice keeps only what is its own:
- **its models** as `runtime_model` rows (from its catalog — `generated.js`, `curated/*.js`), seeded through
  `installLlm({ runtimes: ["audiocpp"], runtimeModels })`;
- **how each family's request is shaped** — `slot.js`'s mapping becomes the `fn` it passes to `withSpeechModel`;
- **its hooks** — the warm-up (`warm`), the piece length (`pieceLength`), the load-options key
  (`loadOptionsKey`), its development build (`runtimeExeOverrides`);
- **the voice → model → version choice** (speech has no preset: the voice names its model — the user's word);
- the capability rows, voices, personas, licence acceptances, the DSP program (decided: stays the app's),
  the external OpenAI-compatible providers, render jobs and book runs.

**Transcription becomes a kit feature on an stt preset** (decided), its model and Auto/GPU/CPU on the preset.
**The Speech engines screen becomes the kit's runtime tab** (decided: "JustVoice's UI in a kit slot"), JustVoice's
per-model options in its slots. **Installs and downloads become the kit's runtime state**, polled by its tab (the
kit doesn't use its job registry for them). **Exports move onto the kit's job registry** — the kit built
`forget`/`onForget` for them (`platform/jobs.js:21-24`).

**What the user sees change**
- one AI Settings tab for speech (the kit's), its runtime row, add-ons and settings in the kit's words;
- transcription's model chosen on its preset (Routing), not in a hidden setting;
- first loads measure each model's memory again (§5 item 10);
- nothing else on the speaking side: the same models, voices, renders and takes.

## 2 · Each piece and the standard it follows (app-structure §19)

| Piece | §19 row | Kit code |
|---|---|---|
| The runtime, its builds, pin, install, Update | "Another engine"; "An engine whose models load into running servers" (rows `runtime_binary`) | `packages/core/src/runner/runtimes.js`, `RuntimeService`, `AudioCppPool` |
| eSpeak NG, the Japanese dictionary | "An engine's side archives … its optional add-ons" (a build's `extras`, `defaults.addons`) | `packages/core/src/runner/runtime_extras.js`, `installArchive` |
| The models | "Another engine" — `installLlm`'s `runtimeModels` (built-in rows rewritten every seed, no reset) | `installLlm`, `seedRuntimeModels` |
| Model files | "A runtime's model files"; "Files already on this computer, into the cache" (`RuntimeService.adoptModel`) | `acquireFileSet`, `adoptFileSet` |
| Where a model runs, its memory | "An engine whose models load …"; "The graphics card's memory" | `packages/core/src/runner/speech_placement.js`, `SpeechPlacement`, `getArbiter` |
| One line of speech | "Run a transcription feature …; speak with a voice's model" | `withSpeechModel` |
| Transcription | the same row; a feature + an stt preset (`featureCatalog`, `enginePresets`, `featurePresets`) | `transcribeFeature`, `speechFeatureReadiness` |
| Settings that move into the kit | "Settings that change between versions" | `retireSettings` |
| The runtime's settings, speed bands | "A runtime's own settings" (`defaults.settings`, `PUT /v1/ai/runtimes/:id/settings`) | `packages/core/src/llm/stores.js`, `settingKey`, `bandKey` |
| What was measured | "What was measured on this computer" (already the table JustVoice writes) | `ModelMeasurementStore` |
| The screen | "A runtime's screens" (slots `before-models`, `model`, `after-models`) | `LuRuntimeTab` |
| Export jobs | "A long server job" | `JobRegistry`, `makeJobsRouter`, `runServerJob` |
| The DSP process | decided 2026-10-29: stays the app's, started through the kit; "Start a server process, find a port" | `spawnChild`, `findFreePort` |
| A refusal | "A refusal" (note: `statusCode`, not `status` — the kit session, 2026-10-29) | `ApiError` |
| Each family's request, its warm-up, the catalog | — (the kit leaves request shaping to the app: `llm/speech_dispatch.js:8`) | app — how each audio.cpp family is asked for speech, its warm-up and the voice catalog are the voice app's own |

No piece is NOT STANDARD as planned. The one candidate — moving the Japanese dictionary's folder into the kit's
`_addons/` by hand — is not proposed (§5 item 11).

## 3 · What the kit must do first

The family rule: a kit gap is filled in the kit before the app is built on it. Found by reading the kit at
`75d07f8` against JustVoice's code. None of these is fixed yet.

### 3.1 Bugs (each checked in code)

- **B1 · Under `npm run dev` the GPU servers start on the CPU.** `_load` passes `backend: null` for the gpu
  placement unless a setting names one (`runtime_service.js:1180`); `AudioCppServer.ensure` then takes
  `backendOf(exe)` (`audiocpp.js:289`), which reads the exe's folder — `…/build/jv-dev/bin` → "cpu"
  (`audiocpp.js:148-153`). Placement and booking meanwhile use the dev build's own backend (`_cardBackend`, `:967`).
  JustVoice's `backendOf` handles the dev exe (`engines/audiocpp/runtime.js:357-361`).
- **B2 · The `backend` setting picks no build.** `_pick` calls `selectRuntimeAsset(cfg.binaries, hw)` without its
  `preferredGpu` (`runtime_service.js:241`, `binary.js:1005`), but `_load` writes the setting into the server's
  config (`:1180`) and the setting's own note says it "pins that build" (`config.js:424`). Vulkan chosen on an
  NVIDIA box → the CUDA build started as Vulkan (INFERRED). JustVoice chose the build by it
  (`runtime.js:260-269`).
- **B3 · Install, Update and Reinstall never stop the running servers.** No `stopServer` in `install`/`_run`
  (`runtime_service.js:358-419`) or the Update route (`llm/runtimes_api.js:89-101`). A held model keeps serving
  from the old process (`useModel` checks running + registered, not the exe — `:1321-1326`), its measurements
  filed under the new build's tag (`_buildTag`, `:983`), and `_sweepStaleBuilds` deletes the old build under it
  (`:424-445`) — INFERRED for the consequences. JustVoice stopped them first (`manager.js:360-364, 405-414`).
- **B4 · Under `npm run dev`, eSpeak NG comes only from a full release install.** `extrasEnv` reads the pinned
  build's `_extras` only (`runtime_service.js:870-878`), while the status says installed once the dev exe exists.
  Without a release install, Kokoro loads whatever eSpeak NG the system has — the 2026-10-04 bug (RESEARCH §1.2).
- **B5 · A server that dies stays "loaded" with its booking** until the next load of its kind (`loaded()`
  `:1363-1365`; `_held` is cleared only by unload/drop/stop). JustVoice dropped a dead slot whenever anything asked
  (`manager.js:595-611`).
- **B6 · Installing or removing the dictionary, and removing the runtime, cut a line in flight.** `installAddon` /
  `removeAddon` call `stopServer()` without the kinds' locks (`:914, 926`); `uninstall` refuses only while
  `this._jobs > 0` (`:457`), a counter `useModel` never moves (it counts `_inUse`, `:1330`).
- **B7 · Nothing stops the servers when the app quits.** `AudioCppPool.killAllSync` (`audiocpp.js:552`) has no
  caller; `stopRuntimeServers` is called only by the template's reset/restore. Windows' Job Object covers it; on
  Mac/Linux they live until the next spawn's pid-file sweep. JustVoice armed `process.once("exit", killAllSync)`
  (`manager.js:2370`).
- **B8 · The install keeps the release's Python scripts** — `_run` passes no `dropFiles` (`:383-392`); the family
  keeps no Python (2026-10-08); JustVoice dropped every `.py` (`runtime.js:349-351`).
- **B9 · macOS Intel is gone.** The kit has one macOS row, arm64 (`config.js:388`); the jv.6 release has the Intel
  build and its digest (JustVoice `release.js:96`, `edfda2bc…`).
- **B10 · An eviction during a load can drop the booking without freeing anything** (INFERRED). A known price books
  early (`:1157`); the evictor unloads only a model already in `_held` (`:1010-1036`), which a loading model joins
  after its warm-up (`:1242`); and since `3ff3eed` a kind is busy only while a line runs, not during its load.
- **B11 · Two fields say what a model needs on the card.** Placement reads `spec.minVramGb`
  (`speech_placement.js:71`); the row's fit word reads `peak_vram_mb` (`runtime_service.js:522-532`). One seeded
  without the other shows "unknown" (`fit.js:120-121`). One field.
- **B12 · A shared cache's "Clear models cache" deletes the other apps' files.** When `<cache>/hf` is a real folder
  (here: JustWrite's `data/ai-cache`, JustVoice's `cache_root`), `clearModelsCache` removes it whole
  (`lifecycle.js:1793-1795`); only the link case removes the calling app's own rows' files. JustWrite's clear would
  delete JustVoice's chat models today, and its speech models after the move (INFERRED from code).
- **B13 · The runtime status's `running` is false for a pool runtime** — it reads `this._server`, which a pool never
  sets (`:189, 343`; INFERRED).
- **B14 · No settled reading after a render** (small): JustVoice re-read the resident model's memory once the
  render drained (`synth_scheduler.js:246-256` → `manager.js:1551`); the kit's per-line pass stays.

### 3.2 Gaps — what JustVoice has that the kit's half lacks, and where each goes

Each rec was attacked; the line under it says what that changed.

- **G1 · Transcription's request shaping.** `transcribeFeature` sends the app's body as it is, with no timeout
  (`speech_dispatch.js:37-44`): JustVoice's 16 kHz conversion, language names, its word list and the
  "3 × the recording" limit (`slot.js:670-773`) have nowhere to go. **Rec: a hook, `runtimeSpeech.audiocpp.
  transcribe(body, row)` → `{body, timeout}`, that `transcribeFeature` calls.** *Attack: JustVoice could call
  `withSpeechModel` with its own fn — but that bypasses the decided feature door; the hook keeps one way.*
- **G2 · A model's Auto/GPU/CPU, saved; where it would load and why, before a load; "Try the card again".** The kit's
  tab keeps the choice in screen memory (`LuRuntimeTab.vue:238`); `placementOf` and `forgetCardFailure` exist with
  no route (`runtime_service.js:1369, 1384`). **Rec: the kit saves the choice per model (a runner setting, not the
  seeded row), every load reads it, its tab shows the reason before a load and has "Try the card again".**
  *Attack: JustVoice could keep its own saved choice and route — but the kit tab's unsaved select would then be a
  second way to choose. The kit keeps it.*
- **G3 · A model's own load options on every load.** The tab's Load sends `{placement}` only (`LuRuntimeTab.vue:244`),
  and a load without `sessionOptions` registers only the row's defaults (`runtime_service.js:1094, 941`), so the
  options saved in JustVoice's panel are dropped. **Rec: a hook, `runtimeSpeech.audiocpp.sessionOptions(row)`,
  read by every load.** *Attack: "JustVoice passes them on each line" covers its own calls but not the kit tab's
  button; only a hook covers both.*
- **G4 · Load downloads a model that isn't on disk.** The kit refuses ("isn't downloaded", `runtime_service.js:738`),
  but its own chat load downloads (`lifecycle.js` `load`, status "downloading"); JustVoice's did too
  (`manager.js:1715-1756`), and a render, preview or capture of a never-downloaded model relies on it.
  **Rec: the runtime's load downloads first, as the chat load does, its progress on the tab.** *Attack: the
  kit's readiness door (`LuEngineNeeded`) is the other standard, but it has no speech feature to hang on — speech
  has no preset — and the chat load already sets the precedent.*
- **G5 · A licence the user accepts before a download.** Six engines need it here (`terms_accepted_at`); the kit's
  download has no gate (`runtime_service.js:633-662`). **Rec: a hook, `runtimeSpeech.audiocpp.beforeDownload(row)`,
  read by the Download button and by a load's download (G4), whose refusal (403 `terms-required`, as today) the kit
  tab hands to the app to show its terms dialog.** *Attack:
  kit-owned terms would move JustVoice's licence data into the kit for one app; the hook is smaller and the
  data stays with the facts it belongs to.*
- **G6 · Grouping, filters and sort in the tab.** About 218 model versions (148 speech, 70 transcription — counted on
  the working tree's catalog, §5 item 14; HEAD's has a few fewer) in one flat list,
  searched by name only past 12 (`LuRuntimeTab.vue:232-235, 397`); JustVoice groups by engine with a head (licence,
  tested, best for, Set as default) and a foot (terms, delete all), and filters by cloning, voices, commercial use,
  tested, direction, fit. **Rec: the kit tab takes a `group` function with `group-head`/`group-foot` slots and a
  `filter` function with a `filters` slot.** *Attack: JustVoice keeping its own tab is §19's "Never" ("a speech tab
  of the app's own"); a flat 218-row list isn't usable.*
- **G7 · The AI page adds its own bare runtime tab** (`AiModelsArea.vue:166, 904-908`): no slots, no way to hide it,
  beside JustVoice's "Speech engines". **Rec: AiModelsArea takes the app's slots for a runtime's tab, and
  JustVoice's own tab goes.** *Attack: hiding the kit's and hosting `LuRuntimeTab` in JustVoice's own tab is
  smaller, but leaves every other app the same problem.*
- **G8 · Controls for the runtime's settings.** The kit shows all 11 as text boxes (`LuRuntimeTab.vue:379-386`),
  plus idle minutes and one set of speed bands; JustVoice showed four as real controls: Backend from this machine's
  builds, GPU by name (only with more than one), CPU threads "of N cores", the card-overflow limit only where it can
  be measured. **Rec: the runtime's descriptor gives each setting its control (choices, visibility); the tab renders
  them; the stt bands get their editor (`bandsByKind` is never rendered); Reinstall (the route's `force`) gets its
  button.** *Attack: hiding the other seven (JustVoice's choice before) breaks the family rule that thresholds are
  editable — so they show; the words for any new label are yours.*
- **G9 · The tab tells the app nothing** (no emits): JustVoice's top-bar pill, Home and stores don't refresh after a
  Load in it. **Rec: the tab emits `changed` after a load, unload, install or delete.**
- **G10 · Speech's memory in the memory strip.** The kit's strip reads `/v1/llm-runner/resident`, which lists only
  chat models (`lifecycle.js` resident); speech's bookings are only in `committed_mb`. JustVoice's TTS · STT cells
  come from its own `/v1/engines/vram`, whose keys stop matching (`tts:audiocpp:<placement>`). **Rec: the strip shows
  each runtime kind's booking (speech, transcription, an image runtime's) and exports its cells for Home.**
  *Attack: rebuilding JustVoice's route over the new keys is smaller, but it's the second strip the family rule
  calls a bug, and house-paint's image runtime has the same need.*
- **G11 · The 1.1 GB aligner registers with every transcription load.** `_load` registers every entry
  (`runtime_service.js:1190`); JustVoice registered the aligner on the first alignment (`slot.js:514-518, 713-715`).
  `qwen3-forced-aligner-0.6b-q8_0.gguf` is 1,078 MB on disk here. **Rec: a companion registers on the first request
  that needs it.** *Attack: always loading it is simpler, and its price would be one number — but 1 GB more beside
  the AI model on an 8 GB card for a feature most captures never use is the wrong trade.*

- **G12 · Cancelling a load.** The kit left it out of the port, but its own chat load cancels: a stop during
  "downloading" or "starting" sets the load's cancel token (`lifecycle.js:2284-2289`), `_runLoad` checks it at each
  step (`:3368, 3411, 3437, 3475`) and `_cleanupCancelled` frees the booking (`:3291-3306`). JustVoice's did the
  same (`manager.js:1761-1781`; RESEARCH §1.1: "a Cancel 3 s into a VoiceDesign load ended it with nothing
  booked"). **Rec: the runtime's load takes the same token — an Unload during a load cancels it, its download
  included (G4).** *Attack: dropping it (my first rec) assumed the chat load had no cancel; it has one, so a
  runtime without it is the odd one out.*

Left out, recommended to stay out: **Cancel on the dictionary's download** — 47 MB.

### 3.3 What the kit built — the shapes JustVoice builds on (just-core `e45086d`, green, 2026-10-29)

From the kit session's hand-off, spot-checked in code (`runtimes.js:93` `placementKey`, `runtime_service.js:825-838`
the download gate, `AiModelsArea.vue:126, 140-141` `runtimeTabs`, `ui/src/composables/useMemoryCells.js:81`,
`lifecycle.js:2706` `runtime_bookings`, `config.js:392` the macOS Intel row). Its run: core 1619, template unit 135
and e2e 15, the guard clean; JustVoice's server 1384 and unit 261 on it. B14 dropped; every other §3 item built.

- **Rows:** `peakVramMb` = `min_vram_gb` × 1024 (the one card-need field; `spec.minVramGb` is no longer read);
  `refSpeed.cpu` = `cpu_realtime`; `spec.unloadStopsProcess`; the aligner companion
  `{role, family, task, slot, onDemand: true}`.
- **`installLlm` `runtimeSpeech.audiocpp`:** `warm({server, row, modelId, entries, calibrate})` → calibrated?;
  `pieceLength(row)`; `loadOptionsKey(row)`; `transcribe(body, row)` → `{body, timeout}`; `sessionOptions(row)` (may
  be async) — every load given none reads it; `beforeDownload(row)` answers **synchronously** — throw or return a
  problem to refuse (→ 403 `…/terms-required` `{modelId}`; a promise is a TypeError).
- **Dev build:** `runtimeExeOverrides.audiocpp = () => ({exe, backend, version})` — backend "cuda" | "vulkan" |
  "metal" | "cpu", version "dev · <commit>".
- **A line:** `withSpeechModel(runtimeId, modelId, {placement?, sessionOptions?, line?, needs?}, fn)` — no placement →
  the model's saved choice; `line(result)` → `{text, audioS}`; `needs: ["aligner"]` registers on-demand companions
  first. Errors carry `statusCode` (ApiError).
- **Transcription:** `transcribeFeature(featureKey, body, {timeout})`; the preset's "auto" defers to the model's saved
  choice, its gpu/cpu win.
- **The saved choice:** runner setting `placement:audiocpp:<modelId>` (`placementKey`).
- **Routes under `/v1/ai/runtimes/audiocpp`:** `PUT models/:id/placement {placement}` → the row;
  `POST models/:id/try-card` → the row; `POST models/:id/load {placement?, sessionOptions?}` → 200
  `{modelId, placement, kind, reason}` · 202 `{status: "downloading", modelId}` · 403 terms-required · 409
  `load-cancelled` · 409 `not-enough-memory`; `POST models/:id/unload` during a load cancels it; `GET models` adds
  `placementChoice`, `placement {where, reason, cardFailed} | null`, `loading "" | "downloading" | "loading"`,
  `loadError`; the engine status adds `settingsUi`, `kinds`, `bandsByKind`, `settings`,
  `loaded [{modelId, placement, kind, reason}]`, `running`.
- **Memory:** `/v1/llm-runner/resident` gains `runtime_bookings [{key, kind, runtime, placement, modelId, mb,
  source}]`; `useMemoryCells({llmClaim?, onRead?, every})` → `{resident, cells, start, stop}` for Home.
- **Screens:** `AiModelsArea` takes `runtimeTabs: {audiocpp: {hidden?, props}}` (props by v-bind: `group`, `filter`,
  `onChanged`, `onTermsRequired`); slots `runtime-audiocpp-<slot>`: `group-head` / `group-foot`
  `{group, models, shown, refresh}`, `filters` `{filters}`, `model` `{model, loaded, refresh}`, `before-models` /
  `after-models` `{engine, models, refresh}`; emits `changed {what, id}` and `terms-required {model, retry}`. Groups
  collapse; no sort; a model not on disk shows Download only.
- **Ledger:** `<kind>:audiocpp:<model>` (stt: for transcription); the card word is the build's own (cuda12, cuda13,
  vulkan, metal). macOS Intel is back (platform "macos-x64"). B12: in a shared cache, Clear removes only this
  app's files.

## 4 · JustVoice's move (after §3 lands), in order

Each slice: its own test red then green while building; the full suites, the build and the gate once at the end
(the user's rule, 2026-10-28).

1. **Seeds.** `runtimeModels` from the catalog (`generated.js` `variantRow` → `{runtime, id, name, kind, license,
   files: [{slot, repo, revision, path, sha256, bytes}], peakVramMb, minRamMb, refSpeed: {cpu}, spec}`): a `slot` per
   file (the main one `"model"`), each file's `sha256`/`bytes` from `catalog.json`, companions and session files by
   slot, `spec.espeak` for `kitten_tts`, `spec.unloadStopsProcess` for F5-TTS, `peakVramMb` = `min_vram_gb` × 1024
   (the kit's B11 fix: one field, read by placement and the fit word), `refSpeed.cpu` from `cpu_realtime`. **Pocket TTS's 198 voice files have no SHA-256 in our seeds** (`curated/pocket_tts.js:118`) — add
   them from Hugging Face's LFS ids (7 variants' are in their `files.json` already). `installLlm` gets `runtimes:
   ["audiocpp"]`, `runtimeModels`, `runtimeSpeech` (`warm` ← `slot.js` `_warm`/`_warmGenerated`; `pieceLength` ←
   `manager.js` `effectiveSplit` — the 800 cap included, not `split_chars` alone: 252 of 301 stored rows are at 800;
   `loadOptionsKey` ← `runtime_options.js` `priceKeyFor`, the model's engine looked up from the row id), and
   `runtimeExeOverrides.audiocpp = () => devBuild.current()`. `retireSettings`: `captures.stt_model` into the stt
   preset (decided) and the 11 `speech_runtime` keys into `<name>:audiocpp` (the same names and defaults — every
   value here is at its default), reading the raw settings row.
2. **Speech.** `render_core.js` (`:745-763`), `voice_model.js` (`:415-545`), `api/voice_preview_api.js`
   (`:373-377, 619-632`), `api/generate_api.js` and the MCP tools (through them) speak through
   `withSpeechModel("audiocpp", versionId, {placement, sessionOptions, line}, fn)`; `fn` = `slot.js`'s request
   shaping and `server.speech`; `line(wav)` → `{text, audioS: wavSeconds(wav)}`. The version is still chosen by
   JustVoice (`voice_model.variantForModel`, `resolvedDefaultVariant`). `EngineRequestError` maps the kit's
   `AudioCppError` and refusals. Feature checks (`slot.js` `featuresNeeded`, `featureRefusal`, and `pinnedHas`'s
   callers in `capability_details.js`, `generated.js`, `speech_runtime_api.js`) read `buildHas` (dev: all). What read
   a model's files from the speech cache reads the kit's `modelFor(id).files`: Kokoro's blends and IPA
   (`blending.js:129-149`, `kokoro/ipa.js`, `slot.js:880`), `voice_model.js:454`, `capture_readiness_api.js`. `manager.js`, `runtime.js`, `release.js`, `espeak.js`, `japanese.js` and `speech_cache.js`'s file half go
   (removed everywhere: code, tests, docs).
3. **Transcription.** One stt feature (§5 item 7) and its preset; `captures_api.js` (`:231-250`), `take_check.js`
   (`:102, 302-303`), `align_api.js` (`:35`), `captures._sttTranscribe` (MCP) through `transcribeFeature` (with
   G1's hook); alignment through `withSpeechModel` + `server.align`; `capture_readiness_api.js`'s stt half on
   `speechFeatureReadiness`.
4. **Routes.** Go: the managed half of `/v1/engines*` (install, load, cancel-load, unload, models, placement,
   card-failure, runtime-options, the engine delete), `/v1/speech-runtime*`, `/v1/jobs/:job_id` with
   `installer.js` and `AppState._jobs`, `/v1/engines/vram`, `/v1/engines/speech-cache/clear`, the leftovers routes,
   `/v1/engine-sources*` (§5 item 12). Stay: capabilities, terms, the external providers, the render cache, health's
   `current_engine`/`current_model` (re-read from the kit's `loaded()`). The five error messages that name
   `POST /v1/engines/:id/load` (`render_core.js:731,755`, `generate_api.js:206,359`, `manager.js:2331`) get the new
   words.
5. **The screen.** `SpeechEnginesTab.vue` goes; its pieces move into the kit tab's slots (G6–G7): the engine head and
   foot, the filters, the per-model chips and options panel, Set as default, the Picking card, the self-hosted
   servers. `stores/engines.js`, `services/capabilities.js`, `ttsJobChannel.js` (goes), `vramFeed.js` (goes with
   G10), `HomePage`, `MainLayout`'s pill, `QuickSetup`, `VoicesPage`, the persona pages and makers, and the deep links
   (`?tab=speech-engines` ×7 → the kit tab's id) read the kit's routes. The mock page and its data go
   (`pages/mock/MockSpeechEnginesPage.vue`, `services/mock/speechEnginesMock.js`, `scripts/mock-snapshots.js`'s
   engine half) — the screen is the kit's now.
6. **Jobs.** Exports onto `JobRegistry` + `makeJobsRouter` (at `/v1/jobs`, free once slice 4's routes go) +
   `runServerJob`; the finished file goes with `onForget`. `export_jobs_api.js`, `services/exportRun.js`, the user
   doc's section (`docs/import-and-export.md:415-422`).
7. **The DSP.** `audio/dsp_client.js` stops borrowing `runtime.js`'s `_childEnv`, `_freePort`, `_rotateLog` and its
   timeouts (`:114-137, 221`): the kit's `spawnChild` (decided), `findFreePort`, its own settings.
8. **Data on this PC** (§5 items 9–11): adopt the model files, install the runtime through the kit, then delete what
   is left — each deletion on your word.
9. **Docs and records.** User docs (§6.3), `docs/dev/RESEARCH.md` §1–§2 (what moved, with the was:), TASKS.
10. **The final pass.** `npm run lint`, `test:server`, `test:unit`, the family guard, the build, the gate against the
    running app, and the real app under `npm run dev`: install, Load on Auto/GPU/CPU, a render, a preview, a
    capture, a Kokoro Japanese line (the dictionary), an export — and one Qwen3-ASR line on the CPU, so Auto has this
    PC's speed again (§5 item 10).

### 4.1 Progress and the decisions taken while building (2026-10-29)

Under the user's go: "do it all dont stop if you find bugs are thing sto fix or add think adversirlay on it … take
your recs geti all finished go". Each change ran its own test, red then green; lint, the full suites, the build and
the gate wait for step 10 (the user's rule, 2026-10-28).

- **Step 1 + 7 BUILT** (d3a1c12b … 8223b4e1): `kit_models.js` (the rows), `kit_hooks.js`, `kit_settings.js`, the
  wiring, the settings' retirement, the DSP on the kit's port, log and environment; Pocket's 99 voice files' and 36
  small files' SHA-256s (fetched at their pinned revisions). The kit fixed G1's order on our report (52e663c: the
  transcription hook runs under the stt lock), and the 16 kHz copy was built on it.
- **Steps 2–4 BUILT** (5b6f56a4 + 00cc9407 … e1764725): speech through `withSpeechModel` (`kit_speech.js`),
  transcription as one "Transcription" feature on preset `p_transcription` (group "Editing", hint "Turns speech into
  text — your dictation, the read-back that checks each take, and agents' transcriptions."), the old engine code and
  routes removed, the kit's `runtimeProblem` for refusals (kit 284c67f; not installed → 409 `engine-not-installed`,
  kit later). Decided while building: `npm run dev`'s guard against a running app comes back in
  `scripts/audiocpp-dev.js`; `engine_overrides.*.placements` dropped (this PC's two were "auto"); the external
  path's messages point at "Try Test connection on AI Settings → Speech"; server messages say "AI Settings → Speech".
- **Steps 5–6 BUILT** (ba5ec71e … 4d480b6c): the kit's Speech tab with our slots; exports on the kit's job registry
  at `/v1/jobs`. Decided while building: online and self-hosted speech providers sit under the models in
  `after-models` (the old Local/Online folder tabs would need two kit features for one switch); Re-download, Open
  folder and the TTS/STT headings dropped; "Set as default" for speech only (transcription's model is its preset's).
  Asked of the kit: a sort for the tab (G6 left it out — my miss), the model Load as a kit service, the job strip's
  note, evictions announced. Follow-ups running: the "Loaded now" rail back, the chat model's on-demand claim, the
  repeated deep link, `mock-snapshots.js` off `createRequire`, a self-hosted server registered on save.
- **The fork** (the user: "merge it"): upstream merged into `jv` as dacb0d7f, pushed, unbuilt — its build and ctest
  run in step 10. The catalog is being rebuilt from it as `seed_audiocpp_catalog.json` (the kit's guard: seed data
  under the `seed_` prefix), the small-file hashes moving into `seed_file_hashes.js`.
- **Step 8 DONE on this PC (2026-10-29):** the kit's `adoptModel`, run once from a scratch command (no code shipped),
  moved 31 downloaded versions into the kit's models cache (`justwrite-app/data/ai-cache/hf`, the shared
  `cache_root`): 112 files adopted, 82 shared files linked, every SHA-256 checked by the kit (57 s), none refused.
  The 61 files left in `data/speech-cache` were each hashed and found byte-identical in the kit's cache (the
  IndexTTS 2.5 duplicate, Pocket's voice files shared across versions) before the folder was deleted. The kit then
  installed `v0.9.2-jv.6` (cuda12, eSpeak NG in its `_extras`, no `.py` files) and the Japanese dictionary add-on;
  `data/engines-runtime` (2.4 GB: jv.4 cuda12, v0.9.0 vulkan, the old eSpeak and dictionary) and
  `data/engines-runtime-config` deleted after, nothing in the code reading them. Left: `paths.speechCacheRoot` and
  its Disk usage row go with the next follow-up.
- **Still to do:** step 9 (docs, running), the switch to the kit's four new pieces (sort, the Load service, the job
  strip's note, evictions and the chat claim on the strip), step 10.

## 5 · Decisions for your word

1. **Send §3 to the kit session to fix and fill before JustVoice builds.**
   Rec: yes — B1–B14 as found, G1–G12 as recommended there.
   Attack: B1, B3, B6 and B10 lose data or break loads; building JustVoice on them means building on bugs. B2, B3 and
   B8 hold for every runtime (sd.cpp too), and G6–G10 change the tab and strip every app uses — that's for the kit
   session to weigh with house-paint. Changed: the note on the other apps.
2. **Load downloads a missing model** (G4). Rec: in the kit, as its chat load does. Attack in §3.2.
3. **Cancelling a load stays — in the kit, the chat load's way** (G12). Rec: an Unload during a load cancels it.
   Attack: my first rec was to drop it, on the belief that the kit's chat load can't be cancelled; it can
   (`lifecycle.js:2284-2289`). Changed: drop → keep, in the kit.
4. **The voice → model → version choice stays JustVoice's.** Rec: keep (`voice_model.variantForModel`, the engine's
   "Set as default"); the kit gets a concrete model id. Attack: dropping it means every voice stores a version id
   and loses the fallback when that version is deleted. Changed: nothing.
5. **A model's Auto/GPU/CPU, saved in the kit** (G2). Rec as in §3.2.
6. **The tab's name.** Rec: the kit's word, **"Speech"** (`kit.aiTabs.kinds.tts`), as every app's runtime tab is named
   by its kind; the deep links and docs follow. Attack: "Speech engines" is what the docs and seven links say today —
   but keeping it needs a kit label override for one app, and there are no users yet. Changed: nothing.
   Re-attacked: the kit is adding a label prop anyway (its session, 2026-10-29), so "Speech engines" would cost
   nothing in the kit — but the docs are rewritten in round E either way, and the family names a runtime's tab by
   its kind. Changed: nothing.
7. **Transcription's feature.** Rec: **one** stt feature for captures, read-back, alignment and the MCP tool — today
   it's one setting (`captures.stt_model`) — named **"Transcription"** (the kit's own kind word). Attack: separate
   features would let read-back use a faster model than dictation, but nobody asked for that, and each is another
   preset to set up. Changed: nothing.
   Re-attacked: read-back today uses the capture model or whichever recogniser is already loaded
   (`take_check.js:302-306` → `captures.ensureSttLoaded`); on the feature it always uses the preset's model — the
   same one unless someone loaded another by hand. Changed: nothing.
8. **The aligner loads on first use** (G11). Rec as in §3.2.
   Re-attacked: only `/v1/align` (chapter captions, `api/align_api.js:35`) aligns; read-back and captures only
   transcribe — so on-demand saves the 1.1 GB on every capture and read-back. Changed: nothing.
9. **The 89.7 GB of model files: adopt them once, with the kit's `adoptModel`, from a one-off command I run on this
   PC — no code shipped** — the kit hashing every file (23 versions were downloaded before the SHA-256 check).
   Then the emptied `data/speech-cache` and its 3.5 GB duplicate (`indextts/indextts-25-q8`, the same bytes as
   `index_tts2-indextts25-q8`) are deleted on your word.
   Attack: "no migrations" — but nothing ships, the reset keeps model files on purpose (`data_admin.js:135`), and the
   alternative is 89.7 GB downloaded again. The files land in JustWrite's cache folder (`cache_root`), so B12 must
   be fixed first. Changed: hash everything instead of vouching for the old manifests.
   Re-attacked: the move needs the rows first, Pocket's with their SHA-256s (§4 step 1), or its 7 downloaded
   versions can't be adopted; JustWrite's own reset doesn't empty the cache (its `data_admin.js` unloads models,
   it doesn't remove `ai-cache`). The deletions after it still wait for your word when they come up — the rec said
   "on your word". Changed: nothing.
10. **The stored measurements: let them go.** 779 rows under the old ids (`tts:<engine>:<version>`) aren't read by the
    kit (`tts:audiocpp:<version>`). Only 6 models' card prices are for the build running now; each re-measures on its
    first load (about 17 s for Qwen3 1.7B). The real loss is 11 models' CPU speeds (39 rows): Qwen3-ASR 1.7B's
    reference 2.6× replaces its measured 1.66×, so Auto may put it on the CPU once, measure it, and move it back.
    Attack: a one-time rename keeps them — a migration, which the rule forbids, for a loss that heals itself.
    Changed: nothing.
    Re-attacked: it heals only at the next load — speech models stay loaded (the runtime never idles them,
    `idleSeconds` 0), so Qwen3-ASR could sit on the CPU at 1.66× for a whole session. Its reference 2.6×
    (`curated/qwen3_asr.js:80`) against Auto's 2× bar (`models.js:441`) is what sends it there. Changed: the final
    pass runs one Qwen3-ASR line on the CPU (§4 step 10), so this PC's speed is measured again before anyone
    relies on it.
11. **The old engine install: the kit installs fresh, then the old one is deleted on your word.** 1.08 GB down — the
    same download our own pending jv.4 → jv.6 update needs — plus 47 MB for the dictionary; `data/engines-runtime`
    (2.4 GB) and `data/engines-runtime-config` deleted after. Attack: moving the dictionary's folder into the kit's
    `_addons/` saves 47 MB but is NOT STANDARD. Changed: nothing.
12. **What goes with JustVoice's engine code:**
    - its leftover-engine sweep, its routes and the start screen's help (`engines/leftovers.js`,
      `LeftoverEnginesHelp.vue`) — the kit's spawn seam covers the kit's servers and the DSP (Job Object on Windows,
      pid-file sweep elsewhere);
    - the per-version download mirror (`api/engine_sources_api.js`) — no screen uses it, and the kit pins files by
      SHA-256;
    - Settings' "Clear speech cache" — the kit's one models-cache clear does it (after B12);
    - the old mock Speech engines page.
    Rec: all go. Attack: the kit's pid-file sweep is unit-tested only (no Mac or Linux box here); an operator behind
    a firewall loses the mirror (the kit's HTTP honours proxies). Changed: nothing.
    Re-attacked: the DSP already starts through the kit's `spawnChild` (`audio/dsp_client.js:119`), so the kit's
    seam covers it; no screen calls the mirror's routes (grep `/sources` in `src/`: none). Changed: nothing.
13. **Exports onto the kit's job registry in round E; render jobs and book runs stay.** They persist and resume
    after a restart; the kit's registry lives in memory only (`platform/jobs.js:20-35`). Rec: as said; the
    persistence gap goes to the kit's list for after the release. Attack: two job systems is what §19 calls a bug —
    but the kit can't carry these yet, and building persistence now is outside round E. Changed: nothing.
14. **The uncommitted `catalog.json`** (written 2026-10-18 from the fork's `jv` branch at `9106c13a`, ahead of the
    jv.6 pin — 125 families against HEAD's 122). Not this session's. Rec: round E builds on HEAD's catalog (the pin's);
    whether that file is kept or thrown away is yours. Attack: a catalog ahead of its pin lists models the pinned
    build can't load — the bug RESEARCH §1.4 records. Changed: nothing.
    Re-attacked while building (2026-10-29): the three families only it has are `fish_drama3`, `open_wake_word` and
    `plapre` — Fish Audio Drama 3 is the model the listening rounds use (RESEARCH §10.33, 23 GB downloaded here), and
    the dev build (`npm run dev`, the fork's `jv`) runs it. Throwing the file away would take Drama 3 out of the app.
    Changed: keep it as it is — the row producer reads the catalog on disk, so round E changes nothing here (the
    KittenTTS 2 hashes for its revision `be39e32c` stay); its proper home is a fork release pinned with it, which is
    a release and waits for your word.

## 6 · Blast radius

### 6.1 What JustVoice code changes (greps at 78ca4a0e)

See the appendix below, pasted from the commands that produced it.

### 6.2 What the kit's half already changed for JustVoice

Nothing yet: `installLlm` mounts the runtimes router (`llm/install.js:89`), but JustVoice passes no `runtimes`
(`server/src/app.js:374-397`), so every `/v1/ai/runtimes/audiocpp/*` route answers 404. The kit session ran
JustVoice's suites on `75d07f8`: server 1384/1384, unit 261/261, build:unpacked.

### 6.3 User docs that change

`docs/engines.md` — "The speech runtime" (:52-156), "Where the list comes from" (:157-211), all of "Reading AI
Settings → Speech engines" (:212-683), "Where each model runs" (:929-1076), "Loading and unloading" with
"Cancelling an in-flight load" (:1210-1380), "Where model files live" (:1397-1425) · `troubleshooting.md` :20-24,
:48-58 · `gpu.md` "Which build the runtime uses" (:17-52), "The shared memory budget" (:53-106), "Engines left over"
(:202-), "Troubleshooting" (:256-277) · `quick-setup.md` :12-15, :61-96 · `getting-started.md` :9, :37 ·
`dictation.md` :7, :18 · `personas.md` :200, :212-213, :270, :576 · `ai-providers.md` :5, :9, :26, :72 ·
`ai-features.md` :145, :714 · `settings-reference.md` :18, :36 · `backups-and-data.md` :54, :80 · `studio.md` :140,
:1073 · `lexicons.md` :213, :227 · `import-and-export.md` :415-422 (exports) · in the app: `SettingsPage.vue:922-924`
(the API table).

## 7 · Not in round E (found on the way, for the lists)

- The kit's job registry can't persist or resume a job — render jobs and book runs need both (§5 item 13).
- The kit's other hand-offs for JustVoice (just-core TASKS "FOR JUSTVOICE'S SESSION"): the release rule, release.yml
  on the actions' latest majors, the roadmap and ideas list, the e2e onto the template's driver (the kit session
  found `scripts/e2e.js` stale at "⬇ Import"), the 8 bare `element.click()` tests, `resourceIsolation` + `crossorigin`
  audio, AGENTS.md, `installErrorReporting`, UiServerImage's token, ImportModal onto UiSelect's groups, the
  2026-10-20 changes, LanguagePicker, the a11y test and getting-started's "Installing it".

---

## Appendix · blast-radius greps

```
# 1. Importers of the modules that go (server/src, scripts — tests counted in 7)
$ grep -rln --include=*.js -E "engines/(manager|audiocpp/(runtime|release|espeak|japanese)|leftovers)\.js|speech_cache\.js|installer\.js|engine_sources_api" server/src scripts
scripts/audiocpp-catalog.js
scripts/audiocpp-dsp-package.js
scripts/mock-snapshots.js
server/src/api/cache_api.js
server/src/api/capture_readiness_api.js
server/src/api/captures_api.js
server/src/api/engine_sources_api.js
server/src/api/engines_api.js
server/src/api/engines_models_api.js
server/src/api/generate_api.js
server/src/api/health_api.js
server/src/api/models_api.js
server/src/api/personas_api.js
server/src/api/speech_runtime_api.js
server/src/api/voice_bundle_api.js
server/src/api/voice_preview_api.js
server/src/api/voices_api.js
server/src/app.js
server/src/audio/dsp_client.js
server/src/book_run.js
server/src/data_admin.js
server/src/engines/audiocpp/generated.js
server/src/engines/audiocpp/japanese.js
server/src/engines/audiocpp/runtime.js
server/src/engines/audiocpp/slot.js
server/src/engines/base.js
server/src/engines/blending.js
server/src/engines/index.js
server/src/engines/leftovers.js
server/src/engines/manager.js
server/src/installer.js
server/src/render_core.js
server/src/serve.js
server/src/speech_cache.js
server/src/synth_scheduler.js
server/src/take_check.js
server/src/voice_model.js

# 2. Every manager call (server/src)
$ grep -rn --include=*.js -E "getManager\(\)\.[a-zA-Z_]+|\bmgr\.[a-zA-Z_]+\(" server/src | grep -v "engines/manager.js" | grep -oE "^[^:]+|(getManager\(\)|mgr)\.[a-zA-Z_]+" | paste - - | sort | uniq -c
      1 getManager().bumpEngineReservation	server/src/take_check.js
      1 getManager().currentId	server/src/api/models_api.js
      1 getManager().getManifest	server/src/api/engines_api.js
      1 getManager().getManifest	server/src/api/engines_models_api.js
      1 getManager().getManifest	server/src/api/generate_api.js
      2 getManager().getManifest	server/src/render_core.js
      1 getManager().manifests	server/src/api/engines_api.js
      1 getManager().uninstall	server/src/api/engine_sources_api.js
      1 mgr.currentFor	
      1 mgr.currentFor	mgr.currentVariantId
      1 mgr.currentFor	server/src/api/engines_models_api.js
      1 mgr.currentFor	server/src/take_check.js
      1 mgr.currentId	mgr.unload
      1 mgr.currentId	server/src/api/engines_api.js
      2 mgr.currentId	server/src/api/generate_api.js
      1 mgr.currentVariantId	mgr.currentVariantId
      1 mgr.currentVariantId	server/src/api/health_api.js
      1 mgr.currentVariantId	server/src/api/models_api.js
      1 mgr.currentVariantId	server/src/render_core.js
      2 mgr.currentVariantId	server/src/voice_model.js
      1 mgr.forgetCardFailure	server/src/api/models_api.js
      1 mgr.getManifest	server/src/api/engines_api.js
      1 mgr.getManifest	server/src/api/generate_api.js
      1 mgr.getManifest	server/src/api/health_api.js
      4 mgr.getManifest	server/src/api/models_api.js
      1 mgr.load	server/src/api/engines_models_api.js
      1 mgr.manifests	server/src/api/engines_api.js
      1 mgr.manifests	server/src/api/generate_api.js
      1 mgr.resolvedDefaultVariant	server/src/api/engines_api.js
      1 mgr.resolvedDefaultVariant	server/src/voice_model.js
      1 mgr.resolvedDeviceFor	server/src/api/engines_api.js
      1 mgr.resolvedDeviceFor	server/src/api/models_api.js
      2 mgr.status	mgr.currentVariantId
      1 mgr.status	server/src/api/engines_api.js
      1 mgr.status	server/src/api/engines_models_api.js
      1 mgr.status	server/src/api/models_api.js
      1 mgr.synth	server/src/api/health_api.js
      1 mgr.synth	server/src/synth_scheduler.js
      1 mgr.unload	server/src/api/engines_models_api.js
      1 mgr.voices	server/src/api/generate_api.js
      1 server/src/api/align_api.js	mgr.align
      1 server/src/api/cache_api.js	getManager().getManifest
      1 server/src/api/capture_readiness_api.js	mgr.currentVariantId
      1 server/src/api/capture_readiness_api.js	mgr.loadedFor
      1 server/src/api/captures_api.js	mgr.load
      1 server/src/api/captures_api.js	mgr.loadedFor
      1 server/src/api/captures_api.js	mgr.status
      1 server/src/api/captures_api.js	mgr.transcribe
      1 server/src/api/engines_api.js	getManager().currentId
      1 server/src/api/engines_api.js	getManager().manifests
      1 server/src/api/engines_api.js	mgr._hardware
      2 server/src/api/engines_api.js	mgr.currentVariantId
      1 server/src/api/engines_api.js	mgr.getManifest
      2 server/src/api/engines_api.js	mgr.loadedFor
      1 server/src/api/engines_api.js	mgr.placementReasonFor
      1 server/src/api/engines_api.js	mgr.poolUsedMb
      1 server/src/api/engines_api.js	mgr.resolvedDefaultVariant
      1 server/src/api/engines_api.js	mgr.resolvedDeviceFor
      1 server/src/api/engines_models_api.js	getManager().requestCancelLoad
      1 server/src/api/engines_models_api.js	mgr.currentFor
      1 server/src/api/engines_models_api.js	mgr.currentId
      2 server/src/api/models_api.js	getManager().getManifest
      1 server/src/api/models_api.js	mgr._failedOnCard
      1 server/src/api/models_api.js	mgr.cpuSpeed
      2 server/src/api/models_api.js	mgr.getManifest
      1 server/src/api/models_api.js	mgr.manifests
      1 server/src/api/models_api.js	mgr.measuredMbFor
      2 server/src/api/models_api.js	mgr.placementFor
      1 server/src/api/models_api.js	mgr.placementReasonFor
      1 server/src/api/models_api.js	mgr.resolvedDeviceFor
      1 server/src/api/models_api.js	mgr.status
      1 server/src/api/models_api.js	mgr.unload
      1 server/src/api/personas_api.js	getManager().getManifest
      1 server/src/api/speech_runtime_api.js	mgr.loadedFor
      1 server/src/api/speech_runtime_api.js	mgr.unload
      1 server/src/api/voice_bundle_api.js	getManager().manifests
      1 server/src/api/voice_preview_api.js	getManager().getManifest
      1 server/src/api/voice_preview_api.js	mgr.currentId
      4 server/src/api/voice_preview_api.js	mgr.getManifest
      1 server/src/api/voice_preview_api.js	mgr.load
      1 server/src/api/voice_preview_api.js	mgr.synth
      1 server/src/api/voices_api.js	getManager().manifests
      1 server/src/api/voices_api.js	mgr.manifests
      1 server/src/app.js	getManager().loadedSpeechModels
      1 server/src/app.js	mgr.manifests
      1 server/src/book_run.js	getManager().getManifest
      1 server/src/data_admin.js	getManager().unload
      1 server/src/engines/audiocpp/slot.js	getManager().manifests
      1 server/src/engines/model_catalog.js	getManager().getManifest
      1 server/src/engines/model_catalog.js	getManager().resolvedDefaultVariant
      2 server/src/installer.js	mgr.getManifest
      1 server/src/installer.js	mgr.install
      1 server/src/render_core.js	getManager().manifests
      1 server/src/render_core.js	mgr.splitCharsFor
      2 server/src/voice_model.js	mgr.currentFor
      1 server/src/voice_model.js	mgr.currentVariantId
      2 server/src/voice_model.js	mgr.load
      1 server/src/voice_model.js	mgr.resolvedDefaultVariant

# 3. Renderer callers of the routes that go
$ grep -rn --include=*.js --include=*.vue -E "/v1/(speech-runtime|jobs/|engines/(vram|leftovers|speech-cache|unload|\\$\{[^}]+\}/(install|load|cancel-load|models)))" src | grep -v -E "\.test\.|/mock/"
src/components/LeftoverEnginesHelp.vue:26:    found.value = await api.request("/v1/engines/leftovers");
src/components/LeftoverEnginesHelp.vue:58:    const out = await api.request("/v1/engines/leftovers/stop", { method: "POST" });
src/components/PersonaCloneMaker.vue:187:  const r = await api.safeRequest(`/v1/engines/${e.id}/models`, { variants: [] });
src/components/PersonaDesignMaker.vue:58:  const r = await api.safeRequest(`/v1/engines/${e.id}/models`, { variants: [] });
src/components/QuickSetup.vue:15:    ✅ per-engine install progress (poll job_id via /v1/jobs/{id})
src/components/QuickSetup.vue:144:    const r = await api.safeRequest(`/v1/engines/${id}/models`, { variants: [] });
src/components/SpeechEnginesTab.vue:13:      ttsJobChannel (POST → job_id → GET /v1/jobs/{id} → DELETE is exactly
src/components/SpeechEnginesTab.vue:89:// poller over `/v1/engines/vram` (AiView passes its cells up). This tab
src/components/SpeechEnginesTab.vue:197:        const models = await api.request(`/v1/engines/${eng.id}/models`).catch(() => ({ variants: [] }));
src/components/SpeechEnginesTab.vue:240:// PUT /v1/speech-runtime, which frees the speech slots and stops the server
src/components/SpeechEnginesTab.vue:263:  runtime.value = await api.safeRequest("/v1/speech-runtime", null);
src/components/SpeechEnginesTab.vue:308:  const task = makeJobDownloadTask(api, "/v1/speech-runtime/japanese-dictionary", {});
src/components/SpeechEnginesTab.vue:324:    runtime.value = await api.request("/v1/speech-runtime", {
src/components/SpeechEnginesTab.vue:380:      `/v1/engines/${encodeURIComponent(e.id)}/models/${encodeURIComponent(v.id)}/placement`, {
src/components/SpeechEnginesTab.vue:398:    await api.request(`/v1/engines/${encodeURIComponent(e.id)}/models/${encodeURIComponent(v.id)}/card-failure`, { metho
src/components/SpeechEnginesTab.vue:418:      `/v1/engines/${encodeURIComponent(e.id)}/models/${encodeURIComponent(v.id)}/runtime-options`, {
src/components/SpeechEnginesTab.vue:544:    const resp = await api.request("/v1/engines/unload", {
src/components/SpeechEnginesTab.vue:579:    await api.request(`/v1/engines/${e.id}/models/${encodeURIComponent(v.id)}`, { method: "DELETE" });
src/components/SpeechEnginesTab.vue:648:    await api.request(`/v1/engines/${e.id}/models/${encodeURIComponent(v.id)}`, { method: "DELETE" });
src/components/SpeechEnginesTab.vue:821:    await api.request("/v1/engines/unload", {
src/pages/SettingsPage.vue:759:    const res = await api.request("/v1/engines/speech-cache/clear", { method: "POST" });
src/services/engineFacts.js:51: * safety margin (`marginMb`, the server's: /v1/engines/vram `safety_margin_mb`) are no more than
src/services/ttsJobChannel.js:4:// GET /v1/jobs/{id} → DELETE /v1/jobs/{id} — IS the kit's channel contract
src/services/ttsJobChannel.js:32:  return jobChannel(api, `/v1/engines/${engineId}/install`, startBody);
src/services/ttsJobChannel.js:36: *  download (gap 7) polls /v1/jobs/{id} exactly like an engine install. */
src/services/ttsJobChannel.js:49:    fetch: () => api.request(`/v1/jobs/${jobId}`),
src/services/ttsJobChannel.js:62:      if (jobId) await api.request(`/v1/jobs/${jobId}`, { method: "DELETE" });
src/services/ttsJobChannel.js:81:// A load is NOT a job: there is no `/v1/jobs/{id}` to poll, so the request's own
src/services/ttsJobChannel.js:95:      await api.request(`/v1/engines/${engineId}/load`, {
src/services/ttsJobChannel.js:111:    cancel: () => api.request(`/v1/engines/${engineId}/cancel-load`, { method: "POST" }),
src/services/vramFeed.js:3:// poller over `/v1/engines/vram` whose cells the kit's top strip renders
src/services/vramFeed.js:27:  const v = await api.safeRequest(`/v1/engines/vram?events_since=${lastEventSeq}`, null);

# 4. The job channel and its users
$ grep -rn --include=*.js --include=*.vue -E "makeEngineLoadTask|makeEngineDownloadTask|makeJobDownloadTask|engineLoadChannel" src | grep -v /mock/
src/components/QuickSetup.vue:27:import { makeEngineDownloadTask } from "../services/ttsJobChannel.js";
src/components/QuickSetup.vue:195:    runtimeTask.value = makeEngineDownloadTask(api, first.id, {});
src/components/SpeechEnginesTab.vue:46:import { makeEngineDownloadTask, makeEngineLoadTask, makeJobDownloadTask } from "../services/ttsJobChannel.js";
src/components/SpeechEnginesTab.vue:283:  const task = makeEngineDownloadTask(api, first.id, repair ? { repair: true } : {});
src/components/SpeechEnginesTab.vue:308:  const task = makeJobDownloadTask(api, "/v1/speech-runtime/japanese-dictionary", {});
src/components/SpeechEnginesTab.vue:513:  const task = makeEngineLoadTask(api, engine.id, { model_variant: variantId || null });
src/components/SpeechEnginesTab.vue:530:  // The task announces `jv:health-refresh` itself now (see engineLoadChannel),
src/components/SpeechEnginesTab.vue:664:  const task = makeEngineDownloadTask(api, engine.id, { model_variant: variantId });
src/pages/PersonaEditorPage.vue:52:import { makeEngineLoadTask } from "../services/ttsJobChannel.js";
src/pages/PersonaEditorPage.vue:558:  const task = makeEngineLoadTask(api, mv.engine_id, { model_variant: chosenVersion.value });
src/services/ttsJobChannel.js:70:export function makeEngineDownloadTask(api, engineId, startBody = {}) {
src/services/ttsJobChannel.js:75:export function makeJobDownloadTask(api, startPath, startBody = {}) {
src/services/ttsJobChannel.js:92:export function engineLoadChannel(api, engineId, { model_variant = null, device = "auto" } = {}) {
src/services/ttsJobChannel.js:120:export function makeEngineLoadTask(api, engineId, opts = {}) {
src/services/ttsJobChannel.js:121:  return createDownloadTask(engineLoadChannel(api, engineId, opts));

# 5. Settings that move into the kit
$ grep -rn --include=*.js -E "speech_runtime|stt_model" server/src | grep -v "^server/src/engines/audiocpp/runtime.js"
server/src/api/captures_api.js:239:    log.info(`loading speech recognition (${settings.captures.stt_model}) for its first use`);
server/src/api/captures_api.js:240:    await mgr.load("asr", { device: "auto", variant: settings.captures.stt_model });
server/src/api/capture_readiness_api.js:8:// model the dictation setting names (`settings.captures.stt_model`) is in the speech cache. It
server/src/api/capture_readiness_api.js:48:    const want = st.settings.get().captures.stt_model;
server/src/api/speech_runtime_api.js:3:// of justvoice/api/speech_runtime_api.py).
server/src/api/speech_runtime_api.js:32:const log = getLogger("justvoice.api.speech_runtime_api");
server/src/api/speech_runtime_api.js:53:  backend_setting: opt(T.String(), "auto"), // settings.engines.speech_runtime.backend
server/src/api/speech_runtime_api.js:55:  gpu: opt(T.Integer(), 0), // settings.engines.speech_runtime.gpu
server/src/api/speech_runtime_api.js:167:    const old = cur.engines.speech_runtime;
server/src/api/speech_runtime_api.js:175:      cur.engines.speech_runtime = next;
server/src/app.js:72:import { router as speechRuntimeRouter } from "./api/speech_runtime_api.js";
server/src/engines/manager.js:88:// line is longer than `speech_runtime.runaway_s_per_char` seconds a character of its text (0.5;
server/src/engines/manager.js:89:// slow narration is about 0.1) and than `speech_runtime.runaway_min_s` (30 s); its process's
server/src/engines/manager.js:575:    // (speech_runtime.runaway_s_per_char). Keyed by the process, not the slot — the process
server/src/engines/manager.js:1147:   * JustVoice's own setting (`speech_runtime.card_margin_mb`, 512 MB), not the AI model's
server/src/engines/manager.js:1511:   * line (speech_runtime.runaway_s_per_char). */
server/src/models.js:484:  speech_runtime: optModel(SpeechRuntimeSettings),
server/src/models.js:502:  stt_model: opt(T.String(), "qwen3-asr-1.7b-q8"), // variant id on the asr engine
server/src/models.js:544: * (`engines.speech_runtime.runaway_s_per_char` and `runaway_min_s`). A failed take is rendered
server/src/take_check.js:8://     (`runtime.runawayLimitS` — `speech_runtime.runaway_s_per_char` and `runaway_min_s`, the

# 6. Writers of the measurement rows that are orphaned
$ grep -rn --include=*.js -E "getModelMeasurementStore\(\)" server/src
server/src/engines/manager.js:698:      for (const row of stores.getModelMeasurementStore().list(`${kind}:${engineId}:${variant || ""}`)) {
server/src/engines/manager.js:775:      for (const row of stores.getModelMeasurementStore().list(EngineManager._measureId(kind, engineId, variant))) {
server/src/engines/manager.js:1005:      for (const row of stores.getModelMeasurementStore().list(EngineManager._measureId(kind, engineId, variant))) {
server/src/engines/manager.js:1022:    return stores.getModelMeasurementStore().clear(EngineManager._measureId(kind, engineId, variant), "no_card");
server/src/engines/manager.js:1029:      const store = stores.getModelMeasurementStore();
server/src/engines/manager.js:1115:      stores.getModelMeasurementStore().record(`${kind}:${engineId}:${variant}`, {
server/src/engines/manager.js:1304:      const store = stores.getModelMeasurementStore();
server/src/engines/manager.js:1384:      for (const row of stores.getModelMeasurementStore().list(EngineManager._measureId(kind, engineId, variant))) {
server/src/engines/manager.js:1482:      const store = stores.getModelMeasurementStore();

# 7. Tests that import the modules that go (count of import lines per file)
$ grep -rc --include=*.js -E "engines/(manager|audiocpp/(runtime|release|espeak|japanese|slot)|leftovers)\.js|speech_cache\.js|installer\.js|engine_sources_api" server/tests src | grep -v ":0$"
server/tests/audiocpp_catalog.test.js:1
server/tests/audiocpp_dev_build.test.js:5
server/tests/audiocpp_every_family.test.js:3
server/tests/audiocpp_generated.test.js:2
server/tests/audiocpp_switch.test.js:8
server/tests/audit_step5.test.js:7
server/tests/cpu_placement.test.js:4
server/tests/designed_voice_parity.test.js:2
server/tests/engine_deprecation.test.js:2
server/tests/engine_knob_wiring.test.js:3
server/tests/engine_lifetime.test.js:3
server/tests/engine_local_load.test.js:4
server/tests/engine_manifests.test.js:1
server/tests/engine_sources_and_prefetch.test.js:6
server/tests/engine_vram_wiring.test.js:3
server/tests/engines_helpers.js:1
server/tests/factory_reset.test.js:1
server/tests/health_model_name.test.js:1
server/tests/japanese_dictionary.test.js:6
server/tests/kokoro_blends.test.js:4
server/tests/kokoro_ipa.test.js:5
server/tests/os_gate.test.js:2
server/tests/project_lexicon.test.js:1
server/tests/qwen3_reference_silence.test.js:3
server/tests/render_helpers.js:1
server/tests/render_jobs.test.js:1
server/tests/runtime_life.test.js:6
server/tests/runtime_update.test.js:6
server/tests/seven_engines_slice4.test.js:3
server/tests/seven_engines_unchanged.test.js:3
server/tests/spec_settings_and_load_options.test.js:3
server/tests/speech_cache.test.js:2
server/tests/split_and_calibration.test.js:4
server/tests/synth_scheduler.test.js:1
server/tests/take_check.test.js:1
server/tests/turbo_cloning.test.js:3
server/tests/variant_wiring.test.js:6
server/tests/voice_model.test.js:2
server/tests/voice_preview_text.test.js:1
server/tests/voice_row_preview.test.js:1
src/services/mock/speechEnginesMock.js:3
```
