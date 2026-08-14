# GPU / CUDA

JustVoice's engines run on whatever compute backend Python and PyTorch can find. The **Settings → GPU** sub-page surfaces what's detected and what's active.

## What you'll see

- **Active backend** — what's actually being used right now (`cuda` / `metal` / `coreml` / `directml` / `rocm` / `mlx` / `cpu`).
- **Detected runtimes** — every runtime the system reports as available. JustVoice picks the most capable one.
- **GPU cards** — vendor, model, VRAM, driver version (per GPU if you have multiple).

If the runtimes list is empty, you're CPU-only. Most engines work on CPU but slower:

| Engine | CPU realtime factor (rough) |
|---|---|
| Kokoro | ~15× realtime (fastest CPU engine) |
| Chatterbox | ~0.5× realtime — long renders take minutes |
| Qwen3-TTS | ~0.2× — practically GPU-only |
| TADA / Dia / MOSS | ~0.1× — practically GPU-only |

For audiobook-scale work, get CUDA (NVIDIA) or Metal (Apple Silicon) working.

## CUDA wheel switch (NVIDIA)

PyTorch engines (Chatterbox / Qwen3 / TADA / LuxTTS / Dia / MOSS) ship with the **CPU wheel** of torch by default. To enable CUDA acceleration:

1. Settings → GPU — confirm the runtimes panel lists `cuda` (means the driver is installed).
2. Speech engines tab (AI page) → find the engine you want — click **Install with CUDA**.
3. JustVoice reinstalls torch + torchaudio in that engine's venv with the matching CUDA wheel (downloads ~2-3 GB).
4. After reinstall, the engine's row shows the active wheel + the engine will use CUDA on next load.

The switch is per-engine. You can have Chatterbox on CUDA and Kokoro on CPU — they live in isolated venvs.

To roll back to CPU: same flow, pick "Install with CPU."

## Metal / CoreML (Apple Silicon)

Apple Silicon Macs get Metal automatically — PyTorch detects MPS (Metal Performance Shaders) on Apple GPUs. No wheel switch required.

Chatterbox specifically forces CPU on macOS due to a known PyTorch MPS bug with the Chatterbox model architecture (see `engines/chatterbox/engine.py:62-65`). All other engines run on MPS.

## ROCm (AMD)

Limited support. PyTorch ROCm wheels exist for Linux only. Windows ROCm is not currently supported by upstream PyTorch. If you're on Linux + AMD, install a ROCm-built torch in the engine venv manually (the auto-CUDA-wheel switch doesn't handle this yet).

## DirectML (Windows non-NVIDIA)

For Windows users with AMD or Intel GPUs, DirectML provides a fallback. Most engines work via DirectML but slower than native CUDA. Detected automatically; no switch needed.

## MLX (Apple Silicon, future)

MLX is Apple's experimental ML framework. We detect it but no engine adapter currently targets it; CoreML / Metal is the active Apple Silicon path.

## The shared memory budget

Your speech engines and the local AI model share **one memory pool**, and since the 2026-08 arbiter wiring JustVoice manages that pool with a single shared budget — nothing is loaded blind anymore.

**The budget strip** at the top of the Speech engines tab shows **measured
reality** — the same numbers `nvidia-smi` or Task Manager would show you,
never internal bookkeeping:

- **VRAM** (or **Memory** — see below) — how much of the pool is actually in
  use right now, out of the total the box has.
- **Free** — what's actually left.
- **One cell per loaded speech engine** — its real, measured memory take.
  Before an engine has ever loaded on your machine the cell shows an
  estimate, drawn as one (**~1.2 GB**, with a tooltip saying so); the moment
  it loads, JustVoice measures the engine process itself and the real number
  replaces the estimate — permanently, because the measurement is remembered
  for next time. Renders raise the number to the observed peak (a TTS engine
  uses more memory while generating than just after loading).
- **AI model** — what the local language model holds if it's loaded
  (measured, by the same rule), or **loads on demand · ~X GB** — its
  predicted footprint — when it isn't. That prediction also prefers your own
  measured loads over calculation. If your AI features are routed to a cloud
  provider, the cell says **cloud-routed** — nothing will load locally.
