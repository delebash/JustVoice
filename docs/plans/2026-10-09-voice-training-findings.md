# Voice training on the speech runtime — findings (2026-10-09)

Gap 5, the last open item of the audio.cpp switch: voice training, rebuilt on the speech runtime
(no Python — the user's ruling, 2026-10-08). The user's answer to the plan's question 6 (2026-10-09):
research after the screens, the updater and the kit fixes, "written up as findings before any
code". This is that write-up. **No code is planned here** — the questions at the end are the user's.

The facts, each with its source, are in RESEARCH
[§9 Voice training on the speech runtime](../dev/RESEARCH.md#9--voice-training-on-the-speech-runtime).
This page is what they add up to.

## What "training a voice" would be

From 15–30 minutes of one person's clean recordings, an adapter (a LoRA) that makes Qwen3-TTS Base
speak as that person — a voice that renders in audio.cpp like any other. That is what JustVoice had
until 2026-10-02, in PyTorch: Qwen3-TTS Base's talker, q/k/v/o, rank 32, AdamW, Alexandria's
recipe. It was never run end to end, so its quality, time and memory were never measured.

## What already exists

- **Preparing the data** — the model's own speech tokenizer (the codec encoder), the speaker
  encoder (the x-vector) and Qwen3-ASR's transcripts are all in our fork today.
- **Rendering a trained voice** — the fork's framework merges a LoRA into the base weights at load
  time (`make_lora_tensor_source`, upstream since 2026-09-15; VibeVoice and YuE2 use it). Qwen3-TTS
  doesn't use it yet: wiring it in is a small job. This corrects the switch plan's note that a
  trained voice would need "merging and converting".
- **The optimizer** — ggml's `ggml-opt` (AdamW, SGD, cross-entropy loss), with a bug in our copy:
  in its dynamic-graph mode the gradients are never zeroed between steps (read in the code, not
  reproduced; upstream closed both fixes unmerged).

## What would have to be written

1. **The training pass for the talker** — teacher-forced over the whole sequence, no KV cache, the
   prompt assembled as the old trainer did, the code predictor's loss beside the talker's, the
   prompt's positions cut out before the loss (ggml's cross-entropy takes no mask). It must use the
   talker's plain paths: flash attention, fused SwiGLU and the cache's writes have no backward pass.
2. **The adapter inside that pass** — trainable A and B matrices on q/k/v/o.
3. **The loop** — `ggml-opt` with the gradient reset fixed, plus gradient clipping, which ggml's
   AdamW lacks and the old trainer used.
4. **Saving the adapter** — in a form the load-time merge reads (PEFT's safetensors, as VibeVoice
   reads, or GGUF).
5. **Qwen3-TTS's LoRA option** at load.
6. **The app's half, in JavaScript** — segmenting and checking the recordings, the training job,
   the screens. All of it was removed on 2026-10-02.

## The risks

- **Backward passes.** ggml has backward passes for the talker's core ops (matrix multiply, RMS
  norm, RoPE, softmax, SiLU), but the path has to avoid every op that has none.
- **Backends.** CUDA and the CPU run the backward passes. Metal runs only the optimizer step, so
  on a Mac training falls back to the CPU. Our ggml copy is behind upstream on Vulkan.
- **Memory on an 8 GB card.** On CUDA the frozen talker must be F32 for its gradients (CUDA's
  `OUT_PROD` takes only F32). That is ~5.6 GB for the 1.7B: tight. The 0.6B is more plausible.
  This is arithmetic, not measured.
- **We would own it.** No LoRA trainer is merged in llama.cpp, and its fine-tuning has no
  maintainer. No ggml TTS project that trains was found. Our ggml copy also differs from upstream.

## Is it worth it — the evidence so far

- Baseten fine-tuned Qwen3-TTS on 1.5 hours of one speaker. It "didn't materially beat zero-shot
  on similarity or MOS-style quality"; averaging the x-vector over many clips helped.
- JustVoice already clones both ways Qwen3-TTS can: from a clip with its transcript, and from the
  x-vector alone.
- The old LoRA training was never measured, so there is no proof it beat cloning either.

## The three unknowns, and the experiment that answers each

1. **Does a trained voice beat cloning enough to matter?**
   - Experiment: take one speaker with 15–30 minutes of recordings and 20 held-out lines.
   - Compare cloning from a clip, an x-vector averaged over many clips, and a trained adapter.
   - Score each with the runtime's speaker encoder (similarity) and Qwen3-ASR (word errors).
   - The first two need no trainer.
