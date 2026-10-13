# Claims review: decisions dated 2026-10-01 to 2026-10-13

## Counts

- **Checked:** 392 claims.
- **Fine:** 361.
- **Wrong or overstated:** 31. They group into 20 findings below.

| Area | Checked | Fine | Wrong / overstated |
|---|---|---|---|
| audio.cpp engines: code, engines.md, gpu.md, quick-setup.md, RESEARCH §1, §2, §10.13, §10.14 | 76 | 66 | 10 |
| Personas and voice making | 81 | 79 | 2 |
| Studio: Discover, Script, Analyze, second look, Cast, narrator, page tasks | 104 | 101 | 3 |
| Render, takes, Export, page player | 71 | 67 | 4 |
| Kit, Electron, Quasar, Hono, Settings, Lexicons, Home, captures, RAM door | 42 | 35 | 7 |
| User docs, code-map.md, RESEARCH §3–§10.12 | 18 | 13 | 5 |

Scope notes:
- Claims citing rulings from before 2026-10 were not counted.
- Comments that only point at a plan, with no attribution, were not counted.
- Test files were not counted.
- Three quotes of the user's words in the persona files are missing from TASKS and the plans. They were checked against the session transcripts and are the user's real words.

Severity:
- **VISIBLE:** behaviour a user sees rests on the claim.
- **INTERNAL:** only the record is wrong.

---

## VISIBLE

### 1. The generated engines' rule puts the clone-only filter beside a decided rule

**(a) Where.** `JustVioce/server/src/engines/audiocpp/generated.js:12-15`:
> "A model is offered when audio.cpp marks it supported, community or experimental (wip and unsupported are hidden — decided 2026-10-11, answer 3), it copies a voice from a clip, and one of its GGUF packages is complete at the pinned model revision. Built-in voices and voice design need a family file to say how they are asked for, and come later."

The same statement appears in `docs/dev/code-map.md:401-408`: "turns each uncovered cloning family into a manifest-shaped engine", directly after the plan cite.

**(b) What was decided.** Answer 3 (TASKS:337-338): "show supported/community/experimental with the status, hide wip and unsupported."
- The goal, in the user's words (TASKS:327-328): "access to all engines and all models and features of audio cpp".
- The approved plan, §1 (`plans/2026-10-11-audiocpp-engine-catalog.md:18-19`): "speaks preset voices · copies a voice from a clip · makes a voice from words".
- The plan, §3 (:74-76): "`built_in_voices` → preset voices … `design: voice_design` → makes one from words".
- The plan, §3 (:82-83): "Speech recognition families become `stt` engines the same way".
- No decision says clone-only, or that the rest "come later".

**(c) What the claim adds.**
- The comment puts the clone-only condition, and a deferral of built-in voices and design, in the same sentence as answer 3. They read as part of the decision.
- The code does more than the comment says:
  - It drops voice-design catalog entries: `SPEECH_ENTRY_TASKS` holds `tts` and `clon` only, at :38.
  - It hard-codes `voice_cloning: true`, `preset_voices: 0` and `voice_design: false` (:269-271, :340-342).
  - It generates no recognition family.
- TASKS:159 already records the clone-only half as a FINDING ("Mine, never asked"). This comment and code-map were not changed with it.
- Unattributed copies of the same narrowing:
  - `docs/engines.md:289-290`: "lists every other speech model … that **copies a voice from a clip**".
  - `src/router/mockRoutes.js:45` and `src/pages/mock/MockSpeechEnginesPage.vue:3` say "every audio.cpp model".

**(d) Severity.** VISIBLE. Thirteen speech families never appear (TASKS:167-169).

**(e) Fix.**
- Recommended:
  - Reword generated.js:12-15 to: "Hidden: wip and unsupported (decided 2026-10-11, answer 3). Also left out — mine, not decided: families that don't copy a voice from a clip, voice-design entries, built-in voices and recognition families (TASKS FINDING 'the generated engines offer only models that clone a voice')."
  - Add the same pointer to code-map.md:406-407.
