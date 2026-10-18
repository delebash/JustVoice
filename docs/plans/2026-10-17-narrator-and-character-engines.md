# The narrator stays on VoxCPM2, the characters move to BreezeTTS 2 (plan, for a go)

TASKS "The character voices: BreezeTTS 2, with its licence on the run's card" (go given 2026-10-16,
waiting on round 5's narrator sample) and TASKS "Round 6b" (2026-10-17: "Narrator: VoxCPM2 narrates,
and Breeze does only the character voices? … Lean: yes" — the user: "think on it again your rec
go"). **Built 2026-10-18** (§5), on the user's "compacted re read docs rules session your rec on
all go" — the leans of §4 as written.

## 1. What it is

The one-click run designs a voice for every speaker in the book, the narrator included, and keeps
each one on a single model: `book_voices.clone_model`, VoxCPM2 today. Your ears decided two things:
- **The characters:** BreezeTTS 2 gave the full feeling on 9 of 13 lines (round 5).
- **The narrator:** VoxCPM2 read better on 9 of 10 passages. You'd let it narrate a whole book as
  it is, and Breeze's copy only "with fixes".

So the run needs **two models**: one for the characters and one for the narrator. Today there is
one setting for both: `makeVoices` keeps every voice on `clone_model`, the narrator included
(`book_voices/index.js:188, 359`). This plan adds the narrator's own setting, switches the
characters to Breeze, and adds the licence word and the stop the earlier go asked for.

**What you will see:**
- **The run's card.** The design step's "Runs on" names both models, and Breeze's licence word
  appears before you start.
- **The stop.** If Breeze's licence hasn't been accepted on this machine, the run doesn't start,
  and a link takes you to accept it.
- **The books.** Narration sounds as it does today; the characters' voices are Breeze copies of
  their designed takes.

## 2. The pieces

| # | Piece | Follows |
|---|---|---|
| N1 | **A setting for the narrator's model**, seeded `voxcpm2`, beside `clone_model` in `BookVoicesSettings` (`models.js:559`). | The existing `clone_model` and `design_model` settings (family rule: values a user might change live in the database). |
| N2 | **`clone_model` seeded to Breeze** (`breeze_tts`). | The setting as it is; only its seed changes. |
| N3 | **`makeVoices` keeps the narrator's voice on N1** and everyone else's on `clone_model` (`book_voices/index.js:359`, which knows the narrator at `:320`). The check that the model can clone and take direction (`:267-276`) runs for both models. | Existing code, one branch added. |
| N4 | **The run's card names both models**: the design step's model text (`book_run.js:365`) and the run log (`:867`). | Existing code. |
| N5 | **The licence word on the card.** The word is the model's `commercial` fact (`curated/breeze_tts.js:22`, "Separate licence"), shown with the classes the engines page already uses (`engineFacts.js:36, :45`). | The engines page's own display (`SpeechEnginesTab.vue:1033`). |
| N6 | **The stop before the run.** `planRun` (`book_run.js:381`) adds a problem when a model the run needs has terms that aren't accepted (`slot.termsAccepted`, `slot.js:390`). The card shows it like its other problems (`bookRun.js:144`), with a link to the engine's terms (`openEngineTerms`, `engineTerms.js:17`). | The card's existing problem list and the engines page's terms dialog. |
| N7 | **Tests and docs** below, in the same change. | The docs law. |

## 3. Blast radius (pasted, from a read-only sweep)

**Every reader and writer of the setting:**
```
server\src\models.js:559:  clone_model: opt(T.String(), "voxcpm2"),
server\src\models.js:597:  book_voices: optModel(BookVoicesSettings),
server\src\models.js:618:  book_voices: opt(nullable(BookVoicesSettings), null),
server\src\book_voices\index.js:267:  const cloneEngine = vmod.engineOfModel(cfg.clone_model);
server\src\book_voices\index.js:269:  if (cloneEngine === null || !vmod.can(cfg.clone_model, "clone") || (directed !== vmod.WORDS && directed !== vmod.TAGS)) {
server\src\book_voices\index.js:276:    [cloneEngine, cfg.clone_model],
server\src\book_voices\index.js:359:      const saved = await vp.savePreview(heard.previewId, { name: personaName, gender: genderOf(d.gender), model: cfg.clone_model });
server\src\book_voices\index.js:381:  log.info(`book_voices: ... on ${cfg.design_model} → ${cfg.clone_model} ...`);
server\src\book_run.js:365:  out.design = { model: `${name(cfg.design_model)} → ${name(cfg.clone_model)}` };
server\src\book_run.js:867:    log.info(`book run ${ctx.runId}: ... ${settings.design_model} → ${settings.clone_model}`);
```
**Where the narrator joins the speakers:**
```
server\src\book_voices\index.js:158:    else if (isNarrator) narrator = { speaker: s, lines };
server\src\book_voices\index.js:188:  const everyone = narrator ? [...targets, narrator] : targets;
server\src\book_voices\index.js:320:    const narrator = speaker.role_label === "narrator";
server\src\book_run.js:826:    st.narrator_lines = addNarrator(h, ctx.projectId);
```
**Licence acceptance today:** recorded at `engines.engine_overrides[id].terms_accepted_at`
(`models.js:418`), checked by `slot.termsAccepted` (`slot.js:390`) and
`engines_api._termsAccepted` (`engines_api.js:104`). Breeze's terms gate only its download
(`generated.js:934`, `gates: "download"`), so the stop before a run is new.

**Tests that assert on today's model:**
```
server\tests\book_voices.test.js:112:  expect([s.min_lines, s.design_model, s.clone_model]).toEqual([3, "qwen3-vd", "voxcpm2"]);
server\tests\book_voices.test.js:123:  expect(r.json().settings.book_voices.clone_model).toBe("voxcpm2");
server\tests\book_voices.test.js:293:  expect([voice.engine, voice.model, voice.source, voice.name, voice.gender]).toEqual(["voxcpm2", "voxcpm2", "designed", "Hatter", "male"]);
server\tests\book_voices.test.js:373:  await c.patch("/v1/settings", { json: { book_voices: { clone_model: "voxcpm2", design_model: "voxcpm2" } } });
server\tests\book_run.test.js:185:  expect(before.plan.steps.find((s) => s.key === "design").model).toBe("Qwen3-TTS VoiceDesign → VoxCPM2");
src\components\BookRunCard.test.js:71:  expect(cells(6)).toEqual(["Design the voices", "Qwen3-TTS VoiceDesign → VoxCPM2"]);
src\services\mock\bookRunMock.js:76:    const model = { design: "Qwen3-TTS VoiceDesign → VoxCPM2", check: "Qwen3-ASR 1.7B" }[key] ?? null;
src\services\mock\bookRunMock.js:120:  design: ["Qwen3-TTS VoiceDesign → VoxCPM2", null],
```
**User docs that name the model:** `docs/ai-features.md:626, 668`, `docs/settings-reference.md:23`,
`docs/studio.md:122`, `docs/personas.md:746`, `docs/engines.md:585`, `docs/whats-new.md:60`;
`docs/dev/code-map.md:1156`.

**Data deleted or overwritten:** none. Voices already made stay on their models; only new runs
change. A user's own `clone_model` setting, if changed, is kept: the new seed reaches only a reset
database (no migrations, the 2026-08 ruling).

## 4. Open questions (each needs your word; labels are yours)

1. **The setting's name:** `narrator_model`? **Lean:** yes, beside `clone_model` and `design_model`.
2. **The card's design-step text:** "Qwen3-TTS VoiceDesign → BreezeTTS 2 · narrator VoxCPM2"?
   **Lean:** yes.
3. **The licence word on the card:** Breeze's own fact, "Commercial use: Separate licence", as the
   engines page shows it? **Lean:** yes, the same words as the engines page.
4. **The stop's text:** "BreezeTTS 2's licence isn't accepted on this computer. Accept it to make
   the character voices." with the link "BreezeTTS 2's licence ➜"? **Lean:** yes.
5. **Speed:** Breeze is about two and a half times as slow as VoxCPM2 (4.5 s a take on the card
   against 1.8 s, RESEARCH §10.29). Is that fine for every character line? **Lean:** yes. Your ears
   picked it.

## 5. Built (2026-10-18)

- **N1–N3:** `book_voices.narrator_model` (seed `voxcpm2`) beside `clone_model` (seed now
  `breeze_tts`) in `BookVoicesSettings` (`server/src/models.js`); `makeVoices` keeps the narrator's
  take on it (`server/src/book_voices/index.js`), and `checkedModels` holds both models to "clones
  and takes direction", naming the setting that fails.
- **N4–N5:** the plan's design step reads "Qwen3-TTS VoiceDesign → BreezeTTS 2 · narrator VoxCPM2"
  (the narrator unsaid when it shares the characters' model) and carries `licences`: each model it
  runs on whose licence isn't a plain "Yes", in the Speech engines list's words (`engineFacts`).
  The card shows each as that list's chip (`.ev-lic`, `licClass`, `licTitle`) beside the model, at
  both widths (`src/components/BookRunCard.vue`). The run log names the narrator's model.
- **N6:** `planRun` stops a run when the characters' model's terms aren't accepted here (problem
  `terms`, with `engine` and `name`; `server/src/book_run.js`). The card's words and link are
  `problemWords` (`src/services/bookRun.js`); the link opens the engine's licence through
  `openEngineTerms`, and accepting it reloads the plan (`jv:health-refresh`,
  `src/components/StudioBookRun.vue`). Only the characters' model is stopped on: the approved words
  name the character voices, and today's narrator and design seeds are both "Yes".
- **Swaps checked first:** two models in a chapter don't swap line by line — the scheduler renders a
  chapter model by model (`synth_scheduler.js:166`, keyed by model at `voice_model.js:379`).
- **N7:** tests (`book_voices.test.js`, `book_run.test.js` — a new one for the licence word and
  the stop; `BookRunCard.test.js` — the chip and the link), the mock (`bookRunMock.js`: the text,
  the chip, the stop in the blocked state), docs (ai-features, studio, personas,
  settings-reference, whats-new, code-map). Suites: server 1,360 passed, unit 260 passed; lint and
  the family guard clean.
