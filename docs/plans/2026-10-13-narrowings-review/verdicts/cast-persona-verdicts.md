# Verdicts — cast-persona.md (14 findings), adversarial pass, 2026-10-13

Read-only. Nothing was run. Line numbers are the current tree's.

---

## 1. Smart-assign never sends the narrator; docs say it reads every speaker
**Verdict: PARTLY · VISIBLE**
- Code holds: `src/components/StudioCast.vue:107-109` `listed` drops the narrator (non-game); `:458` `const people = listed.value;`.
- Refuted parts:
  - The skip is not new. It dates from the split (`fd593f8`, 2026-09-29). Before that, the old `StudioView.vue` `smartAssignCast` read `characterPersonas`, which also left the narrator out.
  - "Three places say the opposite" is overstated:
    - The header comment `:25-27` says only that the chips "change what is shown, never who Smart-assign or ＋ New persona read". That is true.
    - The batch-pick plan §3 says "stays on `listed`". That is accurate.
    - `docs/personas.md:677` says "sends the book's speakers, the narrator aside". That is correct.
- Still false: `docs/studio.md:815`, "Smart-assign and ＋ New persona still read all the book's speakers". The TASKS "All · No persona" BUILT line ("still read the whole cast") is ambiguous at best.
- No user words approve or reject the skip. 2026-09-29's "the narrator becomes a speaker cast like anyone" is about the data model. 2026-10-05's "Include the narrator when it has no persona? Lean: yes" covers ＋ New persona only.
- **Surviving claim:** Smart-assign leaves out the narrator, which no user word covers, and `docs/studio.md:815` says it reads everyone.

