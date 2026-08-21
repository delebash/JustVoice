# SPDX-License-Identifier: MIT
#
# Adapted from gokhaneraslan/chatterbox-finetuning
#   https://github.com/gokhaneraslan/chatterbox-finetuning
#   Apache-2.0
#
# Theirs, and verified against their source rather than recalled: the
# preprocessing pipeline (speaker embedding via the voice encoder, speech
# tokens + a 3 s prompt slice via the s3gen tokenizer, text tokens per
# variant), the LoRA target-module sets — Turbo's are `c_attn / c_proj /
# c_fc / spkr_enc`, NOT the llama-style names the other variants use — the
# `modules_to_save` embedding pair, and the training loss: cross-entropy
# over speech logits with the prompt span and the padding masked out, plus
# cross-entropy over text logits, summed.
#
# JustVoice changes:
#   * runs against the STOCK `chatterbox-tts` package rather than their
#     vendored fork, so preprocessing calls the public surface
#     (`tts.ve.embeds_from_wavs`, `tts.s3gen.tokenizer`, `tts.tokenizer`)
#   * argv[1] is a JSON job config from training_runner.py; progress is one
#     JSON object per stdout line (see that module for the contract)
#   * a hand-rolled AdamW loop instead of HF `Trainer`, because the host
#     wants per-step progress and a cancel that lands within a step
#   * no vocabulary resizing: we fine-tune a voice on the model's own
#     language, where upstream also supports adding a new one
#
# NOT YET HEARD. The pipeline is faithful to a working upstream recipe and
# every call is checked against the installed package's surface, but no
# adapter trained by THIS file has been listened to. `supports_training`
# for chatterbox-turbo stays off in capability_details until it has been.
"""LoRA fine-tuning subprocess for Chatterbox. See training_runner.py for
the contract; run only through it."""

import json
import os
import random
import shutil
import sys
import time
import traceback


def emit(obj):
    print(json.dumps(obj), flush=True)


# Their config.py defaults, read from source 2026-08-19.
TURBO_TARGET_MODULES = ["c_attn", "c_proj", "c_fc", "spkr_enc"]
STANDARD_TARGET_MODULES = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj", "spkr_enc",
]
MODULES_TO_SAVE = ["text_emb", "text_head"]
PROMPT_DURATION_S = 3.0
MAX_SPEECH_LEN = 850
MAX_TEXT_LEN = 256


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    variant = cfg.get("variant") or ""
    return {
        "data_dir": cfg["dataset_dir"],
        "output_dir": cfg["output_dir"],
        "model_dir": cfg["model_dir"],
        "engine": cfg.get("engine", "chatterbox"),
        "variant": variant,
        "is_turbo": "turbo" in variant.lower(),
        "epochs": int(cfg.get("epochs") or 10),
        "lr": float(cfg.get("learning_rate") or 1e-4),
        "batch_size": int(cfg.get("batch_size") or 1),
        "grad_accum": int(cfg.get("grad_accum") or 1),
        "lora_r": int(cfg.get("lora_rank") or 128),
        "lora_alpha": int(cfg.get("lora_alpha") or 256),
    }


def resolve_device():
    import torch

    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


# ── Data preparation ────────────────────────────────────────────────────

