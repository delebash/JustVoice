"""Shared helpers used by the PyTorch-based engine adapters."""

from __future__ import annotations

import gc
import io
import platform
import wave


def auto_device(requested: str = "auto") -> str:
    """Resolve an explicit device or pick the best available one."""
    if requested and requested != "auto":
        return requested
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"


def force_cpu_on_mac(requested: str) -> str:
    """Engines whose Mac GPU path is upstream-broken (Chatterbox)."""
    if platform.system() == "Darwin":
        return "cpu"
    return auto_device(requested)


def cuda_empty_cache() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass


def tensor_to_wav_bytes(tensor, sample_rate: int) -> bytes:
    """Convert a mono float32 tensor in [-1, 1] to WAV bytes."""
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
