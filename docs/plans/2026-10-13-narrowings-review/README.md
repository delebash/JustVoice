<!-- SPDX-License-Identifier: MIT -->
# The narrowings review — every choice I made that the approved words didn't (2026-10-13)

Decided: TASKS "Adopt everything audio.cpp has in engines; what we add, in a standard way — and a
review of every narrowing I added unasked". The user: "review all your decisions like this, this
is a huge massive mistake"; "go and i want evertyhing done right we adopt all that audio cpp has
in engines anything we need to add we do so in a stnadard way"; "you need to check your results
adverserially before you recommend any fixes"; "make sure you adversiariall includes
recommnedations on fixes".

**How it was done.** Six reviewers, one per area, put each approved decision (TASKS, the plan
docs) beside the code and listed every filter, limit, refusal, hidden option, number, label or
"decided" claim the approved words don't contain (`reports/`). Eight more tried to break each
finding — read the line, search TASKS, the plans, git and the session transcripts for an
approval, check the effect is real — and attacked each fix: is it audio.cpp's or the framework's
standard way, does it bring a new number, word or rule, what does it touch, is there a simpler
one (`verdicts/`). One of them checked all 392 "decided" / "the user's" claims in code, docs and
RESEARCH from 2026-10-01 on. Only what survived is listed below; the verdict files hold the
evidence (file:line, the approved words quoted) and the full fix blocks.

**Tally.** 131 first-pass findings (memory 13, platform 42 + 3, fork 16, engine list 15, Cast and
personas 14, Render and Script 28) and 20 claim groups. Refuted 10, unsure 3, surviving 118 + the
20 claim groups. Data risk: 2 (P16, S6). Nothing has been fixed.

