# SPDX-License-Identifier: MIT
#
# Adapted from Alexandria's app/train_lora.py
#   https://github.com/Finrandojin/alexandria-audiobook
#   MIT License, Copyright (c) 2026 Finrandojin
#
# The training logic — teacher-forcing input construction mirroring the
# model's own generate(), the talker cross-entropy + 0.3 × sub-talker
# combined loss, x-vector extraction via speaker_encoder, best-loss
# checkpointing, OOM recovery and ROCm tuning — is theirs, verbatim where
# possible. (The loop is hand-rolled upstream because the official Qwen3-TTS
# finetune script carries a known double label-shift bug.)
#
# JustVoice changes are the I/O contract only:
#   * argv[1] is a JSON job config written by training_runner.py
#     (dataset_dir / output_dir / model_dir / knobs), replacing argparse
#   * progress is emitted as one JSON object per stdout line
#     ({"event": "phase"|"validation"|"progress"|"completed"|"error", ...})
#     alongside the original human-readable [TRAIN]/[EPOCH] prints
#   * training_meta.json additionally records engine + variant, which the
#     host reads back at synth time to load the right base checkpoint
"""LoRA fine-tuning subprocess for Qwen3-TTS Base. See training_runner.py
for the contract; run only through it."""

import gc
import json
import os
import random
import shutil
import sys
import time
import traceback


def emit(obj):
    print(json.dumps(obj), flush=True)


# JustVoice request languages are BCP-47-ish codes; Qwen3-TTS wants names.
_LANG_NAME = {
    "en": "english", "zh": "chinese", "ja": "japanese", "ko": "korean",
    "de": "german", "fr": "french", "ru": "russian", "pt": "portuguese",
    "es": "spanish", "it": "italian",
}


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    lang = (cfg.get("language") or "en").split("-")[0].lower()
    return {
        "data_dir": cfg["dataset_dir"],
        "output_dir": cfg["output_dir"],
        "model_name": cfg["model_dir"],  # local checkpoint dir from the speech cache
        "engine": cfg.get("engine", "qwen3"),
        "variant": cfg.get("variant", ""),
        "epochs": int(cfg.get("epochs") or 20),
        "lr": float(cfg.get("learning_rate") or 5e-6),
        "batch_size": int(cfg.get("batch_size") or 1),
        "lora_r": int(cfg.get("lora_rank") or 32),
        "lora_alpha": int(cfg.get("lora_alpha") or 128),
        "gradient_accumulation_steps": int(cfg.get("grad_accum") or 8),
        "device": "auto",
        "language": _LANG_NAME.get(lang, "english"),
        "max_audio_seconds": float(cfg.get("max_audio_seconds") or 30.0),
    }


def resolve_device(device_str):
    if device_str != "auto":
        return device_str
    import torch
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def enable_rocm_optimizations():
    """Apply ROCm-specific optimizations. No-op on NVIDIA/CPU."""
    import torch
    if not (hasattr(torch.version, "hip") and torch.version.hip):
        return
    os.environ.setdefault("MIOPEN_FIND_MODE", "2")
    os.environ.setdefault("MIOPEN_LOG_LEVEL", "4")
    os.environ.setdefault("FLASH_ATTENTION_TRITON_AMD_ENABLE", "TRUE")
    try:
        from triton.compiler import compiler as triton_compiler
        if not hasattr(triton_compiler, "triton_key"):
            import triton
            triton_compiler.triton_key = lambda: f"pytorch-triton-rocm-{triton.__version__}"
    except ImportError:
        pass


# ── Data preparation ────────────────────────────────────────────────────

