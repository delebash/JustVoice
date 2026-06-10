# Quick Setup wizard

After picking a use case in the Welcome modal, JustVoice runs a Quick Setup wizard that gets you from a fresh install to a working configuration in three steps:

1. **Detect** — probes your GPU + which engines + LLM providers are already registered.
2. **Confirm** — shows a recommended setup for your hardware tier; lets you override.
3. **Install** — installs the recommended TTS engines + pins the AI features to the right tier on your registered LLM.

Total time depends on download size: 0.4 GB for CPU tier, up to 22 GB for the full 32 GB GPU tier.

## Hardware tiers

| Tier | VRAM range | Engines installed | Estimated download |
|---|---|---|---|
| **CPU / low VRAM** | <7 GB | Kokoro | 0.4 GB |
| **8 GB** | 7-11 GB | Kokoro + Chatterbox | 2.4 GB |
| **12 GB** | 11-14 GB | Kokoro + Chatterbox + Qwen3-TTS | 4.1 GB |
| **16 GB** | 14-20 GB | Kokoro + Chatterbox + Qwen3-TTS + Dia | 6.8 GB |
| **24 GB** | 20-28 GB | adds LuxTTS + MOSS-TTS | 14.0 GB |
| **32 GB+** | 28 GB+ | adds TADA Llama | 22.0 GB |

JustVoice auto-detects your VRAM via `/v1/system/info` and pre-picks the right tier. You can override with the dropdown in the confirm step — useful if you'd rather not download 14 GB on a 24 GB card right now.

## Feature pin recipe per tier

The Quick Setup wizard doesn't just install engines — it pins the AI features (Compose / Persona rewrite / Speaker attribution / Smart-assign / Render preset suggest) to the right tier for your hardware.

| Tier | Compose | Rewrite | Attribution | Smart-assign | Suggest |
|---|---|---|---|---|---|
| CPU / 8 GB | Direct | Direct | Direct | Direct | Direct |
| 12 GB | Direct | Direct | **Reasoned** | Direct | Direct |
| 16 GB | Direct | Direct | Reasoned | **Reasoned** | Direct |
| 24 GB | Direct | **Reasoned** | Reasoned | Reasoned | Direct |
| 32 GB+ | Reasoned | Reasoned | Reasoned | Reasoned | Reasoned |

Reasoning tiers cost more per call but substantially improve speaker attribution accuracy and character-voice match. The wizard only ratchets up to Reasoned when the hardware can probably run a reasoning-class LLM locally.

**Note:** the recipe targets the **first registered LLM provider** in your Engines tab. If no provider is registered when you run Quick Setup, the wizard shows a warning banner in the confirm step and the pins are queued — register a provider in Engines → LLM and revisit Settings → AI features to confirm the pins took.

## Watching install progress

The install step shows one row per engine being installed with:

- Engine name + id.
- A progress bar (deterministic when the job reports bytes-total, indeterminate-shimmer otherwise).
- The current phase (`queued` / `downloading` / `loading_weights` / `completed` / `failed`).
- An error message if anything fails.

You can **Cancel** mid-install. Engines that have already completed are kept; the in-progress engine's subprocess is killed and any partial download is reaped. The wizard then jumps to the Done step.

## Done step

Shows a success summary:

- N engines installed
- N feature pins applied
- N deferred (when no LLM provider was registered yet)

If pins were deferred, the Done step shows a follow-up link to `Engines → LLM tab` to add a provider, then `Settings → AI features` to confirm the pins.

## Skipping the wizard

Click **Skip — configure later** in the confirm step. You can:

- Install engines manually in the Engines tab.
- Pin features manually in Settings → AI features.

The wizard re-runs from Settings → About → Run welcome again. Quick Setup persists "I've seen this" in localStorage so it doesn't re-pop on every launch.

## Troubleshooting

- **Detection shows "CPU only" but you have a GPU** — check Settings → GPU. If JustVoice doesn't detect a runtime (CUDA / Metal / DirectML), your driver may need to be reinstalled or the runtime isn't on your PATH. Pick the tier manually for now.
- **Engine install fails on shared-venv setup** — first install on a shared-venv engine builds the venv (~1-2 minutes). If it fails, check Settings → Logs for the pip install output. Common cause: PyPI rate limit or a build dep missing on your system.
- **Pins don't apply** — almost always means no LLM provider is registered yet. The wizard surfaces this with a banner; check Engines → LLM tab to confirm a provider with the `live` pill.
