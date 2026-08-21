# Voices

A **voice** is what an engine speaks with. Every voice has a type, an engine
it belongs to, gender / age / accent / tone descriptors, an optional effects
chain, and an audio-output-channel routing.

A voice belongs to the engine that made it and cannot move to another one.
That is not a limitation we chose: a voice is coordinates inside one model's
learned space, so the numbers mean nothing to a different model. What *is*
portable is the recording you cloned from — it is stored with the voice, so
you can clone it again on another engine. The result is a new voice, and it
will sound a little different, because each engine clones with its own
character.

## The five ways to get a voice

The Voices page has a tab per way in — **Voices** for the library itself,
then **Clone**, **Design**, **Import**, **Blend** and **LoRA**. Each one
produces the matching voice type, so the tab you used and the filter chip
that finds the result are the same word.

| Type | What it is | Engines |
|---|---|---|
| **Preset** | Ships with the engine. Nothing to make. | Kokoro (54), Qwen3 **CustomVoice** (9) |
| **Cloned** | Learned from a recording of someone speaking. | Chatterbox Turbo + Multilingual, Qwen3 **Base**, LuxTTS (the light one — runs on CPU) (TADA and MOSS-TTSD are marked for removal and no longer offered) |
| **Designed** | Invented from a written description — no recording. | Qwen3 **VoiceDesign** |
| **Imported** | An audio clip stored as-is. | any — no engine needed |
| **Blended** | A voice made out of voices the engine already has — mixed, exaggerated, added and subtracted, or spliced. | Kokoro |
| **LoRA** | Taught from a set of clips (a LoRA fine-tune). | Qwen3 **Base**, Chatterbox **Turbo** |

### Finding a voice in the library

The **Voices** tab is the library. Above it: a search box, then filters for
**engine**, **language**, **gender** and voice **type**. Language reads as a
name — *American English*, *British English*, *Chinese* — never as a code.
Any column heading sorts the list.

Each tab lists the engines that can do its job and what each one needs —
**Install** for one you do not have, **Load** for one that is not running.
Where a model ships in more than one build, a **Size** dropdown sits beside
the picker and the line under it spells the choice out in full — the build's
name and what it weighs. Size decides which weights **Load** fetches, so
switch it before loading, not after. Loading shows the same progress bar as
the Speech engines page, with the same Cancel and the same error if it
fails; a model already loaded there shows as **loaded** here too.
An engine that cannot do a thing is never offered for it: Qwen3 CustomVoice
speaks its nine preset voices and cannot clone, so it does not appear under
Cloned, and picking it for a clone at render time is refused rather than
read in somebody else's voice.

## Clone — from a recording

Drop in a clip of one person speaking. **10 seconds to 2 minutes**, one
speaker, as clean as you can get: 16 kHz or better, dialogue delivery, low
noise floor.

