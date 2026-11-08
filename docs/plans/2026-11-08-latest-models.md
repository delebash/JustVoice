# The latest models, tested as voices you can sell, and the picks made plain (2026-11-08)

**Read this FIRST after any compaction.** Then re-check every name and number below at its source.
The job before it: `docs/plans/2026-11-08-commercial-engine.md` (D1–D8: what counts as commercial,
the judge, the picks). Its rules stand here.

## The job, in the user's words (2026-11-08)

- "i want the latest model whou told you to hold that for nex release, you tsted new engines thats
  greate but left out the other new vocpm2 and other, why"
- "so the app should make it abouvies that 1 this is best model for cocmmercial, 2 this is best
  model for non commercial, does it make this very cleary?"
- The go: "do the test with th newer models dont stop until it is all done"
- After the lockup (2026-11-08, ~15:25): "so rethink on these recs adverserily and go cooridinate with
  just-stage as to when you cna use pc resources"; "you make all decisions on your own but ony after
  you think each decision adverserily until you dont flip your anwers, i dont what to have to do
  anything or interact with you until the app is complete and ready for releaese". So: every decision
  is mine, attacked until it holds; no questions to the user until JustVoice is complete and ready for
  release; the release itself stays the user's word.

Who held them: I did. The new packages were put after the release on my rec (2026-11-07, the
close-out's B10, "your recs go"), and the commercial job (D3's candidates) never reopened that.
That was my miss: a new VoxCPM2 package is exactly a candidate for the best voice you can sell.

## The design

1. **The latest audio.cpp.** The fork's `jv` with upstream main merged (73a2b82e, upstream 408935bf:
   Drama 3 and Nemotron Transcribe on shared MoE execution, merged by the family release session,
   local only). Build it (`scripts/audiocpp-dev.js`), test what it changes through the app (the
   fork rule): Drama 3 narrating, Nemotron Transcribe transcribing.
2. **The latest model files.** `scripts/audiocpp-catalog.js` `MODEL_REVISION` from 661a224e
   (2026-10-18) to the repo's main, 73ce4162 (2026-11-07). Every new or changed package gets its
   licence read at its source and its notes (`curated/<family>.js`), as the app's rule is; the
   tests that pin 661a224e's facts move with it.
3. **The new speech models tested as voices you can sell**, the commercial job's way (D2–D5): round
   10's 13 lines × 3 seeds, told and untold, through the app; the LAION feeling score places each in
   or out of BreezeTTS 2's tier and against VoxCPM2's 0.84; read-back by the app's recogniser and
   speaker similarity gate it (WER ≤ 0.05, similarity ≥ 0.80). A new model replaces a pick only on
   that evidence, said plainly with its limits (the judge does not separate sellable engines well:
   arm Spearman 0.20).
4. **The picks made plain everywhere a model is chosen.** Today only the one-click card's Voices
   says it. Each model is marked **Best you can sell** or **Best acting — not for sale** wherever
   the app offers models (AI Settings → Speech, the voice-making model pickers), read from
   `book_voices.sets` (the settings the card uses), so the marks follow the picks.
5. Docs, tests once at the end, the real window.

## Where it stands

- [x] 1. Built 73a2b82e (dev build, 09:47; upstream has nothing newer, fetched 09:4x EST). Its test
  through the app (Drama 3 narrating, told) waits for the card.
- [x] 2. Model revision → 73ce4162; catalog regenerated at jv 73a2b82e (142 families, 58 speech, 455
  packages); sanoTTS's small files re-pinned; the three new families' licences (D10); Kitten's voice
  ids (D11). The app lists 265 model rows (live, 17494).
