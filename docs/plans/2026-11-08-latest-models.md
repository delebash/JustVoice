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
