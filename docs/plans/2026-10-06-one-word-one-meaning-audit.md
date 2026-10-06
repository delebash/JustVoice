<!-- SPDX-License-Identifier: MIT -->
# One meaning per word, one wording per fact — the audit (2026-10-06)

**Decision:** TASKS "One meaning per word — speaker, persona, cast — and one wording per fact"
("your rec go" — the list first). **Status (2026-10-06, end of day): built.** "your rec go" on A, B
and C as leaned; built in five batches (`e410e97` A · `e3ab4f9` B1–B4 · `fb3e603` B5/B6/B8 ·
`fb41867` B7/B9/C) and the four follow-up answers (Speech engines says *version*; the Cache page
names engine and model, which needed renders to record them). C1 was wrong and left as it is
(RESEARCH §3). B6's take-wording table was not recorded word for word — only its button, tag,
Compare and Play chapter words were; the rest was kept as built by the user's answer. TASKS "One
meaning per word" holds each batch's BUILT line. The text below is the list as it was approved.
**Before the go:** nothing had been changed. This is the list, for the go on each decision in §1. Three read-only passes found the rows (on-screen text in `src/`, the user
docs `docs/*.md`, the same fact worded differently across screens); the key rows were re-checked by
grep before this was written (VoicesView's own `voiceGenderWord` at `:647`, "★ live" at
`StudioRenderChapter.vue:325`, "Peak ≤ −3 dB" at `ExportPanel.vue:208`, ProjectsView's chapter word
at `:227`, the two "rendered" counts at `studioStatus.js:248` / `StudioRender.vue:231`, "between
quotes" at `StudioCast.vue:644`, the hard-coded "auto" at `CapturesView.vue:134`, Discover's "In the
cast", Script's "Your cast has only the Narrator", Qwen3's "nine speakers").

## 1. The decisions

### A. The three words (the rule)
- **A1 · "the cast" as a name for the speakers → "the book's speakers" / "in this book".** ~35 on
  screen, ~40 in the docs. Discover's chip **In the cast → In this book**, card **Already in the cast
  → The book's speakers**, **Remove from cast → Remove from book**; Script's *Your cast has only the
  Narrator* → *This book's only speaker is the Narrator*; *AI named no one in the cast* → *AI named
  none of the speakers*; *Remove Nettle from the cast?* → *Remove Nettle from this book?*.
- **A2 · A persona named next to a speaker → "persona X".** ~15 on screen, ~10 in the docs. Cast's
  card *June · Qwen3 · 61 lines* → *persona June · Qwen3 · 61 lines*; Render's line → **Speaker**
  [Nettle ▾] · **Cast:** persona June · Qwen3 · Change in Cast ➜; *Assigned June to Nettle.* →
  *Nettle cast with persona June.*; *⚠ June has no voice* → *⚠ persona June has no voice*.
- **A3 · "plays / played by" (persona → speaker).** 44 in the docs, a few on screen. Lean: **keep
  "plays"** as the verb — it's natural, you used it yourself ("played by persona narrator"), and the
  rule is about the three nouns. Only where it's ambiguous ("nobody plays them yet") → *no persona yet*.
- **A4 · "✕ Clear cast" → "✕ Clear personas"** (it takes every speaker's persona away; the speakers
  stay — today its confirm has to add "The speakers stay").
- **A5 · "speaker" meaning something else.** Qwen3 CustomVoice's *nine speakers* / *preset speakers*
  → *nine built-in voices*; Channels' *your speakers* (loudspeakers) → *your sound output*.
- **A6 · "voice" meaning persona.** *Finished voices* (Personas' header, Home's card), Channels'
  *route voices* (it routes personas) → *persona*.
- **A7 · "Rewrite in character"** (~12 places; the button already says *✏️ Rewrite as Nettle*). Lean:
  **"Rewrite as the speaker"** for the feature's name; *character* isn't one of the three words.
- **A8 · The rule in design-law** (`docs/dev/design-law.md`), so new screens follow it.

### B. One wording per fact
- **B1 · Can be directed.** The persona page keeps its own copies (`DIRECTION_WORD`, the "This
  model" card's ✗ written direction ✗ tags), the voice makers' notes word it two ways (*Takes no
  direction* / *Written direction is dropped*), and six sentences say *takes no direction / takes tags,
  not words* by hand. → `directionCell` everywhere, plus ONE shared sentence
  (`directionSentence(directedBy, model)` in `personaFacts.js`).
- **B2 · A voice's type.** *preset* leftovers (Voices' empty state, Quick setup, Settings) → *Built-in*;
  *blends* → *Blended voices*; the kind shown on some voice dropdowns and hidden on others → always
  `voiceKindLabel`.