- [ ] 3. Round 11 (`data/round11`, the 13 lines × told/plain × seeds 7–9 = 78 takes an arm, the
  Hatter's voice `voice_8862414b55f04b1ca66c43700b741848`). **The machine locked up at ~14:14 and
  restarted 14:15 (2026-11-08)**; counted from `data/round11/manifest.json` and
  `vocalrender-r11-manifest.json` after the restart:
  - `pocket-small-r11` (Pocket TTS Small 18M, CPU): 78/78. Read back 52/78 (scratchpad of session
    6571a392, `judge/r11-readback.json`; stopped to free the CPU).
  - `kitten2-r11` (Kitten TTS 2 20261021, CPU; its licence accepted in the app for the test —
    commercial use needs registering with Stellon Labs, the user's): 68/78; 10 "fetch failed" while the
    CPU was saturated (median 50.2 s a take). A rerun fills them: the script re-renders a take with no file.
  - VocalRender Pro (the fork's CLI, CPU, `vocalrender_r11.js`): seed 7 only, 24/26; 8-48-told-7 and
    8-67-told-7 failed "audiocpp_cli failed: bad allocation"; seeds 8–9 not run.
  - ~~`breeze-q4-r11`~~ **dropped (D13)**: 60/78 were rendered before the lockup; they are left out of
    the scoring and nothing more is rendered.
  - Not started: `drama3-word` on the merged build, Nemotron Transcribe's one transcription, the read-back
    of the other arms, the LAION score (`judge/r11.js score`, round 10's way).
  - The card: shared with just-stage and just-direct-mocap (new sessions after the restart); ask
    "card?" before each piece.
  - **My slot, 16:26–16:50 (the app's headless server on the dev build `dev · 73a2b82e`, the user's
    data):** `drama3-word` 78/78 on the card (Drama 3 V2 — D17; it downloaded the new 23.37 GB file
    first; loaded in 260 s; median 7.3 s a take); Nemotron Transcribe — first 500 (D18), then on the card
    with one read thread every word of the test clip in 36 s, ~5.4 GB of the card, the Transcription
    preset put back to `qwen3-asr-1.7b-q8` (checked); `kitten2-r11` 78/78 (the 10 retakes in ~1 min);
    VocalRender Pro stopped at 20.6 GB (D19), 24 takes; the default recipe's old and new files on the
    same build and seed, CPU: VoxCPM2 plain and told, Qwen3-TTS VoiceDesign and Qwen3-ASR's text —
    **byte-identical**, and each run repeatable (scratchpad `file_ab.js`).
  - Next: the scoring on the card beside family-release's CPU hour, after just-stage's face renders —
    read-back (r11.js readback), LAION (`take-check empathic --device cuda`), similarity (`take-check
    score`), the tables against round 10; then Phonon-2, Orukeet, VibeVoice ASR Streaming 7B and Haas one
    transcription each.
- [x] 4. The marks, built (D12): server `modelPicks` + `GET /v1/book-voices/picks` (live: VoxCPM2
  characters and Drama 3 narrator "Best voices you can sell", BreezeTTS 2 "Best acting — not for
  sale"); renderer store `voicePicks`, `services/modelPicks.js`, `ModelPickChips.vue`, `.ev-pick`;
  wired into the clone maker, the design maker (both selects), Voices (filter, Copy to another
  model), Personas filter, the persona editor (filter, This model), Studio → Cast (Models to choose
  from, the persona filter), AI Settings → Speech (engine heads, the picking table), Quick setup.
  Tests written: server book_run.test.js, src/services/modelPicks.test.js, SpeechTabSlots.test.js;
  the revision's pinned facts moved in audiocpp_generated, seven_engines_slice4 and
  seven_engines_unchanged (none run yet). User docs written: engines.md "The best picks, marked
  wherever you pick a model" (with a worked example), personas.md, voices.md, whats-new.md. The real
  window: open — the desktop build of 10:29 (`dist/electron/UnPackaged`) already has the marks.
- [ ] 5. End run. Nothing committed since c20cbaf4: the job's code, catalog, tests and user docs are in
  the working tree (30 changed, 7 new files). The fork's merge 73a2b82e is local only (origin/jv is
  6d64f04e).

## Decisions (mine, under the go)

**D9 — the model files at the repo's main, 73ce4162, with the catalog at our fork's 73a2b82e.** The
catalog script resolves each other maker's repo at its main the day it runs (its rule since
2026-10-11), so those move too; only sanoTTS's 18 small files needed a new pin (byte for byte the
same). Pocket TTS's 99 preset voice files keep their SHA-256. 265 model rows (240 before). 144 files
of audio.cpp-gguf have other bytes than at 661a224e (embedded specs refreshed), so a model already
downloaded on those files downloads again on its next load. Attacks: past decision — the hold to
after the release (mine, 2026-11-07) is what the user overturned; cost — re-downloads, ~60 GB on this
PC by the 2026-11-06 count (E: has 775 GB free); surprise — none beyond the downloads, said in the
report; simpler — keep 661a224e and add only the new packages: not possible, a pin is one revision.

**D10 — the new families' licences, read at their sources (2026-11-08):** Pocket TTS Small — Yes
(CC-BY-4.0, Kyutai's terms); Haas-ja — Yes (Apache-2.0); Orukeet r3 (in Parakeet's family) — Yes,
CC BY-SA 4.0; Underdog Bark 3.0 — **Separate licence**: CC BY-NC 4.0 since 2026-11-05 (commit
e7a641c0), commercial use from its maker; audio.cpp's table still reads CC-BY-4.0 (checked
2026-10-29) and its GGUF (added 2026-11-03) records no source revision. VoxCPM2 VocalRender Pro —
Apache-2.0, a **singing** fine-tune (lyrics, MIDI pitches, tempo; its card), not offered by
audio.cpp's web UI for VoxCPM2 (so not by the app); tested through the speech runtime. Kokoro's
multilingual file is in the model repo but in no spec of the fork, so nothing loads it yet.

**D11 — Kitten TTS 2's two packages share 47 voice names.** The engine's first model (the
recommended 20261021 package) keeps the plain ids (`kitten_tts2_Bella`); the older package's voices
carry its model id (`kitten_tts2-kittentts2_Bella`) — `generatedEngines` sets `voicePrefix`. A
persona on a plain id now speaks on the refreshed package (the maker's update of the same voices);
the old sound stays pickable. Attacks: the other way round would keep old personas on the old
package, but then the default model's voices carry the odd ids; dropping the old package would break
its personas. Only Kitten is affected (779 voices, 779 ids).

**D12 — the picks marked wherever a model is chosen (the user: "it needs to be obvoius in othe rparts
of the app, model selecttion").** One server answer, `GET /v1/book-voices/picks` (book_run.js
`modelPicks`): from `book_voices.sets` in order, the first set a seller may sell with (D1: Yes or
Conditional) and the first one they can't; each of its models with the parts it plays. The words are
the sets' own labels ("Best voices you can sell", "Best acting — not for sale") plus "plays the
characters" / "narrates". In a model picker the picks come first, each set under its label (the kit
UiSelect's groups — the "recommended first" pattern of model pickers), every option's second line
saying its commercial use; beside the chosen model, the mark and the licence chip
(`ModelPickChips.vue`, the card's `.ev-lic`). Filters keep their order and say the mark under a pick;
the multi-select (label only) says it after the name. The makers and Copy start on the best voice you
can sell (they started on Chatterbox Turbo). Not marked: the design model (the sets don't name one),
the lighter set (the user asked for the two). Attacks: past decisions — D7 (the sets are settings) is
the source, so a changed set changes every mark; cost — one route, one store, one component, ~10
call sites; surprise — the makers' first model changes to VoxCPM2; edge — a pick not offered by a
picker (not downloaded, or not directable the page's way) just isn't grouped; simpler — the labels
alone with no grouping read as one more option among 40.

**D13 — BreezeTTS 2's new 4-bit package is not tested (2026-11-08).** It went into round 11 only as
"a new package", against the user's ruling (TASKS, the release stop, 2026-11-07: "NOT: a non-commercial
engine as a default or as the subject of a tuning round — only as a comparison arm"). The comparison
arm is BreezeTTS 2's round-10 score. The user, 2026-11-08: "why are we even doing anything with breeze
ata all". The arm is removed from `server/scripts/round4_render.js`; its 60 takes stay unscored.

**D14 — what is left, attacked in five rounds after the restart (2026-11-08, mine).** The round-11
test list was never a decision and never attacked (the 4-bit BreezeTTS 2 went straight into the
script); D9–D12 had one pass each. This list is the consensus; round 5 changed nothing.
1. Drama 3 narrating on the merged build (its code changed; it is the sellable narrator) — first on
   the card, its takes compared with round 10's.
2. VoxCPM2's three files changed bytes (+7 KB each, 661a224e → 73ce4162): check its sound is the
   same — the tensor data compared, or same-seed takes if they differ.
3. Kitten TTS 2 (Conditional: register with Stellon Labs) — its 10 retakes, CPU, alone. Limit said
   plainly: no cloning or direction, so it can't play characters.
4. VocalRender Pro (Apache-2.0, the "new vocpm2" the user named) — its 2 retakes and seeds 8–9, CPU,
   alone, only with room in RAM, watched every 20 s, stopped under 4 GB free. Seed 7 alone rejected:
   the score compares three-seed means.
5. Read-back and the LAION score for every sellable arm, beside round 10.
6. The new recognisers the app now lists that you can sell — Orukeet, VibeVoice ASR Streaming 7B,
   Haas (Japanese, on a line Kokoro speaks) — one transcription each through the app, not rounds;
   Underdog Bark 3.0 (non-commercial) left out.
7. The marks in the real window, every picker clicked; then the end run once.
Each heavy piece booked with the other sessions first (the global rule). Rounds: 1 past rulings and
licences (found VoxCPM2's changed files); 2 cost and the machine (VocalRender alone, RAM gates);
3 what the update adds (the recognisers); 4 surprise and order (the dev app warms the chat model onto
the card: start it only inside my card booking, unload the chat model if it loads); 5 nothing new.

**D15 — what is left to make JustVoice ready for release, attacked again (2026-11-08 ~15:30, mine;
supersedes D14).** Rounds: 1 past rulings — Nemotron Transcribe back (the merge changed it; D14 had
dropped it silently); the fork's push and tag stay the release session's (the user, 2026-11-07: "hand
it off to the release session"); TASKS records the user's 2026-11-08 overturn of "after the release".
2 the sellable recipe as a whole — the file check widens from VoxCPM2 to every default model whose
files changed at 73ce4162: VoxCPM2 (`clone_model`), Qwen3-TTS 1.7B VoiceDesign (`design_model`
qwen3-vd), Qwen3-ASR 1.7B (the transcription preset, the run's read-back); Drama 3's files are
unchanged. 3 cost and the machine — the renders go through the app's own server, headless, with the
dev build (`JUSTVOICE_AUDIOCPP_BUILD`, as for JustDirect's runs): no window, so no chat model warmed
onto the card; VocalRender Pro finishes seed 7 (2 retakes) and is compared with VoxCPM2's seed-7
takes of the same lines; seeds 8–9 only if it is not clearly behind — the app can't offer it
(audio.cpp's web UI doesn't list it for VoxCPM2), so a pick change would need a NOT STANDARD step,
and ~50 min of the whole machine at 22.8 GB committed is what started the lockup (D14's "all three
seeds" flipped, with this reason). 4 the judge — Drama 3's piece is `drama3-word` (round 10 planned
it; `data/round10` never got it): its plain takes against round 6k's plain takes (same text, seed,
voice, top-k 4097) test the merged build, its told takes score Drama 3 the app's way; no judge reads
narration, so no new model can move the narrator pick, only a regression could. 5 the user's view,
the whole app and kit — nothing changed. The order, each piece booked with just-stage and
just-direct-mocap first, one heavy piece at a time:
1. Card + most RAM: `drama3-word` (78 takes, ~6 s each by round 6k) on the merged build.
2. Card + RAM: Nemotron Transcribe, one transcription (its CPU expert offload).
3. CPU: Kitten TTS 2's 10 retakes, then VocalRender Pro's 2.
4. Card: read-back and the feeling score for every sellable arm; the recipe's three changed files
   checked (tensor data, then same-seed takes if it differs); one transcription each on Orukeet,
   VibeVoice ASR Streaming 7B and Haas (a Japanese line Kokoro speaks).
5. VocalRender seeds 8–9 only by rule 3. A pick changes only on the judge's evidence, said with its
   limits.
6. A fresh build; the marks in the real window, every picker clicked; the end run once (lint,
   server, unit, guard, smoke, e2e); commit; RESEARCH 10.40; TASKS; the user docs' last check.
7. The kit's development-build module once just-direct-mocap says "kit pushed": JustVoice's
   dev_build.js onto it, with its own server-suite run if that comes after step 6.
Light work (docs, scripts) runs while the machine is booked to others.

**D16 — a model whose load options keep weights off the card isn't weighed at its files (2026-11-08,
mine; a kit change).** Found while preparing D15 step 2: the kit's Auto placement weighs a model not
measured here at the larger of audio.cpp's estimate and its files (speech_placement.js `needOf`,
decided 2026-10-12: "the weights alone take that much"). Drama 3's default package declares no
estimate and has 22.9 GB of files, so on any machine without a card measurement of it Auto sends the
default narrator to the CPU ("its files are about 23 GB, more than this card's 8 GB") — though with
Experts from disk it took ~7.2 GB of the 8 GB card (rounds 6–8). Nemotron Transcribe (20.5 + 1.7 GB)
the same. The fix: a kit hook `filesOnCard(row)` (default true — nothing changes for any other app
or model); false, the files don't bound the need, the estimate alone does, and with none it is the
kit's own "memory not measured yet" path (try the card, measure, a load that doesn't fit moves to the
CPU — decided 2026-10-15). JustVoice answers it from the family file: a load option marked
`keepsWeightsOffCard` (Drama 3's and now Nemotron's `disk_experts`, on by default) switched on
(runtime_options.js `weightsOffCard`, kit_hooks.js `filesOnCard`). Rounds: 1 past decisions — the
2026-10-12 premise is false only for disk-backed experts (audio.cpp's docs: "Dense weights and all
expert computation remain on the selected backend"), so it stays for every other row; D6 (Drama 3
narrates, on an 8 GB card) becomes true on a fresh install. 2 standard — a pre-load size computed from
the GGUF's tensor table (llama.cpp's own fitting) needs each family's expert naming and cache rule;
a declared 7.2 GB constant breaks the kit's "no pre-load estimate constant" rule; the kit's own
measure-first path is its standard, so it's reused. 3 blast radius (grep) — `needOf` is called only by
`placementFor`; `filesGbOf` there three times (all moved to the hook's answer); the Speech tab's fit
word reads only `peakVramMb`; the hook reaches the placement through `runtime_service.js`'s
`...speech` spread, unchanged. 4 edges — a card it really doesn't fit: the first load fails or
spills and the kit's `failedOnCard` sends it to the CPU after, as for OmniVoice; Experts from disk
switched off: the files count again. 5 nothing new. Kit: worktree `E:\Dev\Web\just-core-placement`,
branch `jv/files-on-card`, into the kit's main only after family-release's "dispatched" (it holds
the kit's tree at HEAD for its release run); tested then with the end run.

**D17 — the narrator stays on Drama 3 V2, the maker's current files, unless the automatic checks show a
regression (2026-11-08, mine).** Found in D15 step 1: Drama 3's file is not unchanged (D15's round 2 said
so; it had checked only audio.cpp's own model repo). The catalog's pin of Jmica/Drama-3-GGUF moved from
17a5b40c to 060acc8e — "Release Drama 3 GGUF V2 … conversions of the October 29 replacement checkpoint"
(Fish Audio's fishaudio/drama-3 78e5ab7; V1, the October 13 checkpoint the user heard in rounds 6–8, kept
at revision `original-2026-10-13`). Same tensor table (1,386 tensors), other tensor data; Fish Audio's
LICENSE unchanged since 2026-10-13 (so still Conditional). The maker's card: V2 "does not establish
speed, perceptual parity, voice similarity, or correct words in every take", and the earlier listening
and silence studies "do not describe this replacement checkpoint". Rounds: 1 past decisions — D6 picked
Drama 3 by the user's ears on V1; the user: "i want the latest model"; the catalog takes each maker's
repo at its main (since 2026-10-11) — V2. 2 evidence — no judge reads narration and the user won't
listen (2026-11-08), so the check is automatic: round 11's 78 V2 takes (`drama3-word`, merged build,
through the app) against round 6k's V1 takes of the same lines and seeds (read-back words, flagged
takes, the LAION feeling and its told-over-plain gain). 3 a regression there — then one change at a
time: V1 and V2 on the same build, and V1 pinned (a NOT STANDARD pin, its reason in the catalog
script) if V1 is better. 4 surprise — the narrator a user hears isn't the one the user picked by ear:
said in the report and in What's new. 5 nothing new. Held.

**D18 — Nemotron Transcribe reads its experts on one thread (2026-11-08, mine).** Measured: on the card
with Experts from disk, its first transcription answered 500 "parallel disk expert reads require
ENGINE_ENABLE_OPENMP=ON" — audio.cpp's default `disk_expert_read_threads` is 4 for Nemotron (1 for Drama
3), and OpenMP is off in upstream's own release builds (.github/workflows/release.yml, #286) and so in
ours and the dev build (scripts/audiocpp-dev.js copies the release's flags). The fix: its
`LOAD_OPTIONS.disk_expert_read_threads` default 1, its hint saying why. Rounds: 1 past decisions — the
dev build copies the release's flags so it behaves as a user's would; keep. 2 the other way — OpenMP on
in our builds changes every engine's host threading in the released runtime and parts from upstream's
release flags: rejected. 3 cost — serial reads are slower; measured below. 4 edge — a user who sets
more threads gets audio.cpp's own refusal; the hint says so before. 5 nothing new.

**D19 — VocalRender Pro ends at seed 7 (2026-11-08, mine; refines D15 rule 3).** Measured: its retake on
the CPU (the fork's CLI, original precision) held 20.6 GB of the 32 GB PC and free memory fell to 3.8 GB,
under the slot's 4 GB stop line — stopped at 16:48 (the morning's lockup began at this size). It is
scored on its 24 seed-7 takes (8-48-told-7 and 8-67-told-7 never rendered) against VoxCPM2's seed-7
takes of the same lines. No seeds 8–9: the app can't offer it (audio.cpp's web UI doesn't list the
package for VoxCPM2) and a load needs ~21 GB of RAM or more than an 8 GB card, so no result could make it
a pick for this app's users; more renders would only risk the machine. Rounds: 1 the user's words ("left
out the other new vocpm2") — it is tested and scored, its limits measured and said; 2 cost — measured
above; 3 the other way — on a 24 GB card it would fit, but the offering is still NOT STANDARD against
audio.cpp's own catalog; 4 nothing new.

## The standard each piece follows

| Piece | Standard | Kit code |
|---|---|---|
| The model files, their pins and downloads | the kit's models cache (HF cache layout, a blob per SHA-256) | `packages/core/src/runner/models.js` (`acquireFileSet`) |
| Loading, placing and unloading each model for the tests | the kit's audio.cpp runtime and its routes | `packages/core/src/runner/runtime_service.js` |
| The speech catalog | audio.cpp's own spec files and web UI rule, read at our fork's ref | app — `scripts/audiocpp-catalog.js`, JustVoice's catalog of voices |
| The licence readings | each model's licence read at its source | app — `curated/<family>.js` |
| The picks' route and shape | a JSON route on the app's server, its shape in `models.js` | app — JustVoice's `book_voices` settings |
| The picks in a picker | the kit's select and its groups ("recommended first") | `UiSelect` |
| The picks' store | a per-domain Pinia store, as the app's other stores | app — `src/stores/voicePicks.js` |
| The judge | take-check's LAION heads (NVIDIA NeMo's wrapper), as round 10 | app — the test kit beside the app, never shipped |

## Mistakes to avoid

- Don't hold a candidate back behind a release schedule when the job is "the best".
- Check every test arm against the TASKS rulings before it runs: a non-commercial model is never the
  subject of a round (D13 — BreezeTTS 2 4-bit took the card for 60 takes for nothing).
- A log watch: no `cut` in the pipe (it holds lines); `awk … fflush()`.
- Look at a process before stopping it.
- Three CPU jobs at once (Kitten, the read-back, VocalRender at 12 GB) beside a desktop build and the
  release's e2e saturated the machine: Kitten's 10 failures, VocalRender's 2 "bad allocation", the
  release's JustWrite e2e timeouts. Run one CPU piece at a time.
- The lockup, from Windows' System log (read after the restart): at 10:34 "low virtual memory",
  the top three audiocpp_cli.exe 22.8 GB (VocalRender Pro, mine), audiocpp_server.exe 16.5 GB (the
  app's CPU speech server, mine) and blender.exe 9.0 GB, on a 32 GB PC; from 11:00 Windows services
  timed out starting (12, 15, 18 an hour) until the hang — last heartbeat 13:53, hard restart 14:15
  (Kernel-Power 41). No Bluetooth or display-driver fault before it. My CPU jobs had ended by 12:07,
  so the log can't say what kept the machine starved after them. Book RAM and the processor with the
  other sessions as the card is (the global rule, 2026-11-08).
