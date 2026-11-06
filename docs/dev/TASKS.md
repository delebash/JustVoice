# TASKS — open work (JustVoice)

> **This is JustVoice's live tracker.** One item per piece of open work, written
> so it can be read cold. **Close = delete** — git keeps the history, so nothing
> finished stays on this page. **An item lives where the code that closes it
> lives** — JustVoice work here; shared-kit and shared-server work in
> `../just-core/docs/dev/TASKS.md`; JustWrite work in
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
> **A closed item is in git.** The finished, stale and rule-holding items were deleted on
> 2026-11-05 (their rules moved to AGENTS.md, `design-decisions.md`, `design-law.md` and
> RESEARCH §10): a citation of a TASKS item by a title no longer here points at git —
> `git log -S "<the title>" -- docs/dev/TASKS.md`.
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

### FFmpeg from the kit — JustVoice moves onto it, when you say
STATE:  DECIDED 2026-11-06 in web-4c's session (JustDirect's kit work), relayed here: the user, "5 your rec", on
        "FFmpeg from the kit: gyan.dev's 9.0.2 essentials for Windows, Martin Riedl's 9.0.2 for macOS and Linux,
        pinned by SHA-256; the addresses are data rows; a path the user sets falls back to their own FFmpeg;
        JustVoice moves onto it in its own session." (kit TASKS, "JustDirect's six decisions", item 5; built on
        just-core edd35715: `installLlm({ runtimes: [..., "ffmpeg"] })`, `@delebash/core/runner/ffmpeg`
        `ffmpegExe()` / `ffmpegReadiness()`; ffprobe only in the Windows build).
WHY:    JustVoice asks the user to install FFmpeg for mastering and the M4B; the kit's would install from the app.
OPEN:   when — not on the close-out list A–D. The files that run FFmpeg today (web-4c's list): mastering.js,
        export_audiobook.js, book_run.js, models.js, system_info.js, audio/wav.js, api/export_jobs_api.js,
        api/render_chapter_api.js, api/book_runs_api.js, api/projects_api.js.
GO:     needed for the timing (the decision itself is given).

## The next build

### JustVoice closed out for its release — the list A–D (decided 2026-11-06)
STATE:  DECIDED 2026-11-06 — the user: "i want to get jv in the same state where all items are closed out … only
        give me items that a human absolutely has to do". Shown ("JustVoice close-out"): "A. Already done; I just
        delete them from TASKS … B. I do these myself: 1. Long books on the cloud recipe … drop the oldest and try
        again … 2. JustWrite import. A scene with no `body` gets refused with a clear message … 3. The run card's four
        differences … 4. The looks I'd left for you, done by me … 5. A real recording through ● Record … 6. The Qwen3
        silence bug … 7. A paused re-render after a check adds a second take … 8. Drama 3's top-k: keep audio.cpp's
        default … 9. Dependencies to their latest … 10. Release prep … 11. Docs and Help checked against every
        screen, and TASKS cleaned down to the release. C. Removed for this release (they go back into IDEAS
        afterwards with the other five) … D. Only you: 1. Listen to one fresh one-click audiobook … 2. Turn on
        JustVoice's Release workflow … 3. Release-day go … 4. A JustVoice website … Rec: none for this release".
        The user: "just continue", then "that was not a go stop", then "your recs think adversierliy on it again
        make sure you dont keep changing your recs go" (and before: "of work is done clean up the docs"). Attacked
        again: no rec changed.
WHY:    the family releases each app with nothing open (just-core TASKS "The family release").
NOT:    the cloud (Frontier) route's provider and its tests — another session's.
BUILT:  B1 da7d1b05 · B2 c8a7d653 · B7 860a18b8 · B3 abae21a1 (re-run words "Done · none needed", the mock's
        rerun state); (a) and (d) seen met on 2026-11-06: at 390 px the real Overview puts the steps above the card
        as the mock does, and at 1280 the pills read "No voice…" / "gemma-4-26b-a4b-q…" by the 2026-10-29 squeeze
        order (URL, project chip, crumbs, then pills). B8: top-k stays audio.cpp's (the 2026-10-13 rule).
        A: the items done or replaced deleted; C: removed (Whisper's English and CJK normaliser ports, a per-voice
        runaway bound, voice conversion and the Python-only engines, the persona mock of every model's voices,
        take findings on each Render line — the run card's "What to check" lists them —, the 2026-08-15 setup lanes
        — the voice engine setup wizard does that job —, the Knave as a 0-line speaker). B9 so far: every package
        at its latest within its range (root, server, Capacitor, e2e), the MCP SDK 1.32.2; left `npm audit`'s 5
        moderate in `@vue/test-utils`' js-beautify (glob, minimatch — tests only, never shipped; its fix is a
        breaking downgrade); sass-embedded pinned to 1.107.1 (`overrides`: 1.108.0's Windows package has no
        `sass.snapshot`, which its own loader needs — every Quasar build failed); Playwright's 1.65 browser.
        B6: the silence runaway is gone at fork 281de44a (RESEARCH §9; the guard stays; the FINDING closed).
        B10: the model revision fd2fe4c3 tried, its 14 changed families re-tested, and put back (the fork item
        above: it brings packages not curated yet; 14 server tests fail with it). B11: the three docs audits'
        ~65 corrections; Settings → Mastering rebuilt on the server's real targets (it saved nothing — checked
        on the app: ACX −20 → −20.5 on the server and back); the run card's Stop tooltip ("Stops at once …").
        B4: Discover and the one-click mock beside the real pages — the differences are the data's; the
        mock's rerun state as the real card; the character-voice card's words as decided; the kit's folds
        (Engine binaries a list-item, ▸; the class and launch libraries open expanded, their ▸ rows shown);
        Storage's **Change folder…** in the installed app on its default folder. B5: ● Record through Chrome's
        fake microphone — "■ Stop · 0:09", a `mic` capture of 9 s, 19 of 19 words read back.
        D1's audiobooks, made 2026-11-06 on the merged fork's dev build (book_voices.narrator_model set to its
        default, breeze_tts — the dev database still held the old voxcpm2, as clone_model did on 2026-10-19):
        `data/one-click/Alice VII (release listen).m4b` — 15:22, 273 lines, 2 flagged; its four speakers matched
        the library's personas of 2026-10-16 (VoxCPM2) and the narrator the persona "Narrator" (Kokoro am_echo);
        `data/one-click/Alice VIII (release listen).m4b` — 18:22, 9 speakers, 7 voices designed (Qwen3-TTS
        VoiceDesign → BreezeTTS 2), 181 lines, 2 flagged — the defaults' voices.
