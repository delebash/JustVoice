# What's new

## v0.1.0

- **A designed voice keeps the take you auditioned**, and stays one person for
  a whole book instead of re-inventing itself line by line
  ([Voices](voices.md#keeping-a-designed-voice-is-what-makes-it-one-voice))
- A designed voice you have not kept a clip for now actually reaches the
  model — its description is spoken on every line, with your direction added
  after it ([Voices](voices.md#design--from-a-description))
- A table of **which voice types take written direction**, because it depends
  on how the voice was made, not just which engine you picked
  ([Voices](voices.md#which-of-them-take-written-direction))
- A cast that mixes Qwen3 checkpoints is refused **before** the render starts,
  naming every voice and the model it needs, instead of failing partway
  through ([Studio](studio.md#one-qwen3-model-at-a-time))
- Bracketed tags typed into Qwen3 text are removed rather than read aloud —
  Qwen3 takes direction as words, not markup ([Engines](engines.md))
- Four ways to blend a Kokoro voice — mix, exaggerate, add and subtract, or
  splice one voice's sound onto another's delivery
  ([Voices](voices.md#blend--make-a-voice-out-of-other-voices))
- Voices library filters by language and gender, and shows language as a name
  rather than a code ([Voices](voices.md#finding-a-voice-in-the-library))
- **Any column heading sorts, on every list in the app**
  ([Core concepts](core-concepts.md#lists))
- Loading a model from the Voices page shows the same progress bar, Cancel and
  error as the Speech engines page — and the **Size** dropdown now decides
  which weights are fetched ([Voices](voices.md#finding-a-voice-in-the-library))
- Every slider says what its ends MEAN — *slower · as written · faster* — and
  its number box can be typed into ([Generate](generate.md#delivery-overlay))
- One AI Settings console — text AI (providers + models) and speech (engines,
  self-hosted servers, cloud APIs) with per-feature routing and a live Lab
- Multi-use Project model (audiobook / game voice lines / podcast / custom)
- Managed Python environments for speech engines, built for you on first
  install — **every engine gets its own**, so installing one cannot change
  what another already depends on, and every engine has a real Uninstall.
  Costs far less disk than it sounds: the five environments report 5,284 MB
  but add only 431 MB, because they share one download cache
  ([Engines](engines.md#where-the-python-environments-live))
- See which programs are holding GPU memory: **show apps** on the memory
  strip's *Other apps* cell ([GPU / CUDA](gpu.md#which-apps-are-using-the-gpu))
- A sleeping AI model lends its memory to your speech engine and takes it
  back with a visible swap, instead of both quietly claiming the same card
  ([GPU / CUDA](gpu.md#when-the-ai-model-goes-to-sleep))
- Take versioning with source lineage
- HMAC-signed webhooks with exponential backoff
- Backup / restore from Settings → Backups
- Audio output channels (multi-device routing)
- System tray with full lifecycle controls
- Multi-adapter import (JustWrite / CSV / SRT / Audacity labels / standard JSON)
- In-app help drawer
- Multi-use first-run onboarding (5 audiences)
