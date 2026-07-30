# SPDX-License-Identifier: MIT
"""Shared pytest fixtures — synthetic WAVs, plus engine-subprocess cleanup."""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest


@pytest.fixture(autouse=True)
def _reap_engine_subprocesses():
    """Kill any engine subprocess a test started, after every test.

    Engines are real subprocesses (`engine.py serve`) and do not die with the
    test that spawned them. The app kills them from FastAPI's `shutdown` event
    — but 25 of the 27 test files do:

        app = create_app(data_dir=tmp_path)
        return TestClient(app, raise_server_exceptions=False)

    Starlette only runs lifespan when `TestClient` is used as a CONTEXT
    MANAGER, so returning it bare means `shutdown` never fires and the engine
    outlives the test, the module, and the run.

    This accumulated invisibly until it did real damage: leaked engines held
    the shared venv's interpreter open, which made a venv rebuild fail with
    `os error 32`. Each leak was a pair — a venv python plus a re-exec'd
    stock-python child — so two runs left four processes behind.

    Autouse and unconditional on purpose. Fixing it in the fixtures would mean
    editing 25 files and would break again with the 26th; this cannot be
    forgotten. `shutdown_manager()` is idempotent and returns immediately when
    no manager was ever created, so tests that never touch an engine pay
    nothing.
    """
    yield
    from justvoice.engines.manager import shutdown_manager

    try:
        shutdown_manager()
    except Exception:
        # Teardown must never turn a passing test red. A leak is preferable to
        # a misattributed failure, and the atexit reaper is the backstop.
        pass


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
