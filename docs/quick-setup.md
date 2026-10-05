# Voice engine setup wizard

(Renamed from "Quick Setup": JustVoice has two engine kinds, and the pair
names them — this wizard sets up the **voice** engines; its sibling, the
**LLM engine setup** on the AI Settings page, sets up the text-AI model.)

After picking a use case in the Welcome modal, JustVoice runs the Voice engine
setup wizard that gets you from a fresh install to working TTS in three steps:

1. **Detect** — probes your GPU + which engines + LLM providers are already registered.
2. **Confirm** — shows a recommended setup for your hardware tier; lets you override.
3. **Install** — installs the **speech runtime**, the one program every voice engine runs on.

Every voice engine runs on the same speech runtime (see
[Engines → The speech runtime](engines.md#the-speech-runtime)), so the install
step is one download, not one per engine: 60–460 MB depending on your graphics
card (the NVIDIA CUDA build is the large one). Each engine's model then
downloads the first time you load it — the tier decides which engines that will
be, and the estimate below is that total.

## Hardware tiers

| Tier | VRAM range | Engines — and where each runs | Models to download (on first load) |
|---|---|---|---|
| **CPU / low VRAM** | <7 GB | Kokoro, KittenTTS and Pocket TTS — built-in voices and cloning, all on the CPU | 0.8 GB |
| **8 GB+** | 7 GB and up | Kokoro and Pocket TTS on the CPU (keeps the card free for the AI model) + Chatterbox Multilingual and Qwen3-TTS on the graphics card | 5.4 GB |

The sizes are each engine's default 8-bit model (Pocket TTS: English; Qwen3-TTS:
CustomVoice 1.7B). Qwen3-TTS fits an 8 GB card: given lines in pieces of 200
characters it peaks about 3.4 GB above the empty card. It does not fit beside an
AI model of about 7 GB, so on an 8 GB card the two take turns — loading one
unloads the other, and each loads itself back when it is needed (see
[Engines → Long lines](engines.md#long-lines-and-what-a-model-costs)). Until
2026-10-04 Qwen3-TTS started a 12 GB tier of its own, from a 7.8 GB peak
measured with whole lines. Kokoro, KittenTTS and Pocket TTS each speak more than
three times faster than real time on an 8-core CPU, so on the CPU they cost the
AI model nothing.

Each engine in the list says where it will run. That is the expected place; at
each load **Auto** decides from what it has measured on your machine — see
[Engines → Where each model runs](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu).
Pocket TTS asks you to accept Kyutai's terms before its first clone.

JustVoice auto-detects your VRAM via `/v1/system/info` and pre-picks the right
tier. You can override it with the dropdown in the confirm step, and uncheck
any engine you don't want — the runtime install is the same either way.

## What about the AI features?

The pin recipe this wizard used to apply is gone — AI routing lives on the
shared presets now, seeded working out of the box. Set up the text-AI model
with the **LLM engine setup** under **AI Settings** (one click: engine +
model sized to this PC, and a fifteen-second measurement of that model once
it's loaded, so its speed chip shows a real number — plus, on a PC with no
hardware preset, an optional one-minute speed check before it recommends a
model); per-feature choices live under Routing by feature. See
`ai-features.md`.

## Watching install progress

The install step shows one bar, **Speech runtime**, with the download's real
bytes and percent and the stage it has reached. The runtime is downloaded,
checked that it starts on this machine, and only then put in place.

You can **Cancel** mid-install. A cancelled install changes nothing — the
runtime is only put in place once it has downloaded and passed its check. The
wizard then jumps to the Done step.

## Done step

Says whether the speech runtime installed (with the error if it didn't, and a
pointer to retry from AI Settings → Speech engines), reminds you that each
engine's model downloads the first time you load it — on the Voices page or on
AI Settings → Speech engines — and, when no text-AI model is set up yet, points
to the LLM engine setup under AI Settings.

## Skipping the wizard

Click **Skip — configure later** in the confirm step. You can:

- Install the speech runtime yourself from the **Speech runtime** row at the top of the Speech engines tab on the AI page, and download models from each engine's rows.

The wizard re-runs from **Settings → About → Run welcome again**.

Whether you have seen it is stored **on the server**, with the rest of your
settings — not in the browser. So it appears once per install, it comes back
after a factory reset (Settings → Backups → Reset) exactly as it would on a
new machine, and opening the app in a different browser or clearing site data
doesn't make it re-pop on an install you already set up.

## Troubleshooting

- **Detection shows "CPU only" but you have a GPU** — check Settings → GPU. If JustVoice doesn't detect a runtime (CUDA / Metal / Vulkan), your graphics driver may need to be reinstalled. Pick the tier manually for now.
- **The speech runtime fails to install** — the bar shows the error; most often it is the download. Retry from **Install speech runtime** on the AI page's Speech engines tab. See [GPU](gpu.md#troubleshooting).
- **AI features answer 501** — the text-AI model isn't set up; that's the other wizard: AI Settings → Run LLM engine setup.
