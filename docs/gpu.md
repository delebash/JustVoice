# GPU / CUDA

Every speech model in JustVoice runs in one program, **the speech runtime**
([audio.cpp](https://github.com/0xShug0/audio.cpp)), and the runtime comes in a
build per kind of hardware. Which build runs is the one GPU decision you have —
**Build**, under **Engine settings** on **AI Settings → Speech** — and **Auto**
gets it right on most machines. **Settings → GPU** shows what the machine reports.

## What you'll see on Settings → GPU

- **Backend** — the best compute runtime the machine reports (`cuda` / `metal` /
  `rocm` / `vulkan` / `cpu`). This is detection, not a setting — the speech runtime's
  own build is chosen under **Build** on the Speech tab (below).
- **Device** — vendor, model and driver of the first GPU.
- **VRAM total / used** — measured, the same number `nvidia-smi` or Task Manager shows.

## Which build the runtime uses

| Your machine | Auto picks | What else you can choose |
|---|---|---|
| Windows, NVIDIA GeForce 40-series and older | CUDA 12.4 | Vulkan, CPU |
| Windows, NVIDIA GeForce 50-series (Blackwell) and newer | CUDA 13.3 | Vulkan, CPU |
| Windows, AMD or Intel graphics | Vulkan | CPU |
| Linux, any GPU | Vulkan | CPU |
| macOS, Apple silicon | Metal | — |
| macOS, Intel | Metal (the Intel build) | — |
| No usable GPU | CPU | — |

The CUDA split follows the card's compute capability (10.0 and above needs the
13.x build), the same rule the AI model runner uses for its own builds, so the
two never disagree about your card. Linux NVIDIA machines run Vulkan because
audio.cpp publishes no Linux CUDA build.

**Changing it.** Under **Engine settings** on the Speech tab, pick another
**Build** — the list holds **Auto** and the builds this machine can run: **CUDA
(NVIDIA)**, **Vulkan**, **CPU**, **Metal (Apple GPU)** — and, on a machine with
more than one card, another **Graphics card**, then **Save**. A build you have
not downloaded yet makes the engine read *Not installed* until you click
**Install** — the Windows CUDA 12.4 build is a 467 MB download plus 607 MB of
NVIDIA's libraries (about 2 GB once unpacked), the Vulkan build 67 MB. An install
stops the speech processes once a line that is speaking has finished; the next
load starts the build you chose. A build already on this computer needs no
install: the next load starts the speech process again on it. Your
downloaded models are not affected; the same files serve every build.

**Without a GPU.** Every engine runs on the CPU build. Kokoro measured 2.8×
real time there (2026-10-01) — comfortably usable. Qwen3 and Chatterbox were
not measured on the CPU; expect them to be much slower than real time, which
for audiobook-scale work means a GPU (CUDA, Vulkan or Metal).

Until 2026-10-01 each engine was a Python program with its own PyTorch build,
chosen per engine at install time (CUDA 12.6 / 13.0, ROCm, or CPU wheels, with
`JUSTVOICE_TORCH_INDEX` as the override). That is gone, and so is the
per-engine **Device** select: one runtime, one backend, for every engine. A
Windows machine with AMD or Intel graphics now accelerates every engine through
Vulkan — before, only Kokoro accelerated there.

## The shared memory budget

Your speech engines and the local AI model share **one memory pool**, and since the 2026-08 arbiter wiring JustVoice manages that pool with a single shared budget — nothing is loaded blind anymore.

**The memory strip** sits at the top of the AI Settings console, above the
tabs — one strip for the whole console, visible whether you're on LLM
providers or Speech. Its left cells are the box facts
(OS · CPU · Memory · GPU · Acceleration); its live cells show **measured
reality** — the same numbers `nvidia-smi` or Task Manager would show you,
never internal bookkeeping:

- **VRAM used** (or **Memory used** — see below) — how much of the pool is
  actually in use right now, out of the total the box has.
- **Free** — what's actually left.
- **LLM** — the loaded language model's name and the runner's booked take.
  The cell reads **asleep** when the model is still configured and ready but
  its memory has been released after a spell of not being used — see [When
  the AI model goes to sleep](#when-the-ai-model-goes-to-sleep) below.
  When no language model is loaded the cell shows **—**.
- **Speech · Graphics card** and **Transcription · Graphics card** — one cell
  for each speech or speech-recognition model that holds memory, with the
  model's id under it. A model on the CPU holds no VRAM on a discrete card, so
  it has no cell there (on shared memory it does: **Speech · CPU**); see
  [Engines → Where each model runs](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu).
  Each kind runs in a process of its own, so the number is that process's
  measured memory — its model plus the process's own share (about 100 MB on
  the card); nothing is counted twice. A plain number (*2.9 GB*) was measured
  on this computer when the model loaded; one marked **~** (*~1.0 GB*) is the
  model's stated need — audio.cpp's estimate — until a load here measures it.
  Renders raise the number to the observed peak (a speech model uses more
  memory while generating than just after loading).
- **Other apps** — memory held by things JustVoice doesn't manage (browser,
  OS, games). A shared card is shared; the strip says so instead of
  pretending the pool is all yours. Click **show apps** on this cell to see
  exactly which programs — see [Which apps are using the
  GPU](#which-apps-are-using-the-gpu) below.

A model that is speaking — a render, a transcription, an AI run in flight — is
never unloaded to make room: if something else needs its memory, that load
waits or fails honestly instead of killing your work.

The label follows your hardware: a discrete card shows **VRAM**; laptops with integrated or unified memory (iGPU, Apple Silicon) show **Memory**, because CPU and GPU share the same physical pool there and every load — even a CPU-placed one — draws from it.

Home shows the same cells and nothing else — **VRAM used**, **Free**, **LLM**,
the speech cells and **Other apps**, each with the model it holds under it —
read the same way and kept up to date while Home is open, so the two never
disagree. The top
bar's pills open the models themselves.

### When the AI model goes to sleep

A local language model that has not been asked anything for a while is put to
sleep: its weights are dropped from memory and the whole pool goes back to
whatever else needs it. Nothing is forgotten — the model is still your
configured model, and the next time a feature asks it something it loads
itself back in, taking a few seconds to do so. The delay is **Unload an idle
model after (seconds)** in the AI engine panel — 15 minutes by default.

The strip tells you when this has happened. The **LLM** cell reads **asleep**
instead of a number, because the honest number is nothing: the card is not
holding those gigabytes any more, and **Free** rises to prove it.

**A sleeping model's memory is genuinely available.** If you start a render
while your AI model is asleep, the speech engine can use the memory the model
gave back — that is the point of sleeping, and it is why a big narration
engine and a big language model can share a card that could never hold both
at once.

**Waking up takes the memory back, and says so.** When a feature next needs
the model, JustVoice makes room for it *before* it loads — which may mean
unloading the speech model that moved in while it slept; the memory strip shows
it go. The speech model reloads by itself the next time you render; nothing is
lost but the seconds it takes.

This is deliberately a visible swap rather than a silent squeeze. Before
JustVoice tracked sleep, both models could end up believing they held the
same gigabytes: the totals added up to more than the card, and the graphics
driver quietly spilled the overflow into ordinary system memory, which runs
many times slower. A model that unloads and reloads is far better than two
models fighting over one card in silence.

**The AI model needs room in your computer's memory too.** The part of a
local model the graphics card doesn't hold stays in your computer's memory — on
an 8 GB card, gemma 4 26B keeps about 9.8 GB there. When its load mode keeps
those weights resident (read into memory, or mapped and locked — the defaults
for both gemma models), JustVoice checks before it loads that the memory free
now holds that part — worked out from the model file for where the layers
will go, or what it took at its last load here with the same settings if that
was more — plus the 1 GB safety margin, counting what any speech model it will
unload gives back. If there isn't room, the load stops before anything moves:
*not enough memory to load gemma-4-26b-a4b-qat: the part of it that stays in
this machine's memory is about 8.8 GB (+1024 MB safety margin) but only 8 GB of
this machine's 32 GB is free. Close other programs, or pick a smaller model.*
The free figure is what is free right now. With a speech model loaded — on the
graphics card or the CPU — the last sentence names it instead: *A speech model
(voxcpm2) is loaded and holds memory too — unload it first, or close other
programs.* When the check already counted the memory the speech models on the
graphics card give back, it names only the ones running on the CPU — their memory
is never counted (since 2026-10-15; before, it named none then).
A model waking from sleep is never stopped this way — a feature in the middle
of its work shouldn't fail — so a wake that is short of memory goes ahead, and
only the log says so.

If you would rather your model never slept — you have memory to spare and
want every answer instant — set **Unload an idle model after** to `0` (never)
in the AI engine panel. On a card that comfortably fits both your model and
your speech engine, that costs you nothing.

### Which apps are using the GPU

"Other apps" tells you *how much* memory something else is holding. Clicking
**show apps** on that cell tells you *what* — a list of every program
currently holding GPU memory, biggest first, with the amount each one holds.
Anything belonging to JustVoice itself (the speech runtime, the local model
runner) is marked **this app**, so you can separate your own footprint from
the rest of the desktop at a glance.

This is the answer to "why can't I load my model — nothing of mine is
running?" Usually it is a browser with hardware acceleration on, a game or
launcher left open, or the desktop compositor. Close the offender, click
**Refresh**, and watch the number fall.

The list is read **only while it is open**. Reading per-process GPU memory
means asking the operating system for a full counter sample, which takes
about a second, so JustVoice does not fold it into the strip's normal
refresh — nothing is measured until you open the panel, and it stops the
moment you close it. **Refresh** takes a new sample on demand.

Two honest limits, both of which the panel states inline rather than hiding:

- **The figures don't add up to the total above, and shouldn't.** Some GPU
  memory belongs to the driver and the desktop rather than to any one
  program, so the rows will always sum to a little less than the card's
  measured use. Use them to see who the big holders are, not as an exact
  audit of every megabyte.
- **Not every system can report this.** AMD's tools publish whole-card usage
  only, with no per-process breakdown at all, and a non-English Windows
  install renames the performance counters JustVoice reads. On those
  machines the panel says so plainly instead of showing an empty list — an
  empty list would wrongly read as "nothing is using your GPU". On systems
  where the reading comes from `nvidia-smi` rather than Windows' own
  counters, only compute workloads appear; a program using the GPU purely to
  draw its window won't be listed, and the panel notes that too.

### The speech runtime never outlives the app

The speech runtime runs as programs of its own next to the JustVoice server —
up to four, one per kind and place — and each holds GPU memory while a model is
loaded. None outlives the server that started it:

- **On Windows they die with the server.** The server starts each inside a
  Windows job that the operating system closes when the server ends — closed,
  crashed or killed — and closing it ends the process and releases its memory.
- **Closing the window shuts down cleanly.** The desktop app asks the server to
  stop; the server stops the speech processes first (which releases their memory
  at once), then exits. The app forces the server closed only if that hasn't
  happened within a few seconds. A server that exits any other way stops them
  as it goes.
- **On macOS and Linux, a crash is cleared up at the next start.** Each process
  leaves a note beside its log; the next time that process starts, a speech
  process a crashed server left running is stopped first. One whose server is
  still running is never touched.

Whenever a model fails to load, its error message starts by naming any other
program holding a sizeable amount of GPU memory (200 MB or more — the desktop's
own share stays out of it), with the amount each one holds. **Show apps** on the
memory strip's *Other apps* cell lists them too ([Which apps are using the
GPU](#which-apps-are-using-the-gpu)).

The server log records every model load with the process ID and the memory in
use before and after, and each speech process writes its own log —
`audiocpp-server.log` and the rest, beside the AI model engine's logs (see
[Engines → The speech runtime](engines.md#the-speech-runtime)) — so "what was
holding the GPU?" has an answer after the fact too. The server log is under
**Settings → Logs**, or the tray's **Open log file**.

### How a load is checked

When you load a model JustVoice has **measured
before on this machine**, it checks **measured free memory** first —
including what other apps are holding. If there isn't room, it frees the
least-recently-used *idle* model — the AI model included. If nothing can be freed
(everything resident is busy), the load refuses with a message quoting the
measured numbers and listing what's resident and busy, instead of
crash-landing in an out-of-memory error mid-render. A speech model's
**first-ever load** on a machine has no measured number yet, so JustVoice
doesn't do sums with a guess: with the AI model on the card, Auto runs the new
model on the CPU when it is fast enough there, and otherwise unloads the AI model
first and loads it on the card, where the load measures it. A load on the card
that fails or spills moves to the CPU ([Engines → Where each model
runs](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu)). From
then on the model has a measured footprint and gets the full admission
treatment. The same protection runs in the other direction: an AI
run fired mid-render can't kill the rendering engine — it proceeds in
reduced-memory mode and runs full speed after the render ends.

**Where models run.** Every model runs on the speech runtime's build (**Build** under **Engine settings** on the Speech tab), on the graphics card or the CPU as its **Auto · Graphics card · CPU** choice says; its row says where once loaded (*Loaded on the graphics card*, *Loaded on the CPU*). A model on the CPU costs no VRAM on a discrete card. There is no per-engine Device select — every engine runs in one runtime.

**Warm boot.** With the budget in charge, the local AI model now warms up at launch by default on fresh installs (the family default) — the first Analyze is instant, and if a render needs the memory the idle model is simply unloaded. Turn it off in the AI engine console if you prefer a cold start. Databases created before 2026-08-13 keep their old warm-off setting until you change it or reset.

**Where the numbers come from.** A speech model's memory is **measured on
your box** — the model's own process, at its first load and after its lines,
remembered per machine and runtime build. Before a model's first load, the
strip shows the model's stated need with a **~** (*~1.0 GB*): audio.cpp's
estimate, which the first real load replaces with the process's actual
footprint.

You can load one model per kind (one speech, one speech recognition). Unload
with **Loaded now** on the Speech tab — or just load what you need and let the
budget do the freeing.

## Troubleshooting

- **The AI model fails to load: "could not load its speculative-decoding (MTP) draft even on its own"** — Read the start of the message first. If it names other programs holding GPU memory, that is the likely cause: close them and load again (JustVoice's own speech processes never outlive the app — see [The speech runtime never outlives the app](#the-speech-runtime-never-outlives-the-app)). Only if nothing else is holding memory do the other causes apply: the model's tune leaves too little room for the draft (raise `n_cpu_moe`), the draft file is damaged (re-download it), or turn MTP off. When other programs are holding memory the load fails straight away rather than first restarting the AI engine and trying again — a restart can't free another program's memory, so it would only add time. With nothing else on the GPU it still restarts once and retries before it gives up.
- **GPU info card shows "no GPU detected"** — Either no discrete GPU is present (laptops often have CPU + integrated graphics only, which detection may not report) or the driver isn't installed. Run `nvidia-smi` (NVIDIA) or `vulkaninfo` (AMD) from a terminal to verify.
- **The speech runtime fails to install** — Most often a network issue pulling the archive from GitHub. The bar under **Engine: audio.cpp** on the Speech tab carries the error; Install again resumes. If it says the program would not start, a virus scanner may still be holding the freshly unpacked files — wait a moment and retry.
- **Out-of-memory on render** — Switch to a smaller model version (**Set as default** on its row on the Speech tab, or a persona's **Version**), or load a lighter engine entirely.
- **Rendering is very slow** — Check **Build** under **Engine settings** on AI Settings → Speech: a CPU build on a machine with a GPU means it was set to CPU. Then check the model's row there: *Loaded on the CPU — …* says why it runs on the CPU; pick **Graphics card** for it to keep it on the card.

## What's detected — under the hood

Settings → GPU calls `/v1/system`, which returns the runtimes the machine reports and the `gpus` list — the same data you'd get from `nvidia-smi` (or the platform's equivalent). The speech runtime's own state is `GET /v1/ai/runtimes/audiocpp/engine/status`: the build pinned and installed, whether a newer tested build is offered (`updateTo`), its settings and how the tab shows each on this machine (`settingsUi` — the builds this machine can run, its cards, its physical cores), its add-ons, and what each kind holds (`loaded`).
