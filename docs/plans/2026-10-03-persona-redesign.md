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

### 2.2 The code today — what a persona is and what reaches the audio

(Read-only research pass, 2026-10-03; file:line relative to the repo. The claims the design leans
on are re-checked in §3's "my own claims" pass.)

**The model** (`models.py:573-613`; table `personas`, `database/models.py:83-129`): id, name,
voice_id (plain string, no FK), language (default "en"), avatar_path, **voice_instruct** ("the ONE
field that changes the audio"), note (replaced `personality` 2026-09-29; never reaches an engine),
**default_delivery** (an untyped dict, not validated against `Delivery`), effects_chain,
lexicon_id, **engine_override**, llm_rewrite_enabled / llm_model (legacy; accepted, never stored),
imported_from / imported_id, timestamps. `Delivery` (`models.py:1199-1224`): speed, emotion (9
values), pitch, pause_before, pause_after, gain_db, instruct, temperature, seed, and `engine: dict`
for engine-private knobs (style_prompt deleted 2026-08-17). `persona_channels` exists with an API
and a renderer service, used by nothing. `RenderPreset.voice_id` points at personas, read by
nothing.

**The API** (`api/personas_api.py`): list, usage, usage-detail, create, get, put, delete (speakers
SET NULL), compose and rewrite (need a note). Validation: name unique only — nothing checks the
voice exists, voice/engine compatibility, engine_override, or the delivery shape. **PUT trap:**
`PersonaStore.update` drops `None` values (`storage/personas.py:225-233`), so omitting
default_delivery / effects_chain wipes them, omitting language resets it to "en", and sending
`null` for a text field leaves it unchanged.

**The editor** (`src/views/PersonasView.vue`): editable — name, language (free text), note, avatar
path (shown nowhere), voice (every voice of every engine, no compatibility filter), engine
override (every engine), lexicon, spoken delivery (`voice_instruct`), effects. **Default delivery
can't be set at all**: "+ Edit" only toasts "Tune … on the Generate tab, then save as the persona
default" (`:436-442`), and no such save exists; `VoiceParamsModal.vue` is orphaned. **Bug:
clearing a field does nothing** — `x || null` (`:321-327`) meets the store's skip-None, so emptying
Spoken delivery, Note, Engine override or Lexicon keeps the old value while it toasts "Persona
saved". The ✓/✗ "takes direction" verdict (`:196-215`) is wrong twice: a VoxCPM2 clone gets ✗
(slot sends instruct on clones, `slot.py:613-629`); a Qwen3 designed voice with a kept clip gets ✓
(it renders on Base, which drops instruct, `slot.py:520-533`). Stale copy: "Slice 7 builds the
editor", "Qwen3 is the only engine that takes instructions".

**Four render paths, four different persona behaviours**
- **A · Studio Render** (`render_chapter_api.py`; also M4B export, ACX QC): persona via block →
  speaker; delivery = merge(preset > request > persona `default_delivery`) (`delivery_merge.py
  :131-169`; the documented "Tier 1 engine defaults" is not implemented); instruct = designed-voice
  description (clip-less only) + (delivery.instruct OR voice_instruct) + emotion + block.direction,
  joined ". " (`delivery_merge.py:34-57`); effects persona then preset; lexicons book then persona;
  **no language, no seed** (`ChapterLine`, `:256-266`).
- **B · single-block render** (Lines ↻, Re-render changed, game voiceline export —
  `export_voicelines.py:130-170`): raw `default_delivery` (no merge, flat engine knobs dropped);
  **drops voice_instruct, direction, emotion→instruct and the design description** — a clip-less
  designed voice fails outright (`slot.py:516-518, 619-621`); writes the same cache scope as A
  with a different delivery.
- **C · old Chapters page regenerate** (`ChapterView.vue:304-381`): the voice and the project
  lexicon only; the audio is discarded, yet it toasts "regenerated".
- **D · Generate** (`generate_api.py`; also MCP speak and the Voices audition): **ignores the
  persona's voice** (the voice is Generate's own pick); merges default_delivery; instruct without
  line direction; no Turbo emotion tag.

**What each persona field reaches** (slot = `to_speech_request`, `slot.py:462-639`)
| Field | Reaches |
|---|---|
| voice | A, B, C, MCP — not Generate. Clip → `audio_prompt_path` + `ref_text` + `xvector_only`; blend → `voice_vector` (`render_core.py:230-266`) |
| voice_instruct | A and D only. Qwen3 CustomVoice `options.instruct`; Qwen3 VoiceDesign after the description; VoxCPM2 `(…)` prefix on clones AND designs. Dropped: Qwen3 Base, Kokoro, Kitten, Pocket, Chatterbox, Turbo/Nano |
| speed | native on Kokoro/Kitten; every other engine a server time-stretch 0.5–2.0 (`render_core.py:410-438`) — A, B, D |
| pitch | server pitch-shift ±12 st on every engine — A, B, D |
| gain_db | server gain −24…+12 on every engine — A, B, D |
| pause_before / after | A only, at join time (`render_core.py:926-933`) |
| temperature | Qwen3, Chatterbox, Turbo; ignored by Kokoro, Kitten, Pocket, VoxCPM2 |
| emotion | folded into instruct (A, D) → Qwen3 CustomVoice / VoiceDesign, VoxCPM2; a Turbo `[tag]` (A, B). **No UI sets emotion on a persona or a line** — only Generate's picker |
| seed | only Generate's managed path; dead in A and B |
| engine knobs | Qwen3 talker_top_k / top_p / repetition_penalty / temperature; Chatterbox exaggeration, cfg_weight, repetition_penalty, top_p; Turbo repetition_penalty, top_p, top_k; VoxCPM2 cfg_value, inference_timesteps — A and D |
| effects | A, B, D |
| lexicon | A and B server-side; Generate via the client; not C or MCP. `Lexicon.persona_id` never read |
| **language** | **dead in every render path but MCP speak** — Qwen3 is told "English" (`slot.py:506`), Chatterbox "en" (`:573`); the voice's language isn't passed either (only auditions read it) |
| **engine_override** | **dead** — the engine always comes from the voice (`render_core.py:53-76`); Cast even shows it as the engine (`StudioCast.vue:68`) |
| note | Compose / Rewrite / Smart-assign only |
Project export writes no default_delivery or effects_chain for personas (`project_export_api.py
:131-147`).

**Voices** (`models.py:454-514`): kinds preset, cloned, designed, imported, blended ("lora"
removed). A stored voice has engine (fixed at creation), source, name, language, gender,
design_prompt, transcript, xvector_only, blend_recipe, embedding — no effects, channel, age, accent
or tone. A designed voice saved from an audition is frozen (its preview becomes `ref.wav`); "clip
wins" — a designed voice with a clip renders as a clone (`render_core.py:79-125`). The `Voice` DTO
can't tell a kept-clip designed voice apart. The server never checks an engine can clone or design.
Per engine: Kokoro presets + blends (blends only Kokoro, `voice_pack`); Qwen3 preset → CustomVoice,
clip → Base (needs transcript or x-vector-only), clip-less design → VoiceDesign; Kitten presets
(unknown → "Leo"); Pocket clip (terms) or preset (unknown → "alba"), line language must match the
model; Chatterbox Multilingual clip required; Turbo / Nano clip required, English only; VoxCPM2 clip
or instruct required. Only path A checks the loaded checkpoint matches the voices up front.

**Cast** (`StudioCast.vue`): click a persona to cast, click again to uncast; new speakers auto-cast
by unique name; Smart-assign; Clear cast; Add Narrator. "Pace, pitch, gain, delivery, effects — all
of it lives there" (`:598-601`) — untrue today. ▶ plays the bare voice, not the persona. Its
"directed" tag has the editor's wrong heuristic and reads engine_override.

**Docs vs code**: `docs/personas.md` promises engine override works (dead), default delivery is
settable (not), "everything reaches the synthesizer" (not on B/C, not language), "only Qwen3 reads
it" (VoxCPM2 too), undo restores (cast isn't). `docs/voices.md` claims voices carry effects,
channel, age/accent/tone (they don't), misses VoxCPM2 / Turbo / Nano cloning and VoxCPM2 design,
says clones take no direction (VoxCPM2 does), "Chatterbox has no speed control" (server
time-stretch since gap 8).

### 2.4 Earlier rulings, and whether this check was run before

(Read-only research pass over TASKS, design-decisions, IDEAS and the plans, 2026-10-03. User
quotes exact, typos kept.)

**Was this check run before? Partly — on 2026-08-17, under premises that have since moved.**
`2026-08-15-voice-workflow-redesign.md` §10 "where the knobs live" (`:2652-2792`) answered the
user's question "…does persona get all the knobs and settings and you test it there then assign
that persona, the knobs settings ect depend on engine, can the same persona speak in different
voices like one sentence is cheerful next same person but angry…" with three layers (voice,
persona, line): "the persona should hold only what survives a recast"; "engine-specific knobs
belong to the casting"; `engine_override` flagged as "a persona reaching past its instrument"
(`:2746-2748`). It was discussed, not built, and two calls were left open (§10.7: a
`blocks.emotion` column; Generate absorbed or deleted). Since then: the 2026-09-29 split made the
persona the finished spoken voice including engine and pitch; the audio.cpp switch replaced the
engines (Kitten, Pocket, VoxCPM2 added; LuxTTS gone; Turbo / Nano back); training was removed;
speed became host-side on every engine (gap 8); VoxCPM2 clones take direction. TASKS' engine
override finding (2026-10-02) defers to "the model pin the persona review will propose" — **that
review exists nowhere in writing.** So the engine-and-model question was never designed against
today's app.

**The rulings that bind the redesign** (chronological; full citations in the research notes)
- 2026-06 (archived, still true): "No automatic LLM rewrite at render. Manuscript words are
  sacred." (`design-decisions.md:119-129`).
- 2026-08-15: personas are the reusable entity ("i think i like havibng it as a persona for reuse
  as a saved persona"); Kokoro never clones ("kokoro does not do cloning"); English clones go to
  Turbo, other languages to Multilingual ("language branch might be better"); "dont take easy way
  out just becuase we have something coded". Field split built: `voice_instruct` is the only text
  that reaches the synth; `bio` deleted. **Two binding constraints:** "but i do want a voice
  tuning page this is part of creating a new voice for a persona to consume" (do not remove voice
  tuning from the voice); "damint we want a voice designer we have qwen and other tts that do that
  why would you drop it" (keep the Voice Designer). The cast surface must scale to 50–500 game
  NPCs ("jv is not just pipeline for book … that is why we have project types").
- 2026-08-15/16 (walking the mock): tuning in two places, not four ("again i am confused we have
  tunning on 4 different places chapter cast workbench persona, why" → "yes"); the line's numbers
  collapse into a closed "⚙ Override the numbers for this line" hatch, direction (words) is the
  per-line tool; never "character"; Script does one thing only.
- 2026-08-17: style_prompt deleted; emotion is the cross-engine direction control ("go and wire
  emotion"); NOT mapping `sad`→`[crying]`; the composition order is fixed: persona
  `voice_instruct` → emotion → line direction, most specific last, an explicit preset / request
  instruct taking the base slot. The persona-vs-voice argument (§8.22): a persona earns its place
  by surviving a recast. **Open since then:** "can a character's persona vary by scene, or is it
  one per character?" — "i dont know yet" ("Nothing may assume either answer").
- 2026-08-19/21: voice acquisition — Cloned · Designed · Imported · Blended (· Trained, now gone),
  "NOT a Preset tab"; blend strategies reinstated ("no it wasnt you decided that…"), Kokoro only;
  imports pick "Model that speaks as this clip".
- 2026-08-22: designed voices "same as alexandria" — frozen (Designer → save → clone) and dynamic
  (per-line design) both kept; clip wins; a clip-less design composes its description FIRST, then
  `voice_instruct`, emotion, line direction; a mixed Qwen3-variant cast is refused before render.
- 2026-09-27: presets die ("2 presets die"; NOT "Render presets, in any form") — the excision
  (Slice 5) and removing the preset delivery tier (item K, which still wins the merge) have no go.
- 2026-09-29: no built-in personas; **the split** — "a voice is all tied to a persona you set voice
  pitch engine in persona … a persona is the actual spoken voice adjusted with pitch speed and
  other settings"; "i think persona is the single point for an actual spoken voice that is then
  assigned to cast"; "the mock already has it correct, persona on right, cast on left assign cast a
  persona". Persona = voice + engine + speed, pitch, gain, direction, effects, lexicon, note;
  speaker = a person in one book; one persona plays many speakers; render goes line → speaker →
  persona → voice. Persona names unique across the library. Unknown `[word]` tags are dropped at
  render.
- 2026-09-30: book lexicon first, then the persona's; gender and pronouns with this redesign —
  personas get NO gender field, speakers get Pronouns.
- 2026-10-01/02: the four persona findings open (language, seed, engine override, unsettable
  pace/pitch/gain); training removed; speed on every engine (gap 8).
- 2026-10-03: "Skip the words" stored on the voice; Turbo / Nano clone again; personas before
  Slice 4; the whole redesign per the mock.

**Conflicts a redesign must not inherit silently**
1. `2026-08-17-voice-model.md` claims to win over the redesign doc, but no user approval of it is
   recorded and several of its "decided" items contradict TASKS or the code (emotion "deleted" —
   it is wired; per-scene "not a question" — still open; "knobs all on the persona" vs the
   unrevoked "voice tuning page" constraint, which the 09-29 words partly answer — **ask**).
2. "No per-line voice override" was proposed, never ruled.
3. "A cast row IS a persona" is void since the split.
4. The mock vs built rulings: no lexicon / note / language field in `_s7`; "Trained LoRA"; delete
   "refuses while she is cast" (built: delete uncasts); "Merge into… her lines move across"
   (lines point at speakers now).
5. Moved facts: speed is host-side; VoxCPM2 clones take direction; training gone; Kitten, Pocket,
   VoxCPM2 added; Qwen3 CustomVoice 0.6B takes instruct in audio.cpp (not checked by ear).

**Open questions on record that touch personas**
1. The design check itself (2026-10-03).
2. Can a persona vary by scene? ("i dont know yet")
3. Slice 4 D2 / D3 / D6: "Spoken by" per line; where the per-line number override is stored; the
   scene layer vs presets.
4. Language: which wins — persona, voice or book?
5. Seed: resolve the delivery's seed into the line's seed.
6. Engine override: remove it, or replace it with a model pin (the review never written).
7. Frozen designed voices still say "✓ takes direction" — expose `has_ref_clip`?
8. A `blocks.emotion` column (per-line emotion is not built).
9. Generate: absorbed or deleted?
10. The workbench knob panel vs voice tuning on the voice ("argued, not ruled").
11. Gender / pronouns: two checks, then a plan.
12. Cast on Overview ("3 not sure"); lexicon previews and IPA; the designed-voice seed ear test;
    auto variant swap; MCP speak and `voice_instruct`; "Copy a cast"; the 09-29 offered Cast
    additions — none ruled.

## 3. The design passes

To come — each pass takes a new angle (the items; their interactions; my own claims; the checker;
the neighbours not touched).

## 4. Questions for the user

To come.