- Attack:
  - Rewording `engines.md:289` now would put new wording the user hasn't seen into a user doc. It is true today, so leave it until the code changes.
  - Changing the code now would skip the adoption plan's own go (TASKS:152-157, OPEN 2).
  - Blast radius now is two comments.
- Survives: the two comment rewordings now. The behaviour waits for the adoption plan.

### 2. VieNeu is "not offered (decided)", but no recommendation was shown for it

**(a) Where.**
- `JustVioce/server/src/engines/audiocpp/curated/vieneu_v3_turbo.js:15-17`: "Not offered (decided 2026-10-11, TASKS "The download test's first findings"): …"
- `generated.js:171`: "Our file can keep a model out that can't speak from text and a clip yet (VieNeu, 2026-10-11)."

**(b) What was decided.** TASKS:420-425. Shown: "VieNeu babbles … Hide it, or mark it 'doesn't clone from a clip yet'?" The user: "your rec on both go". TASKS's own record: "No lean was shown for VieNeu; the rec given with the go: hide it until it can clone from a clip — a listed model should speak."

**(c) What the claim adds.** It calls a choice between two options "decided", but "your rec" had nothing to point at for VieNeu. The gap was filled by the implementer. The reason, "a listed model should speak", is the implementer's too.

**(d) Severity.** VISIBLE. VieNeu is not listed, and `docs/engines.md:635-639` tells users it is left off.

**(e) Fix.**
- Recommended:
  - Reword both comments to: "Not offered — my pick. The 2026-10-11 question (hide, or mark 'doesn't clone from a clip yet') had no recommendation for VieNeu when the user said 'your rec on both go' (TASKS:424)."
  - Add the question to TASKS as OPEN, with no lean.
- Attack:
  - It adds no rule.
  - The 2026-10-13 ruling ("use everthythiny by default", TASKS:144-145) may bear on the answer. That stays the user's to say.
  - The code stays as built until the user answers.
- Survives as written.

### 3. A book with no language gets every installed voice — a gap fill placed inside the decision

**(a) Where.** `JustVioce/src/components/StudioCast.vue:552-556`:
> "＋ New persona for the N with none (decided 2026-10-05). … The rest go to the language model with the installed voices that speak the book's language (all of them when it isn't set) …"

The rule itself is `src/services/newPersonas.js:20-25` (`voicesForBook`: `if (!bookLanguage) return voices;`).

**(b) What was decided.** TASKS:2912-2914, "your rec on all go": "1. Which voices does it choose from? Lean: installed voices that speak the book's language." No decision covers a book with no language set.

**(c) What the claim adds.** The "all of them when it isn't set" fallback is first written in the plan's after-the-go Built section (`plans/2026-10-05-cast-render-persona.md:26-27`). The user never saw it.

**(d) Severity.** VISIBLE. On a book with no language, the batch sends every installed voice to the AI model, and "Models to choose from" lists every model. Both go through `voicesForBook`: `StudioCast.vue:80` and `:569`.

**(e) Fix.**
- Recommended:
  - Reword the comment to: "…the installed voices that speak the book's language (decided 2026-10-05). With no book language set, every installed voice — mine, not decided."
  - Add a TASKS FINDING: with no book language, should Cast offer every installed voice (as built), or ask for the book's language first? No lean.
- Attack: it adds no rule. The three call sites stay as they are until the user answers.
- Survives as written.

### 4. "Merge into…" also moves lexicons, generations and MCP bindings

**(a) Where.** `JustVioce/server/src/api/personas_api.js:349-351`:
> "'Merge into…' (decided 2026-10-03): every speaker this persona plays is played by `into` from now on, and this persona goes. Its persona-scoped lexicons, its generations and its MCP bindings move too; its own settings do not …"

**(b) What was decided.** Plan `2026-10-03-persona-redesign.md` §6.2, approved "your rec on all save the plan and go code" (TASKS:4766): "Q11 Merge into… moves the speakers to the target, then deletes this one."

**(c) What the claim adds.** Moving the lexicons, generations and MCP bindings is not in the decision. Only "the target keeps its own settings" follows from "deletes this one". `docs/personas.md:86-91` states the move as fact.