- **Other apps** — memory held by things JustVoice doesn't manage (browser,
  OS, games). A shared card is shared; the strip says so instead of
  pretending the pool is all yours.
- **Busy** — shown while a render, transcription, or AI run is in flight. A
  busy model is never evicted: if something else needs its memory it waits
  or fails honestly instead of killing your work.

The label follows your hardware: a discrete card shows **VRAM**; laptops with integrated or unified memory (iGPU, Apple Silicon) show **Memory**, because CPU and GPU share the same physical pool there and every load — even a CPU-placed one — draws from it.

**How loading works now.** When you load an engine that needs GPU memory, JustVoice checks **measured free memory** first — including what other apps are holding. If there isn't room, it frees the least-recently-used *idle* model — the AI model included — and tells you with a toast naming what was unloaded and why. If nothing can be freed (everything resident is busy), the load refuses with a message quoting the measured numbers and listing what's resident and busy, instead of crash-landing in an out-of-memory error mid-render. The same protection runs in the other direction: an AI run fired mid-render can't kill the rendering engine — it proceeds in reduced-memory mode and runs full speed after the render ends.

**Per-engine device choice.** Each engine card has a **Device** select (Auto / CUDA / CPU), stored in settings. **Auto** picks CPU for engines that are genuinely fast on CPU (Kokoro) and your GPU for the rest — the engine's own hidden "auto" no longer decides. An explicit choice always wins; the card shows which device the engine actually loaded on. CPU-placed engines cost no VRAM on discrete cards (their RAM use is shown for information, never enforced).

**Warm boot.** With the budget in charge, the local AI model now warms up at launch by default on fresh installs (the family default) — the first Analyze is instant, and if a render needs the memory the idle model is simply evicted with a toast. Turn it off in the AI engine console if you prefer a cold start. Databases created before 2026-08-13 keep their old warm-off setting until you change it or reset.

**Where the numbers come from.** JustVoice never uses a hand-typed VRAM
figure. Before an engine's first load on your machine, its estimate is
computed from the model's actual file sizes (weights on disk load roughly
1:1 into memory) plus a fixed allowance for the engine process itself —
and it's always labeled as an estimate. From the first real load onward,
every number you see is measured on your box. A small model really shows
up small: Chatterbox-Turbo (350M parameters) measures around 1–1.5 GB, not
a spec-sheet worst case.

You can still load one engine per slot (one TTS + one STT). Unload via the Speech engines tab — or just load what you need and let the budget do the freeing.

## Troubleshooting

- **Engine load fails with `[WinError 1314] A required privilege is not held by the client`** — A Windows edge case in the HuggingFace download cache some engines use for their first model download: the downloader occasionally tries to create a filesystem symlink, which normal Windows processes aren't allowed to do, instead of taking its copy fallback. Your download is almost always already complete when this happens — **just click Load again**: a fresh attempt takes the copy path and finishes placing the one missing file. You do NOT need Developer Mode or admin rights; JustVoice is expected to work without either. (A planned change moves speech-engine model downloads onto the same plain-file downloader the AI models use, which removes this failure class entirely.)
- **GPU info card shows "no GPU detected"** — Either no discrete GPU is present (laptops often have CPU + integrated graphics only, which torch ignores) or the driver isn't installed. Run `nvidia-smi` (NVIDIA) or `vulkaninfo` (AMD) from a terminal to verify.
- **CUDA wheel switch fails** — Most often a network issue downloading the ~2 GB wheel. Check the install-log modal for the pip output.
- **Out-of-memory on render** — Switch to a smaller model variant (Speech engines tab → engine row → pick a `7b` or smaller). Or load a lighter engine entirely.
- **Engine runs but very slow** — Check Settings → GPU: are you actually on CUDA, or did the wheel switch fall back to CPU? The Active backend pill is authoritative.
- **macOS: Chatterbox is way slower than expected** — Chatterbox forces CPU on Mac due to the MPS bug. This is intentional. Use Kokoro / Qwen3 on Mac for GPU acceleration.

## What's detected — under the hood

Settings → GPU calls `/v1/system` which returns the runtimes dict and the `gpus` list. The page picks the highest-priority active runtime and labels the rest. No magic — the same data you'd get from `nvidia-smi` + `torch.cuda.is_available()` + PyTorch's mps backend check.