2. **Does training fit, and run at a usable speed, on 8 GB?**
   - Experiment: one CUDA training step on the 0.6B and on the 1.7B, with an F32 base and with a
     Q8_0 base.
   - Record peak memory and step time.
   - Needs pieces 1–3.
3. **Are the gradients through the fork's talker right?**
   - Experiment: on the CPU with the 0.6B, check a few adapter weights by finite differences.
   - Then overfit one clip.
   - Needs pieces 1–3 and the reset fix.

## The measurement — design (2026-10-09, before running it)

Decided 2026-10-09 (TASKS "The work's eight questions", 1): measure cloning first — clip cloning
against a many-clip x-vector, on one speaker — and build a trainer only if cloning falls short.

- **The speaker** — LJSpeech 1.1 (keithito.com/LJ-Speech-Dataset, public domain, checked
  2026-10-09): one woman reading non-fiction aloud, 13,100 clips of 1–10 s, 22.05 kHz, each with
  its transcript — an audiobook narrator, JustVoice's first use. 20 clips are held out as the
  lines to say (their recordings are the target); the references come from other clips.
- **Three clones, one model** — Qwen3-TTS Base 1.7B (8-bit, on disk), made and spoken through
  the app itself (the clone endpoint and the persona preview), one seed for all:
  - **A · clip with its words** — one ~10 s clip and its transcript, as the clone screen makes it
    today;
  - **B · clip, x-vector only** — the same clip without its words;
  - **C · many clips, x-vector only** — 64 clips (~6 min) joined into one reference. The speaker
    encoder (ECAPA-TDNN) pools its statistics over every frame it hears, so this is an x-vector
    pooled over all 64 clips — not the average of 64 separate x-vectors, which would need a change
    in our audio.cpp copy. Recorded as such.
- **Scores**
  - **Word errors** — each line transcribed by Qwen3-ASR through the app, against its text.
  - **Sounds like her** — a blind listening page: each line's real recording beside A, B and C
    in shuffled order, the names revealed on request. A number for this would need a speaker
    encoder as judge. The only one in our copy is Qwen3-TTS's own, which B and C are conditioned
    on, so it would favour them. A neutral one would be a conversion job. Left out unless the
    listening says it's needed.
- **Clean-up** — the three test voices are deleted from the app afterwards.

## The measurement — results (2026-10-10)

Run through the app on 2026-10-10 (the 8741 server on the real data folder, Qwen3-TTS Base 1.7B 8-bit
on CUDA, seed 1234, 20 held-out LJSpeech lines of 5–9 s from LJ050; the three test voices deleted
afterwards).

- **C as designed could not be made.** A pooled x-vector from a long reference makes the model run
  on without stopping: the same sentence ("The quick brown fox…") from a 19 s reference (2 clips)
  took 7.9 s and gave 3.4 s of audio; from a 32 s reference (4 clips) it took 468 s and gave
  **655 s** of audio. The 494 s reference (64 clips) never finished. The encoder's pooling is all
  32-bit float, so not a half-precision overflow; the cause is not found. C was measured as **C′,
  2 clips (19 s)**, the longest that worked.
- **Word errors** (Qwen3-ASR, 336 words): her own recordings 1, A 0, B 1, C′ 1. All four are
  equally clear; intelligibility does not separate them.
- **Length**: A's lines averaged 6.97 s, B 7.57 s, C′ 7.41 s.
- **Sounds like her** — the blind listening page:
  [Which clone sounds like her?](https://claude.ai/artifact/YTkFK4WS4QkfEr7cjoq4BD). Each line's real
  recording beside A, B and C′ in shuffled order. The user's picks are saved with the page
  (`picks`, one document per line) for the tally.
- **Found on the way**: the app takes a clone reference of any length. A long one (past ~20–30 s on
  Qwen3-TTS Base, x-vector only) sends its first line to the maximum length — minutes of GPU — and
  holds the speech queue the whole time. A cancelled request does not stop it: the runtime keeps
  rendering until done (TASKS FINDING "A long clone reference runs Qwen3-TTS Base on…").

## The decision (the user's)

1. **Measure cloning first?**
   - Run unknown 1 without a trainer: clip cloning against a many-clip x-vector, on one speaker.
   - It tells whether a trainer is worth building at all.
   - Lean: yes, first.
2. **Build the trainer in the fork?**
   - Pieces 1–6 above, starting with the 0.6B on CUDA, then unknowns 3 and 2.
   - Lean: only if (1) shows cloning falls short.
3. **Leave voice training as an idea?**
   - Move gap 5 to IDEAS until there is a reason.
   - Lean: if (1) shows cloning holds up.
