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
| Higgs Audio | ~0.1× — GPU-only |

For audiobook-scale work, get CUDA (NVIDIA) or Metal (Apple Silicon) working.

## CUDA wheel switch (NVIDIA)

PyTorch engines (Chatterbox / Qwen3 / TADA / LuxTTS / Dia / Higgs / MOSS) ship with the **CPU wheel** of torch by default. To enable CUDA acceleration:

1. Settings → GPU — confirm the runtimes panel lists `cuda` (means the driver is installed).
2. Engines tab → find the engine you want — click **Install with CUDA**.
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

## Memory budgeting

Each engine has a `vram_min_mb` in its manifest. The Engines tab shows the requirement next to each engine's row + flags `would_oom` variants when you have less VRAM than recommended. Rough VRAM needs:

| Engine | VRAM (bf16) |
|---|---|
| Kokoro | <1 GB |
| Chatterbox | ~4 GB |
| Qwen3-TTS 1.7B | ~9 GB |
| Higgs Audio v3 4B | ~12 GB |
| TADA 3B | ~9 GB |

You can load one engine at a time. Unload via the Engines tab to free VRAM before loading another.

## Troubleshooting

- **GPU info card shows "no GPU detected"** — Either no discrete GPU is present (laptops often have CPU + integrated graphics only, which torch ignores) or the driver isn't installed. Run `nvidia-smi` (NVIDIA) or `vulkaninfo` (AMD) from a terminal to verify.
- **CUDA wheel switch fails** — Most often a network issue downloading the ~2 GB wheel. Check the install-log modal for the pip output.
- **Out-of-memory on render** — Switch to a smaller model variant (Engines tab → engine row → "Variants" → pick a `7b` or smaller). Or load a lighter engine entirely.
- **Engine runs but very slow** — Check Settings → GPU: are you actually on CUDA, or did the wheel switch fall back to CPU? The Active backend pill is authoritative.
- **macOS: Chatterbox is way slower than expected** — Chatterbox forces CPU on Mac due to the MPS bug. This is intentional. Use Kokoro / Qwen3 on Mac for GPU acceleration.

## What's detected — under the hood

Settings → GPU calls `/v1/system` which returns the runtimes dict and the `gpus` list. The page picks the highest-priority active runtime and labels the rest. No magic — the same data you'd get from `nvidia-smi` + `torch.cuda.is_available()` + PyTorch's mps backend check.
