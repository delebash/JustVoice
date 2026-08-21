# Engines

JustVoice ships with 6 commercial-output-permitting TTS engines plus an external OpenAI-compatible bridge. Each engine runs in its own Python environment, so installing Chatterbox cannot touch Kokoro's dependencies — see [Where the Python environments live](#where-the-python-environments-live).

> **Why no Higgs?** Higgs Audio v3 was removed 2026-06-09 — its model weights are released under a non-commercial license, which conflicts with JustVoice's audiobook / game / podcast use cases where users sell their generated output. Every remaining bundled engine's weights permit commercial output (verified against each engine's HuggingFace model card).
>
> **TADA attribution.** TADA's wrapper code is Apache-2.0 but its weights are released under the Llama 3.2 Community License (it's built on Llama 3.2). The license requires any product or service built on Llama-derivative models to display **"Built with Llama"** in the UI AND include the same notice in documentation. JustVoice surfaces it on the TADA Engines card under the description (driven by the engine manifest's `WEIGHTS_LICENSE` + `ATTRIBUTION` fields). If you publish work produced with TADA (audiobook, podcast, game), reproduce **"Built with Llama"** in your credits. See `NOTICE.md` for the authoritative copy.

## The catalog

| Engine | Type | Download | Languages | Voice cloning | Weight license |
|---|---|---|---|---|---|
| **Kokoro** | preset (54 voices) · fast on CPU | 333 MB | 8 | — | Apache-2.0 |
| **Chatterbox Turbo** | clone + paralinguistic | 3.0 GB | en | ✓ | MIT |
| **Chatterbox Multilingual** | clone | 3.2 GB | 23 | ✓ | MIT |
| **Qwen3-TTS** | 9 presets + instruct · *or* clone | 2.5–4.5 GB | 10 | ✓ (Base only) | Apache-2.0 |
| **LuxTTS (ZipVoice)** | clone · 48 kHz | 1.2 GB | en | ✓ | Apache-2.0 |
| **Hume TADA** ⚠ | clone · long-form coherent | 19.6 GB | 10 | ✓ | Llama 3.2 Community (+ MIT codec) |
| **MOSS-TTSD** ⚠ | clone · dialogue | 4.1 GB | en + zh | ✓ (experimental) | Apache-2.0 |
| **External** (OpenAI-compatible) | HTTP | 0 MB | — | varies | depends on provider |

(Download sizes are the SUM of each variant's pinned, verified model files
— checked against the real repositories on 2026-08-14, replacing earlier
hand-typed figures that were wrong for most engines. The old per-engine
"Speed" column was cut the same day: its realtime factors were never
measured. The honest generalisation: Kokoro is the one engine that is
genuinely fast on CPU; the PyTorch cloning engines want a GPU.)

**Qwen3-TTS is two different checkpoints**, and the difference decides what
you can do with it. *CustomVoice* ships 9 preset speakers (Vivian, Serena,
Uncle Fu, Dylan, Eric, Ryan, Aiden, Ono Anna, Sohee) and takes a plain-English
`instruct` line to steer their style and emotion — it **cannot clone a voice**.
*Base* clones from a 3–10 second reference clip and has no preset speakers.
Both speak the same 10 languages: Chinese, English, Japanese, Korean, German,
French, Russian, Portuguese, Spanish, Italian. (Until 2026-08-15 this table
said 17 languages and marked every Qwen row as cloning-capable; both were
wrong, and the Cloning filter believed them.)

## What each engine can be tuned with

Two things decide which controls you get: **which engine is loaded**, and
**which of its variants**. The loaded variant wins — with Chatterbox Turbo
loaded you get Turbo's controls, not Multilingual's.

Three settings are applied by JustVoice **after** synthesis, so they work
identically on every engine:

| Always available | What it does |
|---|---|
| **Gain** | output level in dB, clamped to −24…+12 |
| **Pitch** | semitone shift of the rendered audio |
| **Effects chain** | reverb, EQ, compressor, delay and the rest |
| **Lexicon** | pronunciation substitution, applied to the text before synthesis |

Everything else is passed to the engine, and each one honours a different set:

| Engine | Clones | Speed | Written direction | Emotion | Engine controls |
|---|---|---|---|---|---|
| **Kokoro** | ✗ | ✓ | ✗ | ✗ | none |
| **Chatterbox Multilingual** | ✓ | ✗ | ✗ | ✗ | Exaggeration · CFG weight · Temperature · Repetition penalty · Min p · Top p |
| **Chatterbox Turbo** | ✓ | ✗ | ✗ | **✓ as a tag** | Temperature · Repetition penalty · Top p · Top k · 19 inline tags |
| **Qwen3 CustomVoice** | ✗ | ✗ | **✓ instruct** | **✓ as words** | Temperature · Top k · Top p · Repetition penalty |
| **Qwen3 Base** | ✓ | ✗ | ✗ | ✗ | as above |
| **LuxTTS** | ✓ | ✓ | ✗ | ✗ | Inference steps · Guidance scale · Max ref length · Reference loudness · Timestep shift · Smoothing |
| **MOSS-TTSD** | ✓ | ✗ | ✗ | ✗ | Temperature · Top p · Top k · Repetition penalty · Max length · speaker + pause tags |
| **TADA** | ✓ | ✗ | ✗ | ✗ | none — text, reference and language only |

**Direction and identity pull against each other.** Written direction — the
Delivery direction box, a persona's Spoken delivery, a line's own direction —
reaches **Qwen3 CustomVoice and nothing else**, and CustomVoice is the one
Qwen checkpoint that cannot clone. Qwen3 *Base* clones but drops the
instruction silently: its clone call takes text, reference and language only.
So "direct the performance in words" and "use this character's cloned voice"
are, today, a choice. The way to have both is a LoRA trained on an
instruct-capable checkpoint — see Train in [labs.md](labs.md).

**Emotion is the exception, and that is why it is a list.** `Emotion` is a
nine-value label rather than a sentence, so it can compile two ways: into the
instruction for engines that read prose, or into the engine's own token for
engines that have an emotion vocabulary. Chatterbox Turbo is the only engine
in the second group — pick *fearful* and it renders `[fear] Who's there?`.
Turbo has no token for *sad*, *shouted* or *contemptuous*, so those three are
not offered while it is loaded. See [generate.md](generate.md).

**Chatterbox Turbo's inline tags — all nineteen.** Seven emotion (`[angry]`
`[fear]` `[happy]` `[sarcastic]` `[surprised]` `[crying]` `[whispering]`),
three register (`[narration]` `[dramatic]` `[advertisement]`) and nine
non-verbal (`[cough]` `[laugh]` `[chuckle]` `[sigh]` `[gasp]` `[groan]`
`[sniff]` `[clear throat]` `[shush]`). They are Turbo's alone — Multilingual
shares the engine but not the tokenizer and reads them aloud as words.
Resemble's model card documents only three by name, so the rest are declared
from the checkpoint's reserved token ids and have not been verified by ear.

