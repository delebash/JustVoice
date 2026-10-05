# Engines

Every local speech engine in JustVoice runs on **one program — the speech
runtime**. It is [audio.cpp](https://github.com/0xShug0/audio.cpp) (Apache-2.0),
a C++ runtime for speech models — JustVoice installs its own build of it, made
from [JustVoice's copy](https://github.com/delebash/audio.cpp), the build that suits
your hardware, starts it when a model loads, and stops it when you close the
app. Each engine is then just a set of model files the runtime can load:
Kokoro, KittenTTS, Pocket TTS, Qwen3-TTS, Chatterbox and VoxCPM2 for speech, and
Speech recognition for turning speech back into text. Each model runs on your
graphics card or your CPU — chosen per model, see
[Where each model runs](#where-each-model-runs--the-graphics-card-or-the-cpu).

Until 2026-10-01 each engine was its own Python program in its own Python
environment. The runtime replaced all of them at once, for three reasons we
measured on the same lines, seeds and settings before switching — see
[the switch record](plans/2026-10-01-audiocpp-switch.md) for every number:

- **Speed.** Qwen3 renders about 7× faster (2.0× real time against 0.26×),
  Chatterbox about 2× (2.1× against 0.9×), and models load in seconds rather
  than half a minute.
- **The same seed gives the same audio** on every engine but KittenTTS.
  Before, only Qwen3 repeated itself.
- **One install instead of five.** No Python environments, no PyTorch
  download, nothing to rebuild when you move the install folder.

What the switch cost is listed under
[Not available yet](#not-available-yet) — nothing was hidden to make the
numbers look good.

> **Why no Higgs?** Higgs Audio v3 was removed 2026-06-09 — its model weights
> are released under a non-commercial license, which conflicts with
> JustVoice's audiobook / game / podcast use cases where users sell their
> generated output. Every bundled model's weights permit commercial output.

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

The Windows CUDA 12.4 build is a 464 MB download plus 607 MB of NVIDIA's CUDA
runtime libraries (about 2 GB once unpacked), the CUDA 13.3 build 275 MB plus
575 MB, and the Vulkan build 63 MB — the files of v0.9.0-jv.4. Vulkan also
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
**v0.9.0-jv.4**, audio.cpp v0.9.0 with JustVoice's changes: Chatterbox Turbo and
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

**eSpeak NG.** Kokoro and KittenTTS read text through eSpeak NG, the open-source
pronunciation library. Installing the runtime also downloads eSpeak NG
(GPL-3.0) onto your machine from its published Python package; JustVoice
itself never ships it. Both models use that copy, even when another eSpeak NG
is installed on the computer.

## The catalog

Every model's default row is an 8-bit file pinned to one commit of
[audio-cpp/audio.cpp-gguf](https://huggingface.co/audio-cpp/audio.cpp-gguf) —
except Qwen3-TTS CustomVoice 0.6B, which audio.cpp does not publish. That one is
JustVoice's own conversion of Qwen's official checkpoint, made with the speech
runtime's converter and published at
[delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF](https://huggingface.co/delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF)
(its page has the exact conversion and what was checked). No account is needed
to download any of them.

**Every model also has a 16-bit row** (since 2026-10-02) — the same model at
its original precision, named "(16-bit)" on Speech engines, beside the 8-bit
row. It is a larger download and needs more memory; the 8-bit row stays the
default, and KittenTTS has no second row because it already ships unquantized.
See [8-bit or 16-bit](#8-bit-or-16-bit) for what the difference measured.

| Engine · model | Download (8-bit · 16-bit) | Languages | Clones | Built-in voices | Weights licence |
|---|---|---|---|---|---|
| **Kokoro 82M** | 190 MB · 212 MB | 9 (American and British English, Mandarin, Spanish, French, Hindi, Italian, Brazilian Portuguese, Japanese) | — | 54 | Apache-2.0 |
| **KittenTTS Mini 0.8** | 302 MB (unquantized) | English | — | 8 | Apache-2.0 |
| **Pocket TTS** — one model per language: English, German, Italian, Portuguese, Spanish | 258 MB · 350 MB each | 1 each | ✓ | 20 | CC-BY-4.0 |
| **Qwen3-TTS CustomVoice 1.7B** | 2.8 GB · 4.2 GB | 10 | — | 9 | Apache-2.0 |
| **Qwen3-TTS CustomVoice 0.6B** | 1.7 GB · 2.2 GB | 10 | — | 9 | Apache-2.0 |
| **Qwen3-TTS Base 1.7B** | 2.7 GB · 4.2 GB | 10 | ✓ | — | Apache-2.0 |
| **Qwen3-TTS Base 0.6B** | 2.0 GB · 2.5 GB | 10 | ✓ | — | Apache-2.0 |
| **Qwen3-TTS VoiceDesign 1.7B** | 2.8 GB · 4.2 GB | 10 | — (designs a voice from words) | — | Apache-2.0 |
| **Chatterbox Multilingual** | 2.1 GB · 3.7 GB | 23 | ✓ | — | MIT |
| **Chatterbox Turbo** (350M) | 881 MB · 1.4 GB | English | ✓ (a clip longer than 5 s) | — | MIT |
| **Chatterbox Nano** (110M) | 616 MB · 895 MB | English | ✓ (a clip longer than 5 s) | — | MIT |
| **VoxCPM2** | 3.0 GB · 4.8 GB | 30 | ✓ (and designs from words) | — | Apache-2.0 |
| **Speech recognition — Qwen3-ASR 1.7B** | 3.6 GB · 5.9 GB (with its word aligner) | 30 | — | — | Apache-2.0 |
| **External** (OpenAI-compatible) | — | — | varies | varies | depends on provider |

Qwen3 speaks Chinese, English, Japanese, Korean, German, French, Russian,
Portuguese, Spanish and Italian. Chatterbox speaks Arabic, Danish, German,
Greek, English, Spanish, Finnish, French, Hindi, Italian, Korean, Malay, Dutch,
Norwegian, Polish, Portuguese, Swedish, Swahili and Turkish.

**Qwen3-TTS is three different models**, and the difference decides what you
can do with it:

- **CustomVoice** ships 9 preset speakers (Vivian, Serena, Uncle Fu, Dylan,
  Eric, Ryan, Aiden, Ono Anna, Sohee) and takes a plain-English instruction to
  steer their style and emotion. It **cannot clone**. It comes in two sizes
  with the same speakers: 1.7B, and 0.6B — a 1.7 GB download instead of 2.8 GB
  that needs less graphics memory.
- **Base** clones from a 3–10 second reference clip and its transcript, and
  has no preset speakers. It ignores written direction.
- **VoiceDesign** makes a voice from a written description ("a gravelly
  harbour-master, sixties, unhurried") and speaks the line in it.

**VoxCPM2** (added 2026-10-02) is OpenBMB's 2B model. It clones a voice from a
short clip, or designs one from a written description, in 30 languages, at
48 kHz — and it is the one engine where **written direction reaches a cloned
voice**: a persona's Style Instructions or a line's direction steers a clone the
way it steers Qwen3 CustomVoice. Two things to know. It does not speak
anything in parentheses — it reads brackets as direction — so JustVoice turns
a line's own brackets into dashes ("He left (quietly) and…" is read as "He
left — quietly — and…"). And when a cloned voice has a transcript of its clip,
VoxCPM2 uses that too, as Qwen3 Base does. It is a graphics-card model: about 1.3× real time on an 8 GB
card, 0.2× on a CPU.

**KittenTTS** is a small English model built to run without a graphics card,
with eight built-in voices: Bella, Luna, Rosie and Kiki (female), Jasper, Bruno,
Hugo and Leo (male). The same seed does not give it the same audio twice, so it
offers no seed.

**Pocket TTS** is Kyutai's small cloning model — the one that clones fast
enough on a CPU. It clones from a short clip (no transcript needed) and speaks
20 built-in voices. Each language is its own model and its own download; the
presets speak whichever language's model is loaded, and a line in another
language stops with a message naming the model to load, rather than reading
German with English sounds.

- **Its presets** are the 20 of Kyutai's 26 whose recordings permit selling
  what you make: Alba, Estelle, the twelve VCTK voices (Anna, Azelma, Charles,
  Eponine, Eve, Fantine, George, Jane, Mary, Michael, Paul, Vera), the four
  Voice-Zero voices (Bill Boerst, Caro Davy, Peter Yearsley, Stuart Bell) and
  two donated voices (Javert, Marius). Cosette and Jean come from
  non-commercial recordings and four more state no licence, so they are left
  out. Kyutai gives them no gender; set one on the Voices page if you want
  Smart-assign to use it.
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
  Pocket TTS row on Speech engines has **Read and accept**, and a Pocket TTS
  clone asked for anywhere else (a chapter, a persona's Hear it, JustWrite, the API) stops
  with a message until you have. Built-in voices need no acceptance.
- **The weights are CC-BY-4.0**, which permits commercial use; the credit it
  asks for is in NOTICE.md.
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

## Where each model runs — the graphics card or the CPU

Each model runs either on your graphics card or on your CPU, and every model
row on Speech engines has its own line saying which: **Runs on** with an
**Auto · GPU · CPU** choice, followed by where it runs — or would load now —
and why ("Loads on the CPU — 3.2× real time here, which keeps the graphics
card for the AI model"). The reason it matters: on an 8 GB card, Kokoro on the
graphics card pushed a 6.8 GB language model out, while on the CPU it speaks
three times faster than real time and takes nothing from the card.

**Auto** decides at each load, in this order:

1. **The graphics card** when nothing else is on it — or when this model's
   graphics memory, measured on your machine, fits beside the AI model (its
   peak at the length it speaks in — see
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
and Pocket TTS rows have their own). A model with no CPU speed at all — Qwen3-TTS, Chatterbox — is
never sent to the CPU by Auto; on the CPU they run several times slower than
real time.

On a Mac, or any machine whose graphics share the computer's memory, Auto
keeps every model on the graphics and says why: moving one to the CPU would
free nothing.

**GPU** and **CPU** pin the model there, whatever Auto would do. Changing a
loaded model's place reloads it in its new place. A machine whose speech
runtime is the CPU build runs everything on the CPU and says so.

The 2× bar is `speech_runtime.cpu_min_realtime` in the settings (see
[Settings reference](settings-reference.md)); the CPU threads are on the
runtime row.

## What each engine can be tuned with

Two things decide which controls you get: **which engine is loaded**, and
**which of its models**. Five settings are applied by JustVoice itself, so they
work on every engine:

| Always available | What it does |
|---|---|
| **Speed** | pacing, 0.5–2.0×. Kokoro and KittenTTS pace themselves (the model reads faster or slower); for every other engine JustVoice time-stretches the finished line and keeps its pitch. Before 2026-10-02 the other engines ignored Speed |
| **Gain** | output level in dB, clamped to −24…+12 |
| **Pitch** | semitone shift of the rendered audio |
| **Effects chain** | reverb, EQ, compressor, delay and the rest |
| **Lexicon** | pronunciation respellings, applied to the text before synthesis |

Everything else is passed to the engine:

| Model | Clones | Paces itself (else stretched) | Written direction | Engine controls |
|---|---|---|---|---|
| **Kokoro** | ✗ | ✓ | ✗ | none |
| **KittenTTS** | ✗ | ✓ | ✗ | none (no seed — see below) |
| **Pocket TTS** | ✓ | ✗ | ✗ | none |
| **Chatterbox Multilingual** | ✓ | ✗ | ✗ | Exaggeration · CFG weight · Temperature · Repetition penalty · Top p · Min p · Decoder CFG |
| **VoxCPM2** | ✓ | ✗ | **✓ direction, on a clone too; a description designs the voice** | CFG · Inference steps · Tries on a runaway · Runaway limit |
| **Qwen3 CustomVoice** | ✗ | ✗ | **✓ instruction** | Temperature · Top k · Top p · Repetition penalty · Detail temperature · Detail top k · Detail top p |
| **Qwen3 Base** | ✓ | ✗ | ✗ | as above |
| **Qwen3 VoiceDesign** | ✗ | ✗ | **✓ the description** | as above |

Every engine but KittenTTS takes a **seed**: the same seed, text and settings
give the same audio (measured on Kokoro, Qwen3 and Chatterbox on 2026-10-01 and
on Pocket TTS on 2026-10-02). KittenTTS gave different audio for the same seed,
so it offers none. Leave the seed empty — or 0 — and every take gets a new one,
on every engine. Until 2026-10-04 an empty seed on Kokoro repeated the last
seed it was sent, and VoxCPM2 and Chatterbox Turbo used a fixed one, so a new
take there came out the same.

Added 2026-10-04, all under the advanced knobs: Chatterbox's **Min p** (drops
sounds less likely than that share of the likeliest; 0.05, 0 = off) and
**Decoder CFG** (how closely the audio decoder holds to the cloned voice; 0.7);
Qwen3's three **Detail** settings, for the sub-talker that fills in each frame's
finer audio after the main model picks it (0.9, 50, 1.0); and VoxCPM2's
**Tries on a runaway** and **Runaway limit** — a take that runs far longer than
its text is cut and made again, up to 3 tries in all by default. Each starts at
the runtime's own default, so leaving it alone changes nothing. Pocket TTS's
temperature and end-of-speech settings are read only when its voice is
prepared, not per line, so they aren't offered.

**Options on a model's row.** A few settings are read when a model loads rather
than per line, so they live on its row on Speech engines, under **Runs on**.
Qwen3-TTS has two, measured on CustomVoice 1.7B:

- **Attention** — *Exact* or *Flash attention*: about 9 % faster and 0.2 GB
  less at the peak, and the same seed gives a different take. 8-bit models
  only; the runtime refuses it on 16-bit weights.
- **Decoder weights** — *16-bit* (the default) or *32-bit*. 16-bit takes about
  0.5 GB less at the peak; at the same seed the two measure slightly apart, but in a
  listening test no difference could be heard, so 16-bit became the default on
  2026-10-04. Pick 32-bit on a model's row to go back.

Changing one on a loaded model reloads it. They are saved per model in
`settings.engines.engine_overrides[engine].runtime_options[model]` (see
[Settings reference](settings-reference.md)).

**Direction and identity pull against each other.** Written direction — a
persona's Style Instructions, a line's own direction —
reaches Qwen3 CustomVoice, Qwen3 VoiceDesign and VoxCPM2. On every engine but
VoxCPM2 it does not reach a clone: Qwen3 Base and Pocket TTS clone but have no
instruction input, and Chatterbox steers through Exaggeration and CFG weight
rather than words. So on those, "direct the performance in words" and "use this
speaker's cloned voice" are a choice — VoxCPM2 is the engine that does both — and that
includes a designed voice once you keep it, because keeping one turns it into
a clone ([voices.md](voices.md#keeping-a-designed-voice-is-what-makes-it-one-voice)).

**Inline tags are Chatterbox Turbo's and Nano's.** Both read 19 bracketed tags
in the text: an emotion the line is spoken in (`[angry]`, `[fear]`, `[happy]`,
`[sarcastic]`, `[surprised]`, `[crying]`, `[whispering]`), a register it is read
as (`[narration]`, `[dramatic]`, `[advertisement]`), and sounds made at a point in
it (`[cough]`, `[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`, `[groan]`, `[sniff]`,
`[clear throat]`, `[shush]`). With any other model, bracketed markup is removed
before the model sees it, so it is never read out as a word. The rule from
2026-09-29 holds: **a tag the rendering engine doesn't list is dropped, never
spoken**, in a chapter render and in a persona's **Hear it** alike — including ordinary
bracketed text such as `[sic]`.

**Chatterbox Turbo and Nano** are English-only Chatterbox models that clone from
a clip longer than 5 seconds and take the inline tags above. Turbo is the larger
(350M parameters); Nano is Turbo's design at 110M, for the CPU and small cards.
They have no Exaggeration or CFG weight — only Temperature, Repetition penalty,
Top p and Top k. They come from JustVoice's own conversions of Resemble AI's
checkpoints (MIT), at
[delebash/chatterbox-turbo-GGUF](https://huggingface.co/delebash/chatterbox-turbo-GGUF)
and [delebash/chatterbox-nano-GGUF](https://huggingface.co/delebash/chatterbox-nano-GGUF).

**Emotion** is a nine-value label rather than a sentence. On Qwen3
CustomVoice and VoiceDesign it becomes part of the instruction; the other
engines have no way to take it.

**Language.** The line's language goes to the engine in the form it expects —
Qwen3 wants the language's name, the others a code — so you never type either.
A line with no language, or one Qwen3 doesn't speak, goes to it as *Auto*: it
picks the language itself (until 2026-10-04 it was read as English). Speech
recognition is given the language's name too, and detects the language itself
for one it doesn't know.
Pocket TTS takes no language: its loaded model is the language, and a line in
another one is refused by name.

## Not available yet

These worked before the 2026-10-01 switch and do not yet run on the speech
runtime; the order is in
[the switch record](plans/2026-10-01-audiocpp-switch.md#5-after-the-cut--the-gaps-in-order).

- **A confidence score from speech recognition.** The old recogniser
  reported how sure it was of each transcript; the new one does not.
- **Voice training** — see [Voice training](#voice-training).

Back since v0.9.0-jv.4: Chatterbox Turbo (cloning, inline tags), Chatterbox in
Hebrew, Japanese, Russian and Chinese, Kokoro blends, Kokoro's Japanese voices,
and a lexicon's exact pronunciations on Kokoro. A runtime still on an older
build refuses a line that needs one of them, by name — *"… — this needs the
speech runtime update"* — and **Update to** on the runtime row brings it.

**Removed for good:** LuxTTS, TADA and MOSS-TTSD. LuxTTS was the one engine
that cloned quickly on a CPU; Pocket TTS took its place on 2026-10-02. TADA and
MOSS-TTSD were already marked for removal. Whisper, the old speech recogniser, was
replaced by Qwen3-ASR, which got fewer words wrong on both human speech (4.3 %
against 5.8 %) and rendered narration (8.6 % against 9.9 %).

## Picking an engine for a use case

- **Audiobook narration in your own voice.** Chatterbox Multilingual or Qwen3
  Base. Clone from a minute or two of clean read-aloud.
- **Audiobook with many speakers.** Cloned or designed voices for the main
  cast, Kokoro for minor speakers — faster to render, 49 voices to choose from.
- **Directed performances.** Qwen3 CustomVoice — tell each line how to sound
  in plain words.
- **A voice nobody recorded.** Qwen3 VoiceDesign — describe it.
- **Multilingual audiobook.** Chatterbox Multilingual clones in 19 languages;
  Qwen3 covers 10, including Chinese, Japanese and Korean.
- **Game dialogue at 50–500 line scale.** Kokoro. Render speed matters at
  scale.
- **Dictation playback** (MCP `speak` tool). Kokoro. Lowest latency.
- **No graphics card, or a small one shared with an AI model.** Kokoro and
  KittenTTS for built-in voices, Pocket TTS for cloning — all three speak more
  than three times faster than real time on an 8-core CPU.

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

**A render loads the model each voice needs.** A voice remembers the model it
was made for ([Voices → Every voice knows the model that speaks it](voices.md#every-voice-knows-the-model-that-speaks-it)),
so hearing a Qwen3 speaker while Qwen3 Base is loaded loads CustomVoice first,
and a chapter with voices on several models loads each in turn. The size and
precision come from here: the model you loaded if it is the right one, else
the one you **Set as default** if it is, else a downloaded build of that model
(the same size first) — and if none is downloaded, the load downloads one, as
any first load does. Pocket TTS picks its model by the line's language.

The runtime never outlives JustVoice: closing the window stops it, and the
server stops one left over from an earlier session when it starts — see
[GPU → Engines left over from an earlier session](gpu.md#engines-left-over-from-an-earlier-session).

### The catalog rows

Each engine group expands into its model rows, and each row carries the model's
**facts** — read from the engine's pinned catalog, never typed twice:

- **Language chip** — `en` for single-language models, `19 langs` for
  multilingual ones (hover for the full list).
- **Capability chips** — `CLONING` (clones a voice from a short clean sample)
  and `PRESETS · N` (ships N ready-made voices). The filter row above the list
  (**All · TTS · STT · Cloning · Built-in voices**) filters on exactly these
  facts.
- **Licence chip** — the model's *weights* licence. Every bundled model
  permits selling your generated output.
- **Download size · on disk** — the verified download size, plus "on disk"
  once every file is present.
- **Measured memory** — on the loaded row: "X GB measured" once this machine
  has measured the model's real footprint, "not measured yet" on its first
  load (the same numbers as the memory strip at the top of the console —
  nothing is ever guessed).

The **⋯ menu** on each row holds the less-common verbs:

- **Re-download** — deletes the local files and downloads fresh. Use it when a
  download looks corrupted.
- **Open folder** — opens the model's folder in your file explorer (desktop
  app only; the browser UI can't reach your file manager and says so).
- **View on Hugging Face** — the model's upstream repository page.
- **Delete downloaded model** — removes the downloaded file; the engine and
  other models stay, and the model downloads again on demand. (Unload first —
  a loaded model's files can't be deleted.)

These are the same four verbs, in the same order and with the same words, as
the **⋯** menu on an AI model row under **LLM providers**.

At the bottom of an engine group with anything downloaded, **Delete downloaded
models** removes all of that engine's models at once. The speech runtime stays
installed. If a file is still in use — Windows will not delete a file a
program holds open — it says so and names the folder, instead of claiming a
delete that did not happen.

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
its cost. Models that can only speak from a clip (Chatterbox Multilingual,
Qwen3-TTS Base) measure themselves on their first real lines instead. The cost
only goes up after that: a line that takes more is remembered too.

Each slot's cell shows its own process's measured memory: the model, plus the
process's own share of the card (about 100 MB). The full story is in
[GPU](gpu.md#the-shared-memory-budget).

#### Long text, cut into pieces

Long text is split at sentence boundaries, rendered per piece, and joined with a
short crossfade. You don't need to do anything — the server sees long input and
switches paths on its own.

How long a piece may be depends on the model, as above: **200 characters** for
Qwen3-TTS CustomVoice and Base and for VoxCPM2, **240** for Kokoro (its own
limit), and `settings.generation.max_chunk_chars` (default 800) for the rest —
and that setting caps them all.

Voice auditions on the Voices page use the same splitter at a much smaller size
(`settings.generation.stream_piece_chars`, default 200): each sentence-sized
piece is sent to your player the moment it renders, so playback starts after the
first piece instead of the whole render. Pieces join with the same crossfade.

The splitter knows about abbreviations (`Mr.`, `Dr.`, `e.g.`), decimal numbers,
CJK sentence-end punctuation (`。！？`), and treats `[bracket]` tags as one unit
(never split inside one).

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