- **B3 · Model / engine / version.** Voices' filter lists engine ids (*kokoro*) over a column headed
  Model; Cast's banner lists engine ids; the header pill says *No voice engine*; Speech engines calls a
  size a *model* where the persona page calls it a *Version*. → **Model** = its name (*Qwen3-TTS
  CustomVoice*), **Version** = size and precision; *engine* only on AI Settings → Speech engines; one
  `modelName()` helper. Loaded / not installed: one set of words (*not loaded*, *needs the speech
  runtime*).
- **B4 · Gender.** VoicesView has its OWN `voiceGenderWord` (lower case, "" for unknown) shadowing
  the shared one; the persona page and the blend maker keep local copies; unknown is *?*, *unset*,
  *Unset*, *unknown* and *Not known*. → the shared `voiceGenderWord` everywhere, and ONE word for
  unknown. Lean: **Not known**.
- **B5 · A line's state.** *blocked* (Overview, Cast) vs *can't render* (Render); *no speaker*
  (Script) vs *need a speaker* (Home) vs *needs a speaker* (Render); **"rendered" is counted two ways**
  — Render's chapter grid excludes stale lines, Overview includes them, so one project shows two
  numbers; Studio's step card counts chapters, Overview lines, both say "rendered"; the game Lines grid
  says *none / ● stale / ✓ rendered* and calls stale lines *changed*; *can't render* is also used for an
  ACX failure. → one `lineStates.js`: **can't render**, **needs a speaker** (Render, Home) / **no
  speaker** (Script, where it's the line's speaker column), **rendered** = has a take that is current,
  always naming the unit (*12 of 40 lines*, *2 of 5 chapters*).
- **B6 · The take the chapter plays.** *★ live*, *★ take*, *the ★ one*, *default* (dead code). →
  your pending choice: **★ In use** / **★ Use this take** (the take wording table).
- **B7 · Language.** Voices' filter splits *American English* / *British English*, the persona page
  groups *English*, the blend maker splits; raw codes on Speech engines (*en*, *N langs*) and Captures
  (*auto*, hard-coded); *Speaks* means the voice's language on Voices and the persona's on the persona
  page. → base names (*English*) in every filter; *Speaks* = the persona's, *Voice's language* = the
  voice's.
- **B8 · Counts and states on the step cards vs Overview.** *3/5 scanned* vs *3 of 5 chapters
  scanned*, *N/M cast* vs *N of M speakers cast*, different empty-state words. → build the step cards
  from Overview's own `stepStatus`, so they can't differ.
- **B9 · Smaller ones.** A persona with no voice: *no voice* / *no voice yet* / *—* → *no voice yet*;
  a line with no speaker in a cell: *— nobody —* / *no one* / *— no speaker —* → *— no speaker —*;
  *not analyzed* / *never* / *Not analyzed yet* → *not analyzed yet*; project kinds (*game* / *Game
  voicelines* / *Game dialogue* / *Games*, *Custom* / *Text* / *Plain text*) → one `PROJECT_KINDS`
  map; *ready* (a line, an engine, ACX passed) and *Spoken by* (Render's speaker, the design maker's
  model) each mean two things; what a persona IS is phrased four ways.