**IDs.** M memory and placement · P platform and the open-work program · F the audio.cpp switch,
our fork and the hand-wired engines · E the engine list · C Cast, Discover, personas · R Render
progress, Export, joins · B the Render chapter page · S Script, the second look, the narrator ·
K claims ("decided" that wasn't). Each ID is the finding's number in its verdict file.

## A — Fixes that add no new number, word or rule

Each restores what was approved, deletes something unasked, or corrects a record. One word from
the user can cover the list; anything here that turns out to need a word goes to B.

**Records (comments, docs, RESEARCH, TASKS) — say what was decided, and mark my choices as mine:**
K1–K20 (31 false or overstated "decided" claims; `verdicts/claims-verdicts.md`); M1 (three
records say OmniVoice's fallback price is fixed — it isn't); M2 (the runaway comment); C1
(`docs/studio.md:815`); C5 (RESEARCH:1521 and the comment); C7 (RESEARCH:1434 "Only Discover adds
speakers"); P11 (RESEARCH:1251 "the user's ruling"); P22 (docs still list the Labs routes); P23
(the Labs STATE quotes an answer to another question); F1 (RESEARCH §1 "Only Kokoro's spec lists
options"); F13 (`chatterbox/manifest.js:33` names a deleted file); B4 and K11 (the Render mock's
header); the stale "for the user's word" in "Every open task…" BUILT (the update cache was decided).

**Code:**

| ID | What changes | Severity |
|---|---|---|
| M3 | The AI model's refusal names a speech model running on the CPU too (the approved sentence; today only card bookings are named) | VISIBLE |
| M10 | Both RAM refusals print what is really free; a refusal after crediting falls back to the approved "Close other programs, or pick a smaller model." | VISIBLE |
| M11 | Kit: the RAM check runs at a wake even when the model books 0 MB on the card | INTERNAL |
| C4 | Voice dropdowns show "Not known" for an unknown gender (the approved word) | VISIBLE |
| C8 | Cast's "Added here" tooltip reuses Discover's existing words | VISIBLE |
| C9 | Discover's "Ignore N selected" doesn't count the narrator it never ignores | VISIBLE |
| C11 | A persona's language follows its new voice in the server too (the user's 2026-10-05 reversal) | INTERNAL |
| E10 | "multilingual" shown as audio.cpp words it; "auto" not counted as a language | VISIBLE |
| E11 | The clone maker shows "What's said in the recording" for every family that takes the words (OmniVoice can't clone without them) | VISIBLE |
| E15 | `text` and file-path options never offered as settings (IndexTTS's "Text", VoxCPM1's paths …) | VISIBLE |
| R2 a, b | Export's Cancel reaches its render phase (the standard `AbortSignal` the sibling routes already pass); only lines with no take in use are rendered | VISIBLE |
| B1 | "Rewrite as" and "Cast" use the speaker's full name ("Dr. Watson", not "Dr.") | VISIBLE |
| B4 | The Render mock gets the approved speaker picker | INTERNAL |
| S2 | The second look sends a speaker's whole "who they are" (no 200-character cut) | VISIBLE |
| S3 | A not-in-the-book name of any length reaches the banner (no 60-character cut) | VISIBLE |
| F8 | Re-measure Kitten's seed through the app; if it repeats, offer the seed audio.cpp's spec lists | VISIBLE |
| F11 | Kokoro: a line in a language Kokoro lacks is sent with no language, so audio.cpp uses the voice's own (its documented default), not "en-us" | VISIBLE |
| F13 | Restore the Turbo/Nano converter from git as a fork tool (Python tools are allowed since 2026-10-11) | INTERNAL |
| P10 | JustVoice's CORS defaults lose the Tauri origins; the desktop window's origin is always allowed | INTERNAL |
| P42 | `server/package.json` gets npm's `files` list, so the installer stops shipping the tests, scripts and test books (only the demo book's sample stays) | INTERNAL |
| P-ver | A test that the server's and the installer's versions are the same | INTERNAL |
| P-also2 | `lru-cache` (the standard package) replaces the hand-ported Python TTLCache | INTERNAL |

## B — Questions only you can answer

My lean is under each. Answer by ID; "your rec" on a group takes every lean in it.

**Data — first.**
- **P16.** Restoring an old backup overwrites, on every paired or cloud-folder computer, the edits
  made since that backup, and deletes there what was created since (JustWrite too). Which wins?
  (a) the backup, everywhere, with a warning before the restore; (b) the other computers' newer
  work — restore the sync tables with the data so old changes stay old; (c) a restore starts a new
  sync library. Lean: (b); until it's built, (a)'s warning, its words for your word.
- **S6.** A speaker you set before a chapter's first Analyze is silently replaced, though the page
  says "Lines you set are kept". (a) keep it — needs a design for the re-cut (which new line gets
  it), shown first; (b) let Analyze replace it and say so. Lean: (a).

**Speech engines and memory.**
- M2 the runaway rule: 0.5 s a character, 30 s, only runaway lines. Lean: keep the values, as settings.
- M4 a saved price just under the card goes to the CPU "more than it holds" while the tab says
  "fits this card". Lean: the reason says "with the 1 GB safety margin"; the tab uses the same rule.
- M6, F14, P5 the silence guard: fills runs of 10 ms or more, keeps 200 files, runs in the server
  (the Electron ruling says the server does no sample math). Lean: fix the runaway in our
  audio.cpp copy (that item's open line) and delete the guard.
- M7 `spill_mb` 256, and settings reachable only by the API. Lean: keep 256; controls on the runtime row.
- M8, K8 a remembered failed card load: forgotten only by a measured card load or a new runtime
  build. Lean: keep, plus a "Try the card again" action on the model's row.
- M9 the CPU speed: lines under 2 s never count; best of the newest 5. Lean: keep as constants.
- M12 the kit's second measurement was a different placement than approved. Lean: accept.
- M13 internal timings (probe cache 2 s, drain 4 s, settle 30 × 2 s). Lean: constants.
- K2 VieNeu hidden "as decided" — no lean was shown. Lean: list it, marked as not cloning yet.
- E9 IndexTTS's direction changed from the tested words (12 of 21) to an untested emotion vector.
  Lean: back to the words until a test says otherwise.
- E12 a setting with no default shows its minimum as the default. Lean: no default — audio.cpp's own.
- F6 Pocket: 6 of 26 presets left out for their licence. Lean: all 26, each labelled.
- F12 one IPA symbol Kokoro lacks refuses the whole line. Lean: warn when the entry is saved, and
  speak that word the normal way.
- F16 the direct-URL source override was removed (switch R11). Lean: keep it removed.

**Cast, personas, voices.**
- C1 Smart-assign leaves the narrator out. Lean: include a narrator with no persona; never replace one.
- C2 "Models to choose from" lumps Qwen3's and Chatterbox's models. Lean: list each model.
- C3 "installed voices" — the runtime counts as installed. Lean: say so; no change.
- C5 a chosen Version that isn't downloaded is ignored. Lean: keep what's downloaded speaking, and
  show the page's Load button for the chosen one.
- C6 the persona page's Gender filter offers "Not known (N)". Lean: keep.
- C7 does "one place adds speakers, Discover" retire Cast's ＋ Add? Lean: keep Cast's ＋ Add.
- C10 Smart-assign's error names a screen that doesn't exist. Lean: "Smart-assign needs a language
  model — set one in AI Settings."
- C12 numbers: the 5-take history, the 60-voice gender batch, Discover's name rules. Lean:
  constants; Smart-assign's 200-character cut goes (send it whole).
- C14 changing Type clears the Model filter. Lean: keep the model with (0), as your filter rule says.
- K3 a book with no language offers every voice. Lean: ask for the book's language first.
- K4 "Merge into…" also moves lexicons, generations and MCP bindings. Lean: keep.

**Render and Script.**
- R1 a pasted chapter's paragraph lines get the shorter pause (fall back to Analyze's paragraph);
  should a split line join its paragraph at it? Lean: yes.
- R2 c the render phase's count: "Rendering line N of M" (words for your word), or warm per chapter
  (more model reloads). Lean: the count.
- R3 "follows any render of its chapter, wherever it was started" was built as "in this window".
  Include other windows and apps, with Cancel? Lean: yes, yes.
- R4 do exports and the ACX check count as "a book's renders" when it's deleted? Lean: yes.
- R5 the join thresholds as constants or Settings. Lean: constants (as Settings they'd need the
  render cache key changed).
- R6 queue work names and "about N s left". Lean: keep (the list is in the verdict).
- R7 export file names: spaces → "_", non-Latin letters lost, "_chapters". Lean: the title as
  written (JustWrite's `safeTitle`, moved to the kit), the zip "<title> chapters".
- R8 ⬇ Chapter WAVs refuses everything without ffmpeg. Lean: the chapters only, with a note.
- B2 a value equal to the persona's isn't saved as the line's own. Lean: keep.
- B3 🎧 Run ACX QC waits for any render. Lean: keep, and say why on hover.
- B5 "Its words", "new seed", "earlier words". Lean: keep.
- S1 the second look drops answers under 0.5 and says "found no one". Lean: no floor.
- S4 lines the second look fills are marked "changed by the last Analyze". Lean: no mark.
- S7 Review stays greyed before Analyze while the row opens. Lean: Review opens it too.
- S8 ✎ Edit text greys during a run with no reason. Lean: "Wait for it to finish", as Review says.
- S9 the Re-analyze chip's tooltip names one of its two reasons. Lean: name both, in the docs' words.
- S11 the narrator question looks at the chapters being analyzed, not the book. Lean: the book.
- S12 one tag "To check" for four kinds of check. Lean: a tag per kind (the words for your word).
- S14 dialogue tags are recognised in English only. Lean: the hint says so.

**Platform and program.**
- P1 CORS is our port of Starlette's; the plan named `hono/cors`. Lean: `hono/cors` (refused
  preflights answer 204 instead of 400; browsers behave the same).
- P2 the body limit is hand-checked at 1 GiB; the plan named `hono/body-limit`. Lean: it, on JSON
  routes only (backup restores stay unlimited), 1 GiB.
- P3 `input()` (~100 lines, NOT STANDARD) instead of the approved ~25-line `validator()` glue —
  `validator()` answers 400 where the API promises 422. Lean: keep `input()`.
- P4 MCP uses the SDK's transport directly, not `@hono/mcp`. Lean: keep.
- P6 the desktop app ignores the Port setting and force-kills whatever holds 17494, your own
  headless server included. Lean: honour Port; evict only a server that answers as this app.
- P7 the API-docs toggle does nothing. Lean: remove it, its link and its doc line.
- P8 two tray items do nothing (Start dictation, MCP toggle). Lean: remove until they work.
- P9 the shell waits 8 s for the server to stop (Tauri waited 15 s). Lean: 15 s.
- P11, K9 the clean-room rewrite's 21 gap rulings, never shown (ChordPicker deleted; `/mcp` behind
  the token; the splitter's rules). Lean: read the list (`verdicts/platform-1-21-verdicts.md` #11).
- P12 the `.jvsync` extension. Lean: keep.
- P14 persona pictures don't sync (no screen sets one). Lean: remove the field and the doc line.
- P15 an imported voice keeps its id. Lean: keep.
- P17 a JustVoice-only deletion log for sync, never pruned. Lean: move it into `@delebash/sqlite-sync`.
- P18 the copied sync watcher asks before reloading ("Changes from another device arrived. Reload
  to see them."); JustWrite reloads by itself. Lean: one kit watcher, reloading by itself.
- P19 Sync is an app section. Lean: keep.
- P20 Stories don't sync, and the doc doesn't say so. Lean: say so.
- P21 a Stop drops a waiting re-tune. Lean: keep.
- P22 the ffmpeg error still names `/v1/master`. Lean: cut those words.
- P24 two NOT STANDARD build steps for Quasar's CSS (the layer, and the grown disabled-state rule).
  Lean: keep both.
- P25 the app id `dev.justvoice.app` differs from §Q and from the id the shell sets at run time.
  Lean: `com.justvoice.app`, before the first Electron release.
- P26 New project, Lexicons, Effects and Speech engines were built with no in-app mock first.
  Lean: compare each with its frozen mock side by side, then your call per screen.
- P27 a file fills New project's name and kind unless you set them. Lean: keep.
- P28 the import format picker became automatic. Lean: keep, and bring back "What is this format?".
- P29, P35 strings on New project (8), Lexicons (3) and Speech engines (1, it names API routes to
  users). Lean: your words; the lists are in the verdicts.
- P30 Lexicons' ▶ plays this lexicon alone, not with the book's. Lean: the book you came from, plus
  this lexicon.
- P31 a lexicon entry can't be heard until saved. Lean: let it be heard unsaved.
- P33 Effects keeps a held take 10 min, 16 at most. Lean: keep.
- P34 the drag-to-reorder dependency is in JustVoice, not the kit. Lean: keep until a second app needs it.
- P37 the updater's "Restart now" and its 13 messages. Lean: keep.
- P38 a Mac only links to the release (unsigned). Lean: keep until the app is signed.
- P39 docgen has no releases or updater. Lean: later, with docgen's first release.
- P40 a waiting scan has its own Cancel. Lean: keep.
- P41 Claude: "thinking off" on Opus 5.5, Fable and Mythos thinks anyway, silently. Lean: map Off
  to effort "low" and say so in the control.
- P-also1 Channels' audio-device list is a placeholder. Lean: hide the field until it's built.
- K5 the kit shares a sibling's AI cache only when this app's own is empty. Lean: keep.
- K6 a new model's pre-filled description is in the app's language. Lean: keep.
- K7 "Auto-detect" for the capture language. Lean: keep.
- K10 the import errors (400s) and their words, never shown. Lean: keep.

## C — Into the adoption plan (TASKS "Adopt everything audio.cpp has", OPEN 2)

The plan, with its blast radius, comes to you before any of these is built.

| ID | What audio.cpp has that the app leaves out, or does by hand |
|---|---|
| E0 | Families that don't clone (13 at v0.9.1: Maya1, NeuTTS, VibeVoice, Supertonic 3 …) |
| E1 | Speech recognition families — 20 at jv.5, 26 at v0.9.1 (captions need an aligner: a question) |
| E2 | 104 number settings with no range (33 are number inputs in audio.cpp's own UI) |
| E3 | MOSS-TTSD's, MOSS-TTS v1.5's and OmniVoice's instruction |
| E4, M5, F1 | Session (load) options — only two Qwen3 ones are offered; "5h exposing every option" was approved |
| E5 | Voice-design entries (Breeze, FireRedTTS3, FireRedAudio, Irodori ×2) |
| E6 | Packages audio.cpp's UI offers (MOSS-TTSD Q4_K and BF16, CosyVoice3 F32, Irodori Anime, Breeze Q4_0) — adding only, removing none |
| E7 | F5-TTS and others with no catalog entry (entries in our fork's catalog) |
| E8 | "Can't be directed yet"; CosyVoice3 and Higgs offered emotions they drop |
| E14, F5 | What the hand-wired skip hides: original precisions, audio.cpp's own Turbo package, Qwen3-ASR 0.6B/QwenCleo, streaming (voice conversion stays out — your 2026-10-11 answer 9) |
| M1 | Generated models never warm up, so no fallback price is saved (OmniVoice) |
| F2 | Our fork's additions declared in our fork's specs (Kokoro voice_pack and IPA, Chatterbox's four languages, Turbo's packages and options) |
| F3 | Chatterbox Multilingual v3 (in the file, a session option) |
| F4 | Turbo's and Nano's built-in voice |
| F9 | Ranges narrower than audio.cpp's (exaggeration ≥0.25, VoxCPM2 CFG ≥1 and steps 4–30, Qwen3 top k ≤100, seed max) |
| F10 | Voices, languages and chunk sizes copied by hand from the specs |
| C13 | The voice makers' per-model notes, typed by hand |
| P36 | The "Picking an engine…" rows cover only the hand-wired engines |

Two requirements the checks found for that plan: saved persona settings use the app's names
(`cfg_value`, not `guidance_scale`), so a key map must keep them; and stored voices, personas and
prices use today's engine and model ids (`kokoro`, `chatterbox-multilingual-v2-q8`), which must
stay.

## Refuted — dropped, with the reason in the verdicts

P13 (speakers belong to the script), P32 (Try a word follows the design), P36 as a narrowing (the
rows were approved word for word), E13 (the hover was in the approved mock), F7 (the filter is the
voice's own language, as decided 2026-10-05), F15 (no usable Linux CUDA archive exists), R9 (the
rule predates Slice 4), S5 (your own words), S10 (a narrator "is not an option"), S13 (the approved
table says the chip shows only when there are any).

## Built 2026-10-13, and what waits on the user

**Built** ("your rec on all go"): group A and every group B lean that needed no new word, by four
agents, then two adversarial reviews of the changes and a second round of fixes
(`verdicts/` is the finding side; the reviews of the changes are in the session's scratchpad and
summarized in TASKS). **The restore (P16) is on hold, not shipped:** the backup-keeps-its-stamps
design (just-sqlite-sync branch `restore-wip`, JustVoice branch `restore-wip`) was redesigned twice
under review, and a stress test (three devices, random edits, backups and restores, 300 runs) still
found permanent divergence in 6 runs — an exchange under way during the restore, a backup taken
while the floor is on, rich-text ids reused, a reset then a restore, the step never running. A
prototype that makes the restored device a new identity in sync (the engine's own rule for a copied
database) passed 300 of 300; it shows the restored computer as a new entry in the devices list, so
it waits for the user's word (question 20). Until then a restore behaves as before. The kit's
restore route gained the optional hooks (`beforeCopy`, `afterCopy`, `afterTables`) either design uses.

**Waiting on the user** — words, numbers or rules the fixes need (a lean under each in chat):

1. The earlier list (shown 2026-10-13): S6's design, S12's tags, R8's note, B3's hover, C5's hint,
   K3's prompt, M7's controls, S14's hint, F12's warning, P41's control text, P35's paragraph, P29's
   strings, P14 (remove persona pictures; takes effect at the next reset), P16's interim warning
   (moot once built), P11's list (the 21 clean-room rulings), P26 (the four screens beside their
   frozen mocks).
2. M4: the tab's words for a measured model that fits the card only without the safety margin.
3. R2c: "Rendering line N of M" (the export's render phase).
4. The export hint — "Cancel stops after the chapter it is on" is no longer true while lines render.
5. E15: dots.tts's Source/Target text and Irodori's No ref (shows "on"; on, a clone ignores its clip)
   — offered or hidden.
6. R3: how an open page notices a render started elsewhere (on window focus, or a timer — a number).
7. R3: how a render over several chapters shows on each of its chapters.
8. R4: a request stopped because its book was deleted answers 500; a 404 "not found" instead?
9. P6: the words when another program holds the port; the two waits (the renderer up to ~7.5 s for
   the server's address, then ~7.5 s for its health; the shell's health probe 500 ms).
10. P18: the window reloads when another device's changes land — unsaved typing is lost.
11. P30: "the book you came from" read as the project open in Studio.
12. P-also1: Channels' docs and its "Multi-device broadcast supported" line describe routing that
    isn't built.
13. M3 × M10: a refusal after crediting memory — name the speech models on the CPU?
14. K2: VieNeu listed with the adoption plan (slice 2 checks it speaks from text), not now.
15. R7: the file-name rule also drops control characters (as JustWrite's server copy does)?
16. C5: Pocket's Version offers only versions that speak the persona's language?
17. F11: a Kokoro blend's own language passed from render and preview.
18. IndexTTS's capability note "Takes a line's emotion and direction." (it takes direction in words).
19. A data-folder lock (a standard package such as `proper-lockfile`), so a second server of the
    app on another port can't open the same data.
20. P16, the restore: make the restored computer a new device in sync (it appears as a new entry in
    the devices list; its old folder subfolder stays until removed), plus: keep this computer's live
    sync settings (library key, paired devices, folder) across a restore — today the backup's
    replace them; and a backup from another sync library — refused, or this computer joins it?

**Found on the way** (bugs, not fixed — each for the user's word): a lexicon entry with both IPA and
a spelling is saved as IPA only (`storage/lexicons.js:29-40`); Try a word replays the old take when
the word changes; a corrected line keeps an old paragraph number after a re-analyze
(`extraction_api.js` in-place loop); the unused setting `limits.request_body_max_bytes`; stale docs
(`channels.md`'s routing, `getting-started.md:38`'s tray items); the kit's `TAURI_ORIGINS`
(`csrf.js`); the re-import dialog's dead "What is this format?" link (`ImportModal.vue`); a long
book's takes read twice by the export; the shell force-kills its stale server instead of asking it
to shut down (`shell/main.js`).

**JustWrite's side** (its session, with the user's go there): the restore wiring
(`beforeCopy`/`afterCopy`/`afterTables`), its CORS test (hono/cors), `serverProduct: "JustWrite
Server"` and `resolvePort`, switching to the kit's `watchSync` and `safeTitle`.

## P26 — three screens beside their frozen mocks (2026-10-15)

Compared at 1280 and 390 px on the user's data (gate server, Playwright; pictures were in the
session's scratchpad). Speech engines waits for the adoption plan's slices. Each screen: what
differs, whether a decision covers it, and a lean — **the user's call per screen**.

**New project** (mock `_s1`; `NewProjectModal.vue`). Covered by "Every open task…" (2026-10-09:
keep the dialog, a file optional, the small table, no "What you get", no master target): a dialog,
not a two-column page; no target chooser or "What you get". Not covered: Name and Language
unlabelled in the footer (the mock labels them in step 1); no step numbers; the source table has 7
rows from the server's importers with columns Source / Files / What comes in (the mock: 4 rows,
Source / What lands / Speakers?, yes/no and "richest" tags), and its descriptions show internal
words ("character roster", "lift to characters", `pause_after_ms` — design law 6b). Lean: keep the
shape; the table's columns and words toward the mock's (new words, for the user's word).

**Lexicons** (mock `_s10`; `LexiconsPage.vue`). Covered: IPA "Kokoro only", Try a word
before/after (plan §3). Not covered: a library list plus an editor dialog (the mock: a page per
lexicon); an "Add entry" form below the table (the mock: one inline add row); columns ▶ / Word /
Pronunciation / Format / Edit+Delete (the mock: Word / Say it as / Notation / Heard ▶ / 🗑); the
IPA note a plain grey hint (the mock: an amber banner); Affects a hint line (plan §3 said "the card
says so, as the mock does"); **scope fixed at creation** (the mock: Global / This project / One
persona, changeable, with which lexicon wins — no decision found). Lean: keep list-and-dialog; the
amber IPA banner and the Affects card as the mock and plan §3 have them; scope — the user's call.

**Effects** (mock `_s11`; `EffectsPage.vue`, `EffectsChainEditorModal.vue`). Covered: the library
plus a persona's chain as a dialog (plan §4), no From column or scene rows (the Scene went to
IDEAS). Not covered: each step is a box with full-width number boxes two per row (the mock: compact
rows, settings inline and sized, with units) — against the size-to-content rule; "＋ Add effect" and
the Save-as-preset card drawn differently; no engine pill. Lean: keep the shape; draw the chain list
in the in-app mock first, then build it.

**Defects found, fixed under the existing rules** (no decision needed): the lexicon dialog's inputs
shown in 11px capitals (a selector matching Quasar's `<label>`); the lexicon table clipped at 390
px; the Effects library's chain pills showing internal keys; "dB" shown as "DB"; New project's
footer cramped at 390 px; at 390 px the ☰ pill over the page's first text and the topbar pills cut
off. **Seen, for the user's word:** every kit table header is JetBrains Mono 10.5px (the mock: the
sans).
