# Voices

A **voice** is what an engine speaks with. Every voice has a type, an engine
it belongs to, gender / age / accent / tone descriptors, an optional effects
chain, and an audio-output-channel routing.

A voice belongs to the **model** that made it and cannot move to another one.
That is not a limitation we chose: a voice is coordinates inside one model's
learned space, so the numbers mean nothing to a different model. What *is*
portable is the recording you cloned from — it is stored with the voice, so
you can clone it again on another model with **⋯ → Copy to another model…**
([below](#copy-to-another-model)). The result is a new voice, and it will sound
a little different, because each model clones with its own character.

### Every voice knows the model that speaks it

One engine can hold several models, and they are not interchangeable.
Chatterbox is **Multilingual** (23 languages, no tags), **Turbo** and **Nano**
(English, 19 inline tags); Qwen3 is
**CustomVoice** (its nine speakers), **Base** (clones) and **VoiceDesign**
(designed voices). So a voice remembers the model it was made for, and every
render loads *that* model:

- **A built-in voice** belongs to its model — Sohee is Qwen3 CustomVoice,
  Heart is Kokoro.
- **A clone** belongs to the model you picked in the **Model** list when you
  cloned it. A clone made on Chatterbox Multilingual renders on Multilingual
  even if another Chatterbox model happens to be loaded — JustVoice loads
  Multilingual for it first.
- **A designed voice** is Qwen3 VoiceDesign while it has no kept clip, and
  Qwen3 Base once you keep its clip ([below](#keeping-a-designed-voice-is-what-makes-it-one-voice)).
- **A blend** is Kokoro's.

The model's *size and precision* — Qwen3 1.7B or 0.6B, 8-bit or 16-bit — stay
your choice on [AI Settings → Speech engines](engines.md): the render uses the
size you loaded or set as default. Voices made before 2026-10-03 did not record
a model; they render on their engine's default model that can speak them.

## Where a voice comes from

The Voices page is the **library**: every voice you have, to find, hear,
copy to another model, start a persona from, or delete. A new voice is made
on a **persona's page** (since 2026-10-04): *Cloned*, *Designed* or *Blended*
under *Type* opens its fields right there — see
[Personas → Making a voice on this page](personas.md#making-a-voice-on-this-page).
You hear it as that persona before you keep it, and once kept it is here, in
the library, for any persona to use.

| Type | What it is | Made |
|---|---|---|
| **Built-in** | Ships with the model. Nothing to make. | Comes with Kokoro (54), Pocket TTS (20), KittenTTS (8), Qwen3 **CustomVoice** (9) |
| **Cloned** | Learned from a recording of someone speaking — including a clip kept as it was before 2026-10-04, once listed apart as *Imported*. | [New clone](personas.md#new-clone) — Chatterbox Multilingual, Turbo, Nano, Pocket TTS, Qwen3 **Base**, VoxCPM2 |
| **Designed** | Invented from a written description — no recording. | [New design](personas.md#new-design) — Qwen3 **VoiceDesign**, VoxCPM2 |
| **Blended** | Made out of Kokoro's own voices — mixed, exaggerated, added and subtracted, or spliced. | [New blend](personas.md#new-blend) |

These four are the words every screen uses for a voice's type — Voices' chips and Type
column, a persona's **Type**, and the label beside a voice everywhere (since 2026-10-05;
Voices said *Preset* and listed *Imported* apart, the persona page *Clone from audio*,
*Design from words* and *Blend*).

Kokoro's five Japanese voices need the optional Japanese dictionary — see
[Engines → The Japanese dictionary](engines.md#the-speech-runtime).

### Which of them take written direction

Written direction — a persona's **Style Instructions** text, a line's **+
direction** note — only reaches models that have somewhere to put it. Whether
yours does depends on the voice type as much as the engine, because a voice
made from a recording is rendered by a different checkpoint than one made
from a description:

| Voice type | Takes written direction? |
|---|---|
| **Built-in** (Qwen3 CustomVoice) | Yes |
| **Designed**, no kept clip | Yes — and its description leads, with your direction added after |
| **Designed**, kept clip | **No** — it is a clone now |
| **Cloned** | **No** — the identity is the recording |
| **Blended** (Kokoro) | No — Kokoro takes no direction at all |

No voice type gives you a specific person's voice *and* line-by-line written
direction. Voice training (a LoRA fine-tune) was the way to get both; it was
removed on 2026-10-02.

Chatterbox takes no written direction at any time; it steers through its
**Exaggeration** and **CFG weight** controls instead. No engine accepts
bracketed `[tag]` markup today — type one and it is removed before the model
sees it, rather than read aloud.

### Finding a voice in the library

Above the library: a search box, then filters for
**engine**, **language**, **gender**, **can be directed** and voice **type**.
Language reads as a name — *American English*, *British English*, *Chinese* —
never as a code. Any column heading sorts the list.

Each filter lists only what the others leave, with counts that match the list,
so no choice empties it by surprise; a choice that nothing fits any more stays
in its list with **(0)**, so you can see it and change it (since 2026-10-05). Under **Written direction**, for example, Engine
offers only the engines whose voices take it, and the type chips count only
those voices. An engine you chose earlier that has no voices now comes back
as *engine (0)* instead of an empty list.

| Column | Shows |
|---|---|
| Name | ▶ plays the voice saying the test line, then the voice's name |
| Gender | **F**, **M**, **N** or **?** — click it to set your own |
| Type | preset, cloned, designed, imported or blended |
| Model | The model that speaks it — *Kokoro*, *Qwen3-TTS CustomVoice*, *Chatterbox Multilingual* — with **LOCAL**, **ONLINE · METERED** or **NEEDS INSTALL** |
| Speaks | The voice's own language. **+9** beside it means its model can also speak it in nine more; hover for the list. A persona built on it can speak any of them ([Personas → Voice](personas.md#voice)) |
| Can be directed | **✓ written direction**, **✓ 19 tags** or **sliders only** — what a persona on this voice can be told (the same words as the Personas page) |
| Used by | The personas built on it: *🎭 Narrator*, *🎭 June, Mara +1*. *— unused —* when none is |
| ⋯ | The voice's menu, below |

**Can be directed** narrows the list to voices whose model takes written
direction (*describe it: clipped, world-weary*), tags (*pick from the model's
list: [fear] [sigh]*), or neither (*sliders only — pace, pitch, gain*).

Every list that offers a voice elsewhere — the persona's page, the Render Lab,
the cache's **Prune by voice…** — names it the same way: *Sohee · Female · Korean · Qwen3-TTS CustomVoice*
(name, gender, the voice's own language, its model).

### The ⋯ menu

- **🎭 New persona from this voice** opens a blank persona on this voice — the
  way to start a persona from the library. A voice is raw; the persona is how
  it speaks ([Personas](personas.md#the-personas-page)).
- **⧉ Copy to another model…** — on a cloned, imported or designed voice.
  Pick a model that can clone and, if you like, a name; the same clip becomes a
  second voice spoken by that model, and the first stays as it is. Use it to
  have one recording on Chatterbox Multilingual for Spanish and on Qwen3 Base
  for English. What the target model needs is checked first, by name: Turbo and
  Nano need a clip longer than 5 seconds; Qwen3 Base needs the words the clip
  says, so when the voice has none saved you are asked to type them or pick
  **Skip the words** (clone from the sound alone).
- **⤓ Export…** — on any voice but a built-in. Saves the voice as one file,
  `<name>.jvvoice.zip`: its reference clip (a cloned or imported voice), its
  description (a designed one) or its mixed vector (a blend), and the model it
  was made for. A built-in ships with its model, so there is nothing of yours
  to carry.
- **🗑 Delete** — on any voice but a preset. If personas are built on it, the
  confirmation names them: *It's the voice of June, Mara — those personas need
  another voice before they can speak.*

**⤒ Import voice…** (in the toolbar, at the right) reads a `.jvvoice.zip` back
in as a new voice on the same model. It refuses, saying why, a file whose
engine this install doesn't have (*install it first, then import again*), a
blend for any engine but the one that mixed it, and a file missing what its
voice is made of — a clone with no clip, a design with no description. (The
file carries its model since 2026-10-05; one exported before then imports on
its engine's default model.)

## Making a voice

Clone, Design and Blend moved to the persona's page on 2026-10-04, with
everything they explain — what each model asks for, keeping a design's take,
the four ways to blend: [Personas → Making a voice on this page](personas.md#making-a-voice-on-this-page).
The Voices page's old *Import* tab is folded into New clone: **💾 Keep**
without listening first keeps the clip as it is.

## Gender + accent + tone tags

Every voice has a gender chip (F / M / N / ❓ / unset) in the library. JustVoice auto-detects from:

- **OpenAI voices**: published canon (Alloy / Echo / Fable / Onyx / Nova / Shimmer / Ash / Coral / Sage / Verse / Ballad).
- **Kokoro voices**: parses the `<region><gender>_<name>` convention (af_alloy = American Female; bm_george = British Male).
- **Cloned / freeform voices**: first-name dictionary (sarah.wav → F, michael.wav → M). Ambiguous names (Alex, Jamie, Riley) deliberately left unset.

Click the chip to cycle through F → M → N → unset → ❓. The override saves on the voice and feeds **Smart-assign** on subsequent runs — it matches a book's speakers to personas, and a persona's gender is its voice's.

For the voices the dictionary can't label (the ❓ ones), the toolbar's
**✨ Guess unknown genders** button asks the AI to label them in one batch —
it runs only when you click, applies the confident answers exactly like a
manual chip click, and leaves genuinely ambiguous names unset. (This is the
`voice_gender` feature; its prompt and model live under AI Settings.)

## Hear a voice with your own text

The **test line** box above the grid is the audition surface: type the line
you actually care about once, and every voice's ▶ speaks *that* line — one
box, all voices, so comparing candidates is press, press, press. Leave it
empty and ▶ plays a stock sentence — enough to tell two voices apart, not
enough to cast one. Nothing is saved; you are auditioning, not editing.

Playback starts as soon as the first sentence is rendered: longer lines
stream sentence by sentence instead of waiting for the whole render. (The
piece size is a Settings knob — *Streamed audition pieces* under
Generation.) While a voice plays, its ▶ becomes a pause button with a
progress bar in the row; scrubbing works once the clip has finished
streaming.

Two costs to know about:

- **Engine swaps.** JustVoice keeps **one** TTS engine loaded at a time. If
  the voice belongs to a different engine than the resident one, JustVoice
  asks before paying the swap — a load can take a minute. After that,
  listens are quick.
- **Repeat listens are cached.** The same line on the same voice is served
  from a short in-memory cache, so press-and-compare doesn't re-synthesize
  what you already heard. Long text is refused: auditions are for a line or
  two.

## Voice tuning that sticks (Tier 2)

To make a delivery setting **stick** to a voice, put it on the persona that
uses it — the persona's page, **How it speaks** and **Sampling**
([Personas → How it speaks](personas.md#how-it-speaks)); every render reads
it.

Engine-private knobs used to be applied in preview but not on render,
because the UI saved them flat and the adapters read them nested. That seam
was closed on 2026-08-17: what you audition is what you render, for the
cross-engine knobs and the engine-private ones alike.

Common knobs (Chatterbox Multilingual), with the defaults JustVoice actually
sends:

- `exaggeration` — 0.25–2.0, default **0.5**. Below 0.4 reads flat; above 1.0 is dramatic.
- `cfg_weight` — 0.0–1.0, default **0.5**. Lower loosens pacing, higher holds to the text. Set it to 0 when speaking a language other than the reference clip's.
- `temperature` — default **0.8**. Lower is consistent, higher gives richer prosody.

Chatterbox doesn't pace itself: **Speed** time-stretches its finished line and
keeps the pitch, as on every engine but Kokoro and KittenTTS.

See [engines.md](engines.md) for which params each engine supports.

## Effects + channel routing

Each voice can carry a default **effects chain** (pedalboard — see [effects.md](effects.md)) and an **audio output channel** (see [channels.md](channels.md)) for multi-device routing. These ride along on every render through this voice.