**FIX**
1. Recommended (reviewer's): send `props.speakers`, and fix the comment, the doc and TASKS.
2. Attack:
   - Smart-assign applies at once and re-casts every speaker it is sent, cast or not (`StudioCast.vue:500-504` has no check for an existing persona). Sending the narrator would overwrite the narrator persona the user picked on every run. That is a new overwrite of a user choice the user never saw.
   - The comment is already correct and needs no change.
   - TASKS BUILT lines are records, not live claims.
   - Blast radius of a code change: `StudioCast.vue:458` (and `:467` stats, `:473` label), `docs/studio.md:815`, `:835`, `docs/personas.md:677`.
   - Open question (don't settle it): should Smart-assign include the narrator, and if so, may it replace a narrator who already has a persona?
3. Surviving fix:
   - Docs only now: make `docs/studio.md:815` match `personas.md:677`'s existing words ("the narrator aside" for Smart-assign; ＋ New persona includes the narrator).
   - Put the open question to the user before any code change.

## 2. "Models to choose from" lists engines, not models
**Verdict: PARTLY · VISIBLE**
- Code holds: `StudioCast.vue:83` groups by `v.engine`, `:85` labels with `engineById[id].name`, `:104` / `:464` / `:569` filter by engine.
- The label is refuted by the later, approved example. Order: B3 (`e3ab4f9`, 03:02), then "Models to choose from" (`f6fe144`, 13:05). The user said "go" on: "The list: each installed model that has voices in the book's language, with its count, e.g. Kokoro (28) · Pocket TTS (20) · KittenTTS (8)."
  - Those are engine names. The model names are "Kokoro 82M" (`engines/kokoro/manifest.js:54`), "Pocket TTS English" (`engines/pocket/manifest.js:122`) and "KittenTTS Mini 0.8" (`engines/kitten/manifest.js:58`).
  - So "Pocket TTS (20)" exactly matches the engine-level build. For this control the later example outranks B3's "engine only on AI Settings → Speech engines".
- **Surviving claim:** engines with several models are lumped. `qwen3` covers CustomVoice presets and Base / VoiceDesign stored voices; `chatterbox` covers Turbo, Nano and Multilingual (`voices_api.js:47-72`, `engine: rec.engine`). The approved example never showed a multi-model engine. The doc's own reason ("each extra model is one more load per chapter", `docs/studio.md:831`) holds per model, not per engine.

**FIX**
1. Recommended (reviewer's): group by `v.model`, label with `v.model_name`.
2. Attack:
   - Applied everywhere, this changes "Kokoro (28)" to "Kokoro 82M (28)" and "Pocket TTS (20)" to "Pocket TTS English (20)", against the approved example.
   - Showing engine names for single-model engines and model names for the others would be a new rule.
   - Saved prefs `castModels` hold engine ids. They would stop matching, but the filter at `:93-94` falls back to the default, so nothing breaks.
   - Blast radius: `StudioCast.vue:79-104`, `:464`, `:569`; `docs/studio.md:826-833`; `docs/whats-new.md`.
   - Open questions:
     - Should Qwen3-TTS and Chatterbox list each model separately?
     - Should the label be the model's full name or stay the engine's for single-model engines?
3. Surviving fix: ask those two questions. No code until answered. If the answer is per model, reuse `v.model` / `v.model_name`, the same keys the persona page's Model filter already uses (`PersonaEditorPage.vue:349-353`).

## 3. "Installed" is never checked
**Verdict: PARTLY · INTERNAL**
- Code holds:
  - `src/services/newPersonas.js:24-27` filters by language only.
  - `GET /v1/voices` lists every manifest's static voices (`voices_api.js:96-101`).
  - `StudioCast.vue:80` and `:569` add no install filter.
- Approval: "Lean: installed voices that speak the book's language" (2026-10-05 Q1). The user approved filtering on install, and the code doesn't do it.
- Effect is mostly theoretical. Since 2026-10-01 an engine counts as installed when the shared runtime is installed (`server/src/engines/manager.js:243-246` `isInstalled` → `runtime.installedExe() !== null`), so every engine is installed or none is. With the runtime present, every listed static voice already belongs to an installed engine. The gap appears only when the runtime is missing.
- **Surviving claim:** the approved "installed" filter isn't built. It only matters with no speech runtime, when the batch proposes voices that can't play yet.

**FIX**
1. Recommended: drop voices whose engine is `not_installed` in `voicesForBook`'s callers.
2. Attack:
   - Reuses the Voices page's existing definition: `needsInstall(v)` at `src/pages/VoicesPage.vue:205-210` ("not installed = the shared speech runtime is missing"). `props.engines` already reaches StudioCast (`StudioPage.vue:653`).
   - No new number. It does adopt a meaning of "installed" (the runtime, not a downloaded model file), which no user word fixes.
   - Blast radius: `StudioCast.vue:80` (the picker's counts) and `:569` (the batch); `src/services/newPersonas.test.js` if the filter goes into `voicesForBook`; the existing toast `:572` would then fire with no runtime.
   - Simpler alternative: change nothing and drop the word "installed" from `newPersonas.js:21`, `StudioCast.vue:555`, `:572`, `CastNewPersonas.vue:8` and `docs/studio.md:843`. That contradicts the approved lean, so it is worse.
   - Open question: does "installed" mean the runtime is installed or the model file is downloaded?
3. Surviving fix: filter with VoicesPage's `needsInstall` rule (move it to a shared service rather than copying it), once the user confirms "installed = speech runtime installed".

## 4. Voice dropdown labels leave the gender out when it isn't known
**Verdict: CONFIRMED · VISIBLE**
- `src/services/personaFacts.js:27`: `voiceGender(v) === "?" ? "" : voiceGenderWord(v)`, made in `e3ab4f9`. The earlier version (`x !== "?"` filter) dropped it too.
- `src/services/personaFacts.test.js:14` pins "Zed · English · kokoro".
- Approvals, none permitting omission:
  - 2026-09-30, `docs/plans/2026-09-30-voice-gender-and-pronouns.md:56`: "Unknown shows '?'".
  - B4 (later, 2026-10-06): "ONE word for unknown. Lean: Not known".
  - The persona redesign: every dropdown "Name · Gender · Language · Model".
- Refutation failed: no word omits it.

**FIX**
1. Recommended: `voiceLabel` uses `voiceGenderWord(v)` unconditionally. It already returns "Not known" for "?" (`voiceGender.js:76`, `:85-86`).
2. Attack:
   - Reuses the shared helper and the approved word. No new wording, number or rule.
   - Blast radius (every `voiceLabel` reader): `src/components/CacheSection.vue:162`, `CastNewPersonas.vue:39`, `:109`, `PersonaBlendMaker.vue:77`, `src/pages/PersonaEditorPage.vue:394`, mocks `MockBlendMaker.vue:60`, `MockPersonaEditorPage.vue:217`; test `personaFacts.test.js:14`.
   - The persona page's option gets longer (it also joins type and direction). That is a layout check, not a decision.
3. Surviving fix: as recommended. Update the test and measure the persona page's Voice select width.

## 5. The persona page's Version choice is ignored when it isn't downloaded and another is
**Verdict: CONFIRMED · VISIBLE**
- `server/src/voice_model.js:398-401`: `pool = onDisk.length ? onDisk : ids; if (pool.includes(def)) return def;`. A default that isn't on disk loses to an on-disk sibling.
- What the user was told (2026-10-05 WHY): "the loaded one, else the engine's default, else an installed one". The function's own docstring (`:371-373`) and `docs/dev/RESEARCH.md:1521-1524` say the same. The code adds an unstated on-disk condition to the default.
- Call 4's "the user's default if it is" is ambiguous (that family? on disk?). The P1 amendment only covers the case where nothing is on disk. No user word approves on-disk-wins.
- The page is honest: "Speaks with … 0.6B" (`PersonaEditorPage.vue:1052`). But Load shows only while some version is loaded (`:1057`), so with nothing loaded there is no way to act until a first Listen.

**FIX**
1. Recommended (reviewer's): check the default before the on-disk pool, so the load fetches the missing file.
2. Attack:
   - A render, preview or Generate could then start a multi-GB download without being asked (1.7B is 2.6 GB, 16-bit 3.9 GB; `versions_of` sizes). It reaches every `ensureModelLoaded` caller: `server/src/render_core.js:742`, `server/src/api/generate_api.js:201`, `server/src/api/voice_preview_api.js:440`, `:541`, plus `versionsOf` (`voices_api.js:264`).
   - Test `server/tests/voice_model.test.js:173-190` pins today's pick. The Speech engines "Set as default" path is affected the same way.
   - Simpler alternative, reusing the page's own Load (`loadChosenVersion` + `DownloadBar`, `PersonaEditorPage.vue:540-551`): show it whenever `speaks_with !== chosenVersion`, not only when something is loaded. That is a template condition at `:1057`, with no server change. Its hint line for the nothing-loaded case would be new wording.
   - Open questions:
     - When the chosen version isn't downloaded, should renders download it, or keep using the downloaded one until you press Load?
     - What does the hint say with nothing loaded?
3. Surviving fix:
   - Correct RESEARCH:1521-1524 and the `variantForModel` docstring to what the code does: the default only when it is on disk.
   - Ask the open question.
   - The page-side Load change is the smaller option if the user keeps today's pick.

## 6. Gender filter now offers "Not known (N)"
**Verdict: UNSURE · VISIBLE**
- Code holds: `PersonaEditorPage.vue:354-358` and `PersonaBlendMaker.vue:69-72` key the facet on `voiceGender(v)`, so "?" is offered as "Not known (N)". Before `e3ab4f9` it was mapped to "" and hidden.
- 2026-10-05: "15 … only appear under Any gender. My lean: leave it". NOT: "a gender guessed for the 15 — they stay under Any gender until set on Voices". That ruling was about not guessing, and adding an option guesses nothing.
- B4 (later) approved "the shared voiceGenderWord everywhere, and ONE word for unknown". Audit §4 listed `PersonaEditorView.vue:353`, `:357` (these facet lines) under Gender, but §1's approved text never proposed a filter option.
- The Voices page already offered an unknown option ("unset") before B4 (`e3ab4f9^:VoicesView.vue:219`). The change brought the persona page in line with Voices.
- **Settles it:** ask the user whether the persona page's and the blend maker's Gender filters should offer "Not known (N)" as Voices does.

## 7. RESEARCH says "Only Discover adds speakers"; who settled the conflict
**Verdict: PARTLY · INTERNAL**
- False fact confirmed:
  - `docs/dev/RESEARCH.md:1434` (`22a234b`) says "Only Discover adds speakers". Cast's ＋ Add (`StudioCast.vue:339-355`), Add Narrator (`:425-441`) and imports also add speakers.
  - The BUILT line of "Only Discover adds speakers" (`52dd095`) claims "Discover's is the only add left (grep)", which is also false.
- Order of the rulings:
  - 2026-10-05 (earlier): "Cast's ＋ Add stays — it is for someone Discover missed".
  - 2026-10-06 12:32 (`52dd095`): "one place adds speakers, and that's Discover. · Script stops adding." This answered "should script be identifying speakers".
  - 2026-10-06 12:40 (`22a234b`, latest, "your rec on all go"): "Script still never adds speakers."
- The latest approved words frame the rule as Script's, which is what the implementer's correction (`docs/studio.md:134` "Script never adds speakers … or Cast's ＋ Add for someone Discover missed") follows. So "settled without the user" is only partly true: the user approved "Script still never adds speakers" after "one place adds…". But 12:32's literal "one place" was never reconciled with 10-05 in the user's words.
- **Surviving claim:** RESEARCH:1434 states a false fact. Whether "one place adds speakers, and that's Discover" retires Cast's ＋ Add was never asked.

**FIX**
1. Recommended: rewrite RESEARCH:1434 using the existing words of `docs/studio.md:134-135` ("Script never adds speakers (since 2026-10-06) — they come from the import, Discover's ＋ Add, or Cast's ＋ Add …", plus Add Narrator), with a "(was: …)" note.
2. Attack:
   - Reuses approved doc wording. No behavior changes.
   - Blast radius: `docs/dev/RESEARCH.md:1434` only. TASKS BUILT lines are records; add a dated correction line rather than editing them.
   - Open question: does 2026-10-06's "one place adds speakers, and that's Discover" remove Cast's ＋ Add, which 2026-10-05 kept?
3. Surviving fix: the RESEARCH correction, plus that one question to the user.

## 8. Cast's "Added here" tooltip names only Discover
**Verdict: CONFIRMED · VISIBLE**
- `StudioCast.vue:785`: `'Added here — with Discover\'s ＋ Add'`. Grid cards for speakers added by Cast's ＋ Add, or a former Narrator moved into the grid, show it wrongly.
- Approved (2026-10-06): "Added here, the people you added with ＋ Add, plus the Narrator". It doesn't say Discover. The tooltip is the implementer's wording.
- The same slip is in `docs/studio.md:798-799` ("with Discover's ＋ Add or as the narrator"), which the finding missed.

**FIX**
1. Recommended (reviewer's): "＋ Add (Discover or Cast), or the narrator".
2. Attack:
   - That is new wording. Discover already shows the same fact as "added with ＋ Add, and the narrator" (`StudioDiscover.vue:435`), close to the approved text. The one-wording-per-fact rule (B, 2026-10-06) says to reuse it.
   - Blast radius: `StudioCast.vue:785`, `docs/studio.md:798-799`, the comment `StudioDiscover.vue:431`.
   - Open question: none if Discover's hint is reused.
3. Surviving fix: Cast's tooltip and `studio.md:798-799` use Discover's existing hint text, "added with ＋ Add, and the narrator".

## 9. Discover's Narrator row has no Ignore; "Ignore N selected" counts the narrator
**Verdict: PARTLY · VISIBLE**
- Hiding Ignore is refuted. The approved flow (2026-10-05) names only "status New, with ＋ Add" for the Narrator row (the 09-29 New rows were "Add, Ignore"). The user's own words: "if there is narration then we need a narrator, that is not an option". So the header's "no Ignore" (`StudioDiscover.vue:46-48`) follows the user's words, though the exact phrase came from the BUILT line.
- The count is confirmed:
  - `:257` `pickedWaiting` includes the narrator row, which is ticked by default (`:174-176`, `:255`).
  - `:609-610` labels "Ignore N selected" from it and enables on it.
  - `ignoreSelected` (`:297`) drops the narrator.
  - Result: "Ignore 3 selected" ignores 2. With only the narrator ticked, an enabled "Ignore 1 selected" does nothing.
- **Surviving claim:** Ignore's count and enabled state include the pre-ticked narrator that Ignore skips.

**FIX**
1. Recommended: Ignore's label and `:disabled` count `pickedWaiting.filter((r) => !r.narrator)`, the same filter `ignoreSelected` already applies.
2. Attack:
   - Reuses the existing filter. No new wording or number.
   - The pre-tick was approved ("the narrator row pre-ticked"), so un-ticking it is not an option.
   - Blast radius: `StudioDiscover.vue:609-612` only. "＋ Add N selected" (`:605-606`) rightly keeps counting the narrator. The "N ticked" hint (`:617`) counts ticks, which is still true.
3. Surviving fix: as recommended.

## 10. Smart-assign's error points to a screen that doesn't exist
**Verdict: CONFIRMED · VISIBLE**
- `StudioCast.vue:520`: "Smart-assign unavailable — wire an LLM provider in Engines → LLM tab."
- It is reachable: the server returns 501 when no LLM is configured (`server/src/api/smart_assign_api.js:123`). No "Engines → LLM tab" exists: `#/engines` redirects to AI Settings → Speech engines (`src/router/routes.js:44`).
- The wording dates from `520b6f5` (2026-06-10) and the one-wording audit missed it. Nothing approves it.

**FIX**
1. Recommended: use the app's existing sentence, `${what} needs a language model — set one in AI Settings.` (`PersonaEditorPage.vue:686`; the batch's `StudioCast.vue:604`), giving "Smart-assign needs a language model — set one in AI Settings."
2. Attack:
   - Reuses an existing sentence. "Smart-assign" in it is still a wording the user hasn't seen word for word. Open question: that exact text.
   - Blast radius: `StudioCast.vue:520` only. No test or doc quotes it (`docs/studio.md:838` says only "without one it says so").
3. Surviving fix: as recommended, with the text shown to the user first.

## 11. The server still keeps a persona's old language when its voice changes
**Verdict: PARTLY · INTERNAL**
- Code holds: `server/src/api/personas_api.js:323` passes `{ keepIfSpoken: current.language }`. The docstring is at `:145-150`.
- Test `server/tests/persona_render.test.js:189-194` (`changing_the_voice_keeps_a_language_it_still_speaks`) pins the reversed rule.
- Approved reversal (2026-10-05): "Picking a voice sets Speaks to that voice's language … This reverses the redesign rule that kept the old language." Nothing keeps the server rule, and `docs/personas.md:290-292` says the rule is gone.
- Reach is narrow:
  - The only in-app PATCH with `voice_id` is the persona page, which always sends `language` (`PersonaEditorPage.vue:141`, set in `pickVoice` `:440`).
  - It sends null only for a voice with no language and no `speaks`.
  - No MCP tool PATCHes personas (grep of `server/src/mcp`). That leaves API callers.
- **Surviving claim:** the server keeps the reversed rule (and a test pins it), reachable only through the API or a voice with no language.

**FIX**
1. Recommended: at `:323`, pass `keepIfSpoken: null` when `voice_id` is sent and differs from `current.voice_id`.
2. Attack:
   - No new wording or number. It completes an approved reversal.
   - Blast radius: `personas_api.js:145-150` (docstring), `:323`; `server/tests/persona_render.test.js:189-194` (rewrite to the new rule). `POST /v1/personas` (`:287`) already passes no `keepIfSpoken`.
   - Simpler alternative: leave it and document that the API keeps the old rule. That contradicts "reverses" and `personas.md:292`.
3. Surviving fix: as recommended, with the test rewritten.

## 12. Hardcoded numbers and lists
**Verdict: PARTLY · INTERNAL** (the 200-character cut borders on VISIBLE)
- Values confirmed:
  - `server/src/api/smart_assign_api.js:68` (200 characters).
  - `src/services/voiceMakers.js:117-119` (10 s / 120 s / 25 dB).
  - `PersonaDesignMaker.vue:104` (5 takes).
  - `server/src/api/personas_api.js:186` (`maxLength: 2000`).
  - `src/pages/VoicesPage.vue:67` (60 voices).
  - `server/src/extraction/names.js:112` (title list), `:131` (3+ letters), `:168` (120 characters).
- Refuted or weakened:
  - 25 dB is approved by word (TASKS :4717, "warning under 25 dB").
  - 10 s and 2 minutes were shown in the approved mock's own labels (`MockCloneMaker.vue:95-101`, "under 10 s", "over 2 minutes"; "mock looks good, go ahead and code it"). The values are approved. Where they live is not.
  - The 2000 limit is request validation on an API body, not a threshold a user tunes.
  - The names.js rules appear only in the 09-29 BUILT line.
- The family rule ("Thresholds, limits … live in the database (seeded, editable in Settings)") dates from 2026-10-09 (kit `df3d425`).
- **Surviving claim:** never shown to the user, and hardcoded against the family rule:
  - Smart-assign's 200-character cut of "Who they are", which is also New persona's endpoint. Cast's approved hint says "Read by … Smart-assign" with no cut.
  - The 5-take history.
  - The 60-voice gender batch.
  - Discover's 3-letter, title-word and 120-character rules.

**FIX**
1. Recommended: per the 2026-10-13 review decision's own method ("A number or label I chose that you never saw … Each one goes into TASKS as a finding. Nothing gets fixed until you've seen the list."), record each as a FINDING for the user's word.
2. Attack:
   - Follows the approved process and adds nothing.
   - Moving any of them later reuses `SettingsStore` / `PATCH /v1/settings` (`server/src/storage/settings_store.js`), the app's standard path.
   - Blast radius of a move: the cited lines; `docs/studio.md:897-901` (the hints); `server/tests/discover_speakers.test.js` (names rules).
   - Simpler alternative for the 200 cut: send the whole description (no setting at all). Open question: prompt size with many long JustWrite descriptions.
   - Open questions: which values become settings; whether the 200-character cut should exist.
3. Surviving fix: FINDING entries plus a list for the user. No code until named.

## 13. The voice makers' per-model notes, orders and model names are typed by hand
**Verdict: PARTLY · INTERNAL**
- Code holds:
  - `voiceMakers.js:42-55` (`MODEL_NOTE`, `DESIGN_NOTE`).
  - `PersonaCloneMaker.vue:159` (`ORDER`).
  - `PersonaDesignMaker.vue:48`, `:90`, `:121`, `:127` ("Qwen3 VoiceDesign and VoxCPM2 take written direction").
  - `PersonaEditorPage.vue:282-286` (`OFF_REASON`).
- The wording is refuted as unapproved: these texts were in the approved in-app mock (`src/services/mock/mockMakers.js:59-65`, `MockDesignMaker.vue:32`; "mock looks good, go ahead and code it", 2026-10-04).
- What survives is structural. The model options already come from capability rows (`makerModelOptions`), so a newly adopted model appears with no note and last in order, and the two named design models go stale. This runs against the 2026-10-13 "adopt everything … anything we need to add we do so in a standard way" (TASKS :126-157, OPEN item 2).
- **Surviving claim:** per-model text and order keyed by hand-typed model ids won't follow the adopt-everything engine list.

**FIX**
1. Recommended: fold it into the 2026-10-13 plan (OPEN 2), so notes and preferred order come from each family's curated file / capability row and the two named design models come from `supports_voice_design` rows.
2. Attack:
   - That is the approved standard path (the curated file named in that decision). No separate code now.
   - Blast radius: `voiceMakers.js:42-55`, `PersonaCloneMaker.vue:159`, `PersonaDesignMaker.vue:48`, `:90`, `:121`, `:127`, `PersonaEditorPage.vue:282-286`, mocks `mockMakers.js:59-65`, `MockDesignMaker.vue:32`.
   - Open question: whether the approved note texts move into the curated files as-is.
3. Surviving fix: add these lines to the 10-13 plan's blast radius. No standalone fix.

## 14. Changing Type clears the Model filter
**Verdict: UNSURE · VISIBLE (minor)**
- Code holds: `PersonaEditorPage.vue:374` `watch(kind, () => { modelFilter.value = ""; … })`. It has existed since P4 (`8c9c536`, 2026-10-03), before the 10-05 filter rule.
- 10-05's rule: "an option nothing fits drops out, but the one you chose stays with (0)".
- The filters plan §5 lists "`watch(kind)` already cleared Model" as already on the path. That is a blast-radius note, not the user's words.
- Clearing can be read as protective: the user objected to filters leaving the list empty ("Leaving Tags puts Type back", 10-05). Keeping Model at (0) after a Type change would leave the list empty.
- **Settles it:** ask the user whether a Type change should keep the chosen Model at (0) or clear it.
