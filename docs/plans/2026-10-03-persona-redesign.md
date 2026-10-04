# The Personas redesign — design check before any code

**Status:** review in progress (2026-10-03). No code until the review in this doc is shown and
approved. Tracker: docs/dev/TASKS.md, FINDING "a persona's pace, pitch and gain can't be edited
anywhere in the app".

**Read §5 first.** It corrects §3 and §4 (the user: "we did the mock on purpos and you are ignoring
it"), records a second review of the mock, and holds the open questions. §2 holds the facts — don't
redo that research; re-check only a cited line you are about to rely on.

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

### 2.3 What each engine and model accepts, and what the app sends

(Read-only research pass, 2026-10-03, on the dev build — every feature on. slot =
`engines/audiocpp/slot.py`, cap = `engines/capability_details.py`, rc = `render_core.py`.)

**How capabilities are keyed.** `CAPABILITY_DETAILS` is keyed by engine id (kokoro, kitten,
pocket, chatterbox, qwen3, voxcpm2) or family id (chatterbox-multilingual / -turbo / -nano,
qwen3-cv / -base / -vd) — never by size or precision; `lookup()` cuts `-suffix`es (`cap:435-455`;
latent bug: `qwen3-asr-…` walks down to the Qwen3-TTS row). **A stored voice carries an engine
but no model; a persona carries neither.** Tags, knobs and the Generate page follow whichever
model is LOADED, not the voice being spoken (`rc:287-309`, `GenerateView.vue:123`) — a voice
cloned for Turbo, rendered while Multilingual is loaded, loses its tags and gets other knobs. The
Qwen3 mixed-model check runs for chapter renders only.

**Shared plumbing (every engine)**: speed native on Kokoro/Kitten, a server time-stretch 0.5–2.0
on the rest; pitch ±12 st and gain −24…+12 dB on the server; pauses at chapter joins only;
**seed dropped in chapter renders** (ChapterLine has none); **language sent by no render** (only
auditions, direct-mode lines, MCP); instruct composed for every engine (design description +
persona/preset instruct + emotion + line direction) and then used or dropped per model; emotion
becomes a `[tag]` only on Turbo/Nano; inline tags kept only where the rendering model lists them;
respellings everywhere, IPA only on Kokoro.

**Per model**
| Model | Voices it can speak | Direction (words) | Word tags | Knobs it reads (besides pace/pitch/gain, done on the server) | Language |
|---|---|---|---|---|---|
| Kokoro 82M | 54 presets (9 languages); blends (4 strategies, `voice_pack`) | — | stripped | speed (native), seed (repeatable) | from the code or the voice; ja needs the dictionary; IPA lexicon |
| Kitten Mini | 8 English presets | — | stripped | speed (native); seed sent but not repeatable | English |
| Pocket (en/de/it/pt/es models) | 20 presets; clone from the clip alone (Kyutai terms) | — | stripped | seed (audio.cpp also reads temperature and more — not exposed) | one model per language; another language refused |
| Qwen3 CustomVoice 1.7B / 0.6B | 9 presets; clips refused | ✓ `options.instruct` | stripped | temperature, top_k, top_p, repetition penalty, seed | 10, sent as names, default English |
| Qwen3 Base 1.7B / 0.6B | clones only — transcript or "Skip the words"; frozen designed voices | **dropped** | stripped | same as CustomVoice | same |
| Qwen3 VoiceDesign 1.7B | from a description (clip ignored) | merged INTO the description — **changes who speaks, not just how** | stripped | same | same |
| Chatterbox Multilingual v2 | clones only (no transcript) | — | stripped (would be read as words) | temperature, exaggeration, CFG, repetition penalty, top_p, seed | 23; "en" uses the English model |
| Chatterbox Turbo / Nano | clones only, clip > 5 s | — | **19 kept**: emotion angry, fear, happy, sarcastic, surprised, crying, whispering; register narration, dramatic, advertisement; non-verbal cough, laugh, chuckle, sigh, gasp, groan, sniff, clear throat, shush | temperature, top_p, top_k, repetition penalty, seed (no exaggeration / CFG) | English only |
| VoxCPM2 | clones (+ transcript) or a description | ✓ as a `(…)` prefix, **on clones too** | stripped; `()` in the text become dashes | CFG, steps, seed (no temperature) | 30 listed, none sent |

`Delivery.emotion` on Turbo/Nano: neutral → nothing; happy, angry, sarcastic → same tag; fearful →
fear; whispered → whispering; sad, shouted, contemptuous can't be expressed.

**Mismatches**
- Advertised but dropped: seed in chapter renders (all engines); Generate's Temperature for
  Kokoro, Kitten, Pocket, VoxCPM2 (and its 0–1 range vs the knobs' 0.05–2.0; Qwen refuses 0);
  Generate's Seed for Kitten; emotion composed for every engine but dropped on Qwen3 Base, Kokoro,
  Kitten, Pocket, Chatterbox Multilingual — nothing gates a persona's emotion; language on every
  render (Qwen3 "English", Chatterbox "en" → its English model, Pocket's refusal never fires,
  Kokoro blends always en-us); engine override; persona default delivery has no editor (and a
  `pause_after_ms` key that isn't a Delivery field); the speed range (3.0 vs 2.0 vs the 2.0 clamp);
  import has no "Skip the words".
- Sent but not advertised: Kitten's seed; an `engine.instruct` fallback; VoxCPM2's parenthesis
  rewrite; Qwen3 VoiceDesign's identity changing per line; Generate's temperature default (0.7)
  differing from the models' (0.9 Qwen3, 0.8 Chatterbox).
- Stale: Multilingual "19 languages" (23); Kokoro's variant languages omit ja; "49 voices / eight
  languages" (54 / nine); "no min-p" (audio.cpp reads min_p).
- Read by audio.cpp, not exposed (candidates): Chatterbox min_p, s3gen_cfg_rate; Qwen3 subtalker
  sampling; Pocket temperature and more; VoxCPM2 min/max tokens.

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

> **Superseded in part by §5 (2026-10-03, later).** The mock puts the model on the voice, not the
> persona: 3.0's "make the model part of the persona" and 3.1's **Model card** are withdrawn
> (§5.3). The rest stands unless §5.3 names it.

### 3.0 The root problem, in one line

A persona's options depend on the **model** that speaks it, and today nothing records that model:
a voice records only its engine, a persona records neither, and every option follows whichever
model happens to be loaded (§2.3). The mock never draws this either — its editor exists only for a
Qwen3 CustomVoice persona (§2.1). So the redesign must make the model part of the persona, and
build every card from that model's capabilities.

### 3.1 Pass 1 — the items: what a persona is, and what each card shows per model

**A persona = a voice + the model that speaks it + how it speaks.** (The 09-29 ruling: "a persona
is the actual spoken voice adjusted with pitch speed and other settings".)

**Which models can speak which voice** (from §2.2 / §2.3):
| Voice kind | Models that can speak it |
|---|---|
| Built-in (preset) | exactly one: Kokoro's 54 → Kokoro; Kitten's 8 → Kitten; Pocket's 20 → the Pocket model of that language; Qwen3's 9 → Qwen3 CustomVoice (1.7B or 0.6B) |
| Blended | Kokoro only |
| Cloned / Imported (a clip) | any cloning model: Chatterbox Turbo, Nano (English, clip > 5 s), Chatterbox Multilingual, Qwen3 Base (needs the transcript or "Skip the words"), VoxCPM2, Pocket (Kyutai's terms) |
| Designed, frozen (saved with its clip) | as a clip — any cloning model (today: Qwen3 Base) |
| Designed, dynamic (a description, no clip) | Qwen3 VoiceDesign or VoxCPM2 |

So the model is a real choice only for clips (cloned, imported, frozen designed) and dynamic
designs; for built-in voices and blends it follows from the voice.

**How each model can be directed** — one vocabulary for every screen (the mock has three):
- **Written direction** — Qwen3 CustomVoice; VoxCPM2 (clones and designs); Qwen3 VoiceDesign, where
  the words merge into the description, so **they change who speaks, not just how**.
- **Tags** — Chatterbox Turbo and Nano: 7 emotions, 3 registers, 9 non-verbal sounds.
- **Numbers only** — Kokoro, Kitten, Pocket, Chatterbox Multilingual, Qwen3 Base.

**The editor's cards, built from the chosen model:**
1. **Voice** — kind (Built-in · Cloned · Designed · Blended; "Trained LoRA" gone), then the voice
   (every dropdown shows the voice's gender, per the 09-30 to-do). ▶ Raw.
2. **Model** (new; the mock has none) — every model that can speak this voice, installed or not,
   each with one line of what it gives ("Chatterbox Turbo — English · tags", "Chatterbox
   Multilingual — 23 languages · exaggeration", "VoxCPM2 — written direction · 30 languages",
   "Qwen3 Base — 10 languages · numbers only"). One possible model shows as text, not a choice. A
   model the voice can't use shows why ("Turbo needs a clip longer than 5 s — this one is 4.2 s";
   "Qwen3 Base needs the transcript or Skip the words"). The persona pins the model **family**;
   its size and precision (1.7B / 0.6B, 8-bit / 16-bit) stay the engine's choice on AI Settings.
   This replaces "Engine override", which nothing reads.
3. **How it speaks** — Pace, Pitch, Gain, Pause before / after: done on the server, so every model
   takes them and they survive a change of voice or model. Pace notes "time-stretched" on models
   that don't pace themselves.
4. **Direction** — the model's own kind:
   - written-direction models: **Standing delivery** (the prose) + **Emotion**;
   - Turbo / Nano: **Emotion** as its tag (and Register — see Q3);
   - numbers-only models: the card is shown disabled with its reason ("Chatterbox Multilingual takes
     no direction — use the numbers, or pick a model that does"), values kept.
   - Qwen3 VoiceDesign (dynamic design): the card warns that these words change the voice itself.
5. **Sampling** — exactly the model's own knobs, its own defaults and ranges: Qwen3 temperature,
   top k, top p, repetition penalty; Chatterbox Multilingual temperature, exaggeration, CFG,
   repetition penalty, top p; Turbo / Nano temperature, top k, top p, repetition penalty; VoxCPM2
   CFG, steps; Kokoro / Kitten / Pocket none. **Seed** where the model repeats with it (not Kitten,
   shown disabled with why).
6. **Language** (new in the editor; the field exists and is dead) — limited to the model's
   languages, defaulting from the voice; fixed and shown as text where the voice decides (Kokoro,
   Pocket); Japanese notes the dictionary when it isn't installed.
7. **Words** — the persona's lexicon (kept by the 09-29 ruling; the mock has none) and the note.
8. **Effects** — the chain, as today.
9. **Hear it** — the persona's own line through the same path a chapter renders.
10. **This model** (the mock's "This engine") — languages, direction kind, clone, seed, with
    "Compare models →".
11. **Save** — Save, Save as new (a new persona), **Revert** and an unsaved mark (the mock has
    neither).

**The Personas index** (`_s9`), columns as drawn: ▶ (plays the persona, not the bare voice) ·
Persona · Built on (voice + kind) · Model · Can be directed ("✓ written direction" / "✓ tags" /
"✗ numbers only") · Shaped · Used by · ⋯ (Rename · Merge into… · Delete). Filters: engine/model,
in use. An empty state.

### 3.2 Pass 2 — interactions

1. **Changing the model or voice.** Host-side values (pace, pitch, gain, pauses, effects, lexicon)
   carry over. Model-specific values (sampling, exaggeration) are **kept per model**, so switching
   back restores them and Turbo's top k never lands on Qwen3. Values the new model can't take stay,
   shown disabled with the reason. The mock's banner generalises: "Changing this makes June's 61
   lines stale. 18 carry a written direction — Chatterbox Turbo won't perform them."
2. **Four render paths, four behaviours** (§2.2). The redesign promises that everything on the
   persona reaches the audio, which is true only if **one resolver** turns a persona + a line into
   a request for every path: Studio Render, a single line's re-render, the game export, Generate
   with a persona, Cast's ▶, and the editor's Hear it. Otherwise what you hear in the editor isn't
   what ships (already a finding: "the chapter you audition is paced differently from the one that
   ships").
3. **One engine resident at a time.** Pinning models means a book may need several (Turbo for one
   persona, Qwen3 CustomVoice for another). Today a mixed Qwen3 cast is refused before render. With
   pinned models, render must group lines by model and swap, instead of refusing. That is Render's
   job (Slice 4), but the persona design creates the need.
4. **The scene** stacks words and effects, never numbers or emotion (mock). Its words reach only
   written-direction models — the mock's warning stays, computed from each persona's model.
5. **The per-line override** (Slice 4): numbers in the closed hatch for every model; words only for
   written-direction models; tags only for Turbo / Nano. The persona's model decides what a line
   can carry, so Slice 4 builds on this.
6. **Language end to end.** The persona's language must reach the request on every path (dead
   today: Qwen3 is always "English", Chatterbox always "en" → its English model, Pocket's language
   check never fires, Kokoro blends always en-us).
7. **Seed end to end.** The persona's seed must reach the line's request (dead in chapter renders).
8. **Designed voices.** Dynamic: the description is the identity; the seed keeps it steady (the
   open ear test G); line direction reshapes it on Qwen3 VoiceDesign — said plainly. Frozen: a clip,
   so any cloning model.
9. **Cast.** ▶ should play the persona (today the bare voice). The persona card and the "directed"
   tag read the persona's model, not "Engine override".
10. **Export / import.** Project export writes no delivery or effects for personas today; the model
    pin, language and per-model values must travel too. JustWrite's character sheet still fills the
    speaker / note, never the delivery.
11. **Scale.** A game has 50–500 personas: the index needs search and filters by model; the editor
    must stay one screen.

### 3.3 Pass 3 — my own claims, checked in the code (2026-10-03)

- Persona `engine_override` has no reader in any render path (grep: only settings-level
  `engine_overrides`, a different thing). ✓
- Scene-mode `ChapterLine` carries no language and no seed (`render_chapter_api.py:256-266`). ✓
- The slot defaults Qwen3 to "English" and Chatterbox to "en" (`slot.py:506, 573`). ✓
- `PersonaStore.update` skips `None` (`storage/personas.py:225-233`) — clearing a field does
  nothing. ✓
- `VoiceRecord` has `engine` and no model field (`models.py:500`). ✓
- Tags follow the loaded or default model, not the voice (`render_core.py:287-300`). ✓
- Not checked by me (agent-reported, plausible, to confirm in the build plan): VoxCPM2 sends no
  language; Kitten's seed doesn't repeat; Pocket reads temperature internally.

### 3.4 Pass 4 — the checker: is every model and voice kind covered?

Models: Kokoro, Kitten, Pocket (en/de/it/pt/es), Qwen3 CustomVoice 1.7B / 0.6B, Qwen3 Base 1.7B /
0.6B, Qwen3 VoiceDesign 1.7B, Chatterbox Multilingual, Turbo, Nano, VoxCPM2 — each has a row in
3.1's tables. Voice kinds: built-in, blended, cloned, imported, designed frozen, designed dynamic —
each has a row. Direction kinds: written, tags, numbers — every model sits in exactly one (Qwen3
VoiceDesign in "written", with its warning). Speech recognition is not a persona model. ✓

### 3.5 Pass 5 — the neighbours not touched

- **Voices page**: if clips may be spoken by any cloning model (Q2), its "engine" for a clone becomes
  "made with"; the import's "Model that speaks as this clip" moves to the persona.
- **Generate** ignores a persona's voice today; its fate is still open (absorbed or deleted).
- **MCP speak** sends a language but no persona instruct.
- **Effects menu**: Gain and Pitch shift duplicate the persona's Gain and Pitch (Q8).
- **docs/personas.md / docs/voices.md** promise things the code doesn't do (§2.2) — rewritten with
  the build.
- **The persona API's PUT** wipes omitted fields and can't clear text — replaced by a patch with
  explicit clears.

### 3.6 Pass 6 — a fresh angle: the four workflows the app serves

- A narrator on Kokoro: built-in voice → one model → numbers only. The editor shows How it speaks,
  Language (fixed), Words, Effects; Direction disabled with its reason. ✓
- An expressive character: Qwen3 CustomVoice (prose) or a clone on Turbo (tags) or VoxCPM2 (prose on
  a clone). The Model card is where that choice is made and explained. ✓
- A Spanish clone: Multilingual or VoxCPM2 (Turbo is English only — shown with why). ✓
- A designed creature: dynamic (VoiceDesign / VoxCPM2) or frozen (any cloning model). ✓
- 300 game NPCs: index filters, one-screen editor. ✓
This pass found nothing new beyond 3.1–3.5. **Converged.**

## 4. Questions for the user

> **Replaced by §5.6.** Q1, Q2 and Q12 are withdrawn; Q3, Q4, Q8 and Q9 went against the mock
> (§5.3); Q5, Q6, Q7, Q10, Q11 and Q13 still stand.

Each with a recommendation; nothing here is decided until answered.

1. **Model pin.** The persona picks the model family that speaks its voice (only the ones that
   can); size and precision stay on AI Settings; "Engine override" is deleted. *Rec: yes.*
2. **Clips aren't tied to one engine.** A cloned, imported or frozen designed voice can be spoken by
   any cloning model the persona picks; the Voices page shows what it was "made with". *Rec: yes —
   the same timbre in English with tags (Turbo), in Spanish (Multilingual), or with written direction
   (VoxCPM2).*
3. **Emotion on Turbo.** The ruled cross-engine Emotion (9 words; on Turbo only happy, angry,
   sarcastic, fearful → fear, whispered → whispering reach it) — or Turbo's own 7 + Register on a
   Turbo persona. *Rec: keep the ruled 9 on the persona (survives a model change); Turbo's own extras
   (surprised, crying, registers, non-verbal sounds) live on the line, in Slice 4's tags.*
4. **Language.** The persona's language, limited to its model's, defaulting from the voice, sent on
   every render. *Rec: yes.*
5. **Per-model values** (sampling, exaggeration) kept per model so switching back restores them.
   *Rec: yes.*
6. **Unsupported controls** shown disabled with the reason, values kept (the mock's own rule).
   *Rec: yes.*
7. **One resolver** for every path, so the editor's Hear it, Cast's ▶, Studio Render, a line's
   re-render, the game export and Generate-with-a-persona produce the same audio. *Rec: yes — part
   of this redesign, since "everything reaches the audio" is its promise.*
8. **Duplicates.** Drop Gain and Pitch shift from the effects menu (the persona's How it speaks is
   the one place). *Rec: yes.*
9. **The voice tuning page** (08-15: "i do want a voice tuning page…") vs the 09-29 persona that
   holds pitch and speed. *Rec: the persona is the one place to tune; the "derived voice" stays an
   idea.* Your call.
10. **Delete** uncasts (built 09-29), not the mock's "refuses while she is cast". *Rec: keep
    uncasting.*
11. **Merge into…** moves the speakers cast to this persona onto the target, then deletes this one
    (lines point at speakers now). *Rec: yes.*
12. **The mock's stale parts** — "Trained LoRA", "Train a LoRA", LuxTTS out; Kitten, Pocket, VoxCPM2
    in. *Rec: yes.*
13. **Still open from before, not assumed here:** can a persona vary by scene ("i dont know yet");
    Generate absorbed or deleted.

After the answers: the build plan, with the blast-radius table (every caller of the persona model,
the resolver's four paths, the API, Cast, Voices, export), then the build.

## 5. The mock re-read, and the direction filter (2026-10-03, later)

Saved at the user's word: "save all this info we keep redoing research".

### 5.1 What the user said (verbatim, typos kept)

1. On §3–§4: "the mock has choices like alexandria, clone blend design it should have custom voice
   for qwen lora these options determine what voices are available and what models can be selected
   if you choos clone you only get clone models, so where do you pick engine or model, i dont think
   you thougth this through"
2. "we did the mock on purpos and you are ignoring it"
3. To a second reviewer (Fable): "think on what opus said about the persona design look at the mock
   see if we are missing anything or anything can be improved"
4. "The mock's Built-in radio already covers Qwen3 CustomVoice's speakers, what we need is a way to
   determine if user can direct voice either wither words or like chatterbox with specific works, so
   built in means kokoro which you cant do anything with but also qwen3 custom which takes
   directions, so some way for the user to filter out what types of voices they want to use and save
   all this info we keep redoing research"

Read as: item 4 answers 5.4's question 1 — no separate "Custom voice" radio; Built-in stays as
drawn, and the missing piece is a filter on how a voice can be directed (5.5).

### 5.2 Where the mock sets the engine and model — the answer to "where do you pick"

You never pick an engine or a model on its own. The editor's Voice card is the kind radios
(`_s7:13-18`: Built-in · Clone from audio · Design from words · Blend · Trained LoRA), then one
voice list whose every option names its model ("Sohee — qwen3 CustomVoice · ko", "Heart — kokoro ·
en-US", "Marius — chatterbox Turbo · cloned", `_s7:19-24`). The written record is
`2026-08-15-voice-workflow-redesign.md` §2.3 (`:247-254`): "pick the *kind* … which fixes the
engine; then the specific voice", and "Choosing a voice is choosing an engine". The model is set
once, where the voice is made:

| Kind | Where the model is set |
|---|---|
| Built-in | the preset belongs to one model |
| Clone (and import) | New voice › Clone, its Engine list (`_s8:43-44`); import's "Model that speaks as this clip" |
| Design | the model it is designed on (`_s7:16`: "Needs the Qwen3 VoiceDesign model") |
| Blend | "Same engine family only" (`_s8:27`) — Kokoro |
| Trained LoRA | the Base list on Train (`_s8:55`) — off until gap 5 rebuilds training |

A kind that can't be used yet is shown off with its reason, the way `_s7:16` draws Design.

**The code breaks this** (verified 2026-10-03):
- A voice stores its engine, never its model: `VoiceRecord` (`models.py:498-514`) has `engine` and
  no model or variant. The Voices page offers Turbo and Multilingual as separate rows
  (`VoicesView.vue:1382-1393`) but sends only the engine id (`:600`, `:1529`), and
  `voices_api.py:147` stores it. So "Marius — chatterbox Turbo" can't be told apart from a
  Multilingual clone; tags and knobs follow whichever model is loaded (`render_core.py:287-309`).
- A designed voice saved with its clip renders on Qwen3 Base, not VoiceDesign
  (`render_core.py:180-181`), and nothing records that either.

So the fix is data: **store the model on the voice**, set at the one place per kind above. The
persona editor needs no model picker.

### 5.3 Withdrawn from §3 and §4

- 3.0's "make the model part of the persona", 3.1's **Model card**, and §4 Q1 (model pin on the
  persona) — the mock puts the model on the voice.
- §4 Q2 (clips not tied to one engine) — the mock ties a clone to the model it was made for.
  Restated as 5.4 Q2.
- §4 Q12 — LoRA stays as a kind, shown off until gap 5.
- §4 Q3 (emotion on the persona) and Q4 (language on the persona) went against the mock — restated
  as 5.4 Q4 and Q3.
- §4 Q8 (drop Gain and Pitch shift from effects) — the mock's Add effect has both.
- §4 Q9 (voice tuning page) — the mock answers it: "A voice is raw" (`_s6:31`); §8.22 of the
  redesign doc left at most a measured Calibrate on the voice (not drawn, not built).

### 5.4 The second review (Fable, 2026-10-03) — the mock against §3–§4

**Where §3–§4 went against the mock**
- Emotion on the persona — the editor has none; emotion is per line (the tags modal,
  `_interactions.py:130-157`).
- Language on the persona — the mock sets language on the book (`_s1:14`) and shows what each
  voice speaks (`_s6`, the Speaks column).
- Dropping Gain and Pitch shift from effects — the mock's Add effect has both
  (`_interactions.py:104-107`).
- A voice tuning page — "A voice is raw" (`_s6:31`); the 09-29 ruling says the same.
- A separate Direction card and a Model column — the mock keeps Standing delivery inside How it
  speaks (`_s7:48-51`); its Engine column already shows the model (`_s9:19, 26`).
- Dropped from 3.1's card list though drawn: the summary card (`_s7:82-84`), Used by with "Open
  Cast →" (`:94-96`), the "Qwen3 isn't loaded" banner (`:7`), Compare settings (`:68-69`), Stock
  line and WAV (`:32-34`), the Blend and Train a LoRA buttons (`:77-78`).

**What the mock doesn't answer** (to draw before code)
- The radios don't filter: with Built-in on, the list still shows the Marius clone (`_s7:14, 24`;
  `pickRadio` only moves the highlight, `_interactions.py:238-242`). What Clone, Design, Blend and
  LoRA list is not drawn.
- One persona is drawn — a Qwen3 CustomVoice built-in. Not drawn: Turbo (tags); Kokoro, Kitten,
  Pocket (numbers only); Chatterbox Multilingual (exaggeration, CFG); a Qwen3 Base clone (direction
  dropped); VoxCPM2 (direction works on a clone); a live designed voice.
- Stale engines: LuxTTS is gone; Kitten, Pocket, VoxCPM2 and Nano are missing (`_s13`,
  `_s8:11, 43-44`). Three sentences are now false: "only Qwen3 CustomVoice reads prose" (`_s7:27`,
  `_s12:31`); "a clone … always loses written direction" (`_s8:12-14`); "Qwen3 is the only engine
  that does this" (`_s8:24`) — VoxCPM2 takes direction on clones and designs
  (`slot.py:609-628`, `capability_details.py:393-417`).
- One clip on two models (Marius in English on Turbo, in Spanish on Multilingual).
- Where a designed voice saved with its clip is listed: under Clone, as Alexandria does (its Clone
  list groups "Designed Voices", `2026-08-22-voice-modes-truth-and-parity.md:125-128`), or under
  Design.
- States: a blank new persona ("New persona" opens June, `_s9:12`), a deleted voice, a model not
  installed, unsaved changes, an empty index.
- Ruled after the mock was drawn: the note; delete uncasts; merge moves speakers; gender in voice
  labels with a gender filter (`2026-09-30-voice-gender-and-pronouns.md`).
- Mock bugs: Voices' ⋯ opens "Persona actions" (`_s6:38`); `_s8:3-7` is design commentary about a
  "Save as a new voice" that no longer exists.

**Code facts the design depends on** (verified 2026-10-03)
- Render presets beat the persona's numbers: preset > request > persona
  (`delivery_merge.py:139-140`). A chapter rendered with a preset ignores the persona's Pace, Pitch
  and Gain.
- Chapter renders group lines by engine, not by model (`render_chapter_api.py:506`); a mixed Qwen3
  cast is refused (`:495`); Chatterbox speaks with whichever model is loaded. With the model on the
  voice, grouping has to go by model.
- A book stores no language: `projects` has no language column; an import puts it in
  `metadata_json` and nothing reads it (`projects_api.py:650-653`).
- Cast's ▶ plays the bare voice, not the persona (`StudioCast.vue:433`).

**Improvements proposed** (all keep the mock's layout; none decided)
1. The radios filter the voice list; beside it, a model filter limited to that kind's models — the
   same "All engines" filter the index, Cast and Voices draw (`_s9:7-8`, `_s3:79-80`, `_s6:7-8`).
2. Voices ⋯ → "Copy to another model…": the same clip becomes a second voice on another clone
   model, checked against what that model needs (Turbo a clip over 5 s; Qwen3 Base a transcript or
   Skip the words).
3. Voices ⋯ → "New persona from this voice" — promised by the `_s6` toast, drawn nowhere.
4. A blank persona shows only the Voice card live; the rest unlocks once a voice is picked.
5. Cast gets "＋ New persona" that comes back with it assigned; today only the empty-library
   message links to Personas (`StudioCast.vue:617-619`).

**Its questions, with its recommendations**
1. A separate "Custom voice" radio for Qwen3's nine speakers? — **answered by the user (5.1 item
   4): no. Built-in stays; the need is a direction filter (5.5).**
2. One clip on two models: (a) as the mock — a clone belongs to the model it was made for, and
   "Copy to another model…" makes the second; (b) the persona picks the model. *Rec: (a) — you
   audition a clone on its model before saving, so what you heard is what renders.*
3. Language: the book's language on every line, the voice shows what it speaks, Cast warns on a
   mismatch, no persona field. *Rec: yes.*
4. Emotion: none on the persona, as drawn; per-line emotion stays a Slice 4 question. *Rec: yes.*
5. Presets: take the preset's numbers out of the merge with this work, so the persona's sliders
   always count. Presets are ruled to die; the removal has no go. *Rec: yes.*

**Opus's view of it** (2026-10-03): agrees on every point above. Two notes: a book language is new
data (no column today), and dropping the persona's `language` field is a removal, so 5.4 Q3 covers
both; "Copy to another model…" also keeps the direction filter (5.5) honest, because each copy
has one model and therefore one answer.

### 5.5 The direction filter — the user's requirement (5.1 item 4)

The radios say how a voice was **made**. They don't say how it can be **directed**, and each kind
mixes the answers: Built-in holds Kokoro (numbers only) and Qwen3 CustomVoice (written direction);
Clone holds Turbo (tags), VoxCPM2 (written direction) and Multilingual (numbers only). Direction is
a second axis, and it depends on the voice **and the model it speaks on**:

| Voice | Model | Can be directed |
|---|---|---|
| Built-in, Kokoro's 54; a blend | Kokoro | numbers only |
| Built-in, Kitten's 8 | Kitten | numbers only |
| Built-in, Pocket's 20 | Pocket | numbers only |
| Built-in, Qwen3's 9 | Qwen3 CustomVoice 1.7B / 0.6B | written direction (0.6B not checked by ear) |
| Clone / import | Chatterbox Turbo, Nano | tags, set per line — 7 emotions, 3 registers, 9 sounds |
| Clone / import | Chatterbox Multilingual | numbers only |
| Clone / import | Qwen3 Base | numbers only — direction is dropped |
| Clone / import | Pocket | numbers only |
| Clone / import | VoxCPM2 | written direction |
| Design, saved with its clip | Qwen3 Base | numbers only |
| Design, live (no clip) | Qwen3 VoiceDesign | written direction — it reshapes the voice itself |
| Design | VoxCPM2 | written direction |
| Trained LoRA | gap 5 | before removal: Qwen3 Base + adapter took written direction; Turbo + adapter kept its tags (TASKS "THE VOICES ACQUISITION BUILD", `:1269-1275`) |

Sources: §2.3's table; `capability_details.py` (`supports_instruct_freeform` per row, Turbo's
`inline_tags`); `slot.py:609-628`; `render_core.py:164-188`.

"Numbers only" is not "nothing": pace, pitch, gain, pauses, effects and the lexicon work on every
model (§2.3).

**It needs 5.2's fix first.** A clone's row depends on its model, and a voice stores none — today
a Chatterbox clone can't be told apart as Turbo (tags) or Multilingual (numbers only), so no filter
could be right.

**Proposal (not decided):**
- The server works out one value per voice — written direction · tags · numbers only — from the
  voice's kind, whether it has a clip, and its model, and sends it with every voice. One answer
  for every screen, the way the 09-30 to-do gives gender one service.
- It replaces today's two guesses: the persona editor's verdict (wrong for VoxCPM2 clones and for
  Qwen3 designs with a clip, §2.2) and Cast's "directed" tag.
- One vocabulary everywhere — the mock has three (§2.1).
- A "Can be directed" filter beside the voice list in the persona editor, next to the kind radios;
  the same filter on Voices, the Personas index and Cast's persona list, where the mock already
  shows the column or tag but no filter (`_s6:28`, `_s9:19`, `_s3:87`).
- Labels: the mock's own words — "Written direction" · "Tags" · "Numbers only" — asked, not
  assumed.

### 5.6 Open questions now (replaces §4)

1. The direction filter (5.5): build it as proposed, with those labels?
2. One clip on two models (5.4 Q2): (a) copy, or (b) the persona picks.
3. Language (5.4 Q3).
4. Emotion (5.4 Q4).
5. Presets out of the merge (5.4 Q5).
6. §4 Q5, Q6, Q7, Q10, Q11 — recommendations unchanged.
7. Still open from before, not assumed: can a persona vary by scene; Generate absorbed or deleted.

Recommended next step (not decided): redraw the mock's persona screens — working radios and
filters, one state per model, today's engines — and publish to the same link for the user to walk;
then the build plan with the blast-radius table.
