# The Personas redesign — design check before any code

**Status:** research in progress (2026-10-03). No code until the review in this doc is shown and
approved. Tracker: docs/dev/TASKS.md, FINDING "a persona's pace, pitch and gain can't be edited
anywhere in the app".

## 1. What is decided

- **Order** (2026-10-03): "we need to do the persona first that is before slice 4, why do you keep
  forgeting this?" — the Personas work comes before Studio Slice 4 (D8 in
  `2026-09-30-mock-vs-app-and-slice-4.md` answered).
- **Scope** (2026-10-03): "whole redesign per mock" — the Personas index (mock `_s9`) and the persona
  editor (mock `workbench` / `_s7`), carrying "Voice gender in every voice dropdown, and speaker
  pronouns" (`2026-09-30-voice-gender-and-pronouns.md`).
- **The check asked for first** (2026-10-03): "did we rethink on the persona to make sure we have it
  designed correctly whihc it changing options on engine nad model selection, think on the desing
  nad make sure it is correct and accounts for voice desing clone, regular and models that take
  direction like qwen and thos that take workds like chatterbox, think on it several times".
- **Save it** (2026-10-03): "make sure yyou save thsi info i thought we have already run these
  checks".

## 2. The facts (being gathered)

Four read-only research passes, each with file:line citations:
- 2.1 what the mock says a persona is and how its editor behaves — **done, below**;
- 2.2 what a persona is in the code today and which fields reach the audio;
- 2.3 what each engine and each model accepts (voice kinds, direction text, word tags, knobs,
  language, lexicon);
- 2.4 every earlier ruling that constrains the redesign, and whether an earlier design check
  already covered engine- and model-dependent options.

### 2.1 The mock (docs/plans/mock/) — what it says a persona is

Citations are to the source stashes (`build_mock.py` assembles them into `workbench-mock.html`;
`_s9` = built 1888–1971 and `_s7` = built 2069–2167, byte-identical). Routes: `personas` =
`_s9`, `workbench` (the editor) = `_s7`, `cast` = `_s3`, `voices` = `_s6`, `newvoice` = `_s8`,
`engines` = `_s13` (`build_mock.py:225-245`).

**What a persona is, in the mock's own words**
- Library-level: "A persona is library-level, so these act everywhere she is used — not just in
  the project you came from. Deleting refuses while she still has lines." (`_interactions.py:123-124`)
- Shared: "Two speakers can share one persona — change it once and both change." (`_s3:126-127`)
- Contents: "Pace, pitch, gain, delivery, effects — all of it lives there." (`_s3:68-69`)
- A voice is raw: "A voice is raw. Pick it inside a persona's voice picker, or make a new persona
  from it." (`_s6:31…77`)
- **The voice fixes the engine:** "You choose an engine once, when you cast a persona to a voice.
  From then on it decides three things for every line that persona speaks: whether you can
  **clone** their timbre, whether they can be **directed in words**, and whether a per-line
  **emotion** reaches the model. Nothing else in the app can put back what the engine doesn't
  do." (`_s13:9-13`)
- A scene stacks and never overwrites: "it takes words and effects but no numbers and no emotion:
  those would have to overwrite each persona's" (`_s12:16-19`).
- Effects: "The persona's chain runs first, then the scene's on top" (`_s11:4-5`).
- Lexicon: "A persona-scoped lexicon adds its own words on that persona's lines" (`_s10:28-30`).
- The one design rule in the mock's CSS (`build_mock.py:72-74`): "A control the current voice
  cannot honour is shown, disabled, with its reason — never hidden, or the user cannot tell the
  difference between "off" and "absent"."

**Personas index (`_s9`)**
- Toolbar: search "Search personas…"; engine filter "All engines / qwen3 (2) / kokoro (2) /
  chatterbox (2)"; usage filter "All / In use / Unused"; "New persona" (`:6-12`).
- Columns: ▶ · "Persona" · "Built on" · "Engine" · "Can be directed" · "Shaped" · "Used by" · ⋯
  (`:18-20`). Rows, for example: June "Sohee *preset*" · "qwen3 CV" · "✓ written direction" ·
  "1.05× · −1.0 dB · 2 effects"; Marius "Marius *clone*" · "chatterbox Turbo" · "✓ 19 tags · ✗
  prose"; Narrator (warm) "Heart *preset*" · "kokoro" · "✗ numbers only" (`:22-80`).