**(d) Severity.** VISIBLE. After a merge, the kept persona gains the other persona's lexicons and MCP bindings.

**(e) Fix.**
- Recommended:
  - Split the comment into Q11's words, plus "lexicons, generations and MCP bindings move too — built, not decided".
  - Add a TASKS FINDING: should these move to the kept persona (as built), or go with the deleted one?
- Attack:
  - Changing the code now could delete user data nobody asked to delete. Keep it as built until the user answers.
  - The `personas.md:89` sentence stays true while the code does this.
- Survives as written.

### 5. The kit uses a sibling app's cache only when this app's own cache is empty — a condition not shown

**(a) Where.** `just-llm-runner/server/src/llm/install.js:376-377`:
> "Nothing ever chosen (a fresh or reset database) and this app's own cache holds no models: share a sibling app's that does, and save the choice (decided 2026-10-06)."

**(b) What was decided.** Kit TASKS:441-449, "fix it all go", on: "At startup, if no choice is saved and another family app's cache already holds models, use that cache and save the choice."

**(c) What the claim adds.** The condition "this app's own cache holds no models" appears only in the implementer's BUILT line (kit TASKS:456-457).

**(d) Severity.** VISIBLE, low. After a reset, an app whose own folder still holds a finished model keeps that folder instead of the sibling's cache. `docs/ai-features.md:53` and `docs/whats-new.md:150` state the condition as fact.

**(e) Fix.**
- Recommended:
  - Reword to: "(decided 2026-10-06: no choice saved and a sibling's cache holds models → use it and save the choice; 'and this app's own cache holds none' is mine)".
  - Add an open question to kit TASKS: keep that condition?
- Attack: dropping the condition would change behaviour, so it needs the user's word.
- Survives: reword plus question.

### 6. "A new thing's names" widened to "a new thing's words", and applied to a model description

**(a) Where.** `just-llm-runner/ui/src/components/LuModelCatalog.vue:863-864`:
> "In the interface language — the description is the user's text from here on (ruled 2026-10-13: a new thing's words follow the app's language when it is made)."

**(b) What was decided.** Kit TASKS:145-155. Shown: "3. **Default names saved as data** ('Untitled character', 'New chat', 'Custom', 'first-run measure'): I recommend new-thing names use the app's language when created." The user: "your rec go …".

**(c) What the claim adds.** The comment turns "names" into "words" and applies the ruling to the catalog's pre-filled model description, which was not among the names shown.

**(d) Severity.** VISIBLE. The saved description is in the interface language.

**(e) Fix.**
- Recommended:
  - Reword to: "(ruled 2026-10-13: new-thing names use the app's language when created; applying it to this pre-filled description is mine)".
  - Add the question to kit TASKS.
- Attack: the alternative, keeping it English, is unruled too. So this is a question, not a change.
- Survives as written.

### 7. "Auto-detect" is attributed to the one-wording audit, which never showed it

**(a) Where.** `JustVioce/src/services/captureLanguage.js:4-6`:
> "ONE wording (decided 2026-10-06, the one-wording audit B7/C3): a language by its name, never its code, and "auto" as Auto-detect."

**(b) What was decided.** Audit §1 B7: "raw codes … → base names (*English*) in every filter". C3 covers Captures' hard-coded *auto*. Approved "your rec go" (TASKS:2034).

**(c) What the claim adds.** The label "Auto-detect" appears nowhere in the audit.

**(d) Severity.** VISIBLE. The label shows in Settings → Capture, on the Captures page, and in `docs/dictation.md:62`.

**(e) Fix.**
- Recommended:
  - Reword to: "(decided 2026-10-06, B7/C3: languages by name, never code; Captures shows what Settings holds). 'Auto-detect' for auto is my label."
  - Ask the user for the word.
- Attack: no change on screen until the user answers. The affected places are `captureLanguage.js:15`, `SettingsPage.vue:1630` and `dictation.md:62`.
- Survives as written.

### 8. When the remembered failed card load is forgotten, attributed to the 2026-10-12 decision

