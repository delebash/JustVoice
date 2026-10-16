# Engines

Every local speech engine in JustVoice runs on **one program — the speech
runtime**. It is [audio.cpp](https://github.com/0xShug0/audio.cpp) (Apache-2.0),
a C++ runtime for speech models — JustVoice installs its own build of it, made
from [JustVoice's copy](https://github.com/delebash/audio.cpp), the build that suits
your hardware, starts it when a model loads, and stops it when you close the
app. Each engine is then a set of model files the runtime can load, and each
model runs on your graphics card or your CPU — chosen per model, see
[Where each model runs](#where-each-model-runs--the-graphics-card-or-the-cpu).

**The list of models is audio.cpp's own.** AI Settings → Speech engines lists
every model audio.cpp runs that turns text into speech or speech into text, and
builds each one from audio.cpp's description of it: what it does, its languages,
its built-in voices, its settings and load options, every download audio.cpp's
own model manager offers for it, how much memory audio.cpp says it needs, and its
licence. When audio.cpp adds a model, the next JustVoice update lists it. So this
page doesn't copy each model's facts — the list shows them, and they are always
the current ones. It explains how to read the list
([Reading AI Settings → Speech engines](#reading-ai-settings--speech-engines)),
what JustVoice adds to audio.cpp's description, and what JustVoice measured.

Until 2026-10-01 each engine was its own Python program in its own Python
environment. The runtime replaced all of them at once, for three reasons we
measured on the same lines, seeds and settings before switching — see
[the switch record](plans/2026-10-01-audiocpp-switch.md) for every number:

- **Speed.** Qwen3 renders about 7× faster (2.0× real time against 0.26×),
  Chatterbox about 2× (2.1× against 0.9×), and models load in seconds rather
  than half a minute.
- **The same seed gives the same audio** — on every engine on the CPU, and on
  the graphics card on all but Pocket TTS and Qwen3-TTS, whose take can change
  slightly with the longest line spoken since the model loaded (measured again
  on 2026-10-16; see [the seed](#the-seed)). Before, only Qwen3 repeated itself.
- **One install instead of five.** No Python environments, no PyTorch
  download, nothing to rebuild when you move the install folder.

What the switch cost is listed under
[Not available yet](#not-available-yet) — nothing was hidden to make the
numbers look good.

> **Licences are shown, not hidden.** Every model keeps the licence of the
> people who trained it, and some don't allow commercial use. Speech engines
> labels each engine *Commercial use: Yes, Conditional, Separate licence, No or Unclear*, and
> says in plain words what that means for selling an audiobook you made with
> it — hover the label, or open the engine. A model that isn't a plain "Yes"
> asks you to accept its licence once, before its first download. Kokoro,
> KittenTTS, Pocket TTS, Qwen3-TTS, Chatterbox and VoxCPM2 all allow commercial
> use. (Until 2026-10-11 non-commercial models were left out altogether, Higgs
> Audio among them.) See [Commercial use, in plain words](#commercial-use-in-plain-words).

## The speech runtime

The **Speech runtime** row sits at the top of **AI Settings → Speech
engines → Local · free**, above the engines it runs. It shows the runtime's
version, the build in use and whether it is running:

- **Install speech runtime** — one-time. Downloads the runtime for this
  machine, checks that it starts, and puts it in place. Models download
  separately, per engine. Voice engine setup (the first-run wizard) does the
  same thing.
- **Backend** — which build runs. **Auto** picks CUDA on an NVIDIA card,
  Vulkan on AMD or Intel graphics, Metal on a Mac, and the CPU build when
  there is no usable GPU. Pick one yourself to override it. Changing the
  backend unloads the speech models and stops the runtime; the next load
  starts the build you chose. A build you have not downloaded yet shows as
  **not installed** until you click Install.
- **GPU** — which graphics card the runtime uses. Shown only on a machine
  with more than one.

The builds audio.cpp publishes, and what each costs to download:

| Your machine | Build |
|---|---|
| Windows, NVIDIA GeForce 40-series and older | CUDA 12.4, plus the CUDA runtime libraries |
| Windows, NVIDIA GeForce 50-series (Blackwell) and newer | CUDA 13.3, plus the CUDA runtime libraries |
| Windows, AMD or Intel graphics | Vulkan |
| Linux, any GPU | Vulkan |
| macOS | Metal |
| Any machine, no usable GPU | CPU |

The Windows CUDA 12.4 build is a 467 MB download plus 607 MB of NVIDIA's CUDA
runtime libraries (about 2 GB once unpacked), the CUDA 13.3 build 279 MB plus
575 MB, and the Vulkan build 67 MB — the files of v0.9.2-jv.6. Vulkan also
runs on NVIDIA cards, more slowly than CUDA. The CPU build is the portable one,
which also runs on older processors (the other CPU build stops at start on a
processor without the newest instructions).

Every file of the runtime is checked against the checksum published with its
release before anything is unpacked, and a download that stops resumes where
it stopped on the next attempt. **Reinstall** on the runtime row downloads the
runtime and eSpeak NG again over the installed ones — for a runtime that won't
start, or a file an antivirus took. The speech models unload while it runs and
load again on their next use; your downloaded models stay. (Under `npm run dev`
the app runs the build it made itself, so the row has no Reinstall.)

The runtime is pinned to one build of JustVoice's copy of audio.cpp — today
**v0.9.2-jv.6** (since 2026-10-16), audio.cpp v0.9.2 with JustVoice's changes: the
models and settings audio.cpp v0.9.2 brought (Kitten TTS 2 among them, and the
settings it renamed), Silero VAD in the runtime, F5-TTS freeing its memory on
**Unload**, and F5-TTS and KittenTTS giving the same take for the same seed. jv.5
added the small program that does the app's own audio work (effects, speed, gain
and pitch, the joins between pieces), which the installed app carries beside
itself. Since jv.4: Chatterbox Turbo and
Nano clone voices; Chatterbox speaks Hebrew, Russian, Chinese and Japanese (23
languages); Kokoro's five Japanese voices; Kokoro blends; a lexicon's exact
pronunciations (IPA) on Kokoro; Qwen3-TTS's memory fixes (up to 2.3 GB less while
it speaks); models joining their process without restarting it; and, from the
first build (jv.1), VoxCPM2 using a clip's transcript and word times right at any
sample rate. (Build numbers 2 and 3 were never published.) When a JustVoice update
moves to a newer build, the build you have
keeps working and the row offers **Update to** the new version. Clicking it
downloads the new build — the bar shows how far along it is — and unloads
whatever was loaded; load it again to use it. The older build is then deleted
(about 2 GB for a CUDA build); your downloaded models stay.

**The Japanese dictionary.** Kokoro's Japanese voices and Chatterbox in Japanese
read Japanese text with MeCab and its UniDic dictionary. MeCab comes inside the
runtime; the dictionary is an optional download, on its own row under the runtime
row: **Japanese dictionary · UniDic 1.0.8 · Install** (about 260 MB on disk). A
Japanese line without it stops with *"Japanese needs the Japanese dictionary —
install it on AI Settings → Speech engines."* Nothing else needs it.

**Two slots, a process for each.** The runtime holds at most one speech model
and one speech-recognition model at a time — the same two slots as before.
Loading a second speech model unloads the first. Each slot runs in a process of
its own — one on the graphics card and one on the CPU, each started only when a
model is placed there — so up to four, none with a window of its own. Because
they are separate, downloading or deleting a model never restarts the other
slot's model, and if one process stops, the other slot's model stays loaded.
Their logs are in your data folder: `logs/audiocpp-server.log` and
`logs/audiocpp-server-cpu.log` (speech), `logs/audiocpp-server-stt.log` and
`logs/audiocpp-server-cpu-stt.log` (speech recognition). A log over 10 MB is
kept as `….1.log` the next time its process starts, so the logs don't grow
without end.

- **CPU threads** — how many threads the models on the CPU compute with, next
  to the Backend select. It starts at your machine's physical core count, which
  is the fastest setting measured: Kokoro speaks 3.2× real time at 8 threads and
  2.3× at 4 on an 8-core Ryzen 7 5700X. Changing it reloads the models on the
  CPU; it is not shown when the runtime is the CPU build, which runs everything
  at this setting anyway.
- **Card overflow limit (MB)** — beside it (since 2026-10-15): *A card load that
  puts more than this in the computer's memory counts as not fitting; Auto then
  runs the model on the CPU.* It starts at 256; see
  [Where each model runs](#where-each-model-runs--the-graphics-card-or-the-cpu)
  for how a load is measured. Changing it restarts nothing — the next load on the
  card reads it. It shows only on Windows, the one system where that overflow is
  measured, and, like CPU threads, not when the runtime is the CPU build.

**eSpeak NG.** Kokoro and KittenTTS read text through eSpeak NG, the open-source
pronunciation library. Installing the runtime also downloads eSpeak NG
(GPL-3.0) onto your machine from its published Python package; JustVoice
itself never ships it. Both models use that copy, even when another eSpeak NG
is installed on the computer.

## Where the list comes from

audio.cpp describes every model it runs in its own files: a *model spec* per
family (what the model does, its voices, its settings and load options, its
downloads) and a catalog (which downloads its own model manager offers, how much
memory each model needs, its licence). JustVoice ships a copy of that description
with each release, read from JustVoice's copy of audio.cpp, and builds Speech
engines from it:

- **Which models are listed.** Every model audio.cpp marks *supported*,
  *community* or *experimental* that is on one of audio.cpp's own *Text to
  speech*, *Voice design* or *Speech to text* tabs, and whose download is
  complete. Models audio.cpp marks as work in progress, or unsupported, are left
  out. So, by JustVoice's own decisions, are AuK, OuteTTS and VieNeu-TTS v3 Turbo,
  which don't speak as listed ([Not available yet](#not-available-yet)), and
  Index-Echo: audio.cpp lists it with the recognisers, but it translates Chinese
  speech into English, Spanish or Japanese captions rather than transcribing.
  audio.cpp's models for other work — voice conversion, clean-up, sound effects,
  music — aren't speech models and aren't listed here.
- **An engine is a family; its rows are downloads.** Each of audio.cpp's model
  families is one engine on the list, and each download of each of its models —
  each precision, and each extra package audio.cpp's own model manager offers —
  is one row. Until 2026-10-15 only the models that copy a voice from a clip were
  listed.
- **Where the files come from.** Each download is fetched from the repository
  audio.cpp's catalog names for it, pinned to one commit, so a file never
  changes under you — most from
  [audio-cpp/audio.cpp-gguf](https://huggingface.co/audio-cpp/audio.cpp-gguf).
  The three models JustVoice converted itself — Qwen3-TTS CustomVoice 0.6B,
  Chatterbox Turbo and Chatterbox Nano — are in JustVoice's copy of the catalog,
  with their own repositories (see
  [The seven engines described by our own files](#the-seven-engines-described-by-our-own-files)).

**What JustVoice adds — the model's notes.** audio.cpp's description says what a
model is. What it can't say is in a small file of JustVoice's per family, the
model's notes: its licence read at its source and said in plain words, whether
JustVoice tested it and what it's best for, how a line's direction and emotion
reach it, its voices' genders where audio.cpp's own model documentation gives
them, the languages a checkpoint speaks when it speaks fewer than its family, and
the old names of settings audio.cpp has renamed. A model with no notes still
works as audio.cpp describes it; the list says it isn't tested by JustVoice yet,
and that it can't be directed yet.

**The seven engines described by our own files** — Kokoro, KittenTTS, Pocket
TTS, Qwen3-TTS, Chatterbox (with Turbo and Nano), VoxCPM2 and Speech recognition
(Qwen3-ASR) — are JustVoice's oldest engines, and their notes keep more: the
names, descriptions and ids you know (your voices, personas, saved settings,
takes and measured memory use them), the voices' genders and display names,
which Qwen3 checkpoint does what, Pocket TTS's nineteen other presets, Kyutai's
terms, and what JustVoice measured. Since 2026-10-16 their downloads, built-in
voices, languages and memory estimates come from audio.cpp's description, as
every other engine's do, and they show on the list the same way; what each sends
the runtime didn't change. Their own section is
[below](#the-seven-engines-described-by-our-own-files).

## Reading AI Settings → Speech engines

### From the top

**Local · free** and **Online · metered** are two folder tabs. *Local · free*
holds everything JustVoice installs, plus the speech servers you run yourself;
*Online · metered* holds the cloud speech services, billed to your account (see
[Online + self-hosted providers](#online--self-hosted-providers-llm--tts)).
Under *Local · free*, from top to bottom:

1. **The search and the kind chips** — the search finds engines and models by
   name and description, and opens the groups it matches. **All · TTS · STT ·
   Cloning · Built-in voices** narrow the list to speech, to speech recognition,
   to the models that copy a voice from a clip, or to the models with built-in
   voices.
2. **The filter row** — **Commercial use**, **Tested by JustVoice**, **Takes
   direction**, **Fits this card** and **Sort**; see
   [Finding a model](#finding-a-model).
3. **Loaded now** — one slot for speech (TTS) and one for speech recognition
   (STT), each naming the model loaded in it and its engine, with **Unload** to
   free the slot (the files stay on disk), or *— nothing loaded*.
4. **The speech runtime row** and, under it, **the Japanese dictionary row** —
   see [The speech runtime](#the-speech-runtime).
5. **Picking an engine is picking what a voice can do** — a table of what each
   main engine is for and what you give up with it; see
   [below](#picking-an-engine-is-picking-what-a-voice-can-do).
6. **Voice generation — TTS** and then **Transcription — STT** — the engines.
   Each heading counts its engines and their models, and says what its slot is
   for: *one model loaded at a time — loading another swaps the TTS slot*.
   **What for?** beside the Transcription heading explains speech recognition
   ([Speech recognition](#speech-recognition)).
7. **Self-hosted servers** — the speech servers you run yourself.

When the filters leave nothing, the list says *No engines match these filters.*
and offers **Clear filters**. With the server unreachable, the tab says *No
engines listed — the server may not be running* and points to Settings →
Server.

### An engine

An engine is one line, closed until you open it. Its head reads, left to right:

- **its name** and **its id** (`kokoro`, `index_tts2`);
- **TTS** or **STT** — whether it speaks or recognises speech;
- **Commercial use: Yes** (or *Conditional*, *Separate licence*, *No*,
  *Unclear*) — the licence in one word, coloured by it; hover it for the licence
  in plain words ([Commercial use](#commercial-use-in-plain-words));
- **TESTED BY JUSTVOICE** or **NOT TESTED BY JUSTVOICE YET** — hover it for what
  JustVoice found ([Tested by JustVoice](#tested-by-justvoice));
- **its description** — audio.cpp's, or, for the seven, JustVoice's;
- **how many models it has and how many are on disk** — *12 models · 2 on
  disk*, or *none on disk*;
- **● ‹model› loaded · CUDA** when one of its models is loaded, with where it
  runs (`CUDA`, `VULKAN`, `CPU`);
- **Set as default** (speech engines only) — the engine new voices and a first
  render's setup prefer; the default one reads **Default ✓**.

While the runtime isn't installed, every engine says **needs the speech
runtime**: its models can still download, and Load waits for the runtime. While
something on the engine runs, its head reads *working… · click to expand*.

Click the head to open it. An engine opens by itself when one of its models is
loaded, while one of its tasks runs, while a search is typed, and while a filter
about models is on (Cloning, Built-in voices, Takes direction, Fits this card) —
so you see which of its models match. Opened, it shows first a line of notes —
**Best for** (what JustVoice recommends it for), **Tested by
JustVoice** and what we found, and **Commercial use** in plain words with whose
reading it is and a link to the licence at its source — then its models, one row
each, and at the bottom its foot:

- **its licence or terms** — *Downloads wait until you accept its licence
  (‹licence›)* with **Read and accept**, then *Licence accepted — downloads are
  on*; or, on Pocket TTS, *Cloning waits until you accept Kyutai's terms*, then
  *Kyutai's terms accepted — cloning is on*;
- **Delete downloaded models** — when any of its models is on disk; deletes them
  all at once (the speech runtime stays installed). If a file is still in use —
  Windows will not delete a file a program holds open — it says so and names the
  folder, instead of claiming a delete that did not happen.

### A model's row

Each model row reads, left to right:

1. **Its name.** A download at another precision than the model's first says
   which: *(16-bit)*, *(4-bit)*, *(32-bit)*, *(original precision)*. A second
   download at the same precision carries audio.cpp's own word for it —
   Irodori-TTS's *(Anime Q8)* — and where a model has both 16-bit kinds, each
   says which: *(16-bit, bf16)*, *(16-bit, f16)*. See
   [Downloads and precisions](#downloads-and-precisions).
2. **Its chips** — the facts that decide what a voice on it can do:
   - **its languages** — the language's name for a model that speaks one
     (*English*), else how many (*23 languages*; hover for them by name), or
     audio.cpp's own words where it describes rather than lists (*100+
     languages*, *600+ languages*, *multilingual*). *auto* — the model detects
     the language — isn't counted as one;
   - **CLONING** — it copies a voice from a short clip
     ([Copying a voice, and making one from words](#copying-a-voice-and-making-one-from-words));
   - **BUILT-IN · N** — it speaks N voices of its own, no clip needed
     ([Built-in voices](#built-in-voices));
   - **how it is directed** — `✓ WRITTEN DIRECTION`, `✓ TAGS`, `SLIDERS ONLY`
     or `CAN'T BE DIRECTED YET`, the same words Cast and a persona's page use
     ([How a model takes direction](#how-a-model-takes-direction)). Speech
     recognition has none;
   - **audio.cpp's status** for the model's family — `SUPPORTED`, `COMMUNITY` or
     `EXPERIMENTAL`, audio.cpp's own word for how far along it is.
3. **Its download size**, and *· on disk* once every file is present at its
   recorded size — a half-fetched folder never counts.
4. **Its line** — what differs about this download: *16-bit weights.*, or, on
   the seven, a sentence of ours (*Clones a voice from a short clip, in French.
   8-bit weights.*).
5. **Its memory** — before a load, what it needs against your card
   ([Memory, before you load](#memory-before-you-load)); on the loaded row,
   **● Loaded** and what a load measured: *2.9 GB measured*, *~2.9 GB in
   memory* (read from the whole card's change while it loaded — a reading of the
   model's own process replaces it when one becomes possible), or *not measured
   yet* on its first load. A model loaded on the CPU, on a machine with a
   graphics card of its own, holds no graphics memory and shows no number.
6. **Its verbs** — **Download (‹size›)** while it isn't on disk; **Load model**
   once it is (*Load into the TTS slot*); **Unload model** on the loaded row
   (the files stay on disk). Then **Set as default** — the version this engine
   loads when nothing picks one, the same choice as a persona's **Version** —
   or **Default ✓**, and the **⋯** menu:
   - **Re-download** — deletes the local files and downloads fresh. Use it when
     a download looks corrupted.
   - **Open folder** — opens the model's folder in your file explorer (desktop
     app only; the browser UI can't reach your file manager and says so).
   - **View on Hugging Face** — the download's repository page.
   - **Delete downloaded model** — removes the downloaded files; the engine and
     its other models stay, and the model downloads again on demand. (Unload it
     first — a loaded model's files can't be deleted.)

   These are the same four verbs, in the same order and with the same words,
   as the **⋯** menu on an AI model row under **LLM providers**.

Under the row:

- **Runs on** — **Auto · GPU · CPU**, then where the model runs, or would load
  now, and why: *Loads on the CPU — 3.2× real time here, which keeps the
  graphics card for the AI model*. After a failed card load, **Try the card
  again**. See [Where each model runs](#where-each-model-runs--the-graphics-card-or-the-cpu).
- **Load options** — the options JustVoice measured stay on their own line
  (Qwen3-TTS's **Attention** and **Decoder weights**, Chatterbox
  Multilingual's **Checkpoint**), followed by *Read when the model loads — a
  change reloads it.* The rest fold under **Load options (N)**. See
  [Load options](#load-options).
- **A progress bar** while it downloads or loads — see
  [Cancelling an in-flight load](#cancelling-an-in-flight-load).

### Downloads and precisions

Every download audio.cpp's own model manager offers for a model is a row — never
fewer. Most models have an **8-bit** row, the first and the default, and a
**16-bit** row: the same model, a larger download that needs more memory. Some
have more: an *original precision* row (audio.cpp's own package of the weights as
their makers published them — Qwen3-TTS Base 1.7B and VoxCPM2 since 2026-10-16),
a *4-bit* row (MOSS-TTSD, Breeze TTS 2, CrisperWhisper), a *32-bit* row
(CosyVoice3), or a second package (Irodori-TTS's Anime model beside its v4 one).
A few ship one download only, or list their original precision first; the first
row is the engine's default until you pick another.

A row's size is the size of its files, checked against the checksum each
repository publishes. audio.cpp gives one memory estimate per model, shared by
all its downloads, so a 16-bit or original download can need more than the
estimate says — see [Memory, before you load](#memory-before-you-load). The
8-bit rows stay the defaults: on an 8 GB card they are what fits beside a
language model, and JustVoice's read-back found no 8-bit penalty on any engine
it measured ([8-bit or 16-bit](#8-bit-or-16-bit)). Pick another row with **Set
as default**, or with **Version** on a persona's page.

### Built-in voices

A model with **BUILT-IN · N** speaks N voices of its own, with no clip. They are
voices in the app like any other: listed on [Voices](voices.md), filtered the
same way, and any persona can use one. Each keeps audio.cpp's name for it
(`casual_female`, `us_male`, `M1`); its gender and language are set where the
model's notes give them (from audio.cpp's own model documentation), and
elsewhere the gender is *Not known* — set one on Voices if you want Smart-assign
to use it.

A model that copies no voice, makes none from words and names no voice of its
own speaks in its one voice, listed under the model's name: *Piper TTS
(built-in)*. Chatterbox Turbo and Nano, which also clone, list theirs as **Turbo
(built-in)** and **Nano (built-in)** (since 2026-10-16). Maya1's voice is shaped
by its *Voice description* setting (persona page → Sampling); until you set one it
speaks with audio.cpp's own, *Warm female voice with an American accent and
conversational pacing.*

### Copying a voice, and making one from words

**CLONING** marks a model that copies a voice from a clip: the persona page's
*New clone* offers every such model ([Personas → New
clone](personas.md#new-clone)). What a clone keeps differs by model — some take
the clip's words too, some need a clip of a certain length (Chatterbox Turbo and
Nano: longer than 5 seconds), and one asks you to accept its maker's terms
first (Pocket TTS — see [Pocket TTS](#pocket-tts)). Two of audio.cpp's models
read a script rather than a line: VibeVoice speaks each line as *Speaker 1: …* in
the voice's clip, and MOSS-TTSD tags it *[S1] …*, the clip's words too — you
don't need to do anything, JustVoice writes the script.

**Making a voice from words** is for every model audio.cpp's own *Voice design*
tab lists — Qwen3-TTS VoiceDesign and VoxCPM2 among them: the persona page's
*New design* offers each ([Personas → New design](personas.md#new-design)). The
description goes to the model as its voice description, the way audio.cpp's own
tab sends it. The row has no chip for this; *New design* lists every model
that can.

### How a model takes direction

The direction chip says how a line's direction and emotion reach a voice on the
model — the same words as Cast and the persona page:

| Chip | What it means |
|---|---|
| `✓ WRITTEN DIRECTION` | The model takes a line's direction or emotion, in the way its notes say (the table below). On Qwen3-TTS CustomVoice and VoiceDesign and VoxCPM2, a persona's Style Instructions and a line's own direction, in words |
| `✓ TAGS` | Its own tags, picked from its list — Chatterbox Turbo and Nano, and audio.cpp's built-in-voice Turbo package ([Inline tags](#inline-tags-are-chatterbox-turbos-and-nanos)) |
| `SLIDERS ONLY` | Pace, pitch and gain; no words, no tags |
| `CAN'T BE DIRECTED YET` | A model JustVoice doesn't know how to direct yet — one with no direction in its notes. Every line is spoken plainly; pace, pitch and gain still apply (since 2026-10-15; they read *sliders only* before) |

The **Takes direction** filter keeps the first two. A model that acts on only some
emotions offers only those on the persona page and in Render's *This line only*.
How each of audio.cpp's models that takes direction gets it — each the way its
authors document it:

| Model | How a line's emotion and direction reach it |
|---|---|
| **IndexTTS 2 / 2.5** | The line's direction in words, which its own emotion model turns into an emotion mix — the way JustVoice tested it (12 of 21 lines acted like the book). Its *emotion_alpha* setting (how strongly) applies when you set it; otherwise audio.cpp's own, full strength. In that test it never muttered or sounded contemptuous |
| **CosyVoice3** | Only what its authors document: very happy, very sad, very angry, as loudly as possible, and in a very soft voice. Other directions are spoken plainly |
| **Breeze TTS 2** | The direction as its instruction, with its guidance raised to 4 on a directed line unless you set it yourself |
| **Higgs Audio 3** | Its own emotion and style tags — happy, sad, angry, fearful, contemptuous (as disgust), whispered, shouted. It reads any other tag aloud, so nothing else is sent |
| **Fish Audio S2 Pro** | The emotion as a tag and the direction as a short description at the start of the line |
| **MOSS-TTSD**, **MOSS-TTS v1.5** | The line's direction in words, as its instruction (since 2026-10-15; not yet tested by JustVoice) |
| **OmniVoice** (and VoiceTut-TTS) | Only *whispered*, as its own word *whisper*: OmniVoice takes nothing but its own list of words there (gender, age, pitch, whisper, accents) and refuses anything else, so no other emotion and no written direction is sent (since 2026-10-15; not yet tested) |

### Settings, and Advanced

A model's settings aren't on its row — they are per persona and per line: the
persona page's **Sampling** and Render's **This line only**. Each comes from
audio.cpp's description of the model, as audio.cpp's own screen shows it — a
slider, a dropdown, an on/off switch or a text field — with audio.cpp's label,
starting at audio.cpp's own default. A number with no top or no bottom, or one
audio.cpp's own screen shows as a box, is a number box you type into (MioTTS's
*Max tokens*, CosyVoice3's *num_inference_steps*). A setting the model gives no
default for shows none until you set it; until then audio.cpp's own applies. The
settings audio.cpp's own screen shows for the model stay in view; the rest, for
experts, fold under **Advanced (N)** at the end of the card.

What JustVoice sends itself — the line's text, the voice's clip and its words,
the language, the seed (its own box), the direction the model's notes route — is
never a setting, nor are file paths on the computer running the speech runtime,
nor streaming (JustVoice renders whole lines). The seven engines' settings are
listed under [What each engine can be tuned with](#what-each-engine-can-be-tuned-with).

### Load options

Some options are read when a model loads rather than per line, so they live on
its row. Every one audio.cpp's description of the model lists is there (since
2026-10-15), each starting at audio.cpp's own default — a dropdown, an on/off
switch, a number box or a text field, with its **↺** to go back to the default.
They fold under **Load options (N)** below the row, as audio.cpp's own screen
folds a model's options; open it to see them. Many are for experts: memory pool
sizes in MB, the weights' storage type. File paths are never among them — the
files a model needs are JustVoice's to give.

The ones JustVoice measured stay on the row itself:

- **Attention** (Qwen3-TTS) — *Exact* or *Flash attention*: about 9 % faster
  and 0.2 GB less at the peak, and the same seed gives a different take. Only
  the 8-bit rows offer it: the runtime refuses it on 16-bit weights.
- **Decoder weights** (Qwen3-TTS) — *16-bit* (the default) or *32-bit*. 16-bit
  takes about 0.5 GB less at the peak; at the same seed the two measure slightly
  apart, but in a listening test no difference could be heard, so 16-bit became
  the default on 2026-10-04 — JustVoice's default, where audio.cpp's own is
  32-bit. Pick 32-bit on a model's row to go back. (audio.cpp also offers
  *native*, the file's own.)
- **Checkpoint** (Chatterbox Multilingual) — *v2* (the default) or *v3*,
  audio.cpp's own word for the two multilingual checkpoints inside the same
  downloaded file; v3 is the newer. It speaks the same 23 languages either way,
  and an English line uses Chatterbox's English checkpoint whichever you pick, so
  the choice changes only the other languages.

Changing one on a loaded model reloads it. A load option can change how much
memory the model takes, so its measured memory is kept per set of load options:
the first load with a new set measures it again, and going back to the defaults
finds the earlier measurement. They are saved per model in
`settings.engines.engine_overrides[engine].runtime_options[model]` (see
[Settings reference](settings-reference.md)).

### Memory, before you load

Each model row says how much graphics memory it needs before you download it:

- **about X GB, measured here** — an earlier load measured it on this machine.
  That number wins. It **fits this card** when it and the speech margin (0.5 GB,
  below) fit — the rule *Auto* loads it by; when it fits only without the margin
  the row says *more than this card holds with the 0.5 GB safety margin* (since
  2026-10-15), and when it is more than the whole card, *more than this card
  has*. The margin shown is the one your server keeps.
- **needs about X GB · fits this card** — for a model JustVoice hasn't measured
  yet: audio.cpp's own estimate, or the size of its download when that is more.
  audio.cpp gives one estimate per model, shared by all its precisions, so a
  16-bit or original download can be bigger than the estimate (FireRedAudio's
  original weights are 23 GB against an estimate of 10) — and the weights alone
  take at least their own size. A model with no estimate — MOSS-TTSD, JustVoice's
  own conversions — is judged by its files. An estimate that fits the card only
  without the speech margin — audio.cpp's 8 GB for Qwen3-TTS Base 1.7B on an
  8 GB card — still reads *fits this card* here, and its *Runs on* line says the
  card is tried first, as below (since 2026-10-16; before, that line gave no
  reason).
- **needs about X GB · too big for this card — Load runs it on the CPU** —
  that number is more than your card has, so *Auto* loads it on the CPU, and the
  row's *Runs on* line says why: *audio.cpp says it needs about 18 GB, more than
  this card's 8 GB — this may be slow on the CPU*, or *its files are about 12 GB,
  more than this card's 8 GB — this may be slow on the CPU*. Unlike Auto's other
  move to the CPU, this one doesn't wait for a model to be fast there — OmniVoice
  ran about 17 times slower than real time — so once it has spoken a line, the
  line shows its measured speed in place of the warning (*— 0.1× real time
  here*). Once a load measures it on your card, the measurement decides instead.
- **needs about X GB · more than this card has** — only audio.cpp's estimate is
  too big: the model's files, with the speech margin, fit your card. Such an
  estimate can be far off — OmniVoice's is 10 GB, and on an 8 GB card its 1.3 GB
  of files took 1.2 GB — so Auto tries the card first and the *Runs on* line says
  so: *audio.cpp says it needs about 10 GB, but its files are about 1.3 GB, so it
  tries the graphics card first; if it doesn't fit, Load runs it on the CPU*.
- **memory not measured yet** — neither number is known. Every model audio.cpp
  describes has at least its download's size, so this shows only for one with no
  number at all. (Until 2026-10-16 the seven engines described by our own files
  said this until their first load; they now show audio.cpp's estimate, or their
  files where those are more, like every model — Kokoro *needs about 1 GB*,
  Chatterbox Multilingual *needs about 12 GB*, audio.cpp's own estimate for it.)

Without a graphics card of its own — a Mac, or graphics that share the computer's
memory — the row shows the number without *fits this card*: there is no card to
fit. The **Fits this card** filter keeps the models whose number fits your card.

### Commercial use, in plain words

The question each label answers is one: *can you sell an audiobook you made
with this model, on your own machine?* JustVoice read every speech model's
licence at its source — the speakers on 2026-10-11, the speech-recognition
models and the speakers listed since on 2026-10-15 — and wrote the answer in
plain words. Hover the label for it, or open the engine, where it sits under
*Best for* and *Tested by JustVoice* — the opened engine is the way on a phone,
which has no hover. Each answer names the licence, the date it was read, and a
link to the licence itself, which is what counts.

| Label | What it means |
|---|---|
| **Yes** | Sell what you make with it — no conditions. |
| **Conditional** | Sell what you make if you meet its conditions — credit, a revenue cap. The plain words say which. |
| **Separate licence** | Not under the free licence — its makers sell or grant a separate one for commercial use. The plain words say who to ask. |
| **No** | Personal and research use only — don't sell what you make. |
| **Unclear** | The licence doesn't say, or its makers contradict it. Treat it as No until it's checked. |

The **Commercial use** filter above the list shows the same meanings under each
choice.

**A model that isn't a plain *Yes* asks you to accept its licence once, before
its first download.** **Download** (or **Load model**) on any of its rows opens
the licence in plain words — *‹Engine›'s licence isn't a plain yes for commercial
use, so it's yours to read before you download the model* — with **Accept the
licence** and **Not now**; the engine's foot offers **Read and accept** too. You accept once, on this install. (Pocket TTS's
prompt is Kyutai's terms, before cloning — see [Pocket TTS](#pocket-tts).)

**Where JustVoice's answer differs from audio.cpp's.** audio.cpp keeps a
licence table of its own, and it mostly reads a licence's title. Where reading
the whole licence gave a different answer, the label shows JustVoice's word and
the opened engine says what audio.cpp's table says beside it (*— audio.cpp's
licence table says "No"*). JustVoice's readings that differ, and why:

| Model | JustVoice | Why |
|---|---|---|
| Higgs Audio 3 | **Conditional** | Its *Creator Use Grant* lets you sell your own audiobooks, podcasts and videos if you credit "Boson AI's Higgs Audio" where listeners can see it; no revenue cap |
| IndexTTS 2 / 2.5 | **Unclear** | Its own licence caps revenue at RMB 100 million a year (the Chinese text, which governs — the English says 1 billion), but one part it runs, MaskGCT's semantic codec, is non-commercial |
| FireRedTTS3, FireRedAudio | **Unclear** | Apache-2.0, but their makers write that voice cloning is "solely for academic research purposes". FireRedAudio's speech recognition is outside that sentence: its recogniser reads *Yes* |
| Fish Audio S2 Pro, Breeze TTS 2 | **Separate licence** | Their free licences grant no commercial rights, and each names the separate written licence its maker offers |
| ZipVoice | **No** | Its makers added a non-commercial licence (CC-BY-NC) to it on 2026-10-10 |
| F5-TTS (Habibi-TTS) | **Conditional** | Its models are licensed two ways: ALG, EGY, IRQ, MAR and MSA under Apache-2.0; Unified, SAU and UAE non-commercial (CC-BY-NC-SA-4.0) because of their training data |
| Maya1 | **Conditional** | Its card says Apache-2.0, but it was first published as built on Meta's Llama 3.2 3B, so Meta's terms likely apply too: follow Meta's Acceptable Use Policy |
| Supertonic 3 | **Conditional** | Its licence (OpenRAIL-M) forbids putting out what it makes without saying plainly that it is machine-generated |
| sanoTTS | **Unclear** | Depends on the voice: heart, heart-nano and kristin learned from openly licensed voices; the others from Piper voices whose own cards name non-commercial or unknown recordings |
| VibeVoice | **Unclear** | MIT, but Microsoft's card limits it to research use, and Microsoft has withdrawn its speech code and its own 7B model |
| CrisperWhisper 2.0, Hviske ASR (v5.3) | **Separate licence** | Non-commercial, and each maker offers a separate commercial licence — the plain words say who to ask |

**A model JustVoice hasn't read the licence of yet** — one audio.cpp adds in a
later update — shows audio.cpp's own word and notes from its licence table until
JustVoice reads it, and asks you to accept its licence before its first download
the same way when it isn't a *Yes* there. Every model listed today has
JustVoice's own reading (since 2026-10-15).

### Tested by JustVoice

**TESTED BY JUSTVOICE** means JustVoice ran the model itself and wrote down what
it found; the opened engine says what, and the chip's hover too. The seven engines
described by our own files read *Measured by JustVoice* — their speeds, memory and
read-back are under [What JustVoice measured](#what-justvoice-measured). IndexTTS 2
and CosyVoice3 were tested for acting a cloned voice's emotion (IndexTTS 2: *Acted
12 of 21 lines like the book in a blind test, with directions in words; kept the
cloned voice*). **NOT TESTED BY JUSTVOICE YET** — its hover says *Works as
audio.cpp describes it; JustVoice hasn't listened to it yet* — means just that:
the model does what audio.cpp's description says, and nobody at JustVoice has
listened to it for a book. The **Tested by JustVoice** filter shows the current
set.

### Speech recognition

The engines under **Transcription — STT** recognise speech; they don't speak.
**What for?** beside the heading says what they serve: *Speech recognition is not
a voice — nothing here speaks. It turns speech into text: Captures' dictation, the
words of a capture you clone a voice from (they fill in its transcript), and, for
other apps, transcripts and caption timings.* Other apps reach them through
`/v1/transcribe`, `/v1/align` and the MCP tool `justvoice.transcribe`. The take
check reads a chapter's takes back with them too, to find a take that skipped
words or ran on ([Studio → Checking takes](studio.md#checking-takes)).

Load a recogniser on its row and it is the one that transcribes. With none
loaded, Qwen3-ASR 1.7B loads on first use (`settings.captures.stt_model`). Word
timings — chapter captions and `/v1/align` — need an aligner, and audio.cpp has
only Qwen3's, so a caption request loads Qwen3-ASR in the speech-recognition slot,
whichever recogniser was there. Each recogniser hears the recording at 16 kHz
mono, as audio.cpp's own page sends it: several (OWSM, CrisperWhisper,
MOSS-Transcribe-Diarize, Hviske v6) can't take any other rate. Where a model adds
times or speaker labels to its text (MOSS-Transcribe-Diarize, VibeVoice-ASR
Streaming), JustVoice keeps the words alone (since 2026-10-15; before, a
transcript read *[0.06][S01] …* or *Speaker 0: …*). Where a family both speaks
and recognises speech (FireRedAudio, LFM2.5-Audio), each has its own engine, and
the two share one download: on disk once, shown as downloaded on both, deleted
from both together.

### Languages

A model's language chip is what its description lists — or, where a checkpoint
speaks fewer languages than its family, what its notes say it speaks (since
2026-10-15): LFM2.5-Audio 1.5B English and its JP model Japanese, GigaAM v3
Russian, IndexTTS2 Chinese and English (IndexTTS2.5 adds Japanese, Spanish and
Arabic), each Habibi-TTS model its own Arabic, VoiceTut-TTS *Arabic (Egypt)* and
English. What a model lists is what Cast offers it for and what a persona on it
can speak. Each sanoTTS download speaks one language, so a persona's language
picks the download, as Pocket TTS's does, and a language none of them speaks is
refused by name.

The line's language goes to the model in the form it expects, so you never type
it. A model built from audio.cpp's description gets it in the form its own list
names it (`en`, or `en-US` where only that is listed). Where the list names none
in a form the model takes — OmniVoice's *600+ languages*, dots.tts's
*multilingual*, or Arabic on a model that lists only English and Chinese — the
line goes without one, as audio.cpp's own page sends it by default, and the model
picks the language itself (since 2026-10-15: OmniVoice refused an Arabic line
sent as `ar`). So does a line in a language the model itself doesn't list —
English on LFM2.5-Audio's JP model, say. MOSS-TTS v1.5, MOSS-TTSD and
MOSS-VoiceGenerator get it as its name — *English* or *Chinese* — and IndexTTS2
as its code, where those models read it (since 2026-10-15). A speech-recognition
model is sent the language whatever it lists, so one that can't take it says so —
LFM2.5-Audio's JP model given English. How the seven take it is in their own
section.

### Finding a model

The filter row narrows and orders the list:

- **Commercial use** — *Any commercial use*, or one of the five labels, each with
  its meaning under it.
- **Tested by JustVoice** — only engines we have tested.
- **Takes direction** — only models that take written direction or tags.
- **Fits this card** — only models whose memory fits your graphics card
  (shown when there is one).
- **Sort** — by name, download size, memory needed or commercial use. Size and
  memory sort an engine by its smallest model; an engine none of whose models
  has a known memory sorts last.

A filter about models (Cloning, Built-in voices, Takes direction, Fits this card)
shows only the models that match, and opens their engines; an engine with none
drops out.

## Picking an engine is picking what a voice can do

The Speech engines tab shows this table above the engines. A persona's voice
brings its model, and the model decides what that persona can do on every line:
whether it can clone someone's voice, and whether it takes written direction,
tags, or only pace, pitch and gain.

| If you want… | Use | What you give up |
|---|---|---|
| Ready-made voices, fast, on any machine | Kokoro — 54 built-in voices, 9 languages | No cloning and no written direction — pace, pitch, gain and pauses only |
| English voices made for the CPU | Kitten — 8 built-in voices | English only; no cloning, no written direction |
| Someone's own voice on a modest machine | Pocket — cloning, 20 built-in voices | One language per model; no written direction |
| To direct performances in words | Qwen3 CustomVoice — 9 built-in voices, 10 languages | Cannot clone |
| Someone's own voice, in 10 languages | Qwen3 Base | Written direction is dropped |
| A voice designed from a description | Qwen3 VoiceDesign | — |
| Someone's own voice, with per-line emotion tags | Chatterbox Turbo or Nano — 19 tags | English only; no written direction |
| Someone's own voice in another language | Chatterbox Multilingual — 23 languages | No written direction, no tags |
| Cloning, designing and written direction together | VoxCPM2 — 30 languages | The largest download (2.8 GB at 8-bit) |

Each engine's *Best for* line, in the opened engine, says the same. Beyond these:

- **Someone's own voice, acting each line's emotion** — IndexTTS 2.5: tested by
  JustVoice, it acted 12 of 21 lines like the book in a blind test and kept the
  cloned voice. Its commercial use is *Unclear* — [why](#commercial-use-in-plain-words)
  (accept its licence first) — and in that test it never muttered or sounded
  contemptuous.
- **The newest models** — the rest of the list. Most are *Not tested by JustVoice
  yet*, and several are non-commercial: check the label first.

## Picking an engine for a use case

- **Audiobook narration in your own voice.** Chatterbox Multilingual or Qwen3
  Base. Clone from a minute or two of clean read-aloud.
- **Audiobook with many speakers.** Cloned or designed voices for the main speakers, Kokoro for minor ones — faster to render, 54 voices to choose from.
- **Directed performances.** Qwen3 CustomVoice — tell each line how to sound
  in plain words.
- **A voice nobody recorded.** Qwen3 VoiceDesign — describe it.
- **Multilingual audiobook.** Chatterbox Multilingual clones in 23 languages;
  Qwen3 covers 10, including Chinese, Japanese and Korean.
- **Game dialogue at 50–500 line scale.** Kokoro. Render speed matters at
  scale.
- **Dictation playback** (MCP `speak` tool). Kokoro. Lowest latency.
- **No graphics card, or a small one shared with an AI model.** Kokoro and
  KittenTTS for built-in voices, Pocket TTS for cloning — all three speak more
  than three times faster than real time on an 8-core CPU.

## The seven engines described by our own files

What JustVoice knows about its seven oldest engines, beyond what their rows
show.

### Kokoro

82M parameters, 54 built-in voices in nine languages (American and British
English, Mandarin, Spanish, French, Hindi, Italian, Brazilian Portuguese,
Japanese). A Kokoro voice speaks its own language. A line sent to it in a
language Kokoro doesn't speak — through the API, MCP or JustWrite — goes without
one, so the voice reads it in its own language (audio.cpp's default) rather than
in US English. A blend does the same in its own language — the one it was saved
with (since 2026-10-15; before, a blend fell back to US English there). Kokoro
is the model that blends voices ([Personas → New blend](personas.md#new-blend))
and reads a lexicon's exact pronunciations (IPA); its Japanese voices need the
[Japanese dictionary](#the-speech-runtime).

### KittenTTS

A small English model built to run without a graphics card, with eight built-in
voices: Bella, Luna, Rosie and Kiki (female), Jasper, Bruno, Hugo and Leo (male).
The same seed repeats its take on the CPU, where KittenTTS is meant to run, and
on the graphics card, so it offers a seed like every engine (since 2026-10-16;
before, it offered none — see [The seed](#the-seed)). It ships one download,
already unquantized.

### Pocket TTS

Kyutai's small cloning model — the one that clones fast enough on a CPU. It
clones from a short clip (no transcript needed) and speaks 20 built-in voices.
Each language is its own model and its own download; the presets speak whichever
language's model is loaded, and a line in another language stops with a message
naming the model to load, rather than reading German with English sounds.

- **Its presets** are the 20 of Kyutai's 26 whose recordings permit selling
  what you make: Alba, Estelle, the twelve VCTK voices (Anna, Azelma, Charles,
  Eponine, Eve, Fantine, George, Jane, Mary, Michael, Paul, Vera), the four
  Voice-Zero voices (Bill Boerst, Caro Davy, Peter Yearsley, Stuart Bell) and
  two donated voices (Javert, Marius). Cosette and Jean come from
  non-commercial recordings and four more state no licence, so they are left
  out. audio.cpp's description names only Alba; the other nineteen are files of
  the same repository, which the model's notes list and each language's download
  fetches. Kyutai gives them no gender; set one on the Voices page if you want
  Smart-assign to use it.
- **Pocket TTS French clones only** (since 2026-10-16). Kyutai's one French
  voice, Cosette, is from a recording that forbids commercial use, so JustVoice
  doesn't offer it, and the other twenty have no French version: its row has
  CLONING and no BUILT-IN, and the presets list English, German, Italian,
  Portuguese and Spanish — not French — on the Voices page and the persona page,
  so a persona on one can't be saved in French (since 2026-10-16). With no voice of its own to speak a warm-up in, it
  measures its memory on its first line, like the other models that speak only
  from a clip (see [How fast, and how much memory](#how-fast-and-how-much-memory)).
  It hasn't been timed on a CPU yet, so Auto doesn't
  send it there on speed (see [Where each model runs](#where-each-model-runs--the-graphics-card-or-the-cpu)).
- **The same seed repeats a take on the CPU**, where Pocket TTS usually runs; on the
  graphics card a take can change slightly with the longest line it has spoken
  since it loaded — the words stay, but the sound drifts after a few seconds
  ([The seed](#the-seed)).
- **Its languages are not equally good.** Read back by a recogniser on
  2026-10-02, English, German and Italian came out clean; Portuguese and
  Spanish sometimes leave words out, depending on the seed — a long line in
  quotation marks kept only its last sentence. Listen to a few lines before a
  long render in those two.
- **Cloning asks you to accept Kyutai's terms, once.** JustVoice downloads
  Pocket TTS from audio.cpp's copy, which needs no sign-in. Kyutai, who made it,
  asks everyone who clones with it to accept their prohibited-use terms — no
  cloning a voice without that person's consent, nothing deceptive, nothing
  presented as a genuine recording of a real person. A persona's New clone shows
  the terms with an **Accept** button when Pocket TTS is the chosen model, the
  Pocket TTS engine's foot on Speech engines has **Read and accept**, and a Pocket TTS
  clone asked for anywhere else (a chapter, a persona's Hear it, JustWrite, the API) stops
  with a message until you have. Built-in voices need no acceptance.
- **The weights are CC-BY-4.0**, which permits commercial use; the credit it
  asks for is in NOTICE.md.

### Qwen3-TTS

**Three different models**, and the difference decides what you can do with it:

- **CustomVoice** ships 9 built-in voices (Vivian, Serena, Uncle Fu, Dylan,
  Eric, Ryan, Aiden, Ono Anna, Sohee) and takes a plain-English instruction to
  steer their style and emotion. It **cannot clone**. It comes in two sizes
  with the same voices: 1.7B, and 0.6B — a smaller download that needs less
  graphics memory. audio.cpp doesn't publish the 0.6B: JustVoice converted
  Qwen's official checkpoint with the runtime's converter and published it at
  [delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF](https://huggingface.co/delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF)
  (its page has the exact conversion and what was checked).
- **Base** clones from a 3–10 second reference clip and its transcript, and
  has no built-in voices. It ignores written direction.
- **VoiceDesign** makes a voice from a written description ("a gravelly
  harbour-master, sixties, unhurried") and speaks the line in it.

All three speak Chinese, English, Japanese, Korean, German, French, Russian,
Portuguese, Spanish and Italian. The line's language goes to Qwen3 by name; a line
with no language, or one Qwen3 doesn't speak, goes as *Auto* and Qwen3 picks it
itself (until 2026-10-04 it was read as English). Its two measured load options
are under [Load options](#load-options).

### Chatterbox

- **Chatterbox Multilingual** clones a voice in 23 languages — Arabic, Danish,
  German, Greek, English, Spanish, Finnish, French, Hebrew, Hindi, Italian,
  Japanese, Korean, Malay, Dutch, Norwegian, Polish, Portuguese, Russian,
  Swedish, Swahili, Turkish and Chinese (Japanese with the
  [Japanese dictionary](#the-speech-runtime)). It is steered by Exaggeration and
  CFG weight rather than words. Its **Checkpoint** load option picks v2 or v3
  ([Load options](#load-options)).
- **Chatterbox Turbo and Nano** are English-only Chatterbox models that clone from
  a clip longer than 5 seconds and take the [inline tags](#inline-tags-are-chatterbox-turbos-and-nanos).
  Turbo is the larger (350M parameters); Nano is Turbo's design at 110M, for the CPU
  and small cards. They have no Exaggeration or CFG weight — only Temperature,
  Repetition penalty, Top p and Top k. They come from JustVoice's own conversions of
  Resemble AI's checkpoints (MIT), at
  [delebash/chatterbox-turbo-GGUF](https://huggingface.co/delebash/chatterbox-turbo-GGUF)
  and [delebash/chatterbox-nano-GGUF](https://huggingface.co/delebash/chatterbox-nano-GGUF).
  Each also speaks its own voice, with no clip (since 2026-10-16): **Turbo (built-in)**
  and **Nano (built-in)** among Chatterbox's voices on the Voices page, gender *Not
  known* — Resemble gives the voice no name or gender.
- **Chatterbox Turbo (built-in voice only)** (since 2026-10-16) is audio.cpp's own
  Turbo package, listed beside them: its built-in voice (**Chatterbox Turbo
  (built-in)**), Turbo's settings and tags, and no cloning — it carries no voice
  encoder, so a cloned voice is refused by name. It has only its 8-bit file.

### VoxCPM2

OpenBMB's 2B model. It clones a voice from a short clip, or designs one from a
written description, in 30 languages, at 48 kHz — and it is the one engine where
**written direction reaches a cloned voice**: a persona's Style Instructions or a
line's direction steers a clone the way it steers Qwen3 CustomVoice. When a cloned
voice has a transcript of its clip, VoxCPM2 uses that too, as Qwen3 Base does —
except on a directed line ([below](#a-directed-voxcpm2-line-is-spoken-from-the-clip-alone)).
It does not speak anything in parentheses — it reads brackets as direction — so
JustVoice turns a line's own brackets into dashes ("He left (quietly) and…" is read
as "He left — quietly — and…"). It is a graphics-card model: about 1.3× real time on
an 8 GB card, 0.2× on a CPU.

### Speech recognition (Qwen3-ASR)

The engine named *Speech recognition*: Qwen3-ASR 1.7B (the default), Qwen3-ASR
0.6B (since 2026-10-15) and QwenCleo-ASR Egyptian Arabic (since 2026-10-16), a
Qwen3-ASR fine-tune for Egyptian Arabic and Arabic-English speech. Each comes with
Qwen3's word aligner in the same download, so each gives word timings. 30 languages
on Qwen3-ASR; set the language when you know it — detection is its weak spot.
Speech recognition is given the language's name, and detects the language itself
for one it doesn't know. It replaced Whisper, which got more words wrong on both
human speech (5.8 % against 4.3 %) and rendered narration (9.9 % against 8.6 %).

## What JustVoice measured

### How fast, and how much memory

Measured on an RTX 2070 SUPER (8 GB) on 2026-10-01, rendering a whole novel
(289 lines) per engine, and on that machine's CPU — an 8-core Ryzen 7 5700X, 8
threads — on 2026-10-02:

| Model | On the graphics card | On the CPU | Graphics memory |
|---|---|---|---|
| Kokoro | 11.9× real time on CUDA · 2.8× on Vulkan | 3.2× | under 1 GB |
| KittenTTS Mini 0.8 | — | 3.4× | — |
| Pocket TTS | — | English 3.9× presets · 4.1× cloning; German, Italian, Portuguese, Spanish 3.4–3.6× | — |
| Qwen3-TTS CustomVoice 1.7B | 1.9× real time on CUDA · 1.7× on Vulkan | — | 3–7.8 GB while rendering |
| Chatterbox Multilingual | 2.1× real time on CUDA | — | about 3.2 GB |
| VoxCPM2 | 1.3–1.4× real time on CUDA (16-bit: about 1×) | 0.2× | about 2.9 GB loaded (16-bit: 4.9 GB) |
| Qwen3-ASR 1.7B (recognition) | — | 2.6×, with the same accuracy | about 3–4 GB |

"Real time" is seconds of audio per second of rendering: 2× renders an hour
of narration in half an hour. Your numbers will differ with your machine; the
memory strip at the top of the console shows the real figure for your card
after the first load, and a model's row shows the CPU speed measured on your
machine after its first line there. A model placed on the CPU uses no
graphics memory at all — measured at 0 MB on both the CUDA and Vulkan builds.

### 8-bit or 16-bit

Each model's 8-bit row is the default because it is smaller and needs less
memory — on an 8 GB card it is what fits beside a language model. The 16-bit row
is the same model at its original precision. On 2026-10-02 every engine read the
same real chapter (30 lines and two long passages) at both precisions, and Qwen3's
own recogniser read every take back:

| Model | Words wrong, 8-bit / 16-bit | Lines more than 20 % wrong |
|---|---|---|
| Kokoro | 5.6 % / 5.6 % | 2 / 2 |
| Pocket TTS, English | 6.2 % / 6.2 % | 2 / 2 |
| Qwen3-TTS CustomVoice 1.7B | 9.9 % / 10.9 % | 6 / 5 |
| Qwen3-TTS CustomVoice 0.6B | 9.0 % / 8.5 % | 4 / 3 |
| Chatterbox Multilingual (the whole chapter, 3 takes per line) | 10.8 % / 11.2 % | 19 / 18 of 150 |

Most of what reads as "wrong" is the recogniser spelling invented names its own
way (Cael as "Kale"), which happens at both precisions. None of the engines showed
an 8-bit penalty: Qwen3's occasional long pause or garbled short line turned up at
16-bit as often as at 8-bit, and Chatterbox — which looked better at 16-bit on a
first, single-take run of 30 lines — came out level once the whole chapter was read
three times at each precision. Pocket TTS's Portuguese and Spanish models drop words
now and then at both precisions, so the 16-bit row does not fix that either. The
8-bit rows stay the defaults; the 16-bit rows are there for anyone who wants the
original precision.

## Where each model runs — the graphics card or the CPU

Each model runs either on your graphics card or on your CPU, and every model
row on Speech engines has its own line saying which: **Runs on** with an
**Auto · GPU · CPU** choice, followed by where it runs — or would load now —
and why ("Loads on the CPU — 3.2× real time here, which keeps the graphics
card for the AI model"). The reason it matters: on an 8 GB card, Kokoro on the
graphics card pushed a 6.8 GB language model out, while on the CPU it speaks
three times faster than real time and takes nothing from the card.

**Auto** first checks the card's real free memory (since 2026-10-15): a model
whose graphics memory doesn't fit with the speech margin beside what other
programs use on the card — a game, a second AI server — runs on the CPU. Before,
Auto picked the card and the load was refused there. The model's memory is what a
load measured on your machine; before one has, it counts what audio.cpp says the
model needs (or its files, when only the estimate is too big — see
[Memory, before you load](#memory-before-you-load)). The AI model JustVoice
loaded doesn't count as another program: it can make room. JustVoice's own idle
processes (about 0.2 GB) are counted with the other programs. Every model has a
size to check before its first load — the seven engines described by our own
files too, since 2026-10-16 (before, Auto took the card for them and gave no
reason). With no reading of the card, Auto takes the card and says *memory not
measured yet* — the model's first load measures it, and a load that doesn't fit
moves to the CPU (below). Then Auto decides, in this order:

1. **The graphics card** when the model fits in the card's free memory, or when
   this model's graphics memory, measured on your machine, fits beside the AI
   model (its peak at the length it speaks in — see
   [Long lines](#long-lines-and-what-a-model-costs)).
2. **Otherwise the CPU**, if the model speaks at least **2× real time** there.
3. **Otherwise the graphics card, with the AI model unloaded first.** A toast
   names what was unloaded; the AI model loads itself back the next time a
   feature needs it.

A model that has never run on your card has no measured size yet, so while an
AI model is on the card it counts as not fitting — nothing is ever guessed.
"Fast enough" uses the best of the last five speeds measured on your machine
at the current CPU threads, so one slow line — a busy moment — doesn't keep a
model off the CPU for good; until a model's first line on your CPU records one,
Auto uses the speed measured on the reference machine above (the 16-bit Kokoro
and Pocket TTS rows have their own). A model with no CPU speed — none measured
on the reference machine and none on yours yet: Qwen3-TTS, Chatterbox, Pocket
TTS French and audio.cpp's other models — isn't sent to the CPU by Auto for its
speed; Qwen3-TTS and Chatterbox run several times slower than real time there.

**What the *Runs on* line can say**, and when — the server's own words, with your
numbers in them. Where a line ends *— this may be slow on the CPU*, it shows the
model's measured speed there instead once it has one (*— 0.1× real time here*):

| The line says | It runs on | When |
|---|---|---|
| *it fits in the card's free memory* | the graphics card | Auto read the card, and the model fits with the safety margin beside what other programs hold |
| *memory not measured yet* | the graphics card | The card can't be read, or the model has no size yet; its first load measures it |
| *audio.cpp says it needs about 10 GB, but its files are about 1.3 GB, so it tries the graphics card first; if it doesn't fit, Load runs it on the CPU* | the graphics card | Only audio.cpp's estimate is too big for the card, or fits it only without the speech margin (since 2026-10-16), and the files fit with the margin |
| *it fits beside the AI model (3433 MB)* | the graphics card | An AI model is on the card, and this model's measured size fits beside it |
| *3.2× real time here, which keeps the graphics card for the AI model* | the CPU | An AI model is on the card, this model doesn't fit beside it, and it speaks at least 2× real time on the CPU (*on the reference machine* until measured here) |
| *only 1.5× real time here on the CPU, so the AI model makes room* · *it has no usable speed on the CPU, so the AI model makes room* | the graphics card, the AI model unloaded first | An AI model is on the card, this model doesn't fit beside it, and it isn't fast enough on the CPU |
| *other programs are using about 6.3 GB of the graphics card — this may be slow on the CPU* | the CPU | It would fit the card, but not beside what other programs hold now |
| *audio.cpp says it needs about 18 GB, more than this card's 8 GB — …* · *its files are about 12 GB, more than this card's 8 GB — …* | the CPU | Not measured here, and too big for the card ([Memory, before you load](#memory-before-you-load)) |
| *it took about 9.1 GB on this card before, more than it holds with the 0.5 GB safety margin — …* | the CPU | Measured here, and too big for the card with the speech margin |
| *it didn't load on the graphics card — this may be slow on the CPU* | the CPU | A load on the card failed or overflowed (below); **Try the card again** beside it |
| *your choice* · *your choice — 3.2× real time here* | where you pinned it | You picked **GPU** or **CPU** |
| *your choice — it took about … GB here before and about … GB of the card is free, so it may spill …* · *your choice — about … GB of it spilled …* | the graphics card | You picked **GPU** and it may not fit, or it spilled (since 2026-10-16) |
| *the graphics share this machine's memory, so the CPU would free none of it* | the graphics | A Mac, or graphics that share the computer's memory |
| *this machine's speech runtime is the CPU build* | the CPU | The runtime is the CPU build |

A loaded model's line starts *Running on* instead of *Loads on*, with the reason
it was given when it loaded.

On a Mac, or any machine whose graphics share the computer's memory, Auto
keeps every model on the graphics and says why: moving one to the CPU would
free nothing.

**When the graphics card can't take a model, Auto moves it to the CPU.** If a
load Auto put on the card fails, the same click loads it on the CPU instead, and
its *Runs on* line says *it didn't load on the graphics card — this may be slow on
the CPU* (or its measured speed, once it has spoken). On Windows a load can also
"succeed" without fitting: NVIDIA's driver can put what the card has no room for
in the computer's memory instead of failing, and the model then runs slowly. So
after each such load JustVoice reads how much of the computer's memory the speech
runtime's graphics allocations use (Windows' *Shared GPU memory* for that
process); a model that fits leaves it where it was, and one that grew it by more
than the runtime row's **Card overflow limit (MB)** (`speech_runtime.spill_mb`,
256 MB unless you change it) is unloaded and loaded on the CPU too.
Either way JustVoice remembers it, for this machine and this speech runtime
build, so the next load goes straight to the CPU; a new speech runtime build
tries the card again, and so does pinning the model to **GPU** — once a load
measures it there, the card is used again. **Try the card again** on the
model's *Runs on* line forgets the failure now, keeping what the model measured.
A model whose measured size, with the safety margin, is more than the whole card
goes to the CPU the same way instead of being refused.

**GPU** and **CPU** pin the model there, whatever Auto would do. Changing a
loaded model's place reloads it in its new place. A machine whose speech
runtime is the CPU build runs everything on the CPU and says so.

**The speech margin** (since 2026-10-16). On the graphics card a speech model is
held to 0.5 GB of headroom on top of the card's measured free memory — room for a
longer line than the one it was measured on, and for a program that starts using
the card. It is a setting, `speech_runtime.card_margin_mb` (512); the AI model
keeps its own 1 GB for its layers. A model you pin to **GPU** is held to no
margin and is never refused for memory: the load makes what room it can —
unloading the other speech model and the AI model — and goes ahead. When it may
not fit, its *Runs on* line says so: *your choice — it took about 7.3 GB here
before and about 7.1 GB of the card is free, so it may spill into this machine's
memory and run slowly*; and if it does spill, *your choice — about 0.4 GB of it
spilled into this machine's memory, so it runs slowly; Auto would run it on the
CPU*. Until 2026-10-16 the margin was the AI model's 1 GB, and a pinned model
that didn't fit with it was refused — BreezeTTS 2, measured at 7.3 GB, could not
load on an 8 GB card at all.

**A model needs room in your computer's memory too.** On the CPU its weights
are read into your computer's memory, and even on the graphics card the speech
runtime keeps some beside them — VoxCPM2, on the card, held 3.2 GB of the
computer's memory. JustVoice reads how much the speech runtime's own process
holds once a model has loaded and again after its lines, and keeps the highest,
on this machine — nothing else running counts. Before a model loads, JustVoice
checks that the memory free now holds the larger of its files (on the CPU) and
what it held at its last loads here, plus a safety margin (1 GB — the AI
model's, the kit's `safety_margin_mb`), counting what the model it replaces
gives back. When the load is going to push the AI model off the graphics card,
the AI model's memory counts as given back too, and the check runs again,
exactly, just before the speech model starts. A model that has never loaded
here is checked by its files on the CPU and not at all on the card. If there
isn't room, the load stops before anything moves and says how much is free:
*not enough memory to load OmniVoice on the CPU: its files are about 1.3 GB
(+1024 MB safety margin) but only 1.5 GB of this machine's 32 GB is free. Close
other programs, or pick a smaller model.* — or, by what it took before, *…on
the graphics card: it took about 5.7 GB of this machine's memory when it last
loaded here…*. The free figure is what is free right now. When an AI model is
loaded — a large one can hold more of this memory than any speech model — the
message names it and suggests unloading it first, unless the check already
counted the AI model's memory as given back.

The 2× bar is `speech_runtime.cpu_min_realtime` in the settings, the spill
threshold `speech_runtime.spill_mb` (also on the runtime row), and what counts as a runaway line
`speech_runtime.runaway_s_per_char` and `runaway_min_s` (see
[Settings reference](settings-reference.md); the take check fails a take past the same
limit — [Studio → Checking takes](studio.md#checking-takes)); the CPU threads are on the
runtime row.

## What each engine can be tuned with

Two things decide which controls you get: **which engine is loaded**, and
**which of its models**. Five settings are applied by JustVoice itself, so they
work on every engine:

| Always available | What it does |
|---|---|
| **Speed** | pacing, 0.5–2.0× (*Pace* on a persona's page). Kokoro and KittenTTS pace themselves (the model reads faster or slower); for every other engine JustVoice time-stretches the finished line and keeps its pitch. Before 2026-10-02 the other engines ignored Speed |
| **Gain** | output level in dB, clamped to −24…+12 |
| **Pitch** | semitone shift of the rendered audio |
| **Effects chain** | reverb, EQ, compressor, delay and the rest |
| **Lexicon** | pronunciation respellings, applied to the text before synthesis |

Everything else is the model's own ([Settings, and Advanced](#settings-and-advanced)).
On the seven engines described by our own files:

| Model | Clones | Paces itself (else stretched) | Written direction | Engine controls |
|---|---|---|---|---|
| **Kokoro** | ✗ | ✓ | ✗ | none |
| **KittenTTS** | ✗ | ✓ | ✗ | none |
| **Pocket TTS** | ✓ | ✗ | ✗ | none |
| **Chatterbox Multilingual** | ✓ | ✗ | ✗ | Exaggeration · CFG weight · Temperature · Repetition penalty · Top p · Min p · Decoder CFG |
| **Chatterbox Turbo, Nano** (and the built-in-voice-only package, which doesn't clone) | ✓ | ✗ | ✗ (its tags) | Temperature · Repetition penalty · Top p · Top k |
| **VoxCPM2** | ✓ | ✗ | **✓ direction, on a clone too (a directed line uses the clip without its words); a description designs the voice** | CFG · Inference steps · Tries on a runaway · Runaway limit |
| **Qwen3 CustomVoice** | ✗ | ✗ | **✓ instruction** | Temperature · Top k · Top p · Repetition penalty · Detail temperature · Detail top k · Detail top p |
| **Qwen3 Base** | ✓ | ✗ | ✗ | as above |
| **Qwen3 VoiceDesign** | ✗ | ✗ | **✓ the description** | as above |

Folded under **Advanced** (since 2026-10-15): Chatterbox Multilingual's **Top p**,
**Min p** (drops sounds less likely than that share of the likeliest; 0.05, 0 =
off) and **Decoder CFG** (how closely the audio decoder holds to the cloned voice;
0.7); every Turbo and Nano setting; Qwen3's three **Detail** settings, for the
sub-talker that fills in each frame's finer audio after the main model picks it
(0.9, 50, 1.0); and VoxCPM2's **Tries on a runaway** and **Runaway limit** — a take
that runs far longer than its text is cut and made again, up to 3 tries in all by
default. Each starts at the runtime's own default, so leaving it alone changes
nothing. Pocket TTS's temperature and end-of-speech settings are read only when
its voice is prepared, not per line, so they aren't offered.

**Their ranges are audio.cpp's own** wherever audio.cpp reaches further or gives
no range at all (since 2026-10-15 and 2026-10-16): Chatterbox's **Exaggeration**
and VoxCPM2's **CFG** start at 0; VoxCPM2's **Inference steps**, Qwen3's **Top k**
and **Detail top k**, Qwen3's **Detail temperature**, Chatterbox's **Top p**,
**Min p** and **Decoder CFG**, Turbo's and Nano's **Temperature**, **Repetition
penalty**, **Top p** and **Top k**, and VoxCPM2's **Tries on a runaway** and
**Runaway limit** are number boxes. A temperature and a top-p still start at 0.05 —
below it some models refuse the value or read it as no filter — and the tries at 1.
Where audio.cpp's own range stops short of JustVoice's, JustVoice keeps its own, so a value a persona saved stays valid: **Repetition penalty** goes up to 4
on Chatterbox and Qwen3 (audio.cpp's screen: 2).

### The seed

Every engine offers a **seed** (KittenTTS since 2026-10-16): the same seed, text
and settings give the same take.

- **On the CPU, every engine repeats** a take byte for byte.
- **On the graphics card, every engine repeats except Pocket TTS and
  Qwen3-TTS**, whose take can change slightly with the longest line the model has
  spoken since it loaded. The words stay the same: a Qwen3-TTS VoiceDesign take
  came out one 80 ms frame longer than the next ones (correlation 0.99975), and
  a Pocket TTS take matched for its first 2.5 seconds and then drifted apart. So
  on these two the first take after a speech-runtime update can differ from the
  ones after it: the first load, with no cost stored for that runtime yet, warms
  up on a full-length piece (800 characters on VoiceDesign — see
  [How fast, and how much memory](#how-fast-and-how-much-memory)).

Measured on 2026-10-16 through the app (seed 42, the same line, three or four
takes each): byte for byte the same on the graphics card — Kokoro, KittenTTS,
Qwen3-TTS CustomVoice, Qwen3-TTS Base 1.7B, Chatterbox Multilingual, Chatterbox
Turbo (a clone) and VoxCPM2 — and on the CPU every engine. A take made on the CPU and one made on the graphics card differ
from each other, with the same seed. Every take read back word for word.
(Before, the switch record measured Kokoro, Qwen3 and Chatterbox on 2026-10-01,
and Pocket TTS on 2026-10-02. Until 2026-10-16 KittenTTS offered no seed: on the
graphics card its takes were unrelated, until a fix to JustVoice's copy of
audio.cpp that day.)

Leave the seed empty — or 0 — and every take gets a new one, on every engine.
The seed box goes up to the top the model's description gives
(4,294,967,295 on most), else 2,000,000,000 (Kokoro; since 2026-10-15). Until 2026-10-04 an empty seed on Kokoro repeated the last
seed it was sent, and VoxCPM2 and Chatterbox Turbo used a fixed one, so a new
take there came out the same.

### Direction, emotion and language on the seven

**Direction and identity pull against each other.** Written direction — a
persona's Style Instructions, a line's own direction —
reaches Qwen3 CustomVoice, Qwen3 VoiceDesign and VoxCPM2. On every engine of the
seven but VoxCPM2 it does not reach a clone: Qwen3 Base and Pocket TTS clone but
have no instruction input, and Chatterbox steers through Exaggeration and CFG
weight rather than words. So on those, "direct the performance in words" and "use
this cloned voice" are a choice — VoxCPM2 is the engine that does both — and that
includes a designed voice once you keep it, because keeping one turns it into
a clone ([Personas → New design](personas.md#new-design)).
Several of audio.cpp's other models also direct a cloned voice — IndexTTS,
CosyVoice3, Breeze, Higgs and Fish ([How a model takes
direction](#how-a-model-takes-direction)).

**Emotion** is a nine-value label rather than a sentence. On Qwen3
CustomVoice and VoiceDesign it becomes part of the instruction; on Turbo and
Nano it becomes their own emotion tag at the start of the line, where they have
one for it; of audio.cpp's other models, those whose notes map it take the
emotions their notes list ([How a model takes
direction](#how-a-model-takes-direction)). The other engines of the seven have
no way to take it.

**Language.** The line's language goes to the engine in the form it expects —
Qwen3 wants the language's name, the others a code — so you never type either.
Pocket TTS takes no language: its loaded model is the language, and a line in
another one is refused by name. How audio.cpp's other models take it is under
[Languages](#languages).

### A directed VoxCPM2 line is spoken from the clip alone

VoxCPM2 copies a voice more closely when it also has the clip's words, but its authors say that mode
ignores direction ("When Hi-Fi mode is enabled, the control instruction is
ignored"), and in our tests it read the direction aloud instead. So since
2026-10-11 a line with direction leaves the clip's words out, and a plain line
keeps them.

### Inline tags are Chatterbox Turbo's and Nano's

Chatterbox Turbo and Nano — and audio.cpp's own Turbo package, *Chatterbox Turbo
(built-in voice only)* — read 19 bracketed tags in the text: an emotion the line is spoken in (`[angry]`, `[fear]`, `[happy]`,
`[sarcastic]`, `[surprised]`, `[crying]`, `[whispering]`), a register it is read
as (`[narration]`, `[dramatic]`, `[advertisement]`), and sounds made at a point in
it (`[cough]`, `[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`, `[groan]`, `[sniff]`,
`[clear throat]`, `[shush]`). With any other model, bracketed markup in a line's text is removed
before the model sees it, so it is never read out as a word. The rule from
2026-09-29 holds: **a tag the rendering engine doesn't list is dropped, never
spoken**, in a chapter render and in a persona's **Hear it** alike — including ordinary
bracketed text such as `[sic]`.

## Loading and unloading

One model is **loaded** per slot (one speech, one speech recognition). A load
takes a few seconds. The Speech engines tab shows each engine's state:

- **needs the speech runtime** — the runtime is not installed yet. Models can
  still download; Load waits for the runtime.
- **installed** — the runtime is there; the engine's models load on demand.
- **loaded** — resident and ready to render, with where it runs
  (`· CUDA`, `· VULKAN`, `· CPU`).

The verbs split the same way as the AI model catalog: a model that isn't on
disk shows **Download (N GB)** — download only; once its files are on disk
the row shows **Load model**. A load of a model that is not downloaded yet
downloads it first. Loading a model unloads the same slot's previous one.

**F5-TTS unloads by stopping its process.** F5-TTS (the Habibi-TTS models) keeps
its weights and working memory for as long as its speech process runs, so asking
it to unload gave nothing back: after three Habibi models, 6.2 GB of the card and
7.2 GB of the computer's memory stayed taken. Unloading an F5-TTS model, or
loading another speech model in its place, now stops the speech process instead,
which returns all of it; the next speech model starts a new process. Only the
speech slot's process stops — a speech-recognition model stays loaded — and
every other engine still unloads without a restart.

**A render loads the model each voice needs.** A voice remembers the model it
was made for ([Voices → Every voice knows the model that speaks it](voices.md#every-voice-knows-the-model-that-speaks-it)),
so hearing a Qwen3 built-in voice while Qwen3 Base is loaded loads CustomVoice first,
and a chapter with voices on several models loads each in turn. The size and
precision come from here: the model you loaded if it is the right one, else
the default version — the one you **Set as default** on its row here, the same
choice as the persona page's **Version** — if it is downloaded, else a downloaded
build of that model (the same size first). While another version of the model is
downloaded, that one keeps speaking — in renders too — until you load the chosen
one; when no version is downloaded yet, the first load fetches the chosen one, as
any first load does. Pocket TTS picks its model by the line's language.

The runtime never outlives JustVoice: closing the window stops it, and the
server stops one left over from an earlier session when it starts — see
[GPU → Engines left over from an earlier session](gpu.md#engines-left-over-from-an-earlier-session).

### Loading and the memory budget

Loads run against the **shared memory budget** — the memory strip at the top
of AI Settings, which shows measured use, a cell for each loaded speech model
with its real memory take, the language model, and other apps. For a model
JustVoice has measured before on this machine: if the pool is short, it frees
the least-recently-used *idle* model and toasts what it unloaded; if
everything resident is busy, the load refuses with a message quoting the
measured numbers instead of an out-of-memory crash. The check runs before
anything else happens, so a refused load has downloaded nothing and unloaded
nothing. A model's first-ever load on the graphics card carries no number yet
("not measured yet"): it loads, measures itself (below), and is remembered.

#### Long lines, and what a model costs

A speech model's memory is not just its file: while it speaks it builds working
buffers that grow with the length of what it is given. On an 8 GB card, Qwen3-TTS
VoiceDesign speaking a 752-character line whole peaked at about 7.1 GB; the same
line in 200-character pieces peaked at about 4 GB, and finished no slower.

So each model is given lines in pieces of its own length — **200 characters**
for Qwen3-TTS CustomVoice and Base and for VoxCPM2, **240** for Kokoro, and the
general limit (`generation.max_chunk_chars`, 800) for the others. Pieces are cut
at sentence ends and joined with a short crossfade. A model's length can be
changed in `settings.engines.engine_overrides[engine].split_chars[model]`. A
voice made from words keeps the full length: split into 200-character pieces it
drifted into a slightly different person from piece to piece, on Qwen3-TTS
VoiceDesign and on VoxCPM2 alike (listened 2026-10-04), so it is spoken whole —
which on VoiceDesign needs about 7 GB for a 752-character line (see
[Long text, cut into pieces](#long-text-cut-into-pieces)).

What a model costs is measured at that length, on your machine, for exactly that
model — the 8-bit and 16-bit files and each size count separately. The first
time a model loads on the graphics card it speaks one full-length piece as its
warm-up (a few seconds more, once) and what it holds afterwards is remembered as
its cost. Every model audio.cpp describes does the same when it can speak
without a clip (since 2026-10-15): in its default built-in voice, in its one
voice, or — a model that makes a voice from words — from a short description; a
speech-recognition model hears silence. Models that can only speak from a clip
(Chatterbox Multilingual, Qwen3-TTS Base, Pocket TTS French, and audio.cpp's
clone-only models) measure themselves on their first real lines instead. The cost
only goes up after that: a line that takes more is remembered too — except after
a line that ran away (its audio longer than 0.5 s a character of its text and
than 30 s, `speech_runtime.runaway_s_per_char` and `runaway_min_s`): what that
model's process holds is never remembered as its cost again. When the model's
own process can't be read at that first load, how much the whole card's use went
up across the load is remembered instead — for a model that spoke a warm-up
piece. A model that measures itself on its first line remembers what its process
holds after that line, or, where the process can't be read, how much the whole
card's use went up from before its load — once the model before it in that slot
has left the card — to after that line (since 2026-10-15; before, it remembered
nothing). That reading can include another program that took card memory at the
same moment, so it errs high. The reading is taken before that first line lets
go of the model, so it takes a second or two longer, once; a render that moves
straight on to another model's line keeps it (since 2026-10-16 — before, a model
whose line was followed at once by another model's load often kept no cost, as
Qwen3-TTS Base 1.7B did, or a far too small one, as Chatterbox Multilingual's
105 MB was, and the "before" reading counted the model before it).

Each slot's cell shows its own process's measured memory: the model, plus the
process's own share of the card (about 100 MB). The full story is in
[GPU](gpu.md#the-shared-memory-budget).

#### Long text, cut into pieces

Long text is split at sentence boundaries, rendered per piece, and joined. You
don't need to do anything — the server sees long input and switches paths on its
own. Where two pieces meet, the silence each model leaves at a piece's end and
start (Kokoro: about three quarters of a second after, a quarter before) is cut
down to **260 ms** — Kokoro's own pause at a sentence end — so a long line no
longer holds a second of silence where it was cut (since 2026-10-07; a line
rendered before keeps its gap until it is rendered again — **↻ Re-render all** on
the chapter's Render page). Where a piece ends mid-sound, the two still meet with
the short crossfade.

How long a piece may be depends on the model, as above: **200 characters** for
Qwen3-TTS CustomVoice and Base and for VoxCPM2, **240** for Kokoro (its own
limit), and `settings.generation.max_chunk_chars` (default 800) for the rest —
and that setting caps them all.

Voice auditions on the Voices page use the same splitter at a much smaller size
(`settings.generation.stream_piece_chars`, default 200): each sentence-sized
piece is sent to your player the moment it renders, so playback starts after the
first piece instead of the whole render. Pieces join the same way — the quiet
between them cut to 260 ms, so a long test line no longer pauses a second between
sentences (since 2026-10-07).

The splitter cuts at a sentence end first, then at a clause mark (`,` `;` `:`
`—`), then at a space, and only as a last resort mid-word. It knows
abbreviations (`Mr.`, `Dr.`, `e.g.`, `i.e.`, `a.m.`, `U.S.` — their period
ends no sentence), decimal numbers (`3.14`), a sentence that ends in a number
(`It was 2024.` ends there), closing quotes after a sentence end, and CJK
punctuation (`。！？` end a sentence, `，、` a clause). A `[bracket]` tag is one
unit — `[laugh]` or `[clears throat]` is never split or cut; only a tag longer
than the piece length itself would have to be. A piece length
(`generation.max_chunk_chars`, a model's split length) below 1 is refused with
an error instead of being used (since 2026-10-08; before, `e.g.` ended a
sentence, `2024.` did not, and a tag with a space in it could be cut).

Per-piece seeds vary deterministically (`seed + piece index`), so the same text
and seed always give the same audio while artefacts don't line up across pieces.

A **voice made from words** (designed, with no clip — VoiceDesign, or a VoxCPM2
description) is the exception. Its voice is drawn from the description every
time it speaks, so it gets the same seed for every piece, and when no seed is
set it gets a fixed one of its own instead of a random one; otherwise each
piece, and each line, would come out as a different person. It is also sent
whole, at the full `max_chunk_chars` length (above).

### Cancelling an in-flight load

Downloads run from the row's **Download** button and go through the **speech
cache**: plain files fetched by the same chunked, resumable downloader the AI
models use — a dropped connection resumes past the completed chunks instead
of starting over. While a load or download is in progress:

- A progress bar appears **on the engine's own row**, naming the model and the
  stage it's in. Downloads show real bytes and percent; a load shows the stage
  it has reached, because a model load reports no percentage and JustVoice
  does not invent one.
- The bar has a **Cancel** button while it runs.
- A cancelled or failed bar stays on the row with its error and offers
  **Retry** and **Dismiss**. It doesn't clear itself — you decide when you've
  read it.

The row is deliberately the *only* place these appear. The full-width strip at
the top of the screen is the **AI task** queue: it is for work that queries a
language model and for long renders. Installing, downloading and loading are
file and process work, so they live on the row that owns them.

## Which engines run on your operating system

Every engine runs on Windows, Linux and macOS — the runtime is built for
each. What differs is the backend:

| | NVIDIA | AMD / Intel graphics | Apple Silicon | CPU only |
|---|:--:|:--:|:--:|:--:|
| **Windows** | CUDA | Vulkan | — | CPU |
| **Linux** | Vulkan | Vulkan | — | CPU |
| **macOS** | — | — | Metal | — |

Windows with an AMD or Intel GPU is now accelerated for every engine — before
the switch only Kokoro was. Linux NVIDIA users run the Vulkan build, because
audio.cpp publishes no Linux CUDA build. The Linux builds are for x86-64 only:
there is none for Linux on ARM yet.

## Where model files live — the speech cache

Downloaded speech models live in **the speech cache**: one plain folder per
model at `<data dir>/speech-cache/<engine>/<model>/`, holding the model's file
exactly as it is named upstream, plus a small `files.json` recording where it
came from (repository and pinned revision), its expected size, and its
upstream checksum id.

- **Downloads resume.** A dropped connection resumes past the completed chunks
  on the next attempt.
- **Checked on arrival.** Each model file is checked against the checksum its
  repository publishes for it; a file that doesn't match is deleted and the
  download stops saying so. Two downloads of the same model never run at once
  (they used to, and the second deleted what the first had just finished).
- **"Downloaded" means downloaded.** A model only counts as on disk when every
  file in its record is present at its recorded size. A half-fetched folder
  never shows a Load button.
- **No symlinks, no privileges.** What you see in the folder is the model.
- **Delete really deletes.** "Delete downloaded model" removes that one
  model's folder.

To reclaim the whole store at once, **Settings → Storage → Disk usage →
Speech models → Clear** deletes every downloaded speech model in one step
(each re-downloads on demand) — see
[Backup and data](backups-and-data.md#disk-usage).

The runtime itself lives under `engines-runtime/audiocpp/<release>/<build>/`
next to the app (in a source checkout, next to the engine catalog).

## Not available yet

These worked before the 2026-10-01 switch and do not yet run on the speech
runtime; the order is in
[the switch record](plans/2026-10-01-audiocpp-switch.md#5-after-the-cut--the-gaps-in-order).

- **A confidence score from speech recognition.** The old recogniser
  reported how sure it was of each transcript; the new one does not.
- **Voice training** — see [Voice training](#voice-training).

And three of audio.cpp's models are left off the list until they speak as listed:

- **VieNeu-TTS v3 Turbo** (Vietnamese and English). It
  reads phonemes from SEA-G2P, a separate library the speech runtime's release doesn't
  build, rather than text: given text and a clip, it babbled for 14.8 seconds over a line
  the other models speak in 4 to 5 in JustVoice's download test (2026-10-11). Since
  audio.cpp v0.9.2 it also won't speak without a voice. It was listed without cloning for
  a few hours on 2026-10-15, and is left off the list again until the release carries
  SEA-G2P.
- **AuK** (Tencent). audio.cpp loads it from a folder of
  three separate downloads — the AuK generator, Qwen2.5-Omni-3B and a VAE, 6 to 13 GB
  together — and JustVoice fetches only the generator, so it doesn't load. Cloning from a
  clip also needs a longer instruction than the words alone. Left off the list until those
  three parts are fetched together (2026-10-12).
- **OuteTTS 1.0 1B**. Cloning the download test's voice, it
  generated no audio for ten seeds in eleven — the same with audio.cpp's own command-line
  tool and the same file — while audio.cpp's sample voice spoke on every seed tried. It's left
  off the list until it clones reliably (2026-10-12).

Back since v0.9.0-jv.4: Chatterbox Turbo (cloning, inline tags), Chatterbox in
Hebrew, Japanese, Russian and Chinese, Kokoro blends, Kokoro's Japanese voices,
and a lexicon's exact pronunciations on Kokoro. A runtime still on an older
build refuses a line that needs one of them, by name — *"… — this needs the
speech runtime update"* — and **Update to** on the runtime row brings it.

**Removed for good:** LuxTTS, TADA and the old MOSS-TTSD engine. LuxTTS was the one engine
that cloned quickly on a CPU; Pocket TTS took its place on 2026-10-02. TADA and
the old MOSS-TTSD were already marked for removal. (audio.cpp's own MOSS-TTSD is listed again since
2026-10-11.) Whisper, the old speech recogniser, was replaced by Qwen3-ASR
([Speech recognition (Qwen3-ASR)](#speech-recognition-qwen3-asr)).

## Voice training

Removed on 2026-10-02, to be rebuilt on the speech runtime later. Training a
voice (a LoRA fine-tune of Qwen3 Base) ran on PyTorch in the per-engine Python
environments the 2026-10-01 switch retired, and the speech runtime cannot
render a trained voice. The Voices page's LoRA tab, its Preparer and Dataset
Builder, the training settings and the training webhook events went with it.

## Online + self-hosted providers (LLM + TTS)

Local engines (above) are managed by JustVoice. Online and self-hosted
providers are a separate flow:

- **LLM providers** — Anthropic Claude, OpenAI, Gemini, Ollama, DeepSeek, OpenRouter. Needed for Compose, Persona rewrite, Speaker attribution, Smart-assign, Show notes.
- **TTS providers** — ElevenLabs, Speechify, Speechmatics, OpenAI TTS, OpenAI-compatible self-hosted servers (Kokoro-FastAPI, Chatterbox-TTS-Server, Dia-TTS-Server, Qwen3-TTS).

Language-model providers register on the AI page's **LLM providers** tab.
Speech providers register on the **Speech engines** tab: cloud APIs under
**Online · metered** → **+ Add provider**; servers you run yourself under
**Local · free** → **Self-hosted servers** → **+ Add self-hosted server**.
The inline form handles API key, base URL, the TTS model, voice multi-select
(with Fetch voices), and Test verification. See [ai-providers.md](ai-providers.md)
for the full flow.

After registering one or more LLM providers, open **AI Settings → Routing by
feature** to point specific features (Compose, Speaker attribution, etc.) at
specific provider + model choices — see [ai-features.md](ai-features.md).