def load_dataset(cfg, tts, device):
    """metadata.jsonl -> per-sample tensors, using the model's own encoders.

    Mirrors upstream's preprocess step: the voice encoder gives the speaker
    embedding, the s3gen tokenizer turns audio into speech tokens (plus a
    3-second prompt slice), and the text tokenizer differs per variant.
    """
    import torch
    import torchaudio
    from chatterbox.models.s3tokenizer import S3_SR

    metadata_path = os.path.join(cfg["data_dir"], "metadata.jsonl")
    if not os.path.exists(metadata_path):
        emit({"event": "error", "message": f"metadata.jsonl not found in {cfg['data_dir']}"})
        sys.exit(1)

    with open(metadata_path, "r", encoding="utf-8") as f:
        entries = [json.loads(line) for line in f if line.strip()]
    if not entries:
        emit({"event": "error", "message": "metadata.jsonl is empty"})
        sys.exit(1)

    try:
        from chatterbox.tts import punc_norm
    except ImportError:
        def punc_norm(t):
            return t

    stop_id = getattr(tts.t3.hp, "stop_speech_token", None)
    if stop_id is None:
        emit({"event": "error",
              "message": "this chatterbox build exposes no stop_speech_token; "
                         "cannot build training targets"})
        sys.exit(1)

    samples = []
    reports = []
    skipped = 0
    total_seconds = 0.0

    for i, entry in enumerate(entries):
        rel = entry.get("audio_filepath") or ""
        wav_path = os.path.join(cfg["data_dir"], rel)
        text = (entry.get("text") or "").strip()
        if not os.path.exists(wav_path):
            reports.append({"index": i, "accepted": False, "duration_seconds": 0.0,
                            "rejection_reason": "file not found"})
            skipped += 1
            continue
        if not text:
            reports.append({"index": i, "accepted": False, "duration_seconds": 0.0,
                            "rejection_reason": "no transcript"})
            skipped += 1
            continue

        wav, sr = torchaudio.load(wav_path)
        if wav.shape[0] > 1:
            wav = wav.mean(dim=0, keepdim=True)
        if sr != S3_SR:
            wav = torchaudio.transforms.Resample(sr, S3_SR)(wav)
        duration = wav.shape[1] / float(S3_SR)
        if duration < 1.0:
            reports.append({"index": i, "accepted": False,
                            "duration_seconds": round(duration, 2),
                            "rejection_reason": "shorter than 1s"})
            skipped += 1
            continue
        wav = wav.to(device)

        with torch.no_grad():
            wav_np = wav.cpu().squeeze().numpy()
            spk_emb = torch.from_numpy(
                tts.ve.embeds_from_wavs([wav_np], sample_rate=S3_SR)[0]
            ).cpu()

            s_tokens, _ = tts.s3gen.tokenizer(wav.unsqueeze(0))
            speech_tokens = torch.cat([
                s_tokens.squeeze().cpu(),
                torch.tensor([stop_id], dtype=s_tokens.dtype).cpu(),
            ], dim=0)

            prompt_samples = int(PROMPT_DURATION_S * S3_SR)
            if wav.shape[1] < prompt_samples:
                prompt_wav = torch.nn.functional.pad(wav, (0, prompt_samples - wav.shape[1]))
            else:
                prompt_wav = wav[:, :prompt_samples]
            p_tokens, _ = tts.s3gen.tokenizer(prompt_wav.unsqueeze(0))
            prompt_tokens = p_tokens.squeeze().cpu()

        clean = punc_norm(text)
        if cfg["is_turbo"]:
            out = tts.tokenizer(clean, return_tensors="pt")
            text_tokens = out.input_ids[0].cpu()
            eos = getattr(tts.tokenizer, "eos_token_id", None)
            if eos is not None:
                text_tokens = torch.cat(
                    [text_tokens, torch.tensor([eos], dtype=text_tokens.dtype)], dim=0
                )
        else:
            text_tokens = tts.tokenizer.text_to_tokens(clean).squeeze(0).cpu()

        if speech_tokens.size(0) > MAX_SPEECH_LEN:
            speech_tokens = speech_tokens[:MAX_SPEECH_LEN]
        if text_tokens.size(0) > MAX_TEXT_LEN:
            text_tokens = text_tokens[:MAX_TEXT_LEN]

        samples.append({
            "text_tokens": text_tokens,
            "speech_tokens": speech_tokens,
            "speaker_emb": spk_emb,
            "prompt_tokens": prompt_tokens,
            "wav_path": wav_path,
            "text": text,
            "duration": duration,
        })
        reports.append({"index": i, "accepted": True,
                        "duration_seconds": round(duration, 2),
                        "rejection_reason": None})
        total_seconds += duration
        print(f"[DATA] prepared {len(samples)}/{len(entries)}", flush=True)

    emit({"event": "validation", "accepted": len(samples), "rejected": skipped,
          "reports": reports, "usable_seconds": round(total_seconds, 1)})
    if not samples:
        emit({"event": "error", "message": "no valid training samples"})
        sys.exit(1)
    return samples


