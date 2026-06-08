"""RIFF/WAVE parser — pure stdlib + numpy.

Mirrors the Rust ``audio_analyzer::parse_wav_header`` behavior.
Supports 16-bit PCM mono/stereo at any sample rate; rejects other
formats with a clear error so callers convert via ffmpeg first.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass


@dataclass
class WavFormat:
    sample_rate: int
    channels: int
    bits_per_sample: int
    sample_count: int
    duration_sec: float


def parse_wav_header(buf: bytes) -> tuple[WavFormat, int, int]:
    """Returns (format, data_offset, data_size). Raises ValueError on
    malformed or unsupported input."""
    if len(buf) < 44:
        raise ValueError(f"File too small to be a WAV ({len(buf)} bytes < 44)")
    if buf[0:4] != b"RIFF":
        raise ValueError("Not a RIFF file (missing RIFF magic)")
    if buf[8:12] != b"WAVE":
        raise ValueError("RIFF file is not a WAVE")

    cursor = 12
    sample_rate = 0
    channels = 0
    bits_per_sample = 0
    audio_format = 0
    data_offset = 0
    data_size = 0

    while cursor + 8 <= len(buf):
        chunk_id = buf[cursor : cursor + 4]
        size = struct.unpack_from("<I", buf, cursor + 4)[0]
        body = cursor + 8
        if body + size > len(buf):
            if chunk_id == b"data":
                data_offset = body
                data_size = len(buf) - body
                break
            raise ValueError(f"Truncated WAV chunk {chunk_id!r}")
        if chunk_id == b"fmt ":
            if size < 16:
                raise ValueError(f"fmt chunk too small ({size} < 16)")
            audio_format = struct.unpack_from("<H", buf, body)[0]
            channels = struct.unpack_from("<H", buf, body + 2)[0]
            sample_rate = struct.unpack_from("<I", buf, body + 4)[0]
            bits_per_sample = struct.unpack_from("<H", buf, body + 14)[0]
        elif chunk_id == b"data":
            data_offset = body
            data_size = size
            break
        cursor = body + size + (size & 1)

    if audio_format != 1:
        raise ValueError(f"Only PCM (audio_format=1) supported; got {audio_format}")
    if bits_per_sample != 16:
        raise ValueError(f"Only 16-bit PCM supported; got {bits_per_sample} bits")
    if sample_rate == 0 or channels == 0:
        raise ValueError("Missing or zero sample_rate / channels in fmt chunk")
    if data_offset == 0:
        raise ValueError("WAV has no data chunk")

    bytes_per_frame = channels * 2
    sample_count = data_size // bytes_per_frame
    duration_sec = sample_count / sample_rate
    return (
        WavFormat(
            sample_rate=sample_rate,
            channels=channels,
            bits_per_sample=bits_per_sample,
            sample_count=sample_count,
            duration_sec=duration_sec,
        ),
        data_offset,
        data_size,
    )


def write_wav_container(pcm: bytes, sample_rate: int, channels: int = 1) -> bytes:
    """Wrap raw 16-bit PCM in a minimal WAV container."""
    bits_per_sample = 16
    byte_rate = sample_rate * channels * bits_per_sample // 8
    block_align = channels * bits_per_sample // 8
    data_len = len(pcm)
    chunk_size = 36 + data_len
    header = (
        b"RIFF"
        + struct.pack("<I", chunk_size)
        + b"WAVE"
        + b"fmt "
        + struct.pack("<I", 16)
        + struct.pack("<H", 1)
        + struct.pack("<H", channels)
        + struct.pack("<I", sample_rate)
        + struct.pack("<I", byte_rate)
        + struct.pack("<H", block_align)
        + struct.pack("<H", bits_per_sample)
        + b"data"
        + struct.pack("<I", data_len)
    )
    return header + pcm


def strip_wav_header(buf: bytes) -> bytes:
    """Return just the PCM data."""
    _, data_offset, data_size = parse_wav_header(buf)
    return buf[data_offset : data_offset + data_size]