Type what the clip says if you can. On Qwen3 Base the transcript is passed
to the model as part of the clone prompt (upstream's own demo passes it); on
Chatterbox it is stored but not used. The form says which of the two you are
looking at.

A clone gives you someone's own timbre and **loses written direction** — the
identity comes entirely from the reference clip. Chatterbox Turbo still takes
a per-line emotion tag; the others take neither. If you want both a cloned
identity *and* written direction, train instead.


### What each model asks for

Controls appear only when the chosen model actually uses them — a field
that changes nothing is never shown. **What's said in the recording**
appears for Qwen3 Base: it listens to your clip *while reading those
words*, so a word-for-word transcript gives a truer copy (skip it and the
clone still works, just less exactly). Chatterbox copies the sound alone,
so that field doesn't appear there. The **speaker-vector** checkbox
(Qwen3 Base) clones from the voice's fingerprint without any words —
faster to set up, less exact.

Every model dropdown shows each model's state the same way the rest of
the app does — **· loaded**, **(not loaded)**, **(not installed)** — and
lists models alphabetically.

## Design — from a description

Describe the voice in plain words — *"a gravel-voiced harbour-master in his
seventies, unhurried"* — and the model invents it. No recording needed.

This needs Qwen3's **VoiceDesign** checkpoint, which is a separate download
from the CustomVoice and Base ones; the tab offers to install it. There is
only a 1.7B VoiceDesign checkpoint — no smaller variant exists.

The description is kept on the voice and used every time it speaks, so a
line's own direction adds to it rather than replacing it.

## Import — a clip as-is

Stores an audio file as a voice without learning anything from it. Use this
to keep a clip around; to make a voice that can speak *new* lines, clone it.

**Pick the model that speaks as this clip.** When an imported voice renders,
its clip goes to that model as a cloning reference — so the picker offers
cloning-capable models only, and defaults to your default TTS engine.

## Blend — make a voice out of other voices

Blending needs **Kokoro**. A Kokoro voice is a block of numbers describing
how it sounds, so voices can be arithmetic on each other; most engines'
voices are not that kind of thing.

Above the pickers are **Language** and **Gender** filters. Kokoro ships 54
voices across 9 languages, and every picker on this tab shows a voice by
name, language and gender — "Bella · American English · female" — so you
are choosing a voice, not decoding an id.

Four strategies, each producing an ordinary saved voice.

### Blend — a mix

Pick **2 to 5** voices and give each a weight. What matters is the **ratio**
between the weights, not their absolute size, because the mix is divided by
their total: 1 beside 0.5 is the same mix as 0.6 beside 0.3. So each row
shows the **share** it actually contributes — that percentage is the number
to watch, not the slider.

### Extrapolate — make a voice more itself

Pick **one** voice and raise the **intensity**. The mix is
`average + k × (voice − average)`, where "average" is the middle of every
Kokoro voice — so the dial controls how far the voice is pushed away from
ordinary.

- **k = 0** — the average voice; nothing of your pick survives.
- **k = 1** — the voice exactly as it is.
- **above 1** — its distinguishing qualities exaggerated.
- **k = 3** — extreme. Past about 1.5 the voice leaves the range the model
  was trained on and can start to break up. That is a real limit, not a
  warning label.

To walk *between* two voices, use Blend with two rows instead.

### Vector math — voice arithmetic

Voices go in two groups: **voices to add** (traits you want) and **voices to
subtract** (traits you don't). The classic use is borrowing one quality from
one voice: *Michael + Heart − Sarah* is roughly "Heart, but male".

Unlike Blend, this one is **not** divided by the total, because the size of
the answer is part of the answer — halving it would not be the arithmetic
you asked for.

### Recombine — one voice's sound, another's delivery

A Kokoro voice's numbers are two halves that do different jobs. The first
half decides **timbre** — what the voice sounds like. The second decides
**prosody** — its rhythm, pacing and intonation. Recombine takes each half
from a different voice.

So you can have one narrator's voice speak with another's cadence. Pick
**timbre from** one voice and **prosody from** another; that is the whole
control.

If you want to cut somewhere other than that seam, tick **Cut somewhere
other than the timbre/prosody seam** and set each segment's range by hand.
The segments must cover 0% to 100% — a voice with gaps in its numbers does
not render, and JustVoice refuses it rather than saving something broken.

### What you get

A blend is an ordinary voice from the moment you save it — same speed, same
determinism, usable by any persona, in any project, forever. It is not a
"blend mode" you keep switching on.

Its **language comes from the voices you mixed**: if they all speak the same
language, so does the blend; if they disagree, it takes your default voice
language. That is why the Blend tab has no language picker — and it applies
to **Play** as well as to saving, so a mix of two Mandarin voices auditions
in Mandarin. (Kokoro does not translate: type your test line in the language
the voices speak.)

Pressing **Play** renders a sample without saving anything. If you like it,
**Save this voice** keeps the take you just heard rather than rendering a
second, slightly different one.

## LoRA — teach one voice properly

A LoRA fine-tune: give it a dataset of clips and it teaches a base model
that one voice. It is much slower than cloning, and its payoff is that a
trained voice **still takes written direction** — it renders on a
checkpoint that reads instructions, where a clone drops them.

Training runs on Qwen3 **Base** or Chatterbox **Turbo**, and needs that
checkpoint downloaded. The **LoRA** tab holds the whole job as three
sub-tabs:

| Sub-tab | What it is for |
|---|---|
| **Preparer** | Recordings you own, cut into a training dataset. |
| **Dataset** | A training dataset generated line by line from a described voice. |
| **Training** | The run itself, and hearing what came out. |

### Preparer

One recording in — or several with **Batch Mode** on — and a dataset out.
Each recording is split at its silences, every clip is checked, the
keepers are transcribed with Whisper, and what survives is saved as a
dataset, ready to pick on the Training tab (or download as a ZIP).

The **Configuration** row controls the checks for this run: **Language**,
**Confidence** (how sure the transcriber must be about a clip's words — an
unsure transcript is probably a wrong one, and a wrong transcript teaches
the voice wrong sounds) and **Min SNR** (the least signal-over-noise a
clip may have). Both start at your defaults from Settings → Training and
override them for one run. A measurement that cannot be taken never fails
a clip on its own.

The **Processing Queue** shows each recording's progress and the
**Execution Logs** window says why every dropped clip was dropped.

### Dataset Builder

Describe a voice once, write the lines you want it to say, and generate
each one. Because you wrote each line, its transcript is exact — the one
thing a recorded dataset can never guarantee.

- **Root Voice Description** — one description for the whole set, spoken
  by the **Model** you pick in the **Language** you pick.
- **Global Seed** — empty = random; the same seed = the same voice on
  every row. Set one, or every row is a slightly different person. A
  row's own Seed overrides it.
- Rows carry **Emotion / Style** (added to the description for that row
  only) and **Text**. Generate rows one at a time, or **Generate
  Pending** / **Regen All**; listen to each and re-generate until it is
  right. Rows and audio live on the server — closing the tab loses
  nothing.
- **Import JSON / Export JSON** move the rows as a script file —
  Alexandria's dataset scripts load unchanged, and yours load there.
- **Save as Training Dataset** freezes the generated rows, with the
  **Reference Sample** picker choosing the voice's anchor clip.

### Datasets, ZIPs, and the reference sample

A dataset is WAV clips plus their transcripts. On the Training tab it can
also arrive as a **ZIP upload** and leave as a **ZIP download** — the
format is interchangeable with Alexandria's, so datasets travel between
the two apps unchanged. **New Dataset from WAV Files** builds one from
clips you already have: each clip is checked against your quality rules
and transcribed before saving.

Every dataset has one clip that matters more than the rest: the
**Reference Sample**. Training takes the voice's fingerprint from that
single clip, and every line the finished voice ever speaks is prompted
with it — a bad choice colours everything the voice says. By default the
longest clip is used; the Dataset Builder, the WAV-files flow and the
Training tab all let you choose instead. Pick a clear, unhurried,
representative line.

### Training

Pick a dataset, name the adapter, choose the **Base Model**, and **Start
Training**. Choosing a base fills every knob — Epochs, Learning Rate,
Batch Size, LoRA Rank, LoRA Alpha, Grad Accum Steps — with the settings
that base is known to train well at; **How Settings Affect LoRA Voice
Quality** explains each one. **Language** matters and is not cosmetic: it
sets the sound system the voice is taught in, and an adapter trained on
English audio gives German text an English accent. Train one adapter per
language; a dataset that recorded its language fills this in for you.

Two things worth knowing before you start: training takes the whole
graphics card (every speech engine unloads while it runs), and clips are
checked twice (once as the dataset is made, again by the trainer, which
reports anything it drops).

**Training Progress** shows the epoch, the loss, and a live log of what
the trainer is doing. A finished run lands in your library as a normal
voice of type **LoRA** and in the **Trained Adapters** table — with the
dataset, language, epochs, final loss and sample count that made it, and
**⬇ Download** for the adapter weights as a ZIP.

**Built-in adapters** ship with the app: they appear in Trained Adapters
with a *built-in* badge, and **⬇ Download** fetches their weights the
first time — after that they are ordinary voices in your library.

**Test Voice** renders your own line, with optional direction, through
any finished adapter. Use it — lower final loss is not automatically the
better likeness, and past a point a voice garbles lines it has never
seen. Your ear decides.

## Gender + accent + tone tags

Every voice has a gender chip (F / M / N / ❓ / unset) in the library. JustVoice auto-detects from:

- **OpenAI voices**: published canon (Alloy / Echo / Fable / Onyx / Nova / Shimmer / Ash / Coral / Sage / Verse / Ballad).
- **Kokoro voices**: parses the `<region><gender>_<name>` convention (af_alloy = American Female; bm_george = British Male).
- **Cloned / freeform voices**: first-name dictionary (sarah.wav → F, michael.wav → M). Ambiguous names (Alex, Jamie, Riley) deliberately left unset.

Click the chip to cycle through F → M → N → unset → ❓. The override saves on the voice and feeds **Smart-assign** (the LLM voice→character matcher) on subsequent runs.

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
uses it ([personas.md](personas.md) → "How they sound" → default delivery
overlay); that is the Tier-2 layer every render reads.

Engine-private knobs used to be applied in preview but not on render,
because the UI saved them flat and the adapters read them nested. That seam
was closed on 2026-08-17: what you audition is what you render, for the
cross-engine knobs and the engine-private ones alike.

Common knobs (Chatterbox Multilingual), with the defaults JustVoice actually
sends:

- `exaggeration` — 0.25–2.0, default **0.5**. Below 0.4 reads flat; above 1.0 is dramatic.
- `cfg_weight` — 0.0–1.0, default **0.5**. Lower loosens pacing, higher holds to the text. Set it to 0 when speaking a language other than the reference clip's.
- `temperature` — default **0.8**. Lower is consistent, higher gives richer prosody.

Chatterbox has **no speed control** — neither variant takes one. Use pitch and
the effects chain, or an engine that does (Kokoro).

See [engines.md](engines.md) for which params each engine supports.

## Effects + channel routing

Each voice can carry a default **effects chain** (pedalboard — see [effects.md](effects.md)) and an **audio output channel** (see [channels.md](channels.md)) for multi-device routing. These ride along on every render through this voice.