def load_dataset(data_dir, hf_model, processor, device, dtype, max_audio_seconds):
    """Load metadata.jsonl and prepare training samples.

    For each entry, encodes audio to codec IDs and tokenizes text.
    Speaker embedding is extracted from a consistent ref audio (same for all
    samples) per the official Qwen3-TTS fine-tuning approach.
    """
    import librosa
    import numpy as np
    import torch
    from qwen_tts.core.models.modeling_qwen3_tts import mel_spectrogram

    metadata_path = os.path.join(data_dir, "metadata.jsonl")
    if not os.path.exists(metadata_path):
        emit({"event": "error", "message": f"metadata.jsonl not found in {data_dir}"})
        sys.exit(1)

    with open(metadata_path, "r", encoding="utf-8") as f:
        entries = [json.loads(line) for line in f if line.strip()]

    if not entries:
        emit({"event": "error", "message": "metadata.jsonl is empty"})
        sys.exit(1)

    print(f"[DATA] Found {len(entries)} entries in metadata.jsonl", flush=True)

    # ── Speaker embedding from the reference clip (training_runner writes
    # ref.wav + ref_text.txt into the dataset dir; fall back to sample 1) ──
    ref_audio_path = None
    if entries[0].get("ref_audio"):
        ref_audio_path = os.path.join(data_dir, entries[0]["ref_audio"])
    elif os.path.exists(os.path.join(data_dir, "ref.wav")):
        ref_audio_path = os.path.join(data_dir, "ref.wav")
    if ref_audio_path is None:
        first_audio_rel = entries[0].get("audio_filepath") or entries[0].get("audio", "")
        ref_audio_path = os.path.join(data_dir, first_audio_rel)
    if not os.path.exists(ref_audio_path):
        emit({"event": "error", "message": f"reference audio not found: {ref_audio_path}"})
        sys.exit(1)

    print(f"[DATA] Using reference audio: {os.path.basename(ref_audio_path)}", flush=True)

    ref_audio, _ref_sr = librosa.load(ref_audio_path, sr=24000, mono=True)
    ref_audio = ref_audio.astype(np.float32)

    with torch.no_grad():
        ref_mels = mel_spectrogram(
            torch.from_numpy(ref_audio).unsqueeze(0),
            n_fft=1024, num_mels=128, sampling_rate=24000,
            hop_size=256, win_size=1024, fmin=0, fmax=12000,
        ).transpose(1, 2).to(device).to(dtype)
        spk_embedding = hf_model.speaker_encoder(ref_mels).detach()

    print("[DATA] Speaker embedding extracted from reference audio", flush=True)

    samples = []
    reports = []
    skipped = 0

    for i, entry in enumerate(entries):
        audio_rel = entry.get("audio_filepath") or entry.get("audio", "")
        audio_path = os.path.join(data_dir, audio_rel)
        text = entry["text"]

        if not os.path.exists(audio_path):
            reports.append({"index": i, "accepted": False, "duration_seconds": 0.0,
                            "rejection_reason": "file not found"})
            skipped += 1
            continue

        print(f"[DATA] Tokenizing {i + 1}/{len(entries)}: {os.path.basename(audio_path)}", flush=True)

        audio, sr = librosa.load(audio_path, sr=None, mono=True)
        duration = len(audio) / sr
        if duration > max_audio_seconds:
            reports.append({"index": i, "accepted": False,
                            "duration_seconds": round(duration, 2),
                            "rejection_reason": f"longer than {max_audio_seconds:.0f}s"})
            skipped += 1
            continue
        if duration < 1.0:
            reports.append({"index": i, "accepted": False,
                            "duration_seconds": round(duration, 2),
                            "rejection_reason": "shorter than 1s"})
            skipped += 1
            continue

        # Encode audio to codec IDs via speech tokenizer
        with torch.no_grad():
            enc = hf_model.speech_tokenizer.encode(audio, sr=sr)
            codec_ids = enc.audio_codes[0]  # [T, num_code_groups]

        # Chat template: <|im_start|>assistant\n{text}<|im_end|>\n<|im_start|>assistant\n
        assistant_text = f"<|im_start|>assistant\n{text}<|im_end|>\n<|im_start|>assistant\n"
        text_inputs = processor(text=assistant_text, return_tensors="pt", padding=True)
        text_ids = text_inputs["input_ids"].to(device)
        if text_ids.dim() == 1:
            text_ids = text_ids.unsqueeze(0)

        samples.append({
            "codec_ids": codec_ids.to(device),
            "spk_embedding": spk_embedding,
            "text_ids": text_ids,
            "audio_path": audio_path,
            "text": text,
            "duration": duration,
        })
        reports.append({"index": i, "accepted": True,
                        "duration_seconds": round(duration, 2),
                        "rejection_reason": None})

    print(f"[DATA] Prepared {len(samples)} samples ({skipped} skipped)", flush=True)
    emit({
        "event": "validation",
        "accepted": len(samples),
        "rejected": skipped,
        "reports": reports,
        "usable_seconds": round(sum(s["duration"] for s in samples), 1),
    })
    if not samples:
        emit({"event": "error", "message": "no valid training samples"})
        sys.exit(1)

    # The transcript OF THE REFERENCE AUDIO, resolved here because this is
    # the only scope holding both `entries` and the chosen ref path. Used
    # only when the dataset ships no ref_text.txt; matching by path matters
    # because `samples` holds just the clips that passed the gates, so
    # samples[0] can be a different recording than the reference — and a
    # ref_text that does not match ref.wav is a known garbling cause.
    ref_entry_text = ""
    for entry in entries:
        rel = entry.get("audio_filepath") or entry.get("audio", "")
        if os.path.abspath(os.path.join(data_dir, rel)) == os.path.abspath(ref_audio_path):
            ref_entry_text = (entry.get("text") or "").strip()
            break

    return samples, ref_audio_path, ref_entry_text


