# GPU / CUDA

Every speech model in JustVoice runs in one program, **the speech runtime**
([audio.cpp](https://github.com/0xShug0/audio.cpp)), and the runtime comes in a
build per kind of hardware. Which build runs is the one GPU decision you have —
**AI Settings → Speech engines → Speech runtime → Backend** — and **Auto** gets
it right on most machines. **Settings → GPU** shows what the machine reports.

## What you'll see on Settings → GPU

- **Backend** — the best compute runtime the machine reports (`cuda` / `metal` /
  `rocm` / `vulkan` / `cpu`). This is detection, not a setting — the speech runtime's
  own build is chosen under Backend on the Speech engines tab (below).
- **Device** — vendor, model and driver of the first GPU.
- **VRAM total / used** — measured, the same number `nvidia-smi` or Task Manager shows.

## Which build the runtime uses

| Your machine | Auto picks | What else you can choose |
|---|---|---|
| Windows, NVIDIA GeForce 40-series and older | CUDA 12.4 | Vulkan, CPU |
| Windows, NVIDIA GeForce 50-series (Blackwell) and newer | CUDA 13.3 | Vulkan, CPU |
| Windows, AMD or Intel graphics | Vulkan | CPU |
| Linux, any GPU | Vulkan | CPU |
| macOS | Metal | — |
| No usable GPU | CPU | — |

The CUDA split follows the card's compute capability (10.0 and above needs the
13.x build), the same rule the AI model runner uses for its own builds, so the
two never disagree about your card. Linux NVIDIA machines run Vulkan because
audio.cpp publishes no Linux CUDA build.

**Changing it.** Pick another backend (and, on a machine with more than one
GPU, another **GPU**) on the runtime row. The speech models unload and the
runtime stops; the next load starts the build you chose. A build you have not
downloaded yet shows **not installed** until you click **Install speech
runtime** — the Windows CUDA 12.4 build is a 461 MB download (about 2 GB once
unpacked, most of it NVIDIA's libraries), the Vulkan build 60 MB. Your
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
providers or Speech engines (consolidated 2026-08-15; there is no longer a
second bar on the Speech engines tab). Its left cells are the box facts
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
  When nothing is loaded at all the cell shows **~X GB on demand** — the
  predicted footprint of the model your features route to (a prediction that
  prefers your own measured loads over calculation) — or **cloud-routed** if
  your AI features run on a cloud provider and nothing will load locally.
- **TTS** / **STT** — always present, one per slot: **—** when nothing is
  loaded, otherwise the loaded model's name and its real, measured memory
  take (or **on CPU** when the model is placed on the CPU, which holds no VRAM
  on a discrete card — see [Engines → Where each model runs](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu)).
  Each slot runs in a process of its own, so its number is that process's
  measured memory — its model plus the process's own share (about 100 MB on
  the card); nothing is counted twice.
  The very first time an engine loads on your machine the cell says **not
  measured yet** for a moment: JustVoice attaches no number to a load it has
  never observed — it measures the engine process itself as soon as the load
  lands, shows the real figure, and remembers it for next time. Renders
  raise the number to the observed peak (a TTS engine uses more memory while
  generating than just after loading). On the rare box where per-process
  measurement isn't possible, the cell shows a **~** figure read from the
  device-wide change during the load, labeled as approximate.
- **Other apps** — memory held by things JustVoice doesn't manage (browser,
  OS, games). A shared card is shared; the strip says so instead of
  pretending the pool is all yours. Click **show apps** on this cell to see
  exactly which programs — see [Which apps are using the
  GPU](#which-apps-are-using-the-gpu) below.
- **Busy** — shown while a render, transcription, or AI run is in flight. A
  busy model is never evicted: if something else needs its memory it waits
  or fails honestly instead of killing your work.

The label follows your hardware: a discrete card shows **VRAM**; laptops with integrated or unified memory (iGPU, Apple Silicon) show **Memory**, because CPU and GPU share the same physical pool there and every load — even a CPU-placed one — draws from it.

Home shows the same cells and nothing else — **VRAM used**, **Free**, **LLM**,
**TTS** and **STT**, each with the model it holds under it — read the same way
and kept up to date while Home is open, so the two never disagree. The top
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
unloading the speech engine that moved in while it slept. You get a toast
naming what was unloaded and why. The engine reloads by itself the next time
you render; nothing is lost but the seconds it takes.

This is deliberately a visible swap rather than a silent squeeze. Before
JustVoice tracked sleep, both models could end up believing they held the
same gigabytes: the totals added up to more than the card, and the graphics
driver quietly spilled the overflow into ordinary system memory, which runs
many times slower. A model that unloads and reloads with a toast is far
better than two models fighting over one card in silence.

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

### Engines left over from an earlier session

The speech runtime runs as its own program next to the JustVoice server, and it
holds GPU memory while a model is loaded. It never outlives the server that
started it:

- **On Windows it dies with the server.** The server starts the runtime inside
  a Windows job that the operating system closes when the server ends — closed,
  crashed or killed — and closing it ends the runtime and releases its memory.
- **Closing the window shuts down cleanly.** The desktop app asks the server to
  stop, the server stops the runtime (which releases its memory at once), and
  then exits. The app forces the server closed only if that hasn't happened
  within a few seconds.
- **The server clears up when it starts.** It looks for a runtime from this
  install whose server no longer exists, stops it, and writes to its log what
  it stopped and how much GPU memory that freed. A runtime whose server is
  still running is never touched — including one belonging to a second
  JustVoice server on the same install.

A runtime left behind by a JustVoice older than this one — or, before
2026-10-01, the per-engine Python programs that preceded it — can still be
holding memory, and that is exactly what makes the AI model fail to load when
it fitted yesterday. When a model load fails at launch and such a process is
running, the loading screen says so under the error, for example *"1.5 GB of
GPU memory is held by 2 Speech runtime processes from an earlier session"*,
with a **Stop them and retry** button: it stops them and loads the model again.
Whenever a model fails to load, its error message also starts by naming any
other program holding a sizeable amount of GPU memory (200 MB or more — the
desktop's own share stays out of it), with the amount each one holds.

The server log records every model load with the process ID and the memory in
use before and after, and the runtime writes its own log to
`logs/audiocpp-server.log` in your data folder — so "what was holding the
GPU?" has an answer after the fact too. The server log is under **Settings →
Logs**, or the tray's **Open log file**; the runtime's sits beside it in the
same folder.

**How loading works now.** When you load an engine JustVoice has **measured
before on this machine**, it checks **measured free memory** first —
including what other apps are holding. If there isn't room, it frees the
least-recently-used *idle* model — the AI model included — and tells you
with a toast naming what was unloaded and why. If nothing can be freed
(everything resident is busy), the load refuses with a message quoting the
measured numbers and listing what's resident and busy, instead of
crash-landing in an out-of-memory error mid-render. An engine's **first-ever
load** on a machine is different on purpose: JustVoice has no honest number
for it yet, so it doesn't guess, doesn't evict anything on a guess's behalf,
and simply attempts the load — if the model genuinely doesn't fit, that one
load fails with a clear out-of-memory error and nothing already running is
harmed. From then on the engine has a measured footprint and gets the full
admission treatment. The same protection runs in the other direction: an AI
run fired mid-render can't kill the rendering engine — it proceeds in
reduced-memory mode and runs full speed after the render ends.

**Where models run.** Every model runs on the speech runtime's backend (the runtime row's **Backend** select); the engine card shows it once loaded (`· CUDA`, `· VULKAN`, `· CPU`). The CPU build costs no VRAM on a discrete card (its RAM use is shown for information, never enforced). There is no per-engine Device select any more — the 2026-10-01 switch put every engine in one runtime.

**Warm boot.** With the budget in charge, the local AI model now warms up at launch by default on fresh installs (the family default) — the first Analyze is instant, and if a render needs the memory the idle model is simply evicted with a toast. Turn it off in the AI engine console if you prefer a cold start. Databases created before 2026-08-13 keep their old warm-off setting until you change it or reset.

**Where the numbers come from.** Every memory figure you see is **measured
on your box** — JustVoice never uses a hand-typed VRAM figure, and it
doesn't compute predictions from file sizes either (checkpoint files on
disk don't reliably predict what actually loads into memory). Before an
engine's first load there simply is no number — the strip says **not
measured yet** — and from the first real load onward the number is the
engine process's actual footprint, remembered per machine.

You can still load one engine per slot (one TTS + one STT). Unload via the Speech engines tab's Loaded-now rail — or just load what you need and let the budget do the freeing.

## Troubleshooting

- **The AI model fails to load: "could not load its speculative-decoding (MTP) draft even on its own"** — Read the start of the message first. If it names other programs holding GPU memory, that is the likely cause: close them (or, on the loading screen, click **Stop them and retry** for JustVoice's own leftover engines — see [Engines left over from an earlier session](#engines-left-over-from-an-earlier-session)) and load again. Only if nothing else is holding memory do the other causes apply: the model's tune leaves too little room for the draft (raise `n_cpu_moe`), the draft file is damaged (re-download it), or turn MTP off. When other programs are holding memory the load fails straight away rather than first restarting the AI engine and trying again — a restart can't free another program's memory, so it would only add time. With nothing else on the GPU it still restarts once and retries before it gives up.
- **GPU info card shows "no GPU detected"** — Either no discrete GPU is present (laptops often have CPU + integrated graphics only, which detection may not report) or the driver isn't installed. Run `nvidia-smi` (NVIDIA) or `vulkaninfo` (AMD) from a terminal to verify.
- **The speech runtime fails to install** — Most often a network issue pulling the archive from GitHub. The bar on the runtime row carries the error; Install again resumes. If it says the program would not start, a virus scanner may still be holding the freshly unpacked files — wait a moment and retry.
- **Out-of-memory on render** — Switch to a smaller model variant (Speech engines tab → engine row), or load a lighter engine entirely.
- **Rendering is very slow** — Check the runtime row on AI Settings → Speech engines: which build is running? A CPU build on a machine with a GPU means Backend was set to CPU, or the GPU build failed to start and you installed CPU instead. The model's row there shows where it runs once loaded (`· CUDA`, `· VULKAN`, `· CPU`).

## What's detected — under the hood

Settings → GPU calls `/v1/system`, which returns the runtimes the machine reports and the `gpus` list — the same data you'd get from `nvidia-smi` (or the platform's equivalent). The speech runtime's own state is `GET /v1/speech-runtime`: release, the build installed, the backend setting and the builds available for this OS, the GPUs, and whether it is running.