**(a) Where.**
- `JustVioce/server/src/engines/manager.js:946-949`: "Did a card load of this model fail or spill here, with the runtime build running now, after its newest measured card load? A later card load that measures it (a pin to the GPU) clears it (decided 2026-10-12)."
- `manager.js:903-906`: "… or one remembered here for the runtime build running now … (decided 2026-10-12 …)".

**(b) What was decided.** TASKS:534-537, "your rec on all go": "4. A failed card load retries on the CPU in the same click, and the remembered failure sends the model to the CPU next time. A saved price bigger than the card would take that same route instead of being refused."

**(c) What the claim adds.** When the memory ends was never shown:
- A new runtime build forgets it. This at least follows the existing "A price belongs to the runtime build that measured it" (RESEARCH:489, 2026-10-04).
- A measured card load (a GPU pin) clears it. This is new.
- `docs/engines.md:475-478` tells users both.

**(d) Severity.** VISIBLE, low. It decides where Auto runs a model.

**(e) Fix.**
- Recommended: reword :949 to "(the memory: decided 2026-10-12. That a measured card load clears it, and a new runtime build forgets it, is mine — open question)". Add the question to TASKS.
- Attack: never forgetting would keep a model on the CPU even after a GPU pin works. That is the user's call. The code and docs stay as they are until then.
- Survives as written.

### 9. Clean-room gaps written as "the user's ruling"

**(a) Where.**
- `JustVioce/server/src/app.js:279-281`: "CSRF and auth guard the MCP endpoint like the API (GUARDED_PREFIXES — the user's ruling, 2026-10-08: an MCP client sends no Origin and carries the token like any other client)".
- `JustVioce/server/src/refinement.js:19-20`: "The ground rules only ever add capitals and punctuation; every change to the words themselves belongs to a section (the user's ruling, 2026-10-08)."
- `docs/dev/RESEARCH.md:1250-1251`: "until 2026-10-08, the user's ruling".
- `RESEARCH.md:564-565`: "the clean-room rewrite's rulings 12 and 13".
- `RESEARCH.md:1408`: "as ruled".

**(b) What was decided.** These are clean-room spec gaps 11, 2, 12 and 13 (`plans/2026-10-08-clean-room-rewrite.md`; gap 11 at :1750, "only the user can rule").
- TASKS:3469-3471: "Its 21 gaps, ruled with my rec under 'your rec you can do it all without me'".
- That reply (TASKS:3461-3468) answered two other questions: what the refinement comparison runs on, and removing the fork's `compare` command.
- The spec, the 21 rulings and the build landed in one commit (`64edd25`). The user never saw a gap.
- The real authority is the 2026-10-08 blanket go (TASKS:3619-3627): recommendations "APPLIED and recorded … marked 'rec applied under the 2026-10-08 go'".

**(c) What the claim adds.** It presents the implementer's recommendations as the user's rulings. The words after "the user's ruling:" are the implementer's reasoning.

**(d) Severity.** VISIBLE. MCP clients must carry the token. With every switch off, dictation cleanup keeps filler and self-corrections. Both rest on recommendations the user never saw. The label itself is a record error.

**(e) Fix.**
- Recommended: use TASKS's own wording — "clean-room gap N, my rec applied under the 2026-10-08 go (not shown)". Put the 21 gap recommendations on the list for the user to see.
- Attack:
  - It adds no rule.
  - Reverting the `/mcp` guard is not simpler; `docs/mcp-server.md` already documents the token.
  - Keep the test name `mcp_rulings.test.js`; renaming it is churn.
  - `app.js:108` ("JustWrite's ruling for the Electron move") is a recorded "rec applied under the 2026-10-08 go" (TASKS:3247). It was counted fine, but it should get the same wording for consistency.
- Survives as written.

### 10. A user's go is claimed for the import-error fixes; none is recorded

**(a) Where.** `docs/dev/RESEARCH.md:1205`: "Fixed in both languages 2026-10-08 (the user's go): each is a 400 that names the problem".

**(b) What was recorded.**
- Wave D filed the import 500s as "FINDING (needs a go)" (TASKS at `0b05c27`, :2333-2336).
- The next go (TASKS:3346-3354) covered agent 1's six Python bugs, which are a different list.
- Then the user said "stop what python bugs, why are you fixing anything in python" (TASKS:3355-3361).
- The fix (`adcc4e7`) closed the FINDING with no recorded go and no "rec applied" line.