### C. Factual slips found on the way (not wording — wrong)
- **C1** ExportPanel's ACX checklist says *Peak ≤ −3 dB*; the preset and Overview say −3.5 dB
  (`ExportPanel.vue:208`).
- **C2** Projects labels every row's chapter count with the OPEN project's word — a game project's
  "scenes" shown for an audiobook (`ProjectsView.vue:227`).
- **C3** Captures says *Capture language: auto*, hard-coded, whatever Settings holds
  (`CapturesView.vue:134`).
- **C4** Cast's narrator tooltip says the narrator carries the prose *between* quotes; it's *outside*
  them (`StudioCast.vue:644`).
- **C5** Import review says the Script step finds speakers; it's Discover (`ImportReviewView.vue:211`).
- **C6** Render's ↻ New take hint keys "a new seed can change who speaks" on *written direction*; it's
  a *Designed* voice that drifts (`StudioRenderChapter.vue:768`).
- **C7** ExportPanel shows the raw preset id (*acx*) or *default* where Overview shows the real target.

### Tests that pin strings
`scriptReview.test.js:222`, `:231` (*…in the cast*); `studioStatus.test.js:88`, `:104` (*Add Narrator
on Cast* — fine; *3 of 5 speakers cast*). They change with the strings.

## 2. On-screen text — the three words (`src/`, the rows)

