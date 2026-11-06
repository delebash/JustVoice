<!-- Kept 2026-11-06: the review the user's "your rec go" took (TASKS "The finish run's nine decisions", item 5) — written from code at JV aa603712 on 2026-11-05; its line numbers are that commit's. Done since: entries removed, the three before-release items built or removed, the five "later" ideas removed for now (re-added after the release). -->

# JustVoice IDEAS.md — decision prep for the family release (read-only review, 2026-11-05)

**38 entries** (34 dated bullets + 4 in "Parked 2026-08-21").
**Class:** ALREADY DONE 3 · OBSOLETE 3 · STILL OPEN 32 (8 of them partly done or partly duplicated).
**Rec:** DO BEFORE RELEASE 3 · DO LATER 7 · REMOVE 28.
**DO BEFORE RELEASE:** Global dictation hotkeys… (#13) · From the full walkthrough (#18, items a/e/g only) · Blank blocks render as Script rows (#32).

Every entry was checked in code at JV `aa603712` (main), the kit and the fork's `jv` branch (`281de44a`, the 2026-11-05 merge). Several TASKS items that IDEAS cites ("The run's last questions", "The two-day review's fixes", "Slice 2's acceptance findings", "The build's 16 questions") were deleted in the 2026-11-05 sweep `652b012a`. Find them with `git log -S "<title>" -- docs/dev/TASKS.md`.

Several REMOVE recs leave unused code or false promises behind. Each one names what would have to be deleted with it.

---

### 2026-10-16 · Pocket TTS and Qwen3 repeat on the graphics card
1. What: on the GPU, the same seed can give a slightly different take, depending on the longest line spoken since the model loaded. The words stay the same.
2. Stands: STILL OPEN. Qwen3's step graph still doubles (`../audio.cpp/src/models/qwen3_tts/talker.cpp:1954,1997`). The entry's line numbers 1862-1892 are stale after the merge. **New finding:** Pocket already has a load option that would fix its half. `offline_graph_capacity_mode` accepts `fixed`, together with `prompt_graph_capacity` / `generation_graph_capacity` (`../audio.cpp/src/models/pocket_tts/session.cpp:593-612`; `server/src/engines/audiocpp/seed_audiocpp_catalog.json:14224`). Its default is `double` on the GPU. So Pocket may need only a saved load option, not a change in the model. That is unmeasured. Research: RESEARCH §1.2 (lines 245-258).
3. Takes: Pocket is small (a load option, then a re-measure). Qwen3 is medium (a fork model change, with a small speed cost). The upstream merge reworked Qwen3 (#1011, #1055, #1141), so the old measurement needs re-running first. Gives: a re-render with the same seed is byte-identical on the GPU, which matters to anyone patching one line.
4. Rec: **DO LATER.** The words never change, and the user already chose to document it rather than fix it.
   Attack: the cheap Pocket half could go into the finish run instead of waiting. Its only cost is a measurement once the card is free.

### 2026-10-16 · Word timings for Arabic
1. What: Arabic transcripts get no word timings, because Qwen3's aligner has no Arabic.
2. Stands: STILL OPEN. `align()` sends Arabic to the Qwen3 aligner as "Arabic" (`server/src/engines/audiocpp/slot.js:43-44`, `kit_speech.js:185`). A failure comes back as a generic "engine align failed: …" (`kit_speech.js:89-92,188`) and does not name the aligner's 11 languages. Side finding (unverified at runtime): a language missing from `ASR_LANGUAGE` is sent to the aligner as "English" (`kit_speech.js:185`). Research: RESEARCH §1.6 (lines 701-709); the MMS aligner is CC-BY-NC-4.0, needs a romanizer and has no GGUF.
3. Takes: the aligner itself is large and needs research (a commercial-use Arabic forced aligner). The better error is small: check the language before calling and name the 11. Gives: captions and read-along for Arabic books, a small audience.
4. Rec: **REMOVE** the idea. The better error is a bug fix the finish run can take on its own.
   Attack: an Arabic producer gets no captions. No commercial aligner is known yet (a gap in the search, not a proof that none exists).

### 2026-10-15 · VieNeu-TTS v3 Turbo through SEA-G2P in our fork's release
1. What: make the Vietnamese VieNeu model speak by building the sea-g2p Rust library into the fork's release and giving it a voice.
2. Stands: STILL OPEN and hidden (`server/src/engines/audiocpp/curated/vieneu_v3_turbo.js:22`, `NOT_OFFERED`). It also needs a speaker embedding from CAM++, which audio.cpp hasn't ported ("Without it the embedding is all zeros", `../audio.cpp/docs/models/vieneu_v3_turbo.md:96`). Vietnamese is already offered elsewhere: sanoTTS `vi` (`curated/sanotts.js:25`), and "vi" appears 15 times in the catalog. Research: RESEARCH §10.13 (3439), §10.14 (3598), §10.15 (3831-3835, 3878, 3909), §10.17 (4123).
3. Takes: medium to large. Rust in the fork's CI, a ~50 MB dictionary download, and a speaker embedding or a CAM++ port. Gives: one more Vietnamese voice.
4. Rec: **REMOVE.** Vietnamese is covered, and the cost lands in the fork's release pipeline.
   Attack: VieNeu might sound better than sanoTTS in Vietnamese. Unmeasured; needs measurement: VieNeu vs sanoTTS vi.

### 2026-10-15 · Audio output channels — a persona's audio to a chosen output device
1. What: named channels that route each persona's playback to a chosen speaker or device.
2. Stands: STILL OPEN as dormant half-built code. Present: the `channels` and `persona_channels` tables (`server/src/database/models_schema.js:154,351`), `server/src/api/channels_api.js`, and `src/components/AudioChannelsSection.vue` (+ its test), hidden at `src/services/settingsSections.js:24`. Missing: `listAudioOutputDevices` returns `[]` (`src/services/native.js:164-166`), and nothing outside the API reads a channel. Research: none found (grep "output device|persona_channels").
3. Takes: medium. Device listing (`setSinkId` and `enumerateDevices` in the renderer), routing playback, and deciding what an export does with channels. Gives: live routing for streamers or game prototyping. It doesn't touch a file deliverable.
4. Rec: **REMOVE, and delete the dormant code with it** (the tables, the route, the hidden tab and its test, the native stub, and #34's "audio-channels MultiSelect UI").
   Attack: the user asked that it not be forgotten ("add it to ideas so we dont forget"). git keeps it, but removing it goes against that wish, so the user's word is needed here.

### 2026-10-12 · Check the commit limit, not only free RAM
1. What: refuse or warn before a load that would exceed RAM plus the page file, the point where an allocation fails outright.
2. Stands: STILL OPEN. Nothing in the app or the kit reads the commit limit (grep "commit limit|pagefile|TotalPageFile" over `../just-core/packages/core` and `server/src`: nothing). It happened once: F5-TTS leaked to 67 GB against a 40 GB limit and failed with "bad allocation" (RESEARCH §10.15, lines 3928-3932). The fork has since fixed an F5 leak (`9834aab3`); whether that fixed this one is unverified. Research: RESEARCH §10.14 "Which memory number" (3694-3716).
3. Takes: medium, in the kit's memory booking, not in JV. Gives: a clear refusal instead of a crash on a machine low on memory.
4. Rec: **REMOVE** from JV's IDEAS. It is the kit's arbiter's job; if the user wants it, it belongs in the kit's list.
   Attack: a crash under memory pressure is the worst kind of failure, and it happened once.

### 2026-10-11 · What the research sweep says would make the audiobooks better
1. What: about 25 ideas from the 2026-10-11 sweep, covering acting, checking takes, the text side and production.
2. Stands: STILL OPEN, partly done. **Done:** the test kit (`tools/take-check/`, a Python dev tool); in-app read-back with one automatic re-render (`server/src/take_check.js:1-30`); one cast with names merged across chapters (`speaker_merge`, `server/src/feature_catalog.js:56-64`); direction (`feature_catalog.js:65-75`); the authors'-way re-tests (RESEARCH §10.22, §10.29); Breeze 2 tested (§10.36). **Partly done:** pauses (lines, paragraph and scene break, `server/src/models.js:301-309`); head and tail silence in the mastering presets (`models.js:343-394`).
   **Open:** emotion bank, best of N, act-then-reference, splitting a line where its emotion changes; text normalization (none, RESEARCH 3314); EPUB semantics such as footnotes and front matter (nothing in `server/src/imports/adapters/book_prose.js`); MOBI/PDF; LLM-proposed pronunciations (`server/src/pronunciation.js` only lists names); heteronyms; a pause at a speaker change or after a chapter title; previewing voices on the character's own lines (Cast plays a stock line, `src/components/StudioCast.vue:535-541`); QuickTime-only chapters (no `disable_chpl` in `server/src/export_audiobook.js`); credits ("add as chapters", `src/components/ExportPanel.vue:225`); retail sample; digital-voice disclosure; read-along timings (captions exist per take only, `server/src/api/align_api.js`).
   Research: RESEARCH §10.9-10.12 (2971-3383), ranked lists at 3161-3167 and 3376-3380.
3. Takes: each piece is small to large. The cheapest: QuickTime-only chapters (one ffmpeg flag) and a speaker-change pause (one setting). Gives: audiobook quality and retail readiness, the primary audience.
4. Rec: **DO LATER (keep)**, trimmed to its open items. Text normalization looks like the strongest one (needs measurement: how each offered engine reads numbers, dates, money and abbreviations).
   Attack: a 25-item bucket never gets decided. Better that the user picks the 3-4 wanted, and the rest go.

### 2026-10-10 · Voice training (gap 5)
1. What: a LoRA trained on someone's recordings, for a closer copy of their voice.
2. Stands: STILL OPEN, but rejected by ear. The user heard every trained take as "worse than just the regular clone". No training code is left (grep "lora|peft": only comments). **Leftover in the UI:** a disabled "Trained" voice type, "LoRA training — not rebuilt yet" (`src/services/personaFacts.js:93`). Research: RESEARCH §9 (2331-2445); `docs/plans/2026-10-09-voice-training-findings.md`.
3. Takes: large (a separate Python trainer app, or ggml training in C++). Gives: possibly closer clones, which were not heard as better.
4. Rec: **REMOVE**, together with the disabled "Trained" option.
   Attack: if a better base model or trainer arrives, the idea comes back. RESEARCH §9 and git keep everything measured.

### 2026-10-09 · A passage with its own sound (the mock's "Scene")
1. What: a stretch of the book (e.g. a flashback chapter) with extra direction for every voice plus one effects chain over it.
2. Stands: STILL OPEN. Chapters (`scenes`) carry no effects chain (`server/src/database/models_schema.js:462`). Only personas do (`server/src/models.js:749`). Research: none for a chapter effect; effects in general at RESEARCH 1475.
3. Takes: medium (a chapter setting, the render merge order, the cache key). Gives: a flashback or dream chapter with reverb in one click.
4. Rec: **REMOVE.** A second persona with reverb (e.g. "Narrator (flashback)") does this today with no new concept.
   Attack: that workaround means re-casting the chapter's lines by hand, which a long flashback chapter makes tedious.

### 2026-10-09 · One shared engine-load task
1. What: replace two hand-built engine-load tasks with one shared helper.
2. Stands: **OBSOLETE.** `src/services/ttsJobChannel.js` was deleted in round E (`c542efc2`). The one remaining call site uses the kit's channel (`src/components/QuickSetup.vue:199`, `createDownloadTask(runtimeEngineChannel("audiocpp"))`). Research: n/a.
3. —
4. Rec: **REMOVE.** The kit now owns the load task.
   Attack: none. The duplication it describes no longer exists.

### 2026-10-08 · Rewrite every family app on the Quasar framework
1. What: rebuild every family app on Quasar, for framework conformity.
2. Stands: **ALREADY DONE.** JV (`7e4d71a3`), JustWrite, docgen, house-paint and the kit's template all depend on `quasar ^2.35.0` / `@quasar/app-vite ^3.10.2` (each `package.json`). The layout follows app-structure §Q (AGENTS.md). Research: n/a.
3. —
4. Rec: **REMOVE.**
   Attack: none. Its record lives in the kit's program doc and in git.

### 2026-10-07 · Character voice controls: formants, texture, creature sounds
1. What: per-character sound shaping: size (formant), texture effects, pitch-track controls, voice conversion, monster sounds, presets.
2. Stands: STILL OPEN. The effects are reverb, chorus, distortion, gain, compressor, pitch_shift, delay, filters and three EQ bands (`server/src/audio/effect_catalog.js`). There is no formant control, but the library to add one is already in the fork (Signalsmith Stretch, `../audio.cpp/dsp/third_party/signalsmith-stretch`; RESEARCH 1205-1212: `setFormantSemitones`). Research: RESEARCH §8 (2133-2330); `docs/plans/2026-10-07-character-voice-controls.md`.
3. Takes: large overall. The first step, Size (a formant shift) plus a pitch shift that keeps the voice, is small to medium (Signalsmith is already linked). Gives: game devs and audiobook full casts get distinct, non-human or sized voices.
4. Rec: **DO LATER (keep).** The user said "these types of features i want to add".
   Attack: if the user wants one thing from it before the release, Size is the cheap one. The rest can wait.

### 2026-10-06 · Script: move a line up or down
1. What: reorder a line within a chapter on Script.
2. Stands: STILL OPEN. Chapters can be reordered (`server/src/api/projects_api.js:969-1000`); lines cannot (grep "reorder|moveLine": nothing for lines). Research: none.
3. Takes: small to medium (a position swap, and whether `paragraph_idx` follows the line). Gives: fixing a line imported in the wrong order without losing its speaker and takes.
4. Rec: **REMOVE.** Lines follow the text, and ✎ Edit text already fixes order.
   Attack: after Edit text the moved paragraph loses its speaker and takes, so a fix after rendering costs a re-render.

### 2026-10-05 · Global dictation hotkeys, in-app recording, and paste into any field
1. What: let a user start dictation from the app (Record, a global hotkey) and paste the result into any field.
2. Stands: STILL OPEN. Nothing in the app records for dictation. **The app tells users otherwise:**
   - Home's default banner: "Global speak/dictate hotkeys are off — flip them on in Captures" (`src/pages/HomePage.vue:480-481`). Captures has no such switch.
   - Captures shows a "Hotkeys coming soon" card with fixed chords and disabled buttons (`src/pages/CapturesPage.vue:122-149`).
   - Captures' "Record (soon)" tooltip says to use a global hotkey or a topbar dictate button (`:173-179`). Neither exists; there's no "dictate" in `src/layouts/MainLayout.vue`.
   - The pill hint names a "Show dictate" topbar button (`:163`). It doesn't exist either.
   - `docs/dictation.md:5,26` and RESEARCH 1141-1146 still say "the desktop shell has a hotkey monitor". That was the Tauri `hotkey_monitor.rs`, deleted in `a605a7cb`. The kit's shell and `src-electron` have no `globalShortcut`.
   What works: the server's `POST /v1/captures`. Research: RESEARCH §3 (1141-1146, stale), §6 (1455); ROADMAP §1 calls this the "biggest true gap".
3. Takes:
   - In-app Record: small. `MediaRecorder` already works in `src/components/PersonaCloneMaker.vue:102-110`, and the endpoint exists.
   - A toggle hotkey: small to medium (Electron's `globalShortcut`). It reports no key-up, so push-to-talk hold needs a native hook. Needs research: a hold-to-talk global key hook for Electron.
   - Paste: large. Needs research: native key injection per OS, with the clipboard saved and restored.
   Gives: the dictation audience (one of the five) can actually dictate. Today it cannot.
4. Rec: **DO BEFORE RELEASE.** At minimum in-app Record, plus the false copy fixed or removed. The hotkey and paste are the user's call.
   Attack: if dictation isn't a v1 audience, the cheaper fix is to strip every false claim (Home, Captures, the docs) and leave the feature out. That is also small, and also must happen before release.

### 2026-10-05 · Import a `.justvoice.zip` project
1. What: read back the project ZIP that Studio → Overview exports.
2. Stands: STILL OPEN. The export exists (`server/src/api/project_export_api.js:1-12`, "machine migration + handoff"). No adapter takes it: `justvoice_standard` is JSON only (`server/src/imports/adapters/justvoice_standard.js:1-10`), and the `.zip` adapter is JustWrite's (`server/src/imports/index.js:46`). The entry's `.py` file names are stale. Moving projects between your own computers is covered by sync (`docs/sync.md:1-14`, no audio) and by the whole-server backup and restore (`server/src/data_admin.js`). Research: none.
3. Takes: medium (create rows under new ids, re-link takes, WAVs, personas and lexicons, handle collisions). Gives: handing one project with its takes to another person's JustVoice.
4. Rec: **REMOVE.** Sync and backup cover migration.
   Attack: an export with no import is a one-way door. Handoff of a single project with its audio is not covered by either, so maybe drop the export's "handoff" claim too.

### 2026-10-01 · New TTS engines: IndexTTS 2.5, FireRedTTS3, FireRedAudio and the 2026 field
1. What: whether to add IndexTTS 2.5, FireRedTTS3, FireRedAudio, VoxCPM2, Step-Audio-EditX, MOSS-TTS-Nano and Sopro.
2. Stands: **ALREADY DONE**, through audio.cpp's catalog. Each has a curated file with a licence reading:
   - `curated/index_tts2.js` (2 and 2.5), `fireredtts3.js` and `firered_audio.js`: "Unclear".
   - `voxcpm2.js`, `moss_tts_nano.js` and `sopro_tts.js`: "Yes".
   - None is `NOT_OFFERED`.
   The licence gate decides use. The entry's Python and torch premises are gone. Step-Audio-EditX is not in audio.cpp (RESEARCH 2260-2269). Research: RESEARCH §10.9, §10.13; `docs/plans/2026-10-01-tts-engine-scan.md`.
3. —
4. Rec: **REMOVE.**
   Attack: the scan's §12 rulings were never answered one by one. The licence gate on each model now stands in for them.

### 2026-09-30 · audio.cpp as a second speech runtime, and two engines looked at
1. What: run audio.cpp beside PyTorch, plus two engines looked at: Breeze TTS 2 (non-commercial) and MiMo (cloud only).
2. Stands: **OBSOLETE.** audio.cpp replaced PyTorch outright (`1c7398d1`, then `a605a7cb`), and it is now the kit's runtime. Breeze TTS 2 is in the catalog (`curated/breeze_tts.js`, "Separate licence") and in use for character voices (TASKS "The character voices: BreezeTTS 2…"). No MiMo provider exists (`server/src/engines/tts_providers/`: elevenlabs, speechify, speechmatics). Research: RESEARCH §1, §1.7, §10.36.
3. —
4. Rec: **REMOVE.**
   Attack: MiMo as a cloud provider is lost. Its terms on output use were never stated, and it sends text off the machine.

### 2026-09-30 · "Cut again from the text" for an edited chapter
1. What: an explicit action that re-joins an edited chapter's lines and cuts them again with the current Speech marks, losing any hand cuts.
2. Stands: STILL OPEN. An edited chapter is read as its lines (`server/src/api/extraction_api.js:279-285`, `_linesToKeep`). The hint that explains this exists (`src/components/StudioScript.vue:564-567`). Research: RESEARCH 1138-1140 (chapter text edit); `docs/plans/2026-09-30-script-leftovers.md` §3.
3. Takes: small to medium (an action, refused when takes exist, as any re-cut is). Gives: fixing a book analyzed with the wrong quote marks after one hand edit.
4. Rec: **REMOVE.** It's a narrow case, and the hint already explains it.
   Attack: the only way out today is deleting the chapter and re-importing. That is clumsy for a single-quoted British book, which is common.

### 2026-09-29 · From the full walkthrough
1. What: nine small findings from a fresh-install walkthrough (Smart-assign, Discover, toasts, the cache question).
2. Stands: STILL OPEN, partly done.
   - (a) **Open, and harmful.** Cast sends every speaker except a cast narrator (`src/services/newPersonas.js:58-60`). The server overwrites existing casts (`server/src/api/smart_assign_api.js:161-163`, `onlyUncast` false from Cast at :189). It also counts unchanged ones as applied (:163), so the toast "applied N" over-counts (`src/components/StudioCast.vue:520`).
   - (b) Open: it is a design call, "suggest, don't apply".
   - (c) Open: the "no descriptive labels" rule is in the prompt only, with no code filter (`server/src/extraction/identify.js:36-38`).
   - (d) Partly done: JustWrite's character aliases come in on import (`server/src/imports/adapters/justwrite.js:157`). A role or title is not used.
   - (e) Open: evidence is only trimmed of whitespace, so it can still start mid-quote (`identify.js:105`).
   - (f) Reworded: now "X cast with persona Y." (`StudioCast.vue:264`).
   - (g) Open, in the kit: every error reads "HTTP 409 — …" (`../just-core/packages/ui/src/client.js:78`).
   - (h) Done: the remove dialog now always has a body (`StudioCast.vue:363-367`).
   - (i) Done in effect: the kit adopts a sibling app's cache when this app's own is empty (`../just-core/packages/core/src/llm/install.js:344-361`).
   Research: RESEARCH 2077 (Cast batch prompt); nothing on (a), (c), (e) or (g).
3. Takes: (a) small (send `onlyUncast` from Cast, or send only uncast speakers, and count real changes); (e) tiny; (g) small, but a kit change that every app picks up. Gives: Smart-assign stops silently undoing hand-picked casts, and error toasts read as sentences.
4. Rec: **DO BEFORE RELEASE (a, e, g); REMOVE the rest** (b and c are prompt and design calls; d, f, h and i are done enough).
   Attack: (a) runs against the documented "applies straight away, as it always has" (`docs/studio.md:1111-1117`), so the user may have meant re-casting everyone. Asking costs one line.

### 2026-09-29 · "Read by you" per chapter in Script
1. What: a dated "read through" mark per chapter on Script.
2. Stands: STILL OPEN (grep "read_by|reviewed_at": nothing). The user said decide after using the new Script on a real book. Research: none.
3. Takes: small (one chapter field and a toggle), but it touches the ruling that the Script grid shows no completion state. Gives: tracking your proofread on long books.
4. Rec: **REMOVE.** It was parked "not now", nothing has asked for it since, and it conflicts with a ruling.
   Attack: proofreading is the real review step, and a 40-chapter book is easy to lose track of.

### 2026-08-22 · Feature-horizon candidates live in `ROADMAP.md`
1. What: a pointer saying the parity and roadmap candidates live in `docs/dev/ROADMAP.md`.
2. Stands: STILL OPEN as a pointer. ROADMAP needs its own pass for the release rule ("roadmap, IDEAS"), and it is stale:
   - It says Pocket TTS was "rejected" (§3), but Pocket is offered (`curated/pocket_tts.js`).
   - It says MOSS-TTSD was "removed", but it is curated (`curated/moss_ttsd.js`).
   - It says Kokoro blending and IPA are "on hold" (§1), but both were built 2026-10-03 (`server/src/engines/blending.js`, `server/src/engines/kokoro/ipa.js`).
   Research: n/a.
3. Takes: a separate decision pass over ROADMAP's 10 candidates.
4. Rec: **REMOVE** the pointer. ROADMAP gets its own do-or-remove list next.
   Attack: without the pointer, ROADMAP might be forgotten in the release check. Name it in the release item instead.

### 2026-08-15 · THE TIMELINE, designed properly (replaces the inherited Stories surface)
1. What: a podcast timeline that arrives laid out, with lanes per persona, trims, gains, beds and stings, and a mixdown into mastering.
2. Stands: STILL OPEN. The `stories` and `story_items` tables are dormant (`server/src/database/models_schema.js:547,943`; `server/src/database/models.js:57-58`). No route, no page (`src/layouts/MainLayout.vue:54`: tab removed 2026-10-06). No mixer. Stale user doc: `docs/sync.md:12` lists "Stories timelines" among what stays on each computer. Research: RESEARCH 1093-1094.
3. Takes: large (a schema ruling, then the API, the summing mixer in the fork's DSP, then the editor). Gives: podcasters get an assembled episode with beds and stings, which they can't produce in-app today.
4. Rec: **DO LATER (keep)**, as the one timeline entry with #27 and #38 folded in.
   Attack: if the user won't build it soon, REMOVE all three and drop the dormant tables and the sync doc's mention.

### 2026-08-14 · AMD-Linux per-process GPU memory via KFD sysfs
1. What: read per-process VRAM on AMD Linux from `/sys/class/kfd/…` instead of the device-wide estimate.
2. Stands: STILL OPEN, in the kit (no "kfd" in `../just-core/packages/core/src`; the arbiter records a `source` such as "computed", `runner/arbiter.js:80,96`). The entry's `hardware.py` is gone (Python). There is no AMD box to verify on. Research: none in JV's register.
3. Takes: small code in the kit, but it can't be verified without AMD hardware. Gives: more exact memory booking on AMD Linux.
4. Rec: **REMOVE** from JV. It is the kit's job, and unverifiable here.
   Attack: AMD-Linux users keep the coarser device-wide estimate.

### 2026-08-08 · Unreal / Unity string-table import for game dialogue
1. What: import an Unreal or Unity string table as a game project.
2. Stands: STILL OPEN. The CSV adapter requires a `text` column (`server/src/imports/adapters/csv_lines.js:209`), so Unreal's `Key,SourceString` CSV is refused. `docs/dev/CONCEPTS.md:22,80` still names "Unreal string table" as an import. Research: none.
3. Takes: small (column aliases `SourceString`→text and `Key`→id; Unity's localization tables need research). Gives: game devs import their real string tables, not a re-shaped CSV.
4. Rec: **DO LATER**, merged with #26 and #29 into one "game pipeline" entry.
   Attack: string tables carry no speaker column, so the import still needs speaker mapping by hand. That shrinks the gain.

### 2026-08-07 · A TTS Lab
1. What: a name with no scope ("a voice A/B bench?").
2. Stands: STILL OPEN; it was never defined. The listening rounds and `tools/take-check` already serve as the A/B bench in practice. Research: none.
3. Takes: unknown, since nothing is scoped.
4. Rec: **REMOVE.**
   Attack: none worth keeping. A scoped idea can be added fresh.

### 2026-08-06 · Audiobook competitor-research ideas (unbuilt, previously untracked)
1. What: 21 ideas from the 2026-06-24 competitor research.
2. Stands: STILL OPEN, but mostly done or superseded.
   - Done: render check with auto re-render (`server/src/take_check.js`); alias clustering (`server/src/extraction/merge_names.js`); attribution in context-sized pieces (`server/src/extraction/pipeline.js:440-490`); emotion tags via Direction; disagreement badges (#33).
   - Open: an attribution QC pass over all lines (the second look covers only lines with no speaker), length-sorted parallel TTS, a dialogue-only narrator split, non-verbal sounds as text, a BookNLP cross-check.
   Research: RESEARCH §10.12 (3307-3383, BookNLP and ModernBookNLP at 3323-3325).
3. Takes: each is medium.
4. Rec: **REMOVE.** #6's sweep supersedes it with newer evidence.
   Attack: the full-QC attribution pass isn't on #6's list by that name. Add one line there if it's wanted.

### 2026-08-06 · Game pipeline design residue
1. What: seven game-export items: CSV column mapping, a duplicate-ID check, a naming pattern, "export changed only", manifest voice and rendered_at, folder per quest, and 500-line scale.
2. Stands: STILL OPEN, partly done.
   - Done: a failed line no longer aborts a re-render (`src/components/LinesBoard.vue:146-160`, one render job with per-line isolation); scene-slug folders (`server/src/export_voicelines.js:5-10`).
   - Open: the manifest has 7 fields, with no `voice` or `rendered_at` (`export_voicelines.js:99-108`); no column-mapping UI; no duplicate-ID check; no naming pattern; no changed-only export.
   Research: RESEARCH 1339 (a game project's Studio).
3. Takes: small to medium each. Gives: game devs at 50-500-line scale re-export only what changed, under their own names.
4. Rec: **DO LATER**, merged with #23 and #29.
   Attack: "export changed only" plus `rendered_at` is what a game team re-exporting daily needs most. Maybe pull those two forward.

### 2026-08-06 · The podcast Timeline / episode-export spec
1. What: a pointer to `docs/dev/journey-podcast.md` as the timeline's spec (auto-lay, ducking, SFX, ID3 chapters).
2. Stands: STILL OPEN; it is the same subject as #21. Research: RESEARCH 1093-1094.
3. —
4. Rec: **REMOVE** as an entry. Fold the pointer into #21.
   Attack: none. The spec doc stays.

### 2026-08-06 · Multi-use design soft residue
1. What: leftovers of the archived persona/voice-profile design: batch rewrite, Compose into Script, explainer headers, a "What now?" slide-out, on-blur validation, shared-repo triggers, width sweeps.
2. Stands: STILL OPEN, partly obsolete. The shared-repo triggers are obsolete (the kit exists). Compose and Rewrite live on the persona page only (`src/pages/PersonaEditorPage.vue:715-721`). `.jv-form-row__error` is still dead CSS (`src/css/app.scss:905`, used by no template). There is no "What now?". Research: none.
3. Takes: each is small. Gives: polish.
4. Rec: **REMOVE**, and delete the dead `.jv-form-row__error` CSS.
   Attack: on-blur field errors are a real usability gain on forms. If wanted, it's a kit-wide rule, not a JV idea.

### 2026-08-04 · Unreal Engine integration
1. What: a per-line JSON sidecar (Phase 1, an 18-field schema) and a UE `.uplugin` (Phase 2).
2. Stands: STILL OPEN. Only the aggregate `manifest.json` exists (7 fields, `server/src/export_voicelines.js:99-108`). The user docs promise more: `docs/import-and-export.md:482` (".uplugin and .unitypackage will consume…") and `docs/use-cases.md:27` (".uplugin bundle is planned"). Research: none in the register; the design is `docs/dev/ue-integration-design.md`.
3. Takes: the sidecar is small to medium (a schema plus a writer). The plugin is large (a separate repo, C++). Gives: game devs drop JV output into Unreal with its metadata.
4. Rec: **DO LATER**, merged with #23 and #26.
   Attack: if dropped, the two doc promises must go too, or a game dev reads "planned" for something that won't come.

### 2026-08-04 · External importer formats
1. What: importers for projects from Resemble, Speechify, Murf, Coqui and OpenVoice.
2. Stands: STILL OPEN; none of the six is built. The entry's claim about `elevenlabs.py` (a 501 stub) is stale: the stub was removed 2026-08-08, and ElevenLabs is "not planned" (`docs/dev/external-import-formats.md:10-14`). Separate stale contributor doc: `docs/import-and-export.md:306` says to create `server/justvoice/imports/adapters/<x>.py` (Python). Research: none in the register; the survey's shapes are marked unverified.
3. Takes: small to medium each, once the export shapes are checked (needs research: each tool's current export format). Gives: switchers from those tools bring their projects.
4. Rec: **REMOVE.** No audience comes from these tools, and their shapes are unverified.
   Attack: an importer is a cheap on-ramp for switchers. A Murf CSV may already almost fit `csv_lines`.

### 2026-08-09 · The analyze stream pins a thread per run
1. What: the Python analyze stream held two threads per run.
2. Stands: **OBSOLETE.** The Node port runs it as an async task feeding a queue, with no threads (`server/src/api/extraction_api.js:20-22,69`). Research: n/a.
3. —
4. Rec: **REMOVE.**
   Attack: none.

### 2026-08-09 · Blank blocks render as Script rows
1. What: a whitespace-only line still shows as a Script row with a "—" speaker.
2. Stands: STILL OPEN. `rowsFromBlocks` is gone (`86eb21dd`), but the chapter page still renders non-speakable rows with "—" (`src/components/StudioScriptChapter.vue:704`). The server sends them (`server/src/api/extraction_api.js:1032`). How often blank blocks occur today is unverified. Research: none.
3. Takes: tiny (filter blank, non-marker rows out of the table). Gives: no baffling empty rows.
4. Rec: **DO BEFORE RELEASE.** A few minutes' work under the finish run's go.
   Attack: it may never appear on a real import. Check one EPUB or DOCX first, and if none shows up, REMOVE instead.

### 2026-08-08 · Anchor-vs-LLM disagreement is computed, sent, and dropped
1. What: show where the book's speech tag and the AI disagree about who speaks.
2. Stands: **ALREADY DONE.** The metadata keeps `llm_speaker` (`server/src/api/extraction_api.js:443-445`). `server/src/extraction/flags.js:168` makes a "disagree" check, and Script shows it: "Book and AI differ" / "The book says X, the AI says Y" (`src/services/scriptReview.js:415,459-460`; `71747379`). Research: n/a.
3. —
4. Rec: **REMOVE.**
   Attack: none.

### 2026-08-04 · The deferred-to-v1.1+ list (extracted from the archived DESIGN_FREEZE)
1. What: twelve deferred items from the old design freeze.
2. Stands: STILL OPEN in name, mostly settled.
   - Decided: notarization and signing, as unsigned installers (`../just-core/docs/dev/RESEARCH.md:1338-1339`, §Q.2).
   - Done: per-engine GPU budgets (the kit's arbiter books each model, `runner/arbiter.js:252`); `POST /v1/projects/import` for other sources (adapters, `server/src/api/projects_api.js:1307-1314`); ACX validator (`server/src/export_audiobook.js` `ChapterQC`).
   - Obsolete: the community plugin system (engines are audio.cpp's catalog).
   - Duplicates: audio-channels UI (#4), `.uplugin` (#29), retail sample (#6).
   - Open: voice-embedding drift detection, multi-engine fallback, FTS5 (trigger: >2000 generations), activity log (trigger: a webhook-replay incident), per-character provider override (a voice on an external provider may already cover it: `server/src/engines/tts_providers/index.js`; not verified).
   Research: none for the open items.
3. Takes: each is medium. Two wait on their own triggers.
4. Rec: **REMOVE.** Its live parts are either duplicates or waiting on triggers that haven't fired.
   Attack: the two trigger items (FTS5, activity log) are reminders by design. Removing them means relying on memory when a trigger fires.

## Parked 2026-08-21

### Kokoro group-vector math
1. What: direction vectors from groups of Kokoro voices (gender, language), interpolation ranges, `.pt`/`voices.bin` export.
2. Stands: STILL OPEN. The weighted mean plus two-voice strategies are built (`server/src/engines/blending.js:1-20,60,99`). Group math is not. Research: none in the register.
3. Takes: medium. Gives: more Kokoro voice variety from sliders.
4. Rec: **REMOVE.** Kokoro is one of many engines now, and cloning and design cover variety.
   Attack: game devs wanting 50 distinct NPC voices cheaply on CPU would use it.

### Extra output formats
1. What: opus, flac and raw PCM per request.
2. Stands: STILL OPEN. Mastering writes mp3, m4a or wav (`server/src/mastering.js:145-147`). Research: none.
3. Takes: small (ffmpeg arguments). Gives: smaller game assets (opus) and lossless archives (flac).
4. Rec: **REMOVE.** It was parked as "add only when someone needs it", and no one has asked.
   Attack: it's small enough to add the day it's asked for, which argues both for removing it and for doing it.

### SSML / phonemize / dialogue endpoints
1. What: Kokoro-FastAPI parity endpoints.
2. Stands: STILL OPEN. Inline tags and lexicons cover the real cases, and Kokoro IPA is built (`server/src/engines/kokoro/ipa.js`). Research: none.
3. Takes: medium. Gives: API compatibility for outside tools.
4. Rec: **REMOVE.**
   Attack: an SSML-speaking client (e.g. a screen reader, the future accessibility audience) can't drive JV without it.

### Timeline design
1. What: the same timeline as #21 ("already recorded above").
2. Stands: STILL OPEN; a duplicate of #21.
3. —
4. Rec: **REMOVE** (a duplicate).
   Attack: none.

---

## Found on the way (not IDEAS entries; each needs its own word)
- False UI copy about dictation: `src/pages/HomePage.vue:480-481`; `src/pages/CapturesPage.vue:122-149,163,173-179`.
- Stale docs: `docs/dictation.md:5,26` and RESEARCH 1141-1146 (the Tauri hotkey monitor); `docs/sync.md:12` ("Stories timelines"); `docs/import-and-export.md:306` (Python adapter path); `docs/dev/CONCEPTS.md:22,80` (Unreal string table); ROADMAP §1 and §3 (Pocket, MOSS-TTSD, Kokoro blending).
- A disabled "Trained (LoRA) — not rebuilt yet" option (`src/services/personaFacts.js:93`).
- Dormant code: the channels tables, API and hidden tab (#4); the `stories` and `story_items` tables (#21); `.jv-form-row__error` CSS (#28).
- Unverified: the aligner is sent "English" for languages it doesn't know (`server/src/engines/audiocpp/kit_speech.js:185`), which may give wrong timings rather than an error.
- ROADMAP.md needs its own do-or-remove pass under the same release rule.
