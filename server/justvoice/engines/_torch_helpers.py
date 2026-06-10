# SPDX-License-Identifier: MIT AND GPL-3.0-or-later
# SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
# SPDX-FileCopyrightText: 2026 JustVoice contributors
#
# Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/backend/backends/base.py
# (commit pinned in voicebox-pin.txt at repo root).
# Lifted into JustVoice on 2026-06-08. Modifications by JustVoice contributors
# are licensed under GPL-3.0-or-later as part of the combined JustVoice work. The MIT
# permission notice (LICENSES/MIT.txt) continues to apply to upstream-derived
# portions.
"""Shared helpers used by the PyTorch-based engine adapters.

Upstream MIT lift (see SPDX header above for source URL) — cross-platform
device picking (CUDA / MPS / XPU / DirectML / ROCm), HuggingFace cache
probing, compute-capability checks, and the Chatterbox f32 monkeypatch.

Backward-compat aliases for the JustVoice helpers `auto_device`,
`force_cpu_on_mac`, `cuda_empty_cache`, `tensor_to_wav_bytes` are exported
at the bottom so existing engine adapters keep working unchanged.
"""

from __future__ import annotations

import gc
import io
import logging
import platform
import wave
from contextlib import contextmanager
from pathlib import Path
from typing import Optional


logger = logging.getLogger(__name__)


# ── HF cache probing ──────────────────────────────────────────────────────


def is_model_cached(
    hf_repo: str,
    *,
    weight_extensions: tuple[str, ...] = (".safetensors", ".bin"),
    required_files: Optional[list[str]] = None,
) -> bool:
    """Check if a HuggingFace model is fully cached locally.

    Args:
        hf_repo: HuggingFace repo ID (e.g. "Qwen/Qwen3-TTS-12Hz-1.7B-Base").
        weight_extensions: File extensions that count as model weights.
        required_files: If set, check that these specific filenames exist in
            snapshots instead of checking by extension.

    Returns:
        True if model is fully cached, False if missing or incomplete.
    """
    try:
        from huggingface_hub import constants as hf_constants

        repo_cache = Path(hf_constants.HF_HUB_CACHE) / ("models--" + hf_repo.replace("/", "--"))
        if not repo_cache.exists():
            return False

        # Incomplete blobs mean a download is still in progress.
        blobs_dir = repo_cache / "blobs"
        if blobs_dir.exists() and any(blobs_dir.glob("*.incomplete")):
            logger.debug("Found .incomplete files for %s", hf_repo)
            return False

        snapshots_dir = repo_cache / "snapshots"
        if not snapshots_dir.exists():
            return False

        if required_files:
            for fname in required_files:
                if not any(snapshots_dir.rglob(fname)):
                    return False
            return True

        for ext in weight_extensions:
            if any(snapshots_dir.rglob(f"*{ext}")):
                return True

        logger.debug("No model weights found for %s", hf_repo)
        return False
    except Exception as e:
        logger.warning("Error checking cache for %s: %s", hf_repo, e)
        return False


# ── Cross-platform device picking ─────────────────────────────────────────


def get_torch_device(
    *,
    allow_xpu: bool = False,
    allow_directml: bool = False,
    allow_mps: bool = False,
    force_cpu_on_mac_flag: bool = False,
) -> str:
    """Detect the best available torch device.

    Args:
        allow_xpu: Check for Intel XPU (IPEX) support.
        allow_directml: Check for DirectML (Windows) support.
        allow_mps: Allow MPS (Apple Silicon). If False, MPS falls back to CPU.
        force_cpu_on_mac_flag: Force CPU on macOS regardless of GPU availability.
    """
    if force_cpu_on_mac_flag and platform.system() == "Darwin":
        return "cpu"

    try:
        import torch
    except ImportError:
        return "cpu"

    if torch.cuda.is_available():
        return "cuda"

    if allow_xpu:
        try:
            import intel_extension_for_pytorch  # noqa: F401

            if hasattr(torch, "xpu") and torch.xpu.is_available():
                return "xpu"
        except ImportError:
            pass

    if allow_directml:
        try:
            import torch_directml

            if torch_directml.device_count() > 0:
                return torch_directml.device(0)
        except ImportError:
            pass

    if allow_mps:
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"

    return "cpu"


def check_cuda_compatibility() -> tuple[bool, Optional[str]]:
    """Check if the installed PyTorch supports the current GPU's compute
    capability.

    Returns:
        (compatible, warning_message). `compatible` is True if OK or no
        CUDA GPU. `warning_message` is a human-readable string when there's
        a mismatch.
    """
    try:
        import torch
    except ImportError:
        return True, None

    if not torch.cuda.is_available():
        return True, None

    major, minor = torch.cuda.get_device_capability(0)
    capability = f"{major}.{minor}"
    device_name = torch.cuda.get_device_name(0)
    sm_tag = f"sm_{major}{minor}"

    try:
        arch_list = torch.cuda._get_arch_list()
        if arch_list:
            compute_tag = f"compute_{major}{minor}"
            if sm_tag not in arch_list and compute_tag not in arch_list:
                return False, (
                    f"{device_name} (compute capability {capability} / {sm_tag}) "
                    f"is not supported by this PyTorch build. "
                    f"Supported architectures: {', '.join(arch_list)}. "
                    f"Install PyTorch nightly (cu128) for newer GPU support: "
                    f"pip install torch --index-url https://download.pytorch.org/whl/nightly/cu128"
                )
    except AttributeError:
        pass

    return True, None