| File:line | Now | Breaks | Proposed |
|---|---|---|---|
| StudioCast.vue:98 | card line `June · qwen3 · 61 lines` | A2 | `persona June · qwen3 · 61 lines` |
| StudioCast.vue:100 | `⚠ ${p.name} has no voice` | A2 | `⚠ persona June has no voice` |
| StudioCast.vue:135 | `this cast spans N engines (…)` | A1, B3 | `this book's personas are on N models (…)` |
| StudioCast.vue:234 | `Assigned June to Nettle.` / `Unassigned June from Nettle.` | A2 | `Nettle cast with persona June.` / `Nettle no longer has persona June.` |
| StudioCast.vue:319 | `Added Nettle — played by Nettle, the persona of that name.` | A2 | `Added Nettle — cast with persona Nettle (same name).` |
| StudioCast.vue:331 / :341 | `Remove Nettle from the cast?` / `…removed from the cast.` | A1 | `Remove Nettle from this book?` / `Nettle removed from this book.` |
| StudioCast.vue:404 | `Narrator added to the cast…` | A1 | `Narrator added as a speaker…` |
| StudioCast.vue:646, :721, :728 | title `Remove from the cast — asks first` | A1 | `Remove from this book — asks first` |
| StudioCast.vue:812 | title `Assign June to Nettle` / `Unassign June from Nettle` | A2 | `Cast Nettle with persona June` / `Take persona June from Nettle` |
| StudioCast.vue:795 | `A persona is a finished voice — …` | A6 | `A persona is a voice and how it's spoken. …` |
| StudioCast.vue:351, :353, :363, :681 | `Clear cast?` · `Clear cast` · `✕ Clear cast` | A4 | `Clear personas?` · `Clear personas` · `✕ Clear personas` |
| StudioCast.vue:636 | `Audition · June · qwen3` | A2 | `Audition · persona June · qwen3` |
| StudioCast.vue:818 | `✓ June, Marius` (speakers, under a persona) | ambiguous | `✓ plays June, Marius` |
| StudioDiscover.vue:156, :528 | chip `In the cast` | A1 | `In this book` |
| StudioDiscover.vue:277, :336, :337 | `… added to the cast …` | A1 | `… added as a speaker / as speakers …` |
| StudioDiscover.vue:382, :388 | `Remove … from the cast?` | A1 | `Remove … from this book?` |
| StudioDiscover.vue:405, :407, :408 | `… removed from the cast.` | A1 | `… removed from this book.` |
| StudioDiscover.vue:451 | `…speakers already in the cast…` | A1 | `…speakers already in this book…` |
| StudioDiscover.vue:491, :526 | `N not in the cast yet` / `Not in this cast yet: …` | A1 | `N not in this book yet` |
| StudioDiscover.vue:575, :576 | `already in the cast` · `Remove from cast` | A1 | `already a speaker` · `Remove from book` |
| StudioDiscover.vue:623 | card `Already in the cast` | A1 | `The book's speakers` |
| StudioDiscover.vue:633; PersonaEditorView.vue:1290 | 🎭 (the persona icon) before a SPEAKER's name | A2 | drop the 🎭 |
| StudioScript.vue:442 | `Analyzed before Nettle joined the cast …` | A1 | `Analyzed before Nettle was added as a speaker …` |
| StudioScript.vue:517; StudioScriptChapter.vue:627 | `Your cast has only the Narrator, …` | A1 | `This book's only speaker is the Narrator, …` |
| StudioScriptChapter.vue:154 | `Nettle is in the cast now — …` | A1 | `Nettle is a speaker now — …` |
| StudioScriptChapter.vue:632 | `…choosing from the cast.` | A1 | `…choosing from this book's speakers.` |
| StudioScriptChapter.vue:673 | `Old Sedge isn't in the cast —` | A1 | `Old Sedge isn't a speaker in this book —` |
| scriptReview.js:355, :388, :414 | `…wasn't anyone in the cast` · `AI named no one in the cast` · `…didn't name anyone in the cast.` | A1 | `…none of this book's speakers` · `AI named none of the speakers` · `…didn't name any of this book's speakers.` |
| StudioRenderChapter.vue:509 | `June (who plays Nettle) has no voice` | A2 | `persona June (cast for Nettle) has no voice` |
| StudioRenderChapter.vue:604, :680 | `as June always speaks` | A2 | `as persona June always speaks` |
| StudioRenderChapter.vue:629 | `Give June a voice` | A2 | `Give persona June a voice` |
| StudioRenderChapter.vue:640-646 | `Spoken by` [▾] · `played by June · Qwen3 · Change in Cast ➜` | A2 | **Speaker** [▾] · **Cast:** persona June · Qwen3 · Change in Cast ➜ |
| StudioRenderChapter.vue:649 | `nobody plays them yet · Cast them ➜` | A3 | `no persona yet · Cast them ➜` |
| StudioRenderChapter.vue:430 (→ ↺ titles) | `Back to June's pace` | A2 | `Back to persona June's pace` |
| StudioRenderChapter.vue:156 ff. | state `needs a voice` also for a speaker with NO persona | B5 | `needs a persona` when there is none |
| PersonasView.vue:234, :256, :283, :336 | `Every speaker June plays …` · `June merged into Marius …` · names in delete confirms | A2 | `persona June …` |
| PersonasView.vue:429; App.vue:57; HomeView.vue:269 | `A persona is a finished spoken voice` · `Finished voices.` · `finished voices, any book` | A6 | `A persona is a voice from your library, …` · drop `Finished voices.` · `voice + delivery, any book` |
| PersonaEditorView.vue:870 | `June created and given to Nettle.` | A2 | `Persona June created — Nettle is cast with it.` |
| CastNewPersonas.vue:92 | `Narrator → Narrator` | A2 | `Narrator → persona Narrator` |
| StudioOverview.vue:323 | `…text, cast, lexicons…` | A1 | `…text, speakers, lexicons…` |
| ImportReviewView.vue:211-212 | `The Script step finds speakers … add them to your cast.` | A1, C5 | `Discover finds the speakers each chapter names and offers to add them to this book.` |
| AudioChannelsView.vue:103, :125, :154 | `Route specific voices …` · `…play through speakers AND …` | A6, A5 | `Route personas …` · `…through your sound output AND …` |
| QuickSetup.vue:73 | `preset speakers you direct in plain words` | A5, B1, B2 | `built-in voices you direct in written words` |
| lab/CastEditor.vue:65, :68 | `Remove from cast` · `No cast yet — …` | A1 | `Remove this speaker` · `No speakers yet — …` |
| services/labTestData.js:158 | source label `cast` (→ *Insert from cast…*) | A1 | `speakers` |
| App.vue:46; StoriesView.vue:26 | `multi-voice` (meaning several speakers) | A6 | `multi-speaker` |
| StudioRenderChapter.vue:730, :819; StudioCast.vue:769 | `Rewrite in character` | A7 | `Rewrite as the speaker` |
| StudioView.vue:253; HomeView.vue:212 | `9/10 cast` | B8 | `9 of 10 speakers cast` (Overview's own) |

Correct uses were also checked (≈150 lines in StudioCast, StudioDiscover, Script, Render, Overview,
Personas, persona page, CastNewPersonas, NarratorNeeded, studioStatus, scriptReview, Home, Lines and
the Lab) — the pass's own list. The mocks (`src/mock/`) mirror these rows and change with them.

## 3. The docs — the three words (`docs/*.md`)

84 rows (whats-new, a history log, listed apart and left as history). By file: **studio.md 47**
(36 *the cast* as a noun — Discover's statuses, the confirm texts it quotes, the second look, the
narrator, a *mixed cast* heading whose anchor whats-new links; 6 personas named bare; 5 where *June*
is a persona in one paragraph and a speaker in another — use *Nettle* for the speaker); **personas.md
11** (its table defines **Cast** as "Which persona plays each speaker" — a thing, not the step;
*so one Qwen3 speaker*; *A design model invents a speaker*); **ai-features.md 10** (the Lab's *cast
editor*, *Insert from cast…*); **engines.md 6** (Qwen3's *9 preset speakers*, *the main cast*);
**import-and-export.md 3**; **projects.md 2**; **voices.md 2**; **channels.md 2**; one each in
ai-providers, troubleshooting, lexicons, mcp-server. Plus **44 "plays / played by"** (A3) and **~12
"Rewrite in character"** (A7). The docs quote the screens, so each row follows its screen's change.
The pass's full row list (file:line · now · breaks · proposed) is kept with the session record and is
re-run as the docs are edited, so no row is fixed by memory.

## 4. The same fact in different words (`src/`, by fact)

1. **Can be directed** — `PersonaEditorView.vue:267-268` (local `DIRECTION_WORD` /
   `DIRECTION_EXAMPLE`, *Any* vs *Any direction*), `:280-283`, `:328`, `:603-604`, `:1087`, `:1127`,
   `:1197`, `:1264-1265` (✓/✗ written direction ✓/✗ tags); `voiceMakers.js:43-54` (MODEL_NOTE);
   `PersonaDesignMaker.vue:121`, `:229`; `PersonaCloneMaker.vue:209`, `:320`; `StudioCast.vue:206`
   (*no voice* vs Personas' *—*); `QuickSetup.vue:73`.
2. **Voice type** — `VoicesView.vue:887`; `QuickSetup.vue:73`; `SettingsView.vue:1601`, `:959`;
   `PersonaEditorView.vue:280`, `:282-283`, `:394`, `:407`; `PersonaBlendMaker.vue:211`;
   `PersonasView.vue:460`; `VoicesView.vue:815`.
3. **Model / engine / version** — `VoicesView.vue:169-170`, `:275`, `:707`, `:819`, `:838`;
   `StudioCast.vue:135`, `:636`; `App.vue:574`, `:578`; `HomeView.vue:268`, `:453`, `:457`, `:464`;
   `CacheView.vue:32`, `:260`; `PersonaEditorView.vue:234`, `:526`, `:537`, `:976`, `:1034-1050`;
   `PersonaCloneMaker.vue:238`, `:327`, `:329`; `PersonaDesignMaker.vue:183`, `:185`;
   `SpeechEnginesTab.vue:151`, `:860`, `:881-938`; `capabilities.js:58-68`; `VoicesView.vue:706`, `:839`.
4. **Gender** — `VoicesView.vue:105`, `:219`, `:241`, `:647-649` (its own `voiceGenderWord`), `:809`;
   `PersonaEditorView.vue:353`, `:357`, `:1076`, `:1081`; `PersonaBlendMaker.vue:55`, `:71`, `:78`.
5. **Line state** — `StudioRender.vue:217` (ACX), `:231` vs `studioStatus.js:248`/`:311` (two
   "rendered"), `:233`, `:248-249`, `:282`, `:285`, `:333`; `StudioRenderChapter.vue:156`, `:179`,
   `:183`, `:501`, `:509-511`, `:531`, `:542`, `:564`, `:612`; `studioStatus.js:281`, `:305`, `:314`;
   `StudioCast.vue:101`, `:780-781`; `StudioScript.vue:553`; `StudioScriptChapter.vue:663-664`,
   `:686`; `HomeView.vue:213`, `:404`; `StudioView.vue:261`; `LinesView.vue:220-222`, `:252`,
   `:265-267`.
6. **The take** — `StudioRenderChapter.vue:325-326`, `:334`, `:535-537`, `:617`, `:758`, `:800`,
   `:814`; `StudioRender.vue:237`, `:284`; `StudioScriptChapter.vue:791`; `ExportPanel.vue:198`;
   `LineageViewer.vue:80-81` (imported nowhere — dead).
7. **Language** — `VoicesView.vue:231-235`, `:256`, `:276`; `PersonaEditorView.vue:300`, `:362`,
   `:483`, `:1021`, `:1266`; `PersonaBlendMaker.vue:66`; `SpeechEnginesTab.vue:503`, `:506`;
   `CapturesView.vue:134`, `:245`; `SettingsView.vue:1546`; `StudioCast.vue:817`.
8. **Step cards vs Overview** — `StudioView.vue:247-264` vs `studioStatus.js:268-320`; *to review*
   (`StudioDiscover.vue:491`); analyzed (`StudioScript.vue:106`, `:434-435`,
   `StudioScriptChapter.vue:196-197`, `scriptReview.js:399-400`, `studioStatus.js:289`).
9. **Smaller ones** — no voice (`PersonasView.vue:450`, `:462-463`, `:482`, `:121`;
   `StudioCast.vue:206`, `:817`; `PersonaEditorView.vue:979`, `:1252`, `:1293`; `VoicesView.vue:860`);
   no speaker in a cell (`StudioRenderChapter.vue:588`, `:643`; `StudioScriptChapter.vue:162`, `:713`,
   `:720`, `:723`); project kinds (`App.vue:110-112`, `activeProject.js:23-25`, `HomeView.vue:153-155`,
   `:233-234`, `StudioOverview.vue:84-86`, `ProjectsView.vue:63-81`, `NewProjectModal.vue:36`, `:52`);
   chapter word (`HomeView.vue:153-155` vs `copy.js:32`, `:37`; `ProjectsView.vue:227`); mastering
   (`StudioOverview.vue:103`, `ExportPanel.vue:172`, `:208`, `App.vue:561`, `StudioView.vue:454`);
   *ready* (`StudioRenderChapter.vue:179`, `HomeView.vue:453`, `ExportPanel.vue:159` vs
   `StudioRender.vue:215`); *Spoken by* (`StudioRenderChapter.vue:640`, `PersonaDesignMaker.vue:227`);
   what a persona is (`PersonasView.vue:429`, `StudioCast.vue:795`, `App.vue:57`, `HomeView.vue:269`);
   empty filters (`StudioCast.vue:808` vs `PersonasView.vue:504`).

Mock mirrors: `MockPersonaEditorView.vue` (135, 143-146, 204, 217, 359-360, 861), `mockMakers.js`
(59-64), `MockDesignMaker.vue` (72), `MockBlendMaker.vue` (40, 61), `MockRenderChapterView.vue` (262,
576, 589), `MockRenderGrid.vue` (135-136, 183-184), `MockPersonasView.vue` (340, 359, 378).