**(c) What the claim adds.** A user's go that is not recorded.

**(d) Severity.** VISIBLE, low. The import refusal messages users see were never shown to them.

**(e) Fix.**
- Recommended:
  - Replace "(the user's go)" with "(no go recorded; wave D's FINDING asked for one)".
  - Add a question: keep the import 400s and their wording?
- Attack: it adds no rule, and it touches one line. Only deleting "(the user's go)" would lose why the record is wrong.
- Survives as written.

### 11. The Render mock's line panel lags two decisions

**(a) Where.** `JustVioce/src/components/mock/MockRenderChapter.vue:10-11`:
> "Opening a line shows who speaks it (read-only — Cast decides, D2), the numbers override behind its closed hatch (D3)"

The panel at :505-517 still shows the speaker read-only.

**(b) What was decided.**
- D2 (TASKS:4377): "The voice stays a read-only chip with 'Change in Cast'".
- 2026-10-05, answer 3 (TASKS:2885-2887): "Render's line panel gets the same speaker picker as Script … (D2 … was the VOICE … and stands.)"
- 2026-10-06 (TASKS:2322): "NOT: the closed hatch (Slice 4's D3 … reversed here)".
- 2026-10-07 (TASKS:1253): the mock is brought "up to match" the page.

**(c) What the claim adds.** Both clauses are reversed. The mock has no speaker picker, so it no longer matches the app.

**(d) Severity.** VISIBLE in the dev mock. The header text is INTERNAL.

**(e) Fix.**
- Recommended:
  - Reword the header to: speaker = Script's picker (2026-10-05, answer 3); voice read-only (D2); Render overrides open (2026-10-06, reversing D3).
  - List "the Render mock lacks the speaker picker" for a go on editing the mock.
- Attack: the picker would reuse the app's own title, so it adds no new wording. Editing the mock still needs a go.
- Survives: the header rewording now; the mock edit waits for a go.

---

## INTERNAL

### 12. The runaway-line rule and its two numbers, credited to a decision that only said "worth fixing"

**(a) Where.** `JustVioce/server/src/engines/manager.js:94-101`:
> "… Such a line is longer than RUNAWAY_S_PER_CHAR seconds a character of its text (slow narration is about 0.1) and than RUNAWAY_MIN_S; its process's readings still book the memory it holds, but none is saved as the model's price again (decided 2026-10-11, TASKS FINDING "Digital silence…")."

The constants are `RUNAWAY_S_PER_CHAR = 0.5` and `RUNAWAY_MIN_S = 30`.

**(b) What was decided.** TASKS:958-961. Asked: "One bad run can set a model's memory budget permanently … Worth fixing so a single odd reading can't do that again. Say if you want it looked at." The user: "your re go, double check your work …".

**(c) What the claim adds.** The mechanism and both numbers were never shown: a runaway is spotted at 0.5 s a character and 30 s, and its process, by pid, is never priced again. They first appear in the BUILT line (TASKS:962-968).

**(d) Severity.** INTERNAL. Nothing on screen; it decides which loads set a model's price.

**(e) Fix.**
- Recommended:
  - Reword to: "(approved 2026-10-11: fix it so one odd reading can't set a model's price for good. The rule below and its numbers are mine, not shown.)"
  - List the rule and the 0.5 s / 30 s numbers for the user's word.
- Attack: it adds no rule, and the code is unchanged.
- Survives as written.

### 13. A "render refuses" rule credited to call 4, which says the opposite

**(a) Where.** `JustVioce/server/src/voice_model.js:44-46`:
> "The voice's model is not installed (or not in this runtime's catalog). A render refuses rather than downloading gigabytes behind the user's back (doc §6.2 call 4) …"

**(b) What was decided.** Plan `2026-10-03-persona-redesign.md` §6.2 call 4 picks a variant and never refuses. It was amended (TASKS:4787-4788): "none installed → … the load fetches its file … refusing would have broken today's first-use behaviour".