def empty_device_cache(device: str) -> None:
    """Free cached memory on the given device (CUDA or XPU)."""
    try:
        import torch
    except ImportError:
        return

    if device == "cuda" and torch.cuda.is_available():
        torch.cuda.empty_cache()
    elif device == "xpu" and hasattr(torch, "xpu"):
        torch.xpu.empty_cache()


def manual_seed(seed: int, device: str) -> None:
    """Set the random seed on both CPU and the active accelerator."""
    try:
        import torch
    except ImportError:
        return

    torch.manual_seed(seed)
    if device == "cuda" and torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
    elif device == "xpu" and hasattr(torch, "xpu"):
        torch.xpu.manual_seed(seed)


# ── Chatterbox f32 monkeypatch ────────────────────────────────────────────


def patch_chatterbox_f32(model) -> None:
    """Patch float64 → float32 dtype mismatches in upstream chatterbox.

    librosa.load returns float64 numpy arrays. Multiple upstream code paths
    convert these to torch tensors via torch.from_numpy() without casting,
    then matmul against float32 model weights. This patches the two known
    entry points:

    1. S3Tokenizer.log_mel_spectrogram — audio tensor hits _mel_filters (f32)
    2. VoiceEncoder.forward — float64 mel spectrograms hit LSTM weights (f32)
    """
    import types

    _tokzr = model.s3gen.tokenizer
    _orig_log_mel = _tokzr.log_mel_spectrogram.__func__

    def _f32_log_mel(self_tokzr, audio, padding=0):
        import torch as _torch

        if _torch.is_tensor(audio):
            audio = audio.float()
        return _orig_log_mel(self_tokzr, audio, padding)

    _tokzr.log_mel_spectrogram = types.MethodType(_f32_log_mel, _tokzr)

    _ve = model.ve
    _orig_ve_forward = _ve.forward.__func__

    def _f32_ve_forward(self_ve, mels):
        return _orig_ve_forward(self_ve, mels.float())

    _ve.forward = types.MethodType(_f32_ve_forward, _ve)


# ── Model-load progress context ───────────────────────────────────────────


@contextmanager
def model_load_progress(
    model_name: str,
    is_cached: bool,
    filter_non_downloads: Optional[bool] = None,
):
    """Context manager for model loading with HF download progress tracking.

    Upstream pattern (see file header): patches tqdm, drives the SSE
    progress stream, and reports errors back to both the progress manager
    and the task manager on exception.

    Usage:
        with model_load_progress("qwen-tts-1.7B", is_cached) as ctx:
            self.model = SomeModel.from_pretrained(...)
    """
    if filter_non_downloads is None:
        filter_non_downloads = is_cached

    # Best-effort imports — JustVoice's progress manager is a separate
    # module that may not exist in all engine venvs. Degrade gracefully.
    progress_manager = None
    task_manager = None
    tracker_context = None
    try:
        from ..utils.progress import get_progress_manager  # type: ignore
        from ..utils.tasks import get_task_manager  # type: ignore
        from ..utils.hf_progress import (  # type: ignore
            HFProgressTracker,
            create_hf_progress_callback,
        )

        progress_manager = get_progress_manager()
        task_manager = get_task_manager()
        progress_callback = create_hf_progress_callback(model_name, progress_manager)
        tracker = HFProgressTracker(progress_callback, filter_non_downloads=filter_non_downloads)
        tracker_context = tracker.patch_download()
        tracker_context.__enter__()

        if not is_cached:
            task_manager.start_download(model_name)
            progress_manager.update_progress(
                model_name=model_name,
                current=0,
                total=0,
                filename="Connecting to HuggingFace...",
                status="downloading",
            )
    except Exception:
        # No progress plumbing — proceed without it.
        pass

    try:
        yield tracker_context
    except Exception as e:
        if progress_manager is not None:
            try:
                progress_manager.mark_error(model_name, str(e))
            except Exception:
                pass
        if task_manager is not None:
            try:
                task_manager.error_download(model_name, str(e))
            except Exception:
                pass
        raise
    else:
        if not is_cached and progress_manager is not None:
            try:
                progress_manager.mark_complete(model_name)
                task_manager.complete_download(model_name)
            except Exception:
                pass
    finally:
        if tracker_context is not None:
            try:
                tracker_context.__exit__(None, None, None)
            except Exception:
                pass


# ── Backward-compat aliases (JustVoice originals) ─────────────────────────


def auto_device(requested: str = "auto") -> str:
    """Backward-compat: resolve an explicit device or pick the best available."""
    if requested and requested != "auto":
        return requested
    return get_torch_device(allow_mps=True)


def force_cpu_on_mac(requested: str) -> str:
    """Backward-compat: engines whose Mac GPU path is upstream-broken
    (Chatterbox)."""
    if platform.system() == "Darwin":
        return "cpu"
    return auto_device(requested)


def cuda_empty_cache() -> None:
    """Backward-compat: GC + CUDA cache drop."""
    gc.collect()
    empty_device_cache("cuda")


def tensor_to_wav_bytes(tensor, sample_rate: int) -> bytes:
    """Backward-compat: convert a mono float32 tensor in [-1, 1] to WAV bytes."""
    import numpy as np

    samples = tensor.squeeze().detach().cpu().numpy()
    i16 = np.clip(samples * 32767.0, -32768, 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(i16.tobytes())
    return buf.getvalue()
