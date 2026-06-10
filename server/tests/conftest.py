# SPDX-License-Identifier: GPL-3.0-or-later
"""Shared pytest fixtures — synthetic WAVs for tests that need real audio bytes."""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest


@pytest.fixture(scope="session")
def synth_sine_pcm() -> bytes:
    """1 second, 440 Hz sine wave at 44.1 kHz, 16-bit mono, peak ~ -6 dBFS."""
    sample_rate = 44_100
    duration_s = 1.0
    freq_hz = 440.0
    amplitude = 0.5  # -6 dBFS-ish
    n = int(sample_rate * duration_s)
    samples = np.sin(2 * np.pi * freq_hz * np.arange(n) / sample_rate) * amplitude
    pcm_i16 = (samples * 32767.0).astype("<i2")
    return pcm_i16.tobytes()


@pytest.fixture(scope="session")
def synth_silence_pcm() -> bytes:
    """1 second of silence at 44.1 kHz, 16-bit mono."""
    n = 44_100
    return (np.zeros(n, dtype="<i2")).tobytes()


@pytest.fixture(scope="session")
def synth_full_scale_pcm() -> bytes:
    """1 second of full-scale square wave — used to test clipping detection."""
    n = 44_100
    # Alternating +32767 / -32767 — pure square at Nyquist/2-ish
    samples = np.tile([32767, -32767], n // 2).astype("<i2")
    return samples.tobytes()


def write_wav(pcm: bytes, sample_rate: int = 44_100, channels: int = 1) -> bytes:
    """Wrap PCM in a minimal WAV container (mirrors audio/wav.py)."""
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


@pytest.fixture(scope="session")
def sine_wav(synth_sine_pcm: bytes) -> bytes:
    return write_wav(synth_sine_pcm)


@pytest.fixture(scope="session")
def silence_wav(synth_silence_pcm: bytes) -> bytes:
    return write_wav(synth_silence_pcm)


@pytest.fixture(scope="session")
def fullscale_wav(synth_full_scale_pcm: bytes) -> bytes:
    return write_wav(synth_full_scale_pcm)


@pytest.fixture
def tmp_storage_dir(tmp_path: Path) -> Path:
    """A temp directory for atomic-storage tests."""
    return tmp_path / "storage"
