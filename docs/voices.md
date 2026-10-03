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

## The four ways to get a voice

The Voices page has a tab per way in — **Voices** for the library itself,
then **Clone**, **Design**, **Import** and **Blend**. Each one
produces the matching voice type, so the tab you used and the filter chip
that finds the result are the same word.

| Type | What it is | Engines |
|---|---|---|
| **Preset** | Ships with the engine. Nothing to make. | Kokoro (49), Pocket TTS (20), KittenTTS (8), Qwen3 **CustomVoice** (9) |
| **Cloned** | Learned from a recording of someone speaking. | Chatterbox Multilingual, Pocket TTS, Qwen3 **Base** (1.7B or 0.6B) |
| **Designed** | Invented from a written description — no recording. | Qwen3 **VoiceDesign** |
| **Imported** | An audio clip stored as-is. | any — no engine needed |
| **Blended** | A voice made out of voices the engine already has — mixed, exaggerated, added and subtracted, or spliced. | Kokoro — **not available yet** on the speech runtime |

Every engine runs on the speech runtime since 2026-10-01. One of these types
is waiting on it: **Blended** voices cannot render until the runtime can take
a voice made of numbers — a render that needs one stops with a message naming
the gap rather than speaking in some other voice. Kokoro also offers 49 of its 54 voices: its five Japanese
voices need a dictionary the runtime does not ship yet. See
[Engines → Not available yet](engines.md#not-available-yet).

### Which of them take written direction

Written direction — a persona's **Spoken delivery** text, a line's **+
direction** note — only reaches models that have somewhere to put it. Whether
yours does depends on the voice type as much as the engine, because a voice
made from a recording is rendered by a different checkpoint than one made
from a description:

| Voice type | Takes written direction? |
|---|---|
| **Preset** (Qwen3 CustomVoice) | Yes |
| **Designed**, no kept clip | Yes — and its description leads, with your direction added after |
| **Designed**, kept clip | **No** — it is a clone now |
| **Cloned** / **Imported** | **No** — the identity is the recording |
| **Blended** (Kokoro) | No — Kokoro takes no direction at all |

No voice type gives you a specific person's voice *and* line-by-line written
direction. Voice training (a LoRA fine-tune) was the way to get both; it was
removed on 2026-10-02.

Chatterbox takes no written direction at any time; it steers through its
**Exaggeration** and **CFG weight** controls instead. No engine accepts
bracketed `[tag]` markup today — type one and it is removed before the model
sees it, rather than read aloud.

### Finding a voice in the library

The **Voices** tab is the library. Above it: a search box, then filters for
**engine**, **language**, **gender** and voice **type**. Language reads as a
name — *American English*, *British English*, *Chinese* — never as a code.
Any column heading sorts the list.

Each tab lists the engines that can do its job and what each one needs —
**Install speech runtime** when the runtime every engine runs on is not
installed yet, **Load** for a model that is not running (a load downloads the
model first if it isn't on disk).
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

Type what the clip says if you can. On Qwen3 Base and VoxCPM2 the transcript
is passed to the model with the clip (VoxCPM2 from speech runtime v0.9.0-jv.1);
on Chatterbox and Pocket TTS it is stored but not used. Leave the box empty and
the voice has no transcript — nothing is filled in for you. The form says which
you are looking at.

**Pocket TTS** clones on the CPU — about four times faster than real time on
an 8-core machine — so it is the one to pick without a graphics card, or with
one the AI model is using. Before its first clone the Clone tab shows
**Kyutai's terms for Pocket TTS** with an **Accept** button: Kyutai, who made
the model, asks everyone who clones with it to accept their prohibited-use
terms (no cloning without the person's consent, nothing deceptive). You accept
once; until then **▶ Play** waits, and a Pocket TTS clone asked for anywhere
else stops with a message saying so. Each language is its own Pocket TTS model
— load the one for the language you are cloning in. See
[Engines → The catalog](engines.md#the-catalog).

A clone gives you someone's own timbre and **loses written direction** — the
identity comes entirely from the reference clip.


### What each model asks for

Controls appear only when the chosen model actually uses them — a field
that changes nothing is never shown. **What's said in the recording**
appears for Qwen3 Base: it listens to your clip *while reading those
words*, so a word-for-word transcript gives a truer copy. Qwen3 Base needs
one of two things: the transcript, or the **Skip the words** checkbox, which
clones from the voice's fingerprint without any words — faster to set up, less
exact. A voice saved with **Skip the words** keeps it, so its renders clone the
same way. With neither, ▶ Play stops and says so. VoxCPM2 shows the field too and
clones from the clip alone when it is empty. Chatterbox copies the sound alone,
so that field doesn't appear there.

Every model dropdown shows each model's state the same way the rest of
the app does — **· loaded**, **(not loaded)**, **(not installed)** — and
lists models alphabetically.

## Design — from a description

Describe the voice in plain words — *"a gravel-voiced harbour-master in his
seventies, unhurried"* — and the model invents it. No recording needed.

This needs Qwen3's **VoiceDesign** model, a separate 2.8 GB download from the
CustomVoice and Base ones; loading it downloads it. There is only a 1.7B
VoiceDesign model — no smaller variant exists.

### Keeping a designed voice is what makes it one voice

VoiceDesign invents a speaker from scratch on **every single call**. Ask it
twice for "a gravel-voiced harbour-master" and you get two different
harbour-masters — same description, different person. That is fine for one
line and useless for a chapter.

So when you **Keep** a designed voice, JustVoice saves the audio you just
auditioned along with it, and from then on that clip is the voice: every
later line is cloned from it, and the speaker stays the same person all the
way through the book. The description is kept too — it names the voice in
the library, and it is what you edit if you want to design a new take on it.

Two consequences worth knowing:

- **A kept designed voice stops taking written direction**, exactly like any
  other clone (see [Clone](#clone--from-a-recording) below). Its identity
  lives in the clip now, and the model that clones has nowhere to put
  direction. Delivery still responds to the effects chain and the tuning
  knobs; it stops responding to prose.
- **Audition the take you actually want.** The clip you hear before you press
  Keep is the clip that becomes the voice, so it is worth re-rolling until
  one sounds right rather than keeping the first.

If a designed voice has no kept clip — one you made before this behaviour
existed — it still works, the older way: its description goes to the model on
every line, a line's own direction adds to it rather than replacing it, and
the speaker drifts a little from line to line. Design it again and keep it to
pin it down.

## Import — a clip as-is

Stores an audio file as a voice without learning anything from it. Use this
to keep a clip around; to make a voice that can speak *new* lines, clone it.

**Pick the model that speaks as this clip.** When an imported voice renders,
its clip goes to that model as a cloning reference — so the picker offers
cloning-capable models only, and defaults to your default TTS engine.

## Blend — make a voice out of other voices

> **Not available yet.** Blending runs on Kokoro, and Kokoro on the speech
> runtime (since 2026-10-01) cannot yet take a voice made of numbers, so the
> Blend tab offers no engine and a blended voice you made before cannot
> render. It returns when the runtime can — see
> [Engines → Not available yet](engines.md#not-available-yet). The rest of
> this section describes how blending works when it is available.

Blending needs **Kokoro**. A Kokoro voice is a block of numbers describing
how it sounds, so voices can be arithmetic on each other; most engines'
voices are not that kind of thing.

Above the pickers are **Language** and **Gender** filters, and every picker
on this tab shows a voice by name, language and gender — "Bella · American
English · female" — so you are choosing a voice, not decoding an id.

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
language, so does the blend; if they disagree, it takes your **Default voice
language** (Settings → Generation). That is why the Blend tab has no language picker — and it applies
to **Play** as well as to saving, so a mix of two Mandarin voices auditions
in Mandarin. (Kokoro does not translate: type your test line in the language
the voices speak.)

Pressing **Play** renders a sample without saving anything. If you like it,
**Save this voice** keeps the take you just heard rather than rendering a
second, slightly different one.

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
