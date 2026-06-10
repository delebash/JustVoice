"""Audio helpers — numpy → PCM bytes → WAV file. Used by every engine that
produces audio as a numpy array (which is essentially all of them)."""

from __future__ import annotations

import io
import struct
import wave

import numpy as np


def pcm_bytes_from_numpy(arr: "np.ndarray", channels: int = 1) -> bytes:
    """Return raw 16-bit PCM bytes from a float (-1..1) or int16 numpy array.

    No RIFF header — caller wraps with sample rate / channels separately.
    """
    a = np.asarray(arr)
    if a.dtype.kind == "f":
        # Clip floats to [-1, 1], then scale to int16 range.
        a = np.clip(a, -1.0, 1.0)
        a = (a * 32767.0).astype(np.int16)
    elif a.dtype != np.int16:
        a = a.astype(np.int16)
    if channels == 1 and a.ndim == 2:
        # Squeeze (samples, 1) → (samples,)
        a = a.reshape(-1)
    elif channels > 1 and a.ndim == 2 and a.shape[0] == channels:
        # (channels, samples) → interleaved (samples, channels)
        a = a.T
    return a.tobytes()


def wav_bytes_from_numpy(
    arr: "np.ndarray",
    sample_rate: int,
    channels: int = 1,
    bits_per_sample: int = 16,
) -> bytes:
    """Encode a numpy audio array as a complete WAV file (RIFF header + PCM data)."""
    if bits_per_sample != 16:
        raise ValueError("Only 16-bit PCM WAV is supported by this helper.")
    pcm = pcm_bytes_from_numpy(arr, channels=channels)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


def parse_wav_header(buf: bytes) -> tuple[int, int, int, int]:
    """Cheap WAV header parse — (sample_rate, channels, bits_per_sample, data_offset).

    Doesn't validate every chunk; gets us enough to wrap raw PCM later if needed.
    Raises ValueError on a non-WAV / unsupported WAV.
    """
    if len(buf) < 44 or buf[:4] != b"RIFF" or buf[8:12] != b"WAVE":
        raise ValueError("not a WAV file")
    # fmt chunk starts at offset 12.
    if buf[12:16] != b"fmt ":
        raise ValueError("WAV missing fmt chunk")
    audio_format = struct.unpack("<H", buf[20:22])[0]
    if audio_format != 1:
        raise ValueError(f"non-PCM WAV (format code {audio_format})")
    channels = struct.unpack("<H", buf[22:24])[0]
    sample_rate = struct.unpack("<I", buf[24:28])[0]
    bits_per_sample = struct.unpack("<H", buf[34:36])[0]
    # Find data chunk — it's usually next at 36 but the spec allows others first.
    i = 36
    while i + 8 <= len(buf):
        chunk_id = buf[i : i + 4]
        chunk_size = struct.unpack("<I", buf[i + 4 : i + 8])[0]
        if chunk_id == b"data":
            return sample_rate, channels, bits_per_sample, i + 8
        i += 8 + chunk_size
    raise ValueError("WAV missing data chunk")
