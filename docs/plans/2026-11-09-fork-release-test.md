# The fork's release: JustVoice's test of the merged fork, and its part after the tag (2026-11-09)

**Read this FIRST after any compaction.**

## The job

The user, 2026-11-09, answering "1. Push and tag our audio.cpp copy (the release session's job). 2. Release
JustVoice.": "1 go". In the family release session the user also said "your rec on all go", which covers the
fork's merge, push and v0.9.4-jv.7 release, and then JustVoice's own release (that session's steps; TASKS "Our
audio.cpp fork is released with the family").

This session's part (agreed with family-release, 2026-11-09):

- (b) Build JustVoice's dev build from the merged fork, 9784e04c (upstream 047fb424 merged into jv by
  family-release with no conflicts). Test what the merge changes through the app, then send family-release
  PASS or the fault. After that, send "CPU free" so it can run the fork's CPU ctest.
- The curation: notes or NOT_OFFERED entries for any package the merge newly offers, decided from a
  catalog preview at 9784e04c and committed before "JustVoice ready".

The release steps are family-release's, by the user's decision of 2026-11-07 ("hand it off to the release
session not do it yourslef"), as it proposed and I agreed: (c) the push and the dispatch of release.yml
v0.9.4-jv.7; (3) the kit's pin, rows and AUDIOCPP_BUILDS_IN_ORDER; regenerating seed_audiocpp_catalog.json at
the tag with scripts/audiocpp-catalog.js; the What's new line; JustVoice's suites in its full pass on the final
kit commit. It commits only those paths here, and tells me before it touches this tree.

## What the merge changes (408935bf..047fb424, 11 commits, 108 files)

Ming3 Audio on shared MoE (#1238); Qwen3-TTS opt-in BF16 activation rounding (#1248); sense_asr word timestamps
(#1236); Nemotron Transcribe and Audio8 touched; logging-only tensor readbacks removed in the framework (#1240);
the C API log callback (#1235); the SYCL backend (#1241/#1242/#1246) and YuE2 on SYCL (#1243); the web UI's
model path status (#1249); 2 model_specs files.

## The test (mine, attacked)

The rule is that an audio.cpp update is tested on what it changes (2026-10-15), through the app, on the dev
build (`JUSTVOICE_AUDIOCPP_BUILD`) and the user's data. Each changed family JustVoice offers gets one line,
read back by Qwen3-ASR, or one transcription for a recogniser. Because the framework changed under every
model, the two defaults, VoxCPM2 and Drama 3, also get one line each. RAM and the card are booked with
just-stage and just-direct-mocap.

## Where it stands

- [x] Dev build at 9784e04c: 16:53–16:59, 395 s, exit 0 (`jv-dev-build.json`: 9784e04c, clean).
- [ ] Tests: Ming3 Audio, Qwen3-TTS, Nemotron Transcribe, Audio8, sense_asr (if offered), VoxCPM2, Drama 3
- [x] Catalog preview at 9784e04c (scratchpad `fork-jv7/catalog_preview.js`, written to the scratchpad and never
  to the repo's seed). No family or package added or removed, and no offered package changed. Three changes:
  Qwen3-TTS gets one new session option, `activation_type` (f32/bf16, default f32 = the existing path), with the
  rest moved down one place. SenseVoice (sense_asr) gets the request option `return_timestamps` (default false)
  and the capability `word_timestamps`. VoxCPM2's `voxcpm2_safetensors` source revision moved, and JustVoice
  doesn't offer that package (it offers q8_0 and bf16).
  **Curation: none needed** (mine, attacked). JustVoice takes every spec option at audio.cpp's default and folds
  one it has no words for under Advanced (runtime_options.js, the adoption plan's E4). Both new options default
  to the existing behaviour, and no curated file names them. No server test pins these options (grep).
- [x] The server suite on the previewed catalog (scratchpad `fork-jv7/catalog_redirect.js`, a preload that
  redirects only that file's read; checked that it does: generated.js reads 9784e04c with it, 73a2b82e
  without). 17:02–17:03: 159 files, 1313 passed, 1 skipped, exit 0. The second skip of the first run, "each
  entry offers what audio.cpp's own web UI offers", runs only with the checkout at the catalog's commit, so it
  ran here and passed. "A catalog built at a release tag is the pinned release's" runs only on a tag's catalog,
  at step (4).
- The test set, decided (mine, attacked in three rounds):
  - Tested, because the merge changes their code and JustVoice offers them: Qwen3-TTS (CustomVoice 1.7B, the
    engine's default), Audio8 TTS, Nemotron Transcribe, SenseVoice. Tested because they are the defaults and the
    framework changed under every model: VoxCPM2 and Drama 3.
  - Not tested: Ming3 Audio (#1238's refactor). Its smallest package is 10 GB (20.2 GB bf16), above the 8 GB card.
    It has never run in JustVoice (`ranHere` false), it is no pick, and the merge refactors it without adding it.
    The 2026-10-15 rule tests what an update adds. Testing it would need a 10–20 GB download and a CPU load beside
    the other sessions' jobs on a 32 GB machine (the lockup of 2026-11-08). Named as untested in the report.
  - Downloads through the app (POST …/models/<id>/download, AI Settings → Speech's Download). VoxCPM2 q8 and
    Qwen3 CustomVoice 1.7B q8 were on disk at once, since their files are the same blobs at the new model
    revision 73ce4162; only the snapshot links were missing. Audio8 (1.4 GB) and SenseVoice (0.3 GB) downloaded.
- Found on the way, a plain fault fixed: `scripts/node24.js`, `scripts/smoke.js` and `scripts/smoke_gui.js` used
  `createRequire`, against the family rule (ES modules, no createRequire). Electron's entry and Playwright's
  `chromium` now come by `import`. node24.js was tested by the server suite: 159 files, 1312 passed, 2 skipped,
  exit 0. smoke.js is next, through the smoke gate.
- [x] Tests, 17:08–17:12, through the app (`npm run server` on the user's data, the runtime reporting
  `dev · 9784e04c`). TTS: one line, "The rain kept on, and the old house creaked in the wind.", seed 7, read back
  by the app's Transcription preset (Qwen3-ASR 1.7B q8). Recognisers: the test voice's clip and its transcript,
  with the preset set to the model and put back (checked "restored: yes").
  - Drama 3 (fish_drama3-fishdrama3, a clone through POST /v1/voices/preview, saving nothing): every word, 62.6 s.
  - VoxCPM2 (the same way): every word, 36.2 s.
  - Audio8 TTS Preview 0.6B (the same way, its first run here): every word, 22.1 s.
  - Nemotron Transcribe (iq4_nl, on the card): every word, punctuation aside, 61.8 s.
  - SenseVoice-Small: the words, with `<period>`, `<io` and `<io>` in the text and "Ah!" dropped. **Not the
    merge's**: the pinned release v0.9.2-jv.6's CLI gives the same text on the same clip, and RESEARCH §10
    recorded these tags on 2026-10-15/16 (the model spells them out of ordinary pieces; "not fixed here").
    No new fact, so the decision to keep it offered stands.
  - Qwen3-TTS CustomVoice 1.7B (Aiden): first refused, because /v1/generate needs the engine loaded (the app's
    rule, "Load it on AI Settings → Speech first"). Loaded through the app (placement gpu, "your choice": the
    user's setting) and run again.
  - Memory: Drama 3's speech server (~17 GB working set, mostly its expert files mapped from disk, 9.9 GB
    private) and Qwen3-ASR's loading overlapped for ~10 s, with free RAM at 2.3–2.8 GB (17:09:53–17:10:05). Then
    the app stopped the speech server and free RAM came back to 18 GB. That is the app's normal swap for Drama 3
    plus the read-back check, not something this merge changed. Blender (just-stage's CPU work) held 2.9 GB.
  - Qwen3-TTS CustomVoice 1.7B, loaded: Aiden every word, 2.0 s. In Chinese ("今天下雨了，老房子在风中吱吱作响。我们坐在窗边，
    听着雨声。", language zh-CN, read back by Qwen3-ASR with language zh): Vivian seeds 7 and 11, Serena and Uncle Fu,
    each every character. SenseVoice on Vivian's take: every character on both builds (RESEARCH §10).
  - My mistake, caught: the first Chinese take was nonsense ("啊啊啊…"), because I passed the Chinese text inside a
    `curl -d` argument on Git Bash, which garbled it before it reached the app. Chinese text goes in a file or a
    Node script, never a shell argument.
- [x] PASS to family-release at 17:2x, with "CPU free" for its ctest. "Card free" to just-stage and
  just-direct-mocap. Stopping the server's task left its two audiocpp_server processes on the card (5.7 GB). Found
  by GPU process memory, stopped by PID, and checked: the card back to 517 MiB, 17494 free.
- [ ] The smoke gate for the smoke.js repair (build:spa, a server, `JV_BASE=…17494 npm run smoke`). It loads the
  chat model, so it waits until the PC is free after family-release's ctest.
- [ ] "JustVoice ready" to family-release, once the smoke gate passes. Nothing else of JustVoice's is open: no
  curation is needed at 9784e04c.

## Mistakes to avoid

- Book RAM from a model's own row, never a guess (VibeVoice 7B took ~15 GB on 2026-11-08).
- The PC has 32 GB of RAM: no CPU ctest beside the model tests.
- A heavy command never runs in the foreground: background it, with a timeout.
