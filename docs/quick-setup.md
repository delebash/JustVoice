# Voice engine setup wizard

(Renamed from "Quick Setup": JustVoice has two engine kinds, and the pair
names them — this wizard sets up the **voice** engines; its sibling, the
**LLM engine setup** on the AI Settings page, sets up the text-AI model.)

After picking a use case in the Welcome modal, JustVoice runs the Voice engine
setup wizard that gets you from a fresh install to working TTS in three steps:

1. **Detect** — probes your GPU + which engines + LLM providers are already registered.
2. **Confirm** — shows a recommended setup for your hardware tier; lets you override.
3. **Install** — installs the recommended TTS engines.

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

## What about the AI features?

The pin recipe this wizard used to apply is gone — AI routing lives on the
shared presets now, seeded working out of the box. Set up the text-AI model
with the **LLM engine setup** under **AI Settings** (one click: engine +
model sized to this PC); per-feature choices live under Routing by feature.
See `ai-features.md`.

## Watching install progress

The install step shows one row per engine being installed with:

- Engine name + id.
- A progress bar (deterministic when the job reports bytes-total, indeterminate-shimmer otherwise).
- The current phase (`queued` / `downloading` / `loading_weights` / `completed` / `failed`).
- An error message if anything fails.

You can **Cancel** mid-install. Engines that have already completed are kept; the in-progress engine's subprocess is killed and any partial download is reaped. The wizard then jumps to the Done step.

## Done step

Shows a success summary — N voice engines installed (with failures counted) —
and, when no text-AI model is set up yet, a pointer to the LLM engine setup
under AI Settings.

## Skipping the wizard

Click **Skip — configure later** in the confirm step. You can:

- Install voice engines manually on the Speech engines tab of the AI page.

The wizard re-runs from **Settings → About → Run welcome again**.

Whether you have seen it is stored **on the server**, with the rest of your
settings — not in the browser. So it appears once per install, it comes back
after a factory reset (Settings → Backups → Reset) exactly as it would on a
new machine, and opening the app in a different browser or clearing site data
doesn't make it re-pop on an install you already set up.

## Troubleshooting

- **Detection shows "CPU only" but you have a GPU** — check Settings → GPU. If JustVoice doesn't detect a runtime (CUDA / Metal / DirectML), your driver may need to be reinstalled or the runtime isn't on your PATH. Pick the tier manually for now.
- **Engine install fails on shared-venv setup** — first install on a shared-venv engine builds the venv (~1-2 minutes). If it fails, check Settings → Logs for the pip install output. Common cause: PyPI rate limit or a build dep missing on your system.
- **AI features answer 501** — the text-AI model isn't set up; that's the other wizard: AI Settings → Run LLM engine setup.