CHECKED 2026-11-06, once at the end: lint; server 1298 (+1 skipped); unit 306; the guard; smoke every view,
        zero JS errors (17494, the dev build, the user's data); e2e 10/10 (WCAG 2.2 AA light and dark included).
OPEN:   B9's majors and pins with the family (Electron 45, jsdom 31, Biome, electron-builder — the "family
        release" session sends them); B10's rest (the kit's pin — with the tag; the kit's 2026-10-20 changes 1, 3,
        11 and the start checks are tested by the release run); then D1–D3 (the
        user's). After the release: re-add the five "later" ideas and the global hotkey and paste
        (`git show 69e00a8d:docs/dev/IDEAS.md`; the hotkey's ruling, a C++ addon: docs/plans/2026-10-05-electron-node-study.md §9).
GO:     given 2026-11-06 ("your recs think adversierliy on it again … go").

### Our audio.cpp fork is released with the family, once every app is done
STATE:  DECIDED 2026-10-29 — "do a release once all apps bugs are finished i already stated that, once all apps
        bugs fixes features are done all apps get a release including anything we forked". (The family rule:
        just-core TASKS "The family releases together".)
        2026-11-06 — the user, here: "i want it to do a a releaswe for the family apps jw, housepaint, docs gen …
        have the new session do this it is called family release"; then "have it do all your recs for the apps
        that you listed". So JustWrite, house-paint and docgen release now (the kit's TASKS, "The family release");
        JustVoice — and with it this fork's tag — later, once its own TASKS is done.
WHY:    the packaged app and `npm run server` run the pinned `v0.9.2-jv.6`, which has no Fish Audio Drama 3; only
        `npm run dev` runs the fork's `jv` branch.
BUILT:  nothing. FINDING 2026-10-29: `jv` (1de98891, 2026-10-19) is 150 commits behind upstream main (5951ca47,
        2026-10-29) and lacks upstream's v0.9.3 (2026-10-26); 46 commits are ours. The only fork any family app uses
        (`gh repo list delebash --fork`; the others have no checkout here and no app references them).
OPEN:   whether upstream is merged into `jv` before the release — your call. Then: tag `v0.9.2-jv.7` (or on v0.9.3),
        the kit's audiocpp rows and pin moved (the pin is the kit's since round E), the catalog regenerated at the
        tag and committed (it replaces the uncommitted `catalog.json`).
        And the standing rule, 2026-10-29: "before we do any work on audio cpp nextime we should update the fork
        and test it in our app, this should be in i guess the core or jv, this should be true for any forks for
        futre apps that we may use" — in the kit's `docs/family-rules.md` (every web app imports it) and
        JustStage's `AGENTS.md`.
        The merge, 2026-11-05 (asked: upstream 69 commits ahead with v0.9.3 and v0.9.4, merge before the release?):
        "2 yes always keep fork up to date this is already a rule".
        MERGED 2026-11-05: upstream main (28783225, v0.9.3 and v0.9.4) into `jv` as 281de44a — local until its
        build and test pass; four conflicts (the Qwen3 aligner's rate, upstream's #1148 = ours, its two files
        upstream's again; Qwen3-TTS's CustomVoice base assets beside upstream's talker backend; our clone test
        under upstream's ENGINE_BUILD_MODEL_TESTS). The catalog rebuilt at 281de44a (8 new families; our port of
        audio.cpp's web UI rule took upstream's three changes; JustVoice's licence reading for the two it offers,
        Nemotron 3.5 Transcribe and Phonon-2). Decided under the finish run's go, attacked: the model files'
        revision stays 661a224e (decided 2026-10-29: the next one gives 28 files on this PC other bytes), so
        PocketTTS Small, Underdog Bark 3, Haas ASR and the rest aren't offered until that pin moves — with the
        release. BUILT 2026-11-05: the dev build at 281de44a (CUDA 12.4, 1169 steps, 1079 s, 6 jobs — the
        shared machine; `audiocpp_dsp 1 (281de44a)`); the fork's tests in a clean CPU test build
        (`build/jv-test`, MSVC 14.51, its own toolset): 97 of 99 — `lfm2_audio_assets_test` needs a model
        package folder (round E's known case), `lfm3_audio_assets_test` (upstream's, new in this merge)
        can't open its synthetic GGUF for writing, in any folder tried — its harness on Windows, not
        investigated further. TESTED 2026-11-05 under `npm run dev` on the user's data (the Speech tab:
        `Installed — build dev · 281de44a`): Kokoro (af_heart), Qwen3 CustomVoice 1.7B (Aiden) and
        BreezeTTS 2 (a cloned voice) each spoke "The rain kept on, and the old house creaked in the
        wind." and Qwen3-ASR read each back word for word. FINDING: Phonon-2, new in the update, won't
        load — "GGUF embeds model spec for family 'parakeet_tdt', not 'phonon2_asr'" (HTTP 500): its
        files at the model revision 661a224e name Parakeet's family, the repo's newer ones (main
        fd2fe4c3) its own, and a model's files go by that embedded spec first (RESEARCH §1.2 —
        correcting §1.4's "a release build doesn't read" them). FIXED the same day, decided under the
        finish run's go, attacked (a hand-kept exclusion would have to be remembered at the release;
        moving the model revision breaks the 2026-10-29 decision): the catalog script reads each
        pinned file's family from its first 64 KB (the kit's new `readGgufValue`) and the app offers
        no package whose file names another family — at 661a224e only Phonon-2's two; it comes back
        by itself when the revision moves. Nemotron 3.5 Transcribe (15.6–23.3 GB) was not run.
        PUSHED: `jv` at 281de44a (2026-11-05). Left for the release: the tag, the kit's pin and rows,
        the model revision (Phonon-2, PocketTTS Small, Underdog Bark 3 and the rest come with it).
        2026-11-06 (the close-out's B10): the model revision fd2fe4c3 tried — the 14 families whose files change
        re-tested through the app, all well (RESEARCH §1.4) — and put back to 661a224e the same day: it offers
        packages JustVoice has never curated (Kitten TTS 2's 20261021 beside its first, which doubles its voice
        ids; Pocket TTS Small and VoxCPM2 VocalRender Pro with no licence reading; QwenCleo-ASR's package
        changed), and 14 server tests fail with it. Whether to adopt them before the release: the user's call.
GO:     given for the release's timing; the merge given 2026-11-05.

### The character voices: BreezeTTS 2, with its licence on the run's card (decided 2026-10-16)
STATE:  DECIDED 2026-10-16 — the user's ears on round 4's blind page (51 answers: plays like the
        book — BreezeTTS 2 13/13, IndexTTS 2.5 7/13, Higgs 6/12, VoxCPM2 3/13); shown: "My rec for
        the engine that plays the book's characters (`book_voices.clone_model`): BreezeTTS 2. It's
        the only setup that played every line like the book. Its catches: Licence: as your
        2026-10-11 ruling says (offer the best models, labelled), the run's card shows its licence
        word before the run starts. Speed: about twice as slow as VoxCPM2 (4.3 s a take on the
        graphics card). Memory: it peaks at 7.3 GB, so on an 8 GB card the automatic choice may put
        it on the processor (11 s a take). I'll measure that." Asked what the licence decision is:
        "(a) BreezeTTS 2 … The run's card would show its licence word before you start. (b)
        VoxCPM2, today's default … My rec is (a), with the label." The user: "your rec on breeze
        and license, so our best non commercial only got 3 lines correct in emotion, so chatterbox
        and qwen did not do well, that just seem like something is wrong, can you check what other
        people are saying regarding this … maybe we have something configured wrong".
WHY:    the one-click run needs the engine that acts best on a copied voice (TASKS "The order of
        work after the research sweep").
        The check (RESEARCH §10.25): the weak acting is the models' own, but VoxCPM2 and IndexTTS
        were told less than their authors document; shown again: "switch the character voices to
        BreezeTTS 2, as you approved … Placement measured first … Its licence word on the run's
        card … A stop before the run when Breeze's licence hasn't been accepted on that machine,
        with a link to accept it." The user: "your rec on all go".
NOT:    switching before the configuration check the same message asked for.
BUILT:  —
        Measured 2026-10-16: Auto put Breeze on the CPU (7.3 GB + the 0.5 GB margin > the 7.6 GB
        free). Shown: "when a model's peak has been measured on this machine, the automatic choice
        uses that measurement with no extra margin. Breeze then goes on the card by itself …
        Models that are only estimated keep the 512 MB." The user: "yes for breeze i think its ok
        to run on card by default as long as test is ok, let me know your rec". The test (round
        5's Breeze arm on the card): 93 takes at a 5.0 s median, nothing spilled. BUILT: a measured
        model is weighed at what it took (`manager.placementFor`, `_admitMemory`, `_freeCardMb`);
        docs engines.md (The speech margin), settings-reference, whats-new. Asked of the narrator:
        "Breeze reads everything, narrator included" after a narrator sample in round 5.
        2026-10-18: the narrator plan built (docs/plans/2026-10-17-narrator-and-character-engines.md
        §5) — `book_voices.narrator_model` (voxcpm2), `clone_model` seeded `breeze_tts`, the card's
        "Qwen3-TTS VoiceDesign → BreezeTTS 2 · narrator VoxCPM2" with "Commercial use: Separate
        licence", the stop "BreezeTTS 2's licence isn't accepted on this computer. Accept it to make
        the character voices." with "BreezeTTS 2's licence ➜"; tests, mock, docs.
        2026-10-18 night (the user: "do your rec … all your rec and any bugs or suggestions you
        find our have go"): the stop covers the designer's and the narrator's model too, on the
        approved pattern — "…Accept it to design the voices." / "…to make the narrator's voice." /
        "…to make the character voices and the narrator's voice." (one stop per model, naming what
        it makes: `book_run.termsUses`, the plan problem's `uses`); test, mock, docs studio and
        whats-new.
        2026-10-19 (shown: "Your database still has the old setting `book_voices.clone_model:
        voxcpm2`. Your real book's card says "VoiceDesign → VoxCPM2", not Breeze. Should I set it
        to `breeze_tts`, or do you want to reset? Lean: I set it. It's the old default, not your
        choice." and "The new words for your look: the two new licence stops and the Language
        hint above. Lean: keep them." The user: "autocompacted re read rules docs session your rec
        go"): the dev database's `book_voices.clone_model` set to `breeze_tts` through `PATCH
        /v1/settings` (the narrator stays `voxcpm2`); the stops' words kept as built.
OPEN:   the user's look at the card (#/mock/one-click, and a real book).
GO:     given 2026-10-16 ("your rec on breeze and license"; after the check, "your rec on all
        go"). The narrator plan (docs/plans/2026-10-17-narrator-and-character-engines.md), shown
        2026-10-18: "4. The setting's name: `narrator_model`? Lean: yes. 5. The run's card:
        "Qwen3-TTS VoiceDesign → BreezeTTS 2 · narrator VoxCPM2", plus Breeze's licence word,
        "Commercial use: Separate licence", as the engines page shows it? Lean: yes. 6. The stop
        when Breeze's licence isn't accepted: "BreezeTTS 2's licence isn't accepted on this
        computer. Accept it to make the character voices." with the link "BreezeTTS 2's licence
        ➜"? Lean: yes." The user: "compacted re read docs rules session your rec on all go".

### The kit's fifteenth-review changes taken in (built 2026-10-20, under the go above)
STATE:  BUILT 2026-10-20 — web-0d's ninth note (kit 70e6df1 + 010360f) came after the user's "dont stop
        your rec for eveyrhting think adversiarly, go"; my recs were built under that go without
        being shown first, and are listed here and in the report for the user's check.
WHY:    the kit's UiNumber needs `@internationalized/number`, a peer JustVoice lacked (it resolved
        from the kit's own node_modules in dev; the release installs only the kit's core); a Change
        folder move now keeps the old folder, and JustVoice's own Storage copy had no way to remove
        it, nor sent the window's token; the kit's token contract has `--border-field` and dark
        `--on-accent`, `--danger-ink`, `--info-ink`, `--warn-*`, which JustVoice lacked.
NOT:    ServerPanel and AboutPanel (JustVoice keeps its own sections; the `.card` frame is ready).
BUILT:  `@internationalized/number` ^3.6.9; Settings → Storage on the kit's StoragePanel
        (`native.js`: relocate with the token, `storageOldCopies`, `storageRemoveOldCopy`,
        `storageUseDefault`; the speech models and the render cache in its `extra` slot, with the
        kit's "Clear…"; "AI models cache" kept as JustVoice's word, `kit.storagePanel.modelsCache`);
        the family's `.card`, `h2`, `.hint`, `.card__actions`, `.card__note` in `app.scss` in
        JustVoice's card look; tokens: `--border-field` both themes, and in dark `--on-accent`
        #1a1a1a with the template's `--danger` (near-black on JustVoice's dark danger, which was the
        light red, measured 2.92:1), `--danger-bg`, `--danger-ink`, `--info-blue`, `--info-ink`,
        `--warn-bg`, `--warn-ink` (RESEARCH §6); `scripts/start-packaged.js` re-copied (it runs a
        temp copy of the unpacked build). Docs: backups-and-data, whats-new. Checked: the smoke
        gate (every view, zero JS errors) and screenshots of Storage in light and dark on 8741.
        Then web-0d's tenth note (kit f066ec9): `dom-accessibility-api` ^0.7.1 installed (a kit
        peer); the recursive removes over folders a user could link moved to `fs.promises.rm` —
        the reset's folders, the speech cache, a model's files, an old runtime build, the eSpeak
        and Japanese installs (JustVoice's `rmSync` emptied a linked folder's target, measured;
        RESEARCH §6); `server/tests/junction_removers.test.js`; backups-and-data says so. Kit
        90c513f: Storage passes `forgetOldCopy` (`storageForgetOldCopy`, the template's), so a
        *Not found* old copy can be forgotten; JustVoice sets no `beforeunload`, so the shell's new
        Leave/Stay box never shows here. Kit 7680aca: the toasts' `--ui-toast-*` mapped to
        JustVoice's pairs as the template does (info keeps the kit's pair: `--info-bg` is
        transparent for the outlined pills), with the template's dark success pair (near-black on
        the light success fill was 3.56:1 in dark). The kit's new `resourceIsolation` stays unwired:
        the desktop window's `<audio src>` loads are no-cors cross-site and it would refuse them.
        Kit 7e617b7: the built UI through the kit's `serveUi` (405 with Allow, an unknown /v1 or /mcp
        write still 404, ETags and 304, hashed assets kept; `server/tests/serve_ui.test.js` — no test
        covered the UI's serving before); the AI routes add the kit's `aiRunHttpError` before their
        own fallback (503 a local model not ready, 502 a provider not reached; the capture re-clean
        and the show notes answered 500; `captures_rulings.test.js`). Not taken: the form dialogs'
        focus back into the field after a 422 (the template's NoteDialog) — each dialog's own change;
        no JustVoice CSS styles `.q-field__bottom`.
OPEN:   Change folder, Remove the old copy and Move back show only in the desktop app — not seen;
        the 8741 browser shows the panel without them. 2026-11-05: the desktop e2e now proves the
        window's shell answers the panel (e2e/tests/smoke.test.js "Settings → Storage reads the data
        folder through the desktop shell" — its run names the folder by JUSTVOICE_DATA_DIR, so the panel
        rightly shows "set by JUSTVOICE_DATA_DIR" in place of Change folder); the buttons themselves
        wait for a desktop run without that variable (the installed app, or `npm run dev`).
GO:     the 2026-10-20 go above ("dont stop your rec for eveyrhting … go").

### Discover's names: the AI suggests, you link — Find same people, Link, Unlink, Kept apart (decided 2026-10-16)
STATE:  DECIDED 2026-10-16 — on the Discover mock the user pressed Merge found names: "it says
        Checked just now by gemma-4-26b-a4b-qat · Local, with Merge found names. it should not be
        automatica it should be able to be reviewed in a list like everything else is done with
        user review, stuff that is automatic is hidden from user, it also need an undo, think on
        the desgin and flow, its bad"; before that, of the line and the button: "you need to
        clarify wht the button merge names does, it doesnt merger names, it should seqarch for
        names that are the same person"; then "maybe the same way you can ignore unignore names we
        do the same so user can unlink queen with the queen and so on" and "think on the design
        again and updte it so i can see how it works". Shown (argued against twice): "1. Before
        the AI — every name is its own row … Some people are named more than one way — "the
        Queen" and "Queen of Hearts". Find same people asks the AI which names are one person; you
        link them. [Find same people] … [+ Add selected] [Ignore selected] [Link selected as one
        person] 2. After Find same people — the AI's answer is a list to review; nothing in the
        table has changed: Same person? · 1 from gemma-4-26b-a4b-qat · Local [Link all] Queen of
        Hearts + the Queen ≈ 13 lines · VII, VIII … [Link] [Not the same] 3. After Link — one row
        … also written the Queen [Unlink] 4. After Not the same, or Unlink — the pair goes to Kept
        apart, beside Ignored; Find won't suggest it again: Kept apart 1 Queen of Hearts · the
        Queen [Undo] 5. After Make the audiobook — the run links on its own (one click is its
        point) and says so on the row; Unlink still works … also written the Queen [Unlink] ·
        linked by Make the audiobook. Unlink there takes "the Queen" out of that speaker's Also
        called and shows it as a new row; lines already given to Queen of Hearts stay where Script
        put them. 6. A new scan after a check — the line says Checked 4 min ago by
        gemma-4-26b-a4b-qat · Local · 1 chapter scanned since. [Find again]; new suggestions join
        the list, your earlier answers stay." What the argument changed: "One verb pair — Link /
        Unlink everywhere … Not the same and Unlink both say 'these are different people', so they
        share one list, Kept apart … Unlink works after Add … two ticked rows that are both
        already speakers can't be linked." The user: "your rec go".
WHY:    the AI's answer joined names with no list to check and no undo; the button's name said it
        merged when the step only finds (`POST /v1/projects/{id}/speakers/merge` writes nothing).
        Standards: Google Contacts' Merge & fix — suggestions, Merge or Merge all, a merged contact
        separated later (support.google.com/contacts/answer/7078226); Discover's own Ignore / Undo.
NOT:    joining two speakers (lines would move — a different feature).
        This reverses answer 4 of "The one-click run's leftovers, rethought" (the server's grouping
        shown as one row before the AI): every name is its own row until you link it.
BUILT:  the mock (`#/mock/discover`, 2026-10-16). 2026-11-05, the server and the real page:
        the state is the project's `metadata.discover_people` = {check, suggestions, links,
        apart} (`extraction/same_people.js` — readPeople :61, isOpen :126, addSuggestions :137,
        link :158, unlink :189, notSame :220, undoApart :232), on the project payload as
        `discover_people` and kept out of `metadata`, which a client's PATCH never replaces
        (`api/projects_api.js` :138, :159, :907). Routes beside discover/ignore
        (`api/extraction_api.js`): GET + POST `…/discover/find` :2352 :2363 (`findSamePeople`
        :1536 — suggestions only; Cancel → 499 and nothing written; no model → 501 and 502 kept as
        the failed check), `…/discover/link` :2376, `…/unlink` :2384, `…/keep-apart` (Not the
        same) :2391, `…/undo-apart` :2399. The question is `mergeFoundNames` :1469 (the book's
        speakers' names in what it reads; your links and kept-apart pairs over the model's —
        `merge_names.js` keepApart :280, joinLinked :296, peopleOf :322, mergeAction :95); the
        run's step links its groups by "run" and writes the check by "run" (`linkFoundPeople`
        :1575, `book_run.js` :844), never a pair kept apart; its Add step unchanged. The old `POST
        …/speakers/merge` is gone (one way per job; its callers — eval_speakers.js, the tests —
        moved to find / mergeFoundNames). The step's name: Find same people (`bookRun.js`
        STEP_LABELS, `feature_catalog.js` speaker_merge). The model a step runs on is
        `engines/llm/run.js` featureRoute :37 (book_run.stepRoute calls it). Client:
        `studioStatus.foundSpeakers` :145 joins names only by links (`foundNames` :94,
        `sameSuggestions` :241, `examplePair` :76); `StudioDiscover.vue` — the line :272, Find
        :302 (a kit task with Cancel), Same person? with Link / Not the same / Link all :358,
        also written … [Unlink] :387, linked by Make the audiobook, Kept apart chip + Undo :399,
        Link selected as one person :458; Studio's step count reads the links. Docs studio.md
        (Same people: the AI suggests, you link), ai-features.md, code-map.md, whats-new. Tests:
        server discover_same_people.test.js (8), merge_names.test.js (+3), ai_cancel_routes
        (find's Cancel), one_click_alice (the run's links); unit studioStatus.test.js (+5),
        StudioDiscover.test.js (8, mounted in the mock's states).
OPEN:   the user's look in the real app (Discover before the AI, Find, Link, Unlink, Kept apart,
        after Make the audiobook) beside the mock at the same width.
GO:     given 2026-10-16 ("your rec go") for the mock; the server and the real page under the finish run's go
        of 2026-11-05 ("just keep going fix all the things you think yo can … dont stop and ask me unless
        you absolutley need to"), the user's look skipped as not absolutely needed — the design was argued
        twice and approved, the mock drawn.

## Known deviations, recorded so they aren't re-litigated

- **The deep exhaustive audit is deferred by your word** (2026-08-06): *"for now we are not doing jv
  harness or deep audit i want to finish all features and complete the jv llm runner conversion."* The
  harness half is built (`e2e/`, 2026-10-29); the audit stays deferred.

- **`capture.llm_model` is a dormant settings field** — decided KEEP. Its UI
  picker is gone but the field stays (`models.py:366`; its default still names
  `qwen3-llm-0.6b`, an engine that no longer exists).
- **Discover lists named people who never speak as New, with 0 lines** — decided
  LEAVE IT 2026-10-06 ("fix go", on the lean as shown: "Lean: leave it, since the 0 in
  Lines already says so."). Seen in the end-to-end run after a reset: the courier, the
  Warden, a Concern clerk (`docs/plans/2026-10-05-second-look-test.md`).
- **The kit's outline (secondary) button style stays as it is** — decided LEAVE IT 2026-10-06 (the user:
  "leave it", to: "Every other outline button in all three apps has the same faint look … Should I make the
  outline style itself easier to see, with a darker border and darker text?"). Only Script's ✓ Looks right
  went solid ("Script's ✓ Looks right buttons are solid").