# ── Input construction (Alexandria, verbatim) ───────────────────────────

def build_teacher_forcing_input(sample, hf_model, device, dtype, language="english"):
    """Build the full teacher-forcing input sequence for one training sample.

    Replicates the generate() method's input construction but includes
    ground-truth codec embeddings at every audio timestep.

    Returns:
        inputs_embeds: [1, prefill_len + T, D] full input sequence
        labels: [1, prefill_len + T] with -100 for prefill, first codec group for audio
        all_codec_ids: [T, num_code_groups] ground truth for code predictor
        prefill_len: int, number of prefill positions
    """
    import torch

    talker = hf_model.talker
    config = hf_model.config
    tc = config.talker_config  # talker config

    codec_ids_2d = sample["codec_ids"]       # [T, num_code_groups]
    spk_embedding = sample["spk_embedding"]  # [1, enc_dim]
    text_ids = sample["text_ids"]            # [1, text_len]

    T = codec_ids_2d.shape[0]  # number of audio frames
    num_code_groups = tc.num_code_groups

    # ── Special token embeddings ──
    special_ids = torch.tensor(
        [[config.tts_bos_token_id, config.tts_eos_token_id, config.tts_pad_token_id]],
        device=device, dtype=text_ids.dtype,
    )
    tts_bos_embed, tts_eos_embed, tts_pad_embed = talker.text_projection(
        talker.get_text_embeddings()(special_ids)
    ).chunk(3, dim=1)  # each [1, 1, D]

    # ── Build prefill sequence (mirrors generate method) ──
    parts = []

    # Role tokens: first 3 tokens of text_ids = <|im_start|>assistant\n
    role_embed = talker.text_projection(
        talker.get_text_embeddings()(text_ids[:, :3])
    )  # [1, 3, D]

    # Codec prefix: [think_id, think_bos_id, language_id, think_eos_id]
    language_id = tc.codec_language_id.get(language, None) if tc.codec_language_id else None
    if language_id is not None:
        codec_prefill_list = [[tc.codec_think_id, tc.codec_think_bos_id,
                               language_id, tc.codec_think_eos_id]]
    else:
        codec_prefill_list = [[tc.codec_nothink_id, tc.codec_think_bos_id,
                               tc.codec_think_eos_id]]

    codec_prefix_embed = talker.get_input_embeddings()(
        torch.tensor(codec_prefill_list, device=device, dtype=text_ids.dtype)
    )  # [1, 3-4, D]

    # Speaker embed + codec_pad + codec_bos
    codec_suffix_embed = talker.get_input_embeddings()(
        torch.tensor([[tc.codec_pad_id, tc.codec_bos_id]], device=device, dtype=text_ids.dtype)
    )  # [1, 2, D]

    codec_embed = torch.cat([
        codec_prefix_embed,
        spk_embedding.view(1, 1, -1),
        codec_suffix_embed,
    ], dim=1)  # [1, prefix_codec_len, D]

    prefix_codec_len = codec_embed.shape[1]

    # tts_pad for (prefix_codec_len - 2) positions + tts_bos, added to codec_embed[:-1]
    tts_prefix = torch.cat([
        tts_pad_embed.expand(-1, prefix_codec_len - 2, -1),
        tts_bos_embed,
    ], dim=1)  # [1, prefix_codec_len - 1, D]

    prefix_embed = tts_prefix + codec_embed[:, :-1]  # [1, prefix_codec_len - 1, D]

    role_prefix = torch.cat([role_embed, prefix_embed], dim=1)
    parts.append(role_prefix)

    # Text content (non-streaming mode): text_content + eos, with codec_pad overlay
    text_content_ids = text_ids[:, 3:-5]
    text_content_len = text_content_ids.shape[1]

    text_content_embed = talker.text_projection(
        talker.get_text_embeddings()(text_content_ids)
    )
    text_with_eos = torch.cat([text_content_embed, tts_eos_embed], dim=1)

    text_pad_ids = torch.full(
        (1, text_content_len + 1), tc.codec_pad_id,
        device=device, dtype=text_ids.dtype,
    )
    text_codec_pad_embed = talker.get_input_embeddings()(text_pad_ids)
    text_portion = text_with_eos + text_codec_pad_embed
    parts.append(text_portion)

    # End of prefill: tts_pad + codec_bos
    codec_bos_embed = talker.get_input_embeddings()(
        torch.tensor([[tc.codec_bos_id]], device=device, dtype=text_ids.dtype)
    )
    end_embed = tts_pad_embed + codec_bos_embed
    parts.append(end_embed)

    prefill_embeds = torch.cat(parts, dim=1)
    prefill_len = prefill_embeds.shape[1]

    # ── Audio steps (teacher forcing with ground-truth codes) ──
    codec_ids_per_step = codec_ids_2d  # [T, num_code_groups]

    group_0_embed = talker.get_input_embeddings()(
        codec_ids_per_step[:, :1]
    )  # [T, 1, D]

    group_embeds = [group_0_embed]
    for g in range(1, num_code_groups):
        g_embed = talker.code_predictor.get_input_embeddings()[g - 1](
            codec_ids_per_step[:, g:g + 1]
        )
        group_embeds.append(g_embed)

    all_groups = torch.cat(group_embeds, dim=1)  # [T, num_code_groups, D]
    codec_sum = all_groups.sum(dim=1)            # [T, D]

    audio_embeds = codec_sum + tts_pad_embed.squeeze(0)
    audio_embeds = audio_embeds.unsqueeze(0)     # [1, T, D]

    full_input = torch.cat([prefill_embeds, audio_embeds], dim=1)

    # ── Labels: first codec group at audio steps, -100 for prefill ──
    first_codec = codec_ids_2d[:, 0]
    labels = torch.full((1, prefill_len + T), -100, device=device, dtype=torch.long)
    labels[0, prefill_len:] = first_codec

    return full_input, labels, codec_ids_per_step, prefill_len