# ── Loss (upstream's ChatterboxTrainerWrapper.forward) ──────────────────

def step_loss(t3, sample, device):
    import torch
    import torch.nn.functional as F
    from chatterbox.models.t3.modules.cond_enc import T3Cond

    text_tokens = sample["text_tokens"].unsqueeze(0).to(device)
    speech_tokens = sample["speech_tokens"].unsqueeze(0).to(device)
    prompt_tokens = sample["prompt_tokens"].unsqueeze(0).to(device)
    speaker_emb = sample["speaker_emb"].unsqueeze(0).to(device)
    text_lens = torch.tensor([text_tokens.size(1)], device=device)
    speech_lens = torch.tensor([speech_tokens.size(1)], device=device)

    t3_cond = T3Cond(
        speaker_emb=speaker_emb,
        cond_prompt_speech_tokens=prompt_tokens,
        emotion_adv=0.5 * torch.ones(1, 1, 1, device=device),
    )

    out = t3.forward(
        t3_cond=t3_cond,
        text_tokens=text_tokens,
        text_token_lens=text_lens,
        speech_tokens=speech_tokens,
        speech_token_lens=speech_lens,
        training=True,
    )

    IGNORE_ID = -100

    speech_logits = out.speech_logits[:, :-1, :].transpose(1, 2)
    speech_labels = speech_tokens[:, 1:]
    curr = speech_labels.size(1)
    pad_mask = torch.arange(curr, device=device)[None, :] >= (speech_lens[:, None] - 1)
    # The prompt span is conditioning, not a target: leaving it in teaches
    # the model to reproduce its own prompt.
    prompt_mask = torch.arange(curr, device=device)[None, :] < prompt_tokens.size(1)
    speech_labels = speech_labels.masked_fill(pad_mask | prompt_mask, IGNORE_ID)
    loss_speech = F.cross_entropy(speech_logits, speech_labels, ignore_index=IGNORE_ID)

    text_logits = out.text_logits[:, :-1, :].transpose(1, 2)
    text_labels = text_tokens[:, 1:]
    curr_t = text_labels.size(1)
    text_pad = torch.arange(curr_t, device=device)[None, :] >= (text_lens[:, None] - 1)
    text_labels = text_labels.masked_fill(text_pad, IGNORE_ID)
    loss_text = F.cross_entropy(text_logits, text_labels, ignore_index=IGNORE_ID)

    return loss_text + loss_speech


# ── Training ────────────────────────────────────────────────────────────