**Cloning is not Chatterbox-only.** Chatterbox, LuxTTS, MOSS-TTSD, TADA
and **Qwen3 Base** all clone. Kokoro and **Qwen3 CustomVoice** do not —
and because that split runs *inside* the Qwen3 family, the variant is what
decides, not the engine name.

**A note on LuxTTS "T-shift".** It was previously presented as a native pitch
control. It is not. The fork we ship (`ysharma3501/LuxTTS`) calls it a
*"sampling param, higher can sound better but worse WER"*, and the ZipVoice
base it derives from defines `--t-shift` as *"shift t to smaller ones if
t\_shift < 1.0"* — the flow-matching sampling schedule, valid over (0, 1.0],
default 0.5. It trades pronunciation accuracy against quality, not key. It is
now labelled **Timestep shift** under advanced controls; use the Pitch slider
for pitch.

LuxTTS also carries two controls that act on the **reference clip** rather than
the render — **Max ref length** (how many seconds are encoded; set it above
your clip's length to avoid truncation artifacts) and **Reference loudness**
(the fork's `rms`; around 0.01 is its suggestion) — plus a **Smoothing** toggle
worth trying if output sounds metallic.

## Picking an engine for a use case

- **Audiobook narration in your own voice.** Chatterbox Turbo. Clone from 1-2 minutes of clean read-aloud.
- **Audiobook with 5+ characters.** Chatterbox Turbo for main voices + Kokoro for incidental characters (faster to render, plenty of voices).
- **Multilingual audiobook.** Chatterbox Multilingual — 23 languages, and it clones. Qwen3 covers 10 and is reported strongest on Chinese / Japanese / Korean (reported, not measured here) — but only its Base checkpoint clones; CustomVoice gives you its 9 preset speakers instead.
- **Game NPC dialogue at 50-500 line scale.** Kokoro (fast on CPU, 54 voices). Render speed matters at scale.
- **Multi-speaker game cutscenes.** MOSS-TTSD. One render produces every part, tagged `[S1]` `[S2]` `[S3]`, each cloned from its own reference clip.
- **Podcast voiceover.** Chatterbox Turbo if you want it to sound like you; Kokoro if you want preset variety fast.
- **Dictation playback** (MCP `speak` tool). Kokoro. Lowest latency.

## Loading / unloading

One engine is **loaded** per slot (one TTS, one STT). Loading takes 10-30s (model load + warmup). The **speech engines** tab on the ai page shows the current state per engine:

- `not installed` — first download required. (This also appears if you moved
  the JustVoice install folder: the engine's Python environment records its
  own location and has to be rebuilt. Click Install — your downloaded models
  stay put. See [Backup and data](backups-and-data.md#where-your-data-lives).)
- `installed` — present on disk, not currently loaded.
- `loaded` — resident and ready to render. The card also shows **which device** it loaded on (`· CUDA` / `· CPU`).

The verbs split the same way as the LLM catalog: a model that isn't on disk
shows **Download (N GB)** — download only; once its files are on disk the row
shows **Load model**. Click Load on any on-disk model; the same slot's prior
occupant auto-unloads.

### The catalog rows

Each engine group expands into its model rows, and each row carries the model's
**facts** — read from the engine's pinned manifest, never typed twice:

- **Language chip** — `en` for single-language models, `23 langs` for
  multilingual ones (hover for the full list).
- **Capability chips** — `CLONING` (clones a voice from a short clean sample)
  and `PRESETS · N` (ships N ready-made voices). The filter row above the list
  (**All · TTS · STT · Cloning · Preset voices**) filters on exactly these
  facts — pick **Cloning** and only the models that can clone remain.
- **Licence chip** — the model's *weights* licence. Every bundled engine
  permits selling your generated output; a gold **⚠** chip means an obligation
  rides the licence (TADA's Llama-3.2-Community requires "Built with Llama" in
  your published credits — hover the chip for the exact requirement).
- **Download size · on disk** — the verified download size, plus "on disk"
  once every file is present.
- **Measured memory** — on the loaded row: "X GB measured" once this machine
  has measured the model's real footprint, "not measured yet" on its first
  load (the same numbers as the memory strip at the top of the console —
  nothing is ever guessed).

The **⋯ menu** on each row holds the less-common verbs:

- **Re-download** — deletes the local files and downloads fresh. Use it when a
  download looks corrupted; it's also how a model downloaded before the speech
  cache moves onto the new layout.
- **Open folder** — opens the model's on-disk folder in your file explorer
  (desktop app only; the browser UI can't reach your file manager and says so).
- **View on Hugging Face** — the model's upstream repository page.
- **Delete downloaded model** — removes the downloaded weights; the engine and
  other models stay, and the model re-downloads on demand. (Unload first — a
  loaded model's files can't be deleted.)

These are the same four verbs, in the same order and with the same words, as
the **⋯** menu on an AI model row under **LLM providers** — the two catalogs
are one interaction grammar, not two.

### Loading and the memory budget

Loads run against the **shared memory budget** (the memory strip at the top of the AI Settings console, above the tabs — measured used/free, a TTS/STT cell per loaded engine with the model's name and its real memory take, the LLM, other apps; one strip for the whole console since 2026-08-15). For an engine JustVoice has measured before on this machine: if the pool is short, it frees the least-recently-used *idle* model and toasts what it unloaded; if everything resident is busy, the load refuses with an honest message quoting the measured numbers instead of an out-of-memory crash. An engine's first-ever load carries no number yet ("not measured yet" on the strip) — it simply attempts, gets measured, and is remembered. Each card also carries a **Device** select (Auto / CUDA / CPU) — Auto sends CPU-fast engines (Kokoro) to CPU and the rest to your GPU, and an explicit choice always wins. The full story is in [GPU / CUDA](gpu.md#the-shared-memory-budget).

### Cancelling an in-flight load

Loading can take a while. Downloads run from the row's **Download** button (or the API, which still fetches on a cold load) and go through the **speech cache**: plain files downloaded by the same chunked, resumable downloader the AI models use (a dropped connection resumes past the completed chunks instead of starting over), placed on disk *before* the engine process starts — the engine itself never touches the network. While a load or download is in progress:

- A progress bar appears **on the engine's own row**, naming the model and the
  stage it's in. Installs and downloads show real bytes and percent; a load
  shows the stage it has reached (`spawning subprocess`, `loading model
  weights`), because a model load reports no percentage and JustVoice does not
  invent one.
- The bar has a **Cancel** button while it runs. Clicking it sends
  `POST /v1/engines/{id}/cancel-load`, which:
  - Sets a cancel flag the manager polls between safe steps (model download → subprocess spawn → child `/load` call).
  - Kills the child subprocess if already spawned, so no VRAM is left allocated.
  - Aborts the client-side fetch so you stop waiting.
- A cancelled or failed bar stays on the row with its error and offers
  **Retry** and **Dismiss**. It doesn't clear itself — you decide when you've
  read it.

The row is deliberately the *only* place these appear. The full-width strip at
the top of the screen is the **AI task** queue: it is for work that queries a
language model (Compose, speaker attribution, ACX QC, and the like) and for
long TTS renders. Installing, downloading and loading are file and process
work, so they live on the row that owns them — the same rule the AI model
catalog follows for its own downloads and loads.

## ⚠ Marked for removal — TADA and MOSS-TTSD

Both are **scheduled for removal** and are no longer offered to new setups.
If you already installed one it keeps working exactly as before, and its row
stays on the Speech engines tab with a **⚠ marked for removal** badge; hover it
for the reason. If you have not installed it, it no longer appears in the
catalog and Voice engine setup never includes it in a tier. Searching for it by
name still finds it, so nothing is a dead end.

**Why TADA is going:** it is our largest download by a wide margin — 19.6 GB
across three repositories — and it accepts none of the per-render controls. Its
generate call takes text, a reference clip and a language, and nothing else. Its
ten languages are a subset of Chatterbox Multilingual's twenty-three, which also
clones and does take those controls, for 3.2 GB.

**Why MOSS-TTSD is going:** it was here for multi-speaker dialogue, and that
path was never wired — the adapter passes a single reference clip, so `[S1]` and
`[S2]` both come out in the same voice. JustVoice renders **one speaker per
line** and joins the results, which is a different shape from what a dialogue
model wants. Its other two draws are already covered: pauses are applied by
JustVoice after synthesis so they work on every engine, and Chatterbox
Multilingual covers Chinese *and* clones.

Nothing you have produced is affected. Existing renders, voices and personas
are unchanged; a persona cast to a voice on either engine keeps rendering while
the engine is installed. If you want to move a character off one, recast it in
Studio · Cast — the persona keeps its delivery settings, and the host-side ones
(gain, pitch, pauses, effects, lexicon) carry over to any engine.

## Which engines run on your operating system

Not every engine runs everywhere, and the ones that don't are **listed but not
offered**. Instead of an Install or Download button you get a badge —
`not available on this OS · windows · linux` — and hovering it says which
platforms the engine does declare. Nothing is hidden: you can still read the
engine's description, its models, their sizes and licences. You just can't
install something that would fail.

| Engine | Windows | Linux | macOS | Why |
|---|:--:|:--:|:--:|---|
| **Kokoro** | ✓ | ✓ | ✓ | ONNX via kokoro-onnx; CPU is real-time everywhere |
| **Chatterbox** | ✓ | ✓ | ✓ | Apple GPU attempted with the known float32 repair; falls back to CPU if it fails |
| **LuxTTS** | ✓ | ✓ | ✓ | Every dependency publishes wheels for all three, including piper-phonemize |
| **Whisper (STT)** | ✓ | ✓ | ✓ | transformers + torch, nothing platform-specific |
| **Qwen3-TTS** | ✓ | ✓ | ✓ | Torch checkpoints on Windows/Linux; on a Mac the catalog shows the MLX variants instead |
| **TADA** | ✓ | ✓ | ✗ | Known tensor issues on Apple's MPS backend (marked for removal) |
| **MOSS-TTSD** | ✓ | ✓ | ✗ | Needs flash-attn, which barely builds outside Linux (marked for removal) |

A note on how this is decided: each engine declares its own platforms, and the
server — not your browser — decides whether the machine actually running the
engine qualifies. That matters when you use JustVoice headless
(`justvoice-server serve`) from a laptop against a server elsewhere: what you
can install depends on that server's OS, not yours.

## Hardware acceleration, engine by engine

Every engine installs the right runtime for the machine it lands on — the
install itself picks the GPU arm, there is nothing to configure first.

| Engine | NVIDIA (CUDA) | Apple Silicon | Windows AMD/Intel GPU | Linux AMD (ROCm) | CPU |
|---|:--:|:--:|:--:|:--:|:--:|
| **Kokoro** | ✓ installed when CUDA is detected | ✓ CoreML, used automatically | ✓ DirectML, installed when detected | — | ✓ real-time |
| **Chatterbox** | ✓ CUDA torch wheel | ✓ MPS (float32 repair) | CPU | ✓ ROCm torch wheel | ✓ slow |
| **Qwen3-TTS** | ✓ CUDA torch wheel | ✓ MLX variants (their own runtime) | CPU | ✓ ROCm torch wheel | works, slow |
| **Whisper** | ✓ CUDA torch wheel | ✓ MPS | CPU | ✓ ROCm torch wheel | ✓ |

Two footnotes worth knowing. First, on a machine with a discrete GPU,
**Auto sends Kokoro to the CPU on purpose** — it is real-time there, and
the graphics card stays free for the engines that need it; pick CUDA or
DirectML in the engine's Device select if you want it on the GPU anyway.
On Apple Silicon there is one shared memory pool, so Auto uses CoreML.
Second, the torch engines have no DirectML arm — PyTorch's DirectML
backend stalled upstream — so on a Windows machine with an AMD or Intel
GPU they run on the CPU; Kokoro is the engine that accelerates there.

## GPU detection + tier-aware default

Settings → GPU shows your backend (CUDA / MPS / Metal / XPU / DirectML / ROCm), device name, VRAM total / used, compute capability, and HSA override status. On CPU-only boxes Kokoro is the recommended engine (it's built for CPU); for GPU boxes there is no hand-typed VRAM-to-engine pairing table any more — an engine's real footprint is **measured on your machine at its first load** and shown on the console's memory strip, which is the honest way to see what fits (the old GB-tier suggestions were never measured; cut 2026-08-14).

## Which PyTorch build gets installed

Chosen for you from detected hardware when an environment is built. NVIDIA
cards get **CUDA 12.6**, or **CUDA 13.0** on Blackwell (GeForce 50-series and
newer, which cannot run the 12.x builds at all); Linux AMD gets **ROCm 7.2**;
Apple Silicon gets the standard build, which carries the Metal (MPS) backend;
everything else gets CPU. Intel Arc and AMD-on-Windows are manual — set
`JUSTVOICE_TORCH_INDEX` before installing.

Roughly 2–3 GB per PyTorch build, downloaded once and then hard-linked into
each engine's environment rather than downloaded again — which is why several
environments cost far less than several copies. Override with
`JUSTVOICE_TORCH_INDEX` and reinstall the engine — see
[GPU / CUDA](gpu.md#which-pytorch-build-gets-installed-nvidia).

## Where model files live — the speech cache

Since 2026-08-14, downloaded speech models live in **the speech cache**:
one plain folder per model variant at
`<data dir>/speech-cache/<engine>/<variant>/`, holding the model's files
exactly as they are named upstream, plus a small `files.json` manifest
recording where each file came from (repository + pinned revision), its
expected size, and its upstream checksum id.

Why this matters to you:

- **Downloads resume.** Files come down through the same chunked
  downloader the AI models use — a dropped connection resumes past the
  completed chunks on the next attempt, and files that already finished
  are skipped entirely.
- **"Downloaded" means downloaded.** A model only counts as on-disk when
  every file named in its manifest is present at its recorded size. A
  half-fetched folder never shows a Load button.
- **No symlinks, no privileges.** Nothing in the cache is linked or
  hidden inside a hash-named blob store — what you see in the folder is
  the model. This is what structurally removed the Windows
  `WinError 1314` failure class.
- **Delete really deletes.** "Delete model" removes that one variant's
  folder — the engine and other variants stay.
- **Only what the engine loads.** Each variant's file list is pinned to
  the files its engine actually reads. Example: Chatterbox Turbo's
  repository carries an alternative 1 GB vocoder checkpoint the Turbo
  code never opens — JustVoice doesn't download it.

Models downloaded before this change (into the old per-engine
HuggingFace cache) keep working: the engine loads them the old way until
you delete and re-download, which moves them onto the new layout.

To reclaim the whole store at once, **Settings → Storage → Disk usage →
Speech models → Clear** deletes every downloaded speech model in one step
(each re-downloads on demand) — see
[Backup and data](backups-and-data.md#disk-usage).

## Where the Python environments live

Local engines run in Python environments JustVoice builds for you — you never
create or activate one by hand. **Every engine gets its own**, at
`<engines>/<engine_id>/.venv/`, built to exactly what that engine's manifest
declares. Nothing is shared between them.

Clicking **Install engine** builds that one environment and downloads that
one engine's models. **Uninstall engine** deletes both. Every engine has both
buttons, and neither reaches anything another engine depends on.

### Why one each, when they mostly want the same PyTorch

Because "mostly" was doing a lot of work. Until 2026-08-22 the engines shared
one environment, and each install re-resolved every other engine's
dependencies into it. Four things followed, and all four were real:

- **The tightest pin anywhere won for everyone.** Chatterbox asks for
  `transformers 5.2.0`; it ran on 4.57.3 for months because another engine
  needed that. On its own it now gets what it asks for — and renders slightly
  *faster* for it.
- **A ceiling had to be maintained by hand.** One engine's audio library
  refused to work above NumPy 2.0, so the whole environment was held below
  2.0 — which made Kokoro, which needs 2.0 or newer, impossible to install
  there. It got carved out first, for that reason alone.
- **A missing package was invisible.** A dependency could be declared in a
  manifest and never actually installed, and nothing noticed: the engine
  reported ready and failed later, somewhere else entirely.
- **There was no Uninstall.** An engine with no environment of its own has
  nothing to remove, so shared engines simply had no Uninstall button.

### What it costs on disk

Much less than it sounds. All five engines installed, measured on a real
machine (2026-08-22):

| | On disk |
|---|--:|
| The five environments together | **5,284 MB** |
| The largest one alone (Chatterbox) | 4,800 MB |
| **The other four, between them** | **484 MB** |
| What they would cost with no sharing | 18,750 MB |

Every engine names the **same PyTorch version** (2.13.0), and JustVoice fills
a new environment by hard-linking out of one download cache — so the second,
third and fourth environments reuse the same PyTorch bytes rather than
copying them. Install one engine and you have paid for PyTorch; the rest are
close to free.

Two things that saving depends on. The cache has to sit on the same drive as
the environments, which JustVoice arranges — both live inside your install
folder. And the engines have to agree about PyTorch: one engine on a
different version means a second full CUDA stack, about **4.3 GB**. A test
fails if two ever disagree, so that can only happen deliberately.

### If an environment gets out of date

JustVoice stamps each environment with the package set it was built from. If
an update changes what an engine needs, that engine's row offers **Install**
again rather than pretending to be current. Reinstalling is safe and touches
nothing else.

### Which Python, which PyTorch

Python **3.13**, and PyTorch **2.13.0** with torchaudio **2.11.0**, the same
in every engine. On Python 3.12 two of our engines had NumPy requirements
that could not both be satisfied; on 3.13 they agree, which is the reason for
the version.

Which PyTorch *build* you get depends on your hardware — see
[GPU acceleration](gpu.md) for the full matrix:

| Hardware | Build |
|---|---|
| NVIDIA, GeForce 40-series and older (compute capability under 10.0) | CUDA 12.6 |
| NVIDIA, GeForce 50-series / Blackwell and newer | CUDA 13.0 |
| AMD on Linux | ROCm 7.2 |
| AMD on Windows | CPU by default — see below |
| Apple Silicon | the standard build, which carries Metal (MPS) |
| Everything else | CPU |

### AMD on Windows

PyTorch publishes no ROCm builds for Windows, so JustVoice installs the CPU
build there and says so in the log. AMD publishes their own Radeon-on-Windows
PyTorch, and you can point JustVoice at it:

1. Install AMD's ROCm SDK packages for Windows, following AMD's own
   instructions (their PyTorch-on-Radeon page under *Install → Windows*).
   Their current build is **ROCm 7.2.1 with PyTorch 2.9.1**, needs **Python
   3.12**, driver **26.2.2 or newer**, and supports a specific GPU list
   (RX 7900 XTX class and AI PRO R9700 at the time of writing).
2. Set `JUSTVOICE_TORCH_INDEX` to AMD's wheel index before starting
   JustVoice.
3. Install the engines you want.

Because each engine has its own environment, an AMD-specific PyTorch and
Python in one of them affects nothing else — Kokoro, which uses no PyTorch at
all, is untouched either way. This is a manual recipe: JustVoice does not yet
detect AMD-on-Windows and offer it for you.

## Online + self-hosted providers (LLM + TTS)

Local engines (above) are managed by JustVoice — installed into the
environments described above, loaded one-at-a-time. Online + self-hosted
providers are a separate flow:

- **LLM providers** — Anthropic Claude, OpenAI, Gemini, Ollama, DeepSeek, OpenRouter. Needed for Compose, Persona rewrite, Speaker attribution, Smart-assign, Render preset suggest.
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