# ── Training loop ───────────────────────────────────────────────────────

def train(cfg):
    import torch
    import torch.nn.functional as F

    device = resolve_device(cfg["device"])
    dtype = torch.bfloat16 if "cuda" in device else torch.float32

    enable_rocm_optimizations()
    emit({"event": "phase", "phase": "preparing"})

    print(f"[TRAIN] Device: {device}, dtype: {dtype}", flush=True)
    print(f"[TRAIN] Config: epochs={cfg['epochs']}, lr={cfg['lr']}, lora_r={cfg['lora_r']}, "
          f"lora_alpha={cfg['lora_alpha']}, grad_accum={cfg['gradient_accumulation_steps']}", flush=True)

    print("[TRAIN] Loading Base model...", flush=True)
    from qwen_tts import Qwen3TTSModel

    model = Qwen3TTSModel.from_pretrained(
        cfg["model_name"],
        device_map=device if device != "cpu" else None,
        dtype=dtype,
        attn_implementation="eager",
    )
    processor = model.processor
    hf_model = model.model  # Qwen3TTSForConditionalGeneration

    print("[TRAIN] Base model loaded", flush=True)

    samples, ref_audio_path, ref_entry_text = load_dataset(
        cfg["data_dir"], hf_model, processor, device, dtype, cfg["max_audio_seconds"]
    )

    print("[TRAIN] Applying LoRA to talker...", flush=True)
    try:
        from peft import LoraConfig, get_peft_model
    except ImportError:
        emit({"event": "error",
              "message": "peft is not installed in the engine environment — "
                         "re-run engine setup"})
        sys.exit(1)

    lora_config = LoraConfig(
        r=cfg["lora_r"],
        lora_alpha=cfg["lora_alpha"],
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
    )

    talker = hf_model.talker
    peft_talker = get_peft_model(talker, lora_config)
    hf_model.talker = peft_talker

    peft_talker.enable_input_require_grads()
    peft_talker.base_model.model.model.gradient_checkpointing_enable()

    trainable_params = sum(p.numel() for p in peft_talker.parameters() if p.requires_grad)
    total_params = sum(p.numel() for p in peft_talker.parameters())
    print(f"[TRAIN] LoRA applied: {trainable_params:,} trainable / {total_params:,} total "
          f"({100 * trainable_params / total_params:.2f}%)", flush=True)

    optimizer = torch.optim.AdamW(
        [p for p in peft_talker.parameters() if p.requires_grad],
        lr=cfg["lr"],
        weight_decay=0.01,
    )

    os.makedirs(cfg["output_dir"], exist_ok=True)
    peft_talker.train()
    emit({"event": "phase", "phase": "running"})

    total_steps_per_epoch = len(samples)
    total_steps = cfg["epochs"] * total_steps_per_epoch
    best_loss = float("inf")
    avg_loss = float("inf")
    training_start = time.time()

    base_talker = peft_talker.base_model.model  # original talker with LoRA layers
    transformer = base_talker.model             # Qwen3TTSTalkerModel

    for epoch in range(1, cfg["epochs"] + 1):
        epoch_loss = 0.0
        epoch_steps = 0
        optimizer.zero_grad()

        epoch_samples = samples.copy()
        random.shuffle(epoch_samples)

        for step_idx, sample in enumerate(epoch_samples, 1):
            try:
                full_input, labels, all_codec_ids, prefill_len = build_teacher_forcing_input(
                    sample, hf_model, device, dtype, language=cfg["language"]
                )

                T = all_codec_ids.shape[0]

                output = transformer(
                    inputs_embeds=full_input,
                    use_cache=False,
                )
                hidden_states = output.last_hidden_state

                # Talker main loss: predict first codec group.
                # Standard causal shift: logit i predicts label i+1.
                logits = base_talker.codec_head(hidden_states)
                shift_logits = logits[:, :-1, :].contiguous()
                shift_labels = labels[:, 1:].contiguous()

                talker_loss = F.cross_entropy(
                    shift_logits.view(-1, shift_logits.size(-1)),
                    shift_labels.view(-1),
                    ignore_index=-100,
                )

                # Code predictor loss over the remaining groups.
                audio_hidden = hidden_states[0, prefill_len - 1:prefill_len + T - 1, :]
                _, sub_loss = base_talker.forward_sub_talker_finetune(
                    all_codec_ids, audio_hidden
                )

                # 0.3 sub-talker weight per official Qwen3-TTS training.
                total_loss = talker_loss + 0.3 * sub_loss

                scaled_loss = total_loss / cfg["gradient_accumulation_steps"]
                scaled_loss.backward()

                step_loss = total_loss.item()
                epoch_loss += step_loss
                epoch_steps += 1

                del full_input, labels, all_codec_ids, hidden_states
                del logits, shift_logits, shift_labels, audio_hidden
                del talker_loss, sub_loss, total_loss, scaled_loss

            except RuntimeError as e:
                if "out of memory" in str(e).lower():
                    print(f"[TRAIN] OOM at epoch={epoch} step={step_idx}, skipping sample", flush=True)
                    if "cuda" in device:
                        torch.cuda.empty_cache()
                    gc.collect()
                    optimizer.zero_grad()
                    continue
                raise

            if step_idx % cfg["gradient_accumulation_steps"] == 0 or step_idx == total_steps_per_epoch:
                torch.nn.utils.clip_grad_norm_(
                    [p for p in peft_talker.parameters() if p.requires_grad],
                    max_norm=1.0,
                )
                optimizer.step()
                optimizer.zero_grad()
                if "cuda" in device:
                    torch.cuda.empty_cache()

            done_steps = (epoch - 1) * total_steps_per_epoch + step_idx
            elapsed = time.time() - training_start
            progress = done_steps / max(total_steps, 1)
            eta = int(elapsed / progress * (1 - progress)) if progress > 0 else None
            emit({"event": "progress", "progress": round(progress, 4),
                  "loss": round(step_loss, 4), "eta_seconds": eta})
            print(f"[TRAIN] epoch={epoch}/{cfg['epochs']} step={step_idx}/{total_steps_per_epoch} "
                  f"loss={step_loss:.4f}", flush=True)

        avg_loss = epoch_loss / max(epoch_steps, 1)
        print(f"[EPOCH] {epoch}/{cfg['epochs']} avg_loss={avg_loss:.4f}", flush=True)

        if avg_loss < best_loss:
            best_loss = avg_loss
            peft_talker.save_pretrained(cfg["output_dir"])
            print(f"[TRAIN] Best adapter saved (loss={best_loss:.4f})", flush=True)

    training_time = time.time() - training_start

    # Final save (overwrites best if the last epoch is better).
    peft_talker.save_pretrained(cfg["output_dir"])

    # Reference clip beside the adapter, for inference.
    ref_dest = os.path.join(cfg["output_dir"], "ref_sample.wav")
    shutil.copy2(ref_audio_path, ref_dest)

    ref_text_file = os.path.join(cfg["data_dir"], "ref_text.txt")
    if os.path.exists(ref_text_file):
        with open(ref_text_file, "r", encoding="utf-8") as f:
            ref_sample_text = f.read().strip()
    else:
        # No ref_text.txt (an externally supplied dataset): use the
        # transcript load_dataset matched to the reference AUDIO by path.
        ref_sample_text = ref_entry_text
        if not ref_sample_text:
            print("[DATA] WARNING: no transcript found for the reference audio — "
                  "the speaker prompt will carry empty text.", flush=True)

    meta = {
        "engine": cfg["engine"],
        "variant": cfg["variant"],
        "model_name": cfg["model_name"],
        "epochs": cfg["epochs"],
        "lr": cfg["lr"],
        "lora_r": cfg["lora_r"],
        "lora_alpha": cfg["lora_alpha"],
        "gradient_accumulation_steps": cfg["gradient_accumulation_steps"],
        "batch_size": cfg["batch_size"],
        "num_samples": len(samples),
        "final_loss": avg_loss,
        "best_loss": best_loss,
        "training_time_seconds": round(training_time, 1),
        "language": cfg["language"],
        "ref_sample_text": ref_sample_text,
    }
    with open(os.path.join(cfg["output_dir"], "training_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(f"[DONE] Adapter saved to {cfg['output_dir']} "
          f"(best_loss={best_loss:.4f}, time={training_time:.0f}s)", flush=True)
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