def train(cfg):
    import torch

    device = resolve_device()
    emit({"event": "phase", "phase": "preparing"})
    print(f"[TRAIN] device={device} variant={cfg['variant']}", flush=True)

    if cfg["is_turbo"]:
        from chatterbox.tts_turbo import ChatterboxTurboTTS as EngineClass
    else:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS as EngineClass

    tts = EngineClass.from_local(cfg["model_dir"], device=device)
    print("[TRAIN] base model loaded", flush=True)

    samples = load_dataset(cfg, tts, device)

    try:
        from peft import LoraConfig, get_peft_model
    except ImportError:
        emit({"event": "error",
              "message": "peft is not installed in the engine environment — "
                         "re-run engine setup"})
        sys.exit(1)

    for p in tts.t3.parameters():
        p.requires_grad = False

    peft_config = LoraConfig(
        r=cfg["lora_r"],
        lora_alpha=cfg["lora_alpha"],
        target_modules=(
            TURBO_TARGET_MODULES if cfg["is_turbo"] else STANDARD_TARGET_MODULES
        ),
        lora_dropout=0.05,
        bias="none",
        modules_to_save=MODULES_TO_SAVE,
    )
    tts.t3 = get_peft_model(tts.t3, peft_config)
    trainable = sum(p.numel() for p in tts.t3.parameters() if p.requires_grad)
    total = sum(p.numel() for p in tts.t3.parameters())
    print(f"[TRAIN] LoRA applied: {trainable:,}/{total:,} trainable", flush=True)

    optimizer = torch.optim.AdamW(
        [p for p in tts.t3.parameters() if p.requires_grad],
        lr=cfg["lr"], weight_decay=0.01,
    )
    tts.t3.train()
    os.makedirs(cfg["output_dir"], exist_ok=True)
    emit({"event": "phase", "phase": "running"})

    per_epoch = len(samples)
    total_steps = cfg["epochs"] * per_epoch
    best_loss = float("inf")
    avg_loss = float("inf")
    started = time.time()

    for epoch in range(1, cfg["epochs"] + 1):
        epoch_loss = 0.0
        epoch_steps = 0
        optimizer.zero_grad()
        order = samples.copy()
        random.shuffle(order)

        for idx, sample in enumerate(order, 1):
            try:
                loss = step_loss(tts.t3, sample, device)
                (loss / cfg["grad_accum"]).backward()
                step = loss.item()
                epoch_loss += step
                epoch_steps += 1
                del loss
            except RuntimeError as e:
                if "out of memory" in str(e).lower():
                    print(f"[TRAIN] OOM at epoch={epoch} step={idx}, skipping sample", flush=True)
                    if device == "cuda":
                        torch.cuda.empty_cache()
                    optimizer.zero_grad()
                    continue
                raise

            if idx % cfg["grad_accum"] == 0 or idx == per_epoch:
                torch.nn.utils.clip_grad_norm_(
                    [p for p in tts.t3.parameters() if p.requires_grad], max_norm=1.0,
                )
                optimizer.step()
                optimizer.zero_grad()
                if device == "cuda":
                    torch.cuda.empty_cache()

            done = (epoch - 1) * per_epoch + idx
            elapsed = time.time() - started
            progress = done / max(total_steps, 1)
            emit({"event": "progress", "progress": round(progress, 4),
                  "loss": round(step, 4),
                  "eta_seconds": int(elapsed / progress * (1 - progress)) if progress > 0 else None})

        avg_loss = epoch_loss / max(epoch_steps, 1)
        print(f"[EPOCH] {epoch}/{cfg['epochs']} avg_loss={avg_loss:.4f}", flush=True)
        if avg_loss < best_loss:
            best_loss = avg_loss
            tts.t3.save_pretrained(cfg["output_dir"])
            print(f"[TRAIN] best adapter saved (loss={best_loss:.4f})", flush=True)

    tts.t3.save_pretrained(cfg["output_dir"])

    # The reference clip a trained voice renders with, beside the adapter —
    # same contract as the qwen3 trainer, so the host reads one shape.
    ref = max(samples, key=lambda s: s["duration"])
    shutil.copy2(ref["wav_path"], os.path.join(cfg["output_dir"], "ref_sample.wav"))

    meta = {
        "engine": cfg["engine"],
        "variant": cfg["variant"],
        "model_name": cfg["model_dir"],
        "epochs": cfg["epochs"],
        "lr": cfg["lr"],
        "lora_r": cfg["lora_r"],
        "lora_alpha": cfg["lora_alpha"],
        "gradient_accumulation_steps": cfg["grad_accum"],
        "batch_size": cfg["batch_size"],
        "num_samples": len(samples),
        "final_loss": avg_loss,
        "best_loss": best_loss,
        "training_time_seconds": round(time.time() - started, 1),
        "ref_sample_text": ref["text"],
    }
    with open(os.path.join(cfg["output_dir"], "training_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(f"[DONE] adapter saved to {cfg['output_dir']} (best_loss={best_loss:.4f})", flush=True)
    emit({"event": "completed", "adapter_path": cfg["output_dir"],
          "final_loss": round(best_loss, 4)})


if __name__ == "__main__":
    if len(sys.argv) != 2:
        emit({"event": "error", "message": "usage: train_lora.py <job.json>"})
        sys.exit(2)
    try:
        train(load_config(sys.argv[1]))
    except Exception as e:
        emit({"event": "error", "message": str(e)})
        traceback.print_exc()
        sys.exit(1)