**(c) What the claim adds.** A refusal that call 4 doesn't contain and its amendment rules out. The code refuses only for a model not in this runtime, or a language with no file (`:385`, `:465`).

**(d) Severity.** INTERNAL.

**(e) Fix.**
- Recommended: reword to what the code does: "Thrown when the voice's model isn't in this speech runtime, or has no model for the asked language (Pocket). A model not yet downloaded is fetched on load (call 4 as amended)."
- Attack: no rule changes, and it is one comment.
- Survives as written.

### 14. The second look's header still describes Script offering to add a name

**(a) Where.**
- `JustVioce/server/src/extraction/second_look.js:12-16`: "After the main call, each spoken line left with no speaker gets ONE more call … so Script can offer to add them."
- `server/src/api/extraction_api.js:434-435`: "… — Script offers to add them".

**(b) What was decided.** 2026-10-05 (TASKS:2488-2496) had "＋ Add Old Sedge". It was reversed on 2026-10-06:
- TASKS:1716-1717: "Script stops adding … loses ＋ Add Sedge".
- TASKS:1690: Script sends you to Discover.
- TASKS:1751-1754: the second look is off by default.

**(c) What the claim adds.** The 2026-10-05 behaviour, stated as current. The code follows 2026-10-06.

**(d) Severity.** INTERNAL.

**(e) Fix.**
- Recommended: reword to "Script's banner names them and opens Discover's scan — Script never adds (2026-10-06)" and "when it runs — off by default since 2026-10-06; Script's 🔎 Second look asks the same".
- Attack: no rule changes, and it is three comment lines.
- Survives as written.

### 15. The Render line page header calls the speaker read-only

**(a) Where.** `JustVioce/src/components/StudioRenderChapter.vue:11-12`: "Opening a line shows who speaks it (read-only — Cast decides, D2)".

**(b) What was decided.** D2 covered the voice only. The speaker became Script's picker on 2026-10-05 (answer 3, TASKS:2885-2887).

**(c) What the claim adds.** It credits a read-only speaker to D2. The code has the picker (:141-144).

**(d) Severity.** INTERNAL.

**(e) Fix.**
- Recommended: reword to "shows its speaker — Script's picker (2026-10-05, answer 3) — with its persona and model read-only and 'Change in Cast ➜' (D2)".
- Attack: no rule changes, and it is one comment.
- Survives as written.

### 16. The line's numbers are still credited to the reversed "⚙ hatch"

**(a) Where.**
- `JustVioce/server/src/api/render_chapter_api.js:138`: "(Slice 4's ⚙ hatch)".
- `server/src/api/projects_api.js:266-268`: "Render's ⚙ hatch (Studio Slice 4, D3): the line's own speed, pitch, gain_db and pause_after_ms …".

**(b) What was decided.** D3 (TASKS:4379) put the numbers behind a closed hatch. The hatch was reversed on 2026-10-06 (TASKS:2322), and that day per-model settings were added (TASKS:2229-2231).

**(c) What the claim adds.** It names a control that is gone, and the list leaves out `models`.

**(d) Severity.** INTERNAL.

**(e) Fix.**
- Recommended: change "⚙ hatch" to "Render overrides (stored as D3 decided; open since 2026-10-06)", and add "`models`, per model (2026-10-06)".
- Attack: no rule changes. Change `line_takes.js:49` and `:210` ("the hatch") in the same pass.
- Survives as written.

### 17. TypeBox's "Fastify validates" is stale

**(a) Where.**
- `just-llm-runner/server/src/platform/models.js:2-3`: "(decided 2026-10-07, plan §10 Q5): a model is a TypeBox schema — Fastify validates requests against it natively".
- `platform/errors.js:128` has the same staleness.

