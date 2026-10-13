# Review — Cast, Discover, personas, voices, voice making (decisions 2026-10-03 → 2026-10-06)

Read-only. Every cited line was read in this pass. Nothing was run.

## 1. Findings

**1. Smart-assign never sends the narrator, but the code comment, TASKS and the docs say it reads every speaker.**
- (a) "Speakers and personas become two things"; "Cast: All · No persona chips…" (its BUILT line); "Cast: Models to choose from".
- (b) 2026-09-29: "the narrator becomes a speaker cast like anyone". The chips BUILT line (not the user's words) says: "Smart-assign and ＋ New persona still read the whole cast".
- (c) `src/components/StudioCast.vue:107-109`: `listed` is every speaker except the narrator. `:458` reads `const people = listed.value;` (Smart-assign). Header comment `:25-27`. `docs/studio.md:815`: "Smart-assign and ＋ New persona still read all the book's speakers". `docs/plans/2026-10-06-batch-pick-and-findings.md` §3 table: "`:421` Smart-assign's `people` — **stays on `listed`**".
- (d) In any book that isn't a game, Smart-assign never proposes a persona for the narrator. The skip was never approved, and three places say the opposite. ＋ New persona does include the narrator (`:560`).
- (e) Sure: read the lines.
- (f) Send `props.speakers`, or ask the user whether the narrator should be left out. Either way, fix the comment, the doc and the TASKS wording.

**2. "Models to choose from" lists engines, not models.**
- (a) "Cast: "Models to choose from" for Smart-assign and New persona"; "One meaning per word…", B3.
- (b) "The list: each installed model that has voices in the book's language, with its count, e.g. Kokoro (28) · Pocket TTS (20) · KittenTTS (8)." B3: "**Model** = its name (*Qwen3-TTS CustomVoice*) … *engine* only on AI Settings → Speech engines".
- (c) `StudioCast.vue:83` `counts[v.engine]`; `:85` the label is `engineById[id]?.name`; `:104` `onCastModels(engineId)`; `:464` and `:569` filter by `.engine`; prefs store engine ids (`:79`).
- (d) Qwen3 CustomVoice built-ins and Qwen3 Base clones show as one "Qwen3-TTS" entry. Chatterbox Turbo, Nano and Multilingual clones show as one "Chatterbox" entry. You can't tick one model of an engine: ticking one widens the choice to all of that engine's models. The label is an engine name, which B3 rules out.
- (e) Sure.
- (f) Group by `v.model` and label with `v.model_name`.

**3. "Installed" is never checked: the ＋ New persona batch and the models list offer every catalog voice.**
- (a) "Cast, Render, Generate and the persona's gender — five answers" (follow-up Q1); "Cast: Models to choose from".
- (b) "1. Which voices does it choose from? Lean: installed voices that speak the book's language." Also: "each installed model that has voices in the book's language".
- (c) `src/services/newPersonas.js:21-27`: `voicesForBook` filters by language only. `StudioCast.vue:80`, `:569`. The source is `GET /v1/voices`, which lists every manifest's static voices whether installed or not (`server/src/api/voices_api.js:96-101`). These places all say "installed": `newPersonas.js:21`, `StudioCast.vue:555`, `CastNewPersonas.vue:8-9`, `docs/studio.md` (Cast), batch-pick plan §1, and the toast at `StudioCast.vue:572` ("No installed voice speaks …").
- (d) Voices and models of engines that aren't installed are offered. The comments and the toast claim a check that doesn't exist.
- (e) Unsure. Since 2026-10-01 one speech runtime installs every engine, so "installed" may now mean only the runtime. Either way the code reads no install status.
- (f) Ask the user what "installed" means now, then filter on the engines store's `not_installed` (or on-disk) status, or drop the word.

**4. Voice dropdown labels leave the gender out when it isn't known.**
- (a) "Voice gender in every voice dropdown, and speaker pronouns"; "One meaning per word…", B4.
- (b) 2026-09-30: "every voice dropdown's label shows it ("Bella · Female · Kokoro", "?" when unknown)". B4: "ONE word for unknown. Lean: **Not known**". BUILT: "unknown is **Not known** everywhere".
- (c) `src/services/personaFacts.js:27` `voiceGender(v) === "?" ? "" : voiceGenderWord(v)`. Introduced in P6 (`dca0468`), kept in B4 (`e3ab4f9`).
- (d) The persona page's Voice list, Cast's batch "Pick a voice" and the blend maker show nothing for an unknown gender. You can't tell an unknown gender from a field that was left out. This contradicts both decisions.
- (e) Sure.
- (f) Use `genderWord("?")`, which gives "Not known".

**5. The persona page's Version choice is ignored when that version isn't downloaded and another one is.**
- (a) "The persona page shows which version of its model speaks, and can change it"; the persona redesign §6.2, call 4.
- (b) "Add a Size choice there that sets that model's default version". Call 4: "the render uses the loaded variant if it is that family, else the user's default if it is, else an installed variant of the family".
- (c) `server/src/voice_model.js:400-401` `const pool = onDisk.length ? onDisk : ids; if (pool.includes(def)) return def;` The default wins only when it is on disk, or when nothing of the family is. `src/pages/PersonaEditorPage.vue:525` offers "not downloaded" versions. `:1052` "Speaks with" shows the server's pick. `:1057` offers Load only while some version is loaded. `docs/dev/RESEARCH.md:1521-1525` states call 4's order, which the code doesn't follow.
- (d) Example: pick "1.7B · not downloaded" while 0.6B is on disk. Renders keep using 0.6B. The page shows Version 1.7B but "Speaks with … 0.6B", and offers no download unless something is loaded.
- (e) Sure from reading the code. Not run.
- (f) Check the default before the on-disk pool (a load fetches a missing file), or ask. Then correct RESEARCH.

**6. The persona page's Gender filter now offers "Not known (N)", although the user chose to leave unknown voices under Any gender.**
- (a) "Leaving Tags puts Type back; voices with no gender stay; the voice-card mock goes"; "One meaning per word…", B4.
- (b) "15 of the 91 built-in voices have no gender recorded … They only appear under Any gender. My lean: leave it." The user: "your rec on both go".
- (c) `PersonaEditorPage.vue:354-358`: the facet key is `voiceGender(v)`, so "?" becomes "Not known". `e3ab4f9` changed it from `voiceGender(v) === "?" ? "" : …`. The same applies in `PersonaBlendMaker.vue:69-72`.
- (d) A filter option the user decided against. It widens rather than narrows.
- (e) Unsure. B4's "Not known everywhere" may be read to cover it, but the user never saw a filter option.
- (f) Ask the user. Otherwise restore the old key.

**7. RESEARCH says "Only Discover adds speakers"; two approved decisions conflict, and the implementer settled it without the user.**
- (a) "Only Discover adds speakers; a name the second look finds goes to Discover" (2026-10-06); "Cast, Render, Generate… five answers" #2 (2026-10-05).
- (b) 2026-10-06: "one place adds speakers, and that's Discover". 2026-10-05: "Cast's ＋ Add stays — it is for someone Discover missed".
- (c) `docs/dev/RESEARCH.md:1434` "Only Discover adds speakers (since 2026-10-06)". Cast's ＋ Add (`StudioCast.vue:339-355`) and Add Narrator (`:425-441`) both add speakers. TASKS "Models to choose from" BUILT: "correcting today's 'Only Discover adds speakers' — Cast's ＋ Add adds too". That correction changed the docs without the user's word.
- (d) The register states a false fact. Which decision wins was chosen by the implementer.
- (e) Sure about RESEARCH. Unsure which decision the user wants to stand.
- (f) Fix RESEARCH, and ask the user which decision stands.

**8. Cast's "Added here" tooltip names only Discover.**
- (a) "Discover back to scan results only; … speakers show where they came from".
- (b) "Added here, the people you added with ＋ Add, plus the Narrator."
- (c) `StudioCast.vue:785` `'Added here — with Discover\'s ＋ Add'`.
- (d) Speakers added with Cast's ＋ Add or Add Narrator also show "Added here". The implementer's wording is wrong for them.
- (e) Sure.
- (f) Say "＋ Add (Discover or Cast), or the narrator".

**9. Discover's Narrator row has no Ignore, called "decided"; "Ignore N selected" counts the narrator.**
- (a) "A book with narration gets a narrator: Discover proposes it" (2026-10-05). This is next to this area: it is Discover's list.
- (b) "Narrator is the first row in "Speakers found" … status New, with ＋ Add; ＋ Add selected adds it like anyone else". The approved text says nothing about Ignore. "no Ignore" appears only in the BUILT line.
- (c) `src/components/StudioDiscover.vue:584`: Ignore has `v-if="!row.narrator"`. `:296` "Narration needs a narrator — it is never ignored." Header `:46` "(decided 2026-10-05) … no Ignore". `:610` the label counts `pickedWaiting`, which includes the narrator row, ticked by default (`:180-182`, `:227`).
- (d) A hidden control is described as decided. With the narrator ticked by default, "Ignore 3 selected" ignores only 2.
- (e) The hiding is unsure: the user said "that is not an option" about a narrator. The count mismatch is sure.
- (f) Ask about Ignore. Fix the count either way.

**10. Smart-assign's error points to a screen that doesn't exist.**
- (a) "One meaning per word…", B3 (one wording per fact).
- (b) B3: "*engine* only on AI Settings → Speech engines". The batch's own message says "set one in AI Settings".
- (c) `StudioCast.vue:520` "Smart-assign unavailable — wire an LLM provider in Engines → LLM tab." `:604` "New personas need a language model — set one in AI Settings."
- (d) Two wordings for one fact, and one names a place that doesn't exist.
- (e) Sure.
- (f) Use the `:604` wording.

**11. The server still keeps a persona's old language when its voice changes, which the user reversed.**
- (a) "The persona page: "Style Instructions", and Hear it just above Save" (the second decision).
- (b) "2. Picking a voice sets Speaks to that voice's language … This reverses the redesign rule that kept the old language."
- (c) `server/src/api/personas_api.js:146-150` (docstring) and `:162`. PATCH `:323` passes `{ keepIfSpoken: current.language }` whenever the voice changes and no language is given.
- (d) The persona page always sends a language (`PersonaEditorPage.vue:444`), so it is mostly unaffected. Any other caller (the API, MCP, or a voice with no language, which sends `null`) still gets the reversed rule.
- (e) Sure the code keeps the rule. Unsure how far it reaches.
- (f) Drop `keepIfSpoken` when `voice_id` changes.

**12. Hardcoded numbers and lists in this area that no TASKS approval contains** (family rule: "Thresholds, limits … live in the database").
- Smart-assign reads only the first 200 characters of a speaker's "Who they are" (`server/src/api/smart_assign_api.js:68`). Cast's hint still says "Read by … Smart-assign" (`StudioCast.vue:823`). Predates the window (`520b6f5`).
- Clip checks: under 10 s and over 2 minutes (`src/services/voiceMakers.js:117-118`). These were shown in the approved mock (`MockCloneMaker.vue:95-101`); 25 dB was approved by word.
- The design maker keeps only the last 5 takes (`PersonaDesignMaker.vue:104`). The mock had `slice(-5)`; the user was never told.
- The preview line is capped at 2000 characters (`personas_api.js:186`).
- The gender guess sends at most 60 voices (`src/pages/VoicesPage.vue:67`). Predates the window.
- Discover's name match without the AI has extra rules: a first or last name counts only at 3+ letters, a fixed list of title words never counts (`server/src/extraction/names.js:112`, `:131`), and the quote is cut at 120 characters (`:168`). The approved words were only "by matching their names and 'also called' names in the chapter text"; these rules appeared later, in a BUILT line.
- (e) Sure about the values. Unsure which ones the user would want editable.
- (f) Show the user the list; move the ones they name into settings.

**13. The voice makers' per-model notes, orders and model names are typed by hand.** Unsure; overlaps the 2026-10-13 engine-list decision.
- (c) `voiceMakers.js:42-55` (`MODEL_NOTE`, `DESIGN_NOTE`). `PersonaCloneMaker.vue:159` (`ORDER`). `PersonaDesignMaker.vue:48`, `:90`, `:121`, `:127` ("Qwen3 VoiceDesign and VoxCPM2 take written direction"). `PersonaEditorPage.vue:282` (the off-reason names Chatterbox Turbo and Nano).
- (d) A model adopted from audio.cpp gets no note. A design model that takes no written direction would still be described as taking it.
- (f) Take these from the capability rows.

**14. Changing Type clears the Model filter.** Unsure; minor; predates the window.
- (b) The filters rule (2026-10-05): "an option nothing fits drops out, but the one you chose stays with (0)".
- (c) `PersonaEditorPage.vue:374` `watch(kind, () => { modelFilter.value = ""; … })`. This was already in the 10-04 build (filters plan §5 table).
- (f) Ask the user, or keep the chosen model with (0).

## 2. Decisions checked with no finding

- Cast's batch: skipped rows first, the amber tag, the line above the list, the message after Create.
- Cast's Speakers head in two rows, the AI row on the right.
- Models to choose from: the default, saved per book, both buttons obey it, "All" ticks everything. Only the unit and "installed" are wrong (2, 3).
- Cast: All · No persona chips (only their Smart-assign claim, 1).
- Cast's batch lets you pick a voice it couldn't match.
- The demo cast for Render's three small fixes. The OpenAPI document is gone with Hono, so nothing is left to check.
- Discover back to scan results only: the banner's wording and link, From the book / Added here (only 8).
- Discover: ✕ and Clear all (Clear all keeps the Narrator), ticks and the bulk Add / Ignore / Remove.
- Discover missed Sherlock Holmes: the prompt no longer names the narrator.
- Discover records everyone each chapter names: statuses, chips, the record kept (heuristics in 12).
- Leaving Tags puts Type back.
- The Voice box resets when a filter drops its voice; "Any language".
- The Voice card's lines: one line under the voice, 30rem.
- Type, not Made by: Trained and its tooltip, no LoRA button on Save.
- The Voice card's original layout and its words.
- Filters that narrow each other (14 aside).
- "Style Instructions" and Hear it above Save.
- The five answers: ＋ Add's tooltip, Render's speaker picker, the gender shown from the voice with its warning, Compose / Rewrite / the Lexicon count, Generate removed.
- No built-in personas; any speaker can be the narrator; no automatic narrator.
- Persona names unique across the library (blank refused, case and spaces aside); speaker names unique within a book.
- Personas: tick several and Delete N selected.
- Speakers and personas as two things: auto-cast by exact name, ask before removing, the selected speaker's card and its hints.
- Pronouns: built as §3 of the 09-30 doc (he/him · she/her · they/them · it/its). Discover proposing pronouns was left out by that doc's "Not in it", shown before P9. Unsure whether the user saw that line.
- Mocks in the app: dev-only routes (`src/router/routes.js:72`).
- One meaning per word: A1–A8 spot-checked on Cast and Discover; B1, B3 and B4 beyond 2, 4, 6 and 10.