- ⋯ menu: "✏️ Rename" ("the name changes everywhere she speaks"), "🔗 Merge into…" ("her lines
  move across"), "🗑 Delete" ("delete refuses while she is cast") (`_interactions.py:116-127`).
- Not drawn: an empty state, a gender column, sorting, bulk actions.

**Persona editor (`_s7`)**
- Header: "Personas › June"; pill "Sohee · **qwen3 CustomVoice**"; "used by **1 speaker**"; banner
  "**Qwen3 isn't loaded.** The first listen swaps it in — about a minute." (`:1-7`)
- **Voice** card: kind radios "Built-in" / "Clone from audio" / "Design from words ⤓" (disabled:
  "Needs the Qwen3 VoiceDesign model. Install it on the AI page.") / "Blend" / "Trained LoRA"
  (`:13-18`; the radios only move a highlight). One voice select whose options carry engine and
  model ("Sohee — qwen3 CustomVoice · ko", "Heart — kokoro · en-US", "Marius — chatterbox Turbo ·
  cloned", `:19-24`). "▶ Raw". Banner on change: "Changing this makes June's **61 lines** stale.
  **18 carry a written direction** — only Qwen3 CustomVoice reads prose." (`:26-27`)
- **Hear it**: a line textarea, "▶ Listen", "↻ Stock line", "⤓ WAV", a player (`:29-36`).
- **How it speaks**: Pace 0.5–2 × (1.05), Pitch −12…12 st, Gain −12…12 dB, Pause before → after ms;
  **Standing delivery** tagged "✓ qwen3", "Clipped, world-weary. Dry wit. Boston accent under
  stress.", helper "A line's own direction is appended to this."; Effects tags + "＋ Edit"
  (`:38-54`).
- **Sampling**, subtitled "qwen3": Temperature, Top k, Top p, Repetition penalty, Seed + 🎲,
  "⚖️ Compare settings…" (`:56-69`).
- **Save**: "💾 Save" ("Saved. 61 lines are now stale."), a name box + "＋ Save as new" ("Saved as a
  new persona. June is untouched."), "🔀 Blend", "🧪 Train a LoRA" (`:71-78`). No Cancel/Revert,
  no unsaved-changes mark.
- Right column: a summary; **This engine** card "✓ written direction", "✓ 10 languages", "✗
  cloning", "✗ inline tags", "✓ seed", "Compare engines →"; **Used by** "Open Cast →" (`:82-96`).
- **No engine selector and no model selector** — the engine and model come from the chosen voice.
  No language field, no word-tag control, no exaggeration / CFG, no lexicon link, no gender, no
  description ("Who they are" is the speaker's, in Cast `_s3:64-66`).

**Elsewhere**
- Render (`_s4`): direction column "How it's said"; Kokoro's cell disabled, "kokoro takes no
  direction"; June's placeholder "as June always speaks"; Marius's cell shows "[fear]"
  "[dramatic]" chips (Turbo tags); "Override for this line only" Pace / Pitch / Gain / Pause after.
- Tags modal (`_interactions.py:130-157`): "Emotion" — Turbo's own 7 (angry, fear, happy,
  sarcastic, surprised, crying, whispering); "Register" (narration, dramatic, advertisement);
  "Non-verbal sounds — [sigh], [laugh] — … go at a point *inside* the sentence, so you insert
  them in the line's text."; "Turbo only. Chatterbox Multilingual reads these as words."
- Scene (`_s12:31`): "**Only Qwen3 CustomVoice reads the direction.** For a persona on Kokoro, a
  clone, or Chatterbox Multilingual it does nothing".
- New voice (`_s8`): "A clone … always **loses written direction** … Chatterbox Turbo still takes
  a per-line emotion; the others take neither." (`:12-14`); Blend "Same engine family only."
- Engines (`_s13:34-94`) is the only capability table: per variant, Clones / Per-line direction
  ("✓ prose + emotion" CustomVoice and VoiceDesign, "none — drops it" Base, "✓ emotion only"
  Turbo, "none" Multilingual) / Languages.
- **The mock has no capability data or show/hide logic at all** — every capability fact is static
  HTML; the editor is drawn only for a Qwen3 CustomVoice persona.

**Where the mock is silent** (the design must answer these)
1. Choosing a model per persona (1.7B vs 0.6B, Turbo vs Multilingual) — never drawn.
2. Sampling / Standing delivery for a non-Qwen voice — never drawn (disabled with a reason, by the
   CSS rule, but not shown); exaggeration and CFG appear nowhere.
3. A persona default emotion for Chatterbox Turbo — emotion exists only per line.
4. What "19 tags" are — never listed.
5. What the Clone / Blend / Design cards show once picked — never drawn.
6. Persona language — no field (June is built on a Korean voice and speaks English lines).
7. A new, blank persona — "New persona" opens the populated June.
8. States: Cancel/Revert, unsaved, render error, voice deleted, engine not installed, empty index.
9. Precedence between duplicates: persona Pitch vs the Pitch-shift effect, persona Gain vs the
   Gain effect, persona pauses vs per-line pause and chapter gaps, persona seed vs take seeds.
10. "Make a new persona from it" (Voices) — no such action drawn.

**Where the mock contradicts itself or the code**
- Three vocabularies for direction ("✓ written direction / ✓ 19 tags · ✗ prose / ✗ numbers only";
  "✓ written / 19 tags / ✗ none"; "✓ prose + emotion / ✓ emotion only / none") and three for the
  voice kind ("preset / clone"; "built-in / cloned"; "Built-in / Clone from audio / Design from
  words / Blend / Trained LoRA").
- "Only Qwen3 CustomVoice reads prose" vs VoiceDesign "✓ prose + emotion" (`_s13:71`).
- "You choose an engine once" (`_s13:9`) vs the editor changing the voice (and engine) any time.
- Stale against the code: "Trained LoRA" / "Train a LoRA" (training removed 2026-10-02); the
  mock's engines are Kokoro, Qwen3, Chatterbox, LuxTTS, Whisper — the app has kokoro, kitten,
  pocket, qwen3, chatterbox, voxcpm2, asr (no LuxTTS; Kitten, Pocket, VoxCPM2 missing from the
  mock).
- Smaller: June's effects (reverb + eq vs EQ + Compressor with reverb from the scene), usage counts
  (115 lines in 2 projects vs 61 lines, 1 speaker), Mara's clone missing from Voices, design
  commentary left in `_s8:3-7, 22-24`.

## 3. The design passes

To come — each pass takes a new angle (the items; their interactions; my own claims; the checker;
the neighbours not touched).

## 4. Questions for the user

To come.