**(b) What was decided.** Q5 chose TypeBox (TASKS:3185). Hono replaced Fastify (kit TASKS:172, 2026-10-09, answer 3a: Hono's `validator()` with ajv).

**(c) What the claim adds.** A Fastify that no longer exists.

**(d) Severity.** INTERNAL.

**(e) Fix.**
- Recommended: change to "ajv checks requests against it through Hono's validator() (kit TASKS 'Hono', answer 3a)".
- Attack: none.
- Survives as written.

### 18. The topbar engine pill "shrinks first" is stale

**(a) Where.** `JustVioce/src/css/app.scss:650-651`: "Shrinks first when the bar is short of room … (decided 2026-10-05)".

**(b) What was decided.** TASKS:2534 said "the two pills shrink first". It was superseded the same day (TASKS:2565): "the server URL first, then the project name …, then the pills, then the page name last".

**(c) What the claim adds.** "First". The code follows the later decision (`flex-shrink: 100`).

**(d) Severity.** INTERNAL.

**(e) Fix.**
- Recommended: change to "Shrinks after the server URL and the project chip, before the page name (decided 2026-10-05)".
- Attack: none.
- Survives as written.

### 19. The memory line is still credited to answer 4, which 2026-10-12 replaced

**(a) Where.**
- `JustVioce/src/components/SpeechEnginesTab.vue:547-549`: "A model's memory before it loads (decided 2026-10-11, answer 4): measured here …, else audio.cpp's estimate …; a model too big for it runs on the CPU".
- `SpeechEnginesTab.vue:1021-1022`: the same, "(decided 2026-10-11, answer 4)".
- `src/pages/mock/MockSpeechEnginesPage.vue:9-10`: "a model's memory measured here or audio.cpp's estimate, one too big for this card offered on the CPU".
- Uncited, the same in `docs/dev/code-map.md:419-421`.

**(b) What was decided.**
- Answer 4 (TASKS:338-339): "too-big models listed, 'too big for this card', Load offers the CPU".
- Replaced 2026-10-12: "use the larger of audio.cpp's estimate and the download size" (TASKS:610-611).
- Also 2026-10-12: "try the card first and fall back to the CPU only if the load fails" (TASKS:546-548).
- The new words, 2026-10-13: "needs about 10 GB · more than this card has" (TASKS:504-506).

**(c) What the claim adds.** The superseded rule, stated as current. The code follows the later decisions.

**(d) Severity.** INTERNAL.

**(e) Fix.**
- Recommended: change to "measured here, else the larger of audio.cpp's estimate and the download (2026-10-12); more than the card → the CPU, or the card first when only the estimate is too big (2026-10-12; words 2026-10-13)".
- Attack: no rule changes. It touches three comments plus code-map.
- Survives as written.

### 20. The question's words are quoted as the user's

**(a) Where.** `docs/dev/RESEARCH.md:2893`: "(2026-10-12, the user's word: "Run the OuteTTS command-line check")".

**(b) What was recorded.** TASKS:613-616 shows those words were the question, "2. Run the OuteTTS command-line check?". The user answered "your rec on all go".

**(c) What the claim adds.** The question's words presented as the user's.

**(d) Severity.** INTERNAL.

**(e) Fix.**
- Recommended: change to "(2026-10-12, question 2, 'Run the OuteTTS command-line check?' — the user: 'your rec on all go')".
- Attack: none.
- Survives as written.

---

## Open questions the fixes create for the user (no leans)

1. The generated engines: everything left out by the clone-only filter. This goes into the adoption plan (TASKS:126, OPEN 2), already pending.
2. VieNeu: hide it, or list it marked "doesn't clone from a clip yet"?
3. Cast with no book language: offer every installed voice, or ask for the book's language first?
4. Merge into…: should lexicons, generations and MCP bindings move to the kept persona, or go?
5. Kit cache: use a sibling's cache only when this app's own cache is empty, or always when nothing is chosen?
6. A pre-filled model description: interface language, or English?
7. The capture language label for "auto": what word?
8. A remembered failed card load: should a measured GPU-pinned load clear it, and should a new runtime build forget it?
9. The 21 clean-room gap recommendations, shown for the first time — including the `/mcp` token guard and filler kept with every switch off.
10. Import errors: keep the 400s and their messages as worded?
11. The runaway-line rule: 0.5 s a character and 30 s, and never pricing that process again.
12. The Render mock: give it the speaker picker? This is an edit that needs a go.
