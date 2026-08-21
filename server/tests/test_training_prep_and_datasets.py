# SPDX-License-Identifier: MIT
"""Pins for the 2026-08-20 training build: the segmenter's cuts, the SNR
estimate, dataset storage round-trips, the capability display-name fix,
and the widened train request contract."""

from __future__ import annotations

import math
import struct

import numpy as np
import pytest

from justvoice.audio import segmenter
from justvoice.audio.analyzer import analyze
from justvoice.audio.wav import write_wav_container
from justvoice.engines.capability_details import CAPABILITY_DETAILS
from justvoice.models import TrainJob, TrainVoiceRequest
from justvoice.storage import training_datasets

SR = 16000


def _tone(secs: float, freq: float = 220.0, amp: int = 12000) -> np.ndarray:
    n = int(SR * secs)
    return (amp * np.sin(2 * math.pi * freq * np.arange(n) / SR)).astype("<i2")


def _wav(pcm: np.ndarray) -> bytes:
    return write_wav_container(pcm.tobytes(), SR, 1)


# ── segmenter ────────────────────────────────────────────────────────────


def test_split_cuts_at_long_silence():
    pcm = np.concatenate([_tone(3), np.zeros(int(SR * 0.6), dtype="<i2"), _tone(2)])
    sr, chunks, noise_rms = segmenter.split_on_silence(_wav(pcm), gap_secs=0.4, max_secs=60)
    assert sr == SR
    assert [round(len(c) / sr, 1) for c in chunks] == [3.0, 2.0]
    assert noise_rms is None  # digital-zero silence has no measurable floor


def test_split_measures_noise_floor_from_real_room_tone():
    room = np.random.default_rng(2).normal(0, 12, int(SR * 0.6)).astype("<i2")
    pcm = np.concatenate([_tone(3), room, _tone(2)])
    _sr, chunks, noise_rms = segmenter.split_on_silence(_wav(pcm), gap_secs=0.4, max_secs=60)
    assert len(chunks) == 2
    assert noise_rms is not None and 0 < noise_rms < 40


def test_split_ignores_short_silence():
    pcm = np.concatenate([_tone(2), np.zeros(int(SR * 0.2), dtype="<i2"), _tone(2)])
    _sr, chunks, _n = segmenter.split_on_silence(_wav(pcm), gap_secs=0.4, max_secs=60)
    assert len(chunks) == 1


def test_split_hard_splits_over_max():
    _sr, chunks, _n = segmenter.split_on_silence(_wav(_tone(5)), gap_secs=0.4, max_secs=2)
    assert all(len(c) / SR <= 2.0 for c in chunks)
    assert sum(len(c) for c in chunks) == len(_tone(5))


def test_split_rejects_non_16bit():
    # Hand-build an 8-bit WAV header.
    pcm = bytes(100)
    hdr = (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR, 1, 8)
        + b"data" + struct.pack("<I", len(pcm))
    )
    with pytest.raises(ValueError):
        segmenter.split_on_silence(hdr + pcm, gap_secs=0.4, max_secs=60)


# ── SNR estimate ─────────────────────────────────────────────────────────


def test_snr_estimate_present_and_sane():
    quiet = np.random.default_rng(1).normal(0, 40, SR).astype("<i2")
    a = analyze(_wav(np.concatenate([quiet, _tone(2)])))
    assert a.loudness.snr_db is not None
    assert a.loudness.snr_db > 20  # clean tone over a tiny noise floor


def test_snr_none_when_too_short_to_frame():
    a = analyze(_wav(_tone(0.05)))
    assert a.loudness.snr_db is None


def test_snr_unknown_on_continuous_audio_not_falsely_low():
    # The live-found bug (2026-08-20): a steady signal has no quiet frames,
    # the floor percentile lands on the signal, and the estimate collapsed
    # to 0 dB — falsely rejecting clean clips. It must read UNKNOWN instead.
    a = analyze(_wav(_tone(3)))
    assert a.loudness.snr_db is None


# ── dataset storage round-trip ───────────────────────────────────────────


def test_dataset_roundtrip(tmp_path):
    import base64

    samples = [
        {"wav_b64": base64.b64encode(_wav(_tone(1.5))).decode(), "transcript": "one"},
        {"wav_b64": base64.b64encode(_wav(_tone(2.0))).decode(), "transcript": "two"},
    ]
    rec = training_datasets.create_dataset(tmp_path, "pin-set", samples)
    assert rec.clip_count == 2
    assert rec.total_seconds == pytest.approx(3.5, abs=0.1)

    listed = training_datasets.list_datasets(tmp_path)
    assert [d.id for d in listed] == [rec.id]

    back = training_datasets.load_samples(tmp_path, rec.id)
    assert [s["transcript"] for s in back] == ["one", "two"]
    assert back[0]["wav_b64"] == samples[0]["wav_b64"]

    dest = tmp_path / "jobcopy"
    assert training_datasets.copy_into(tmp_path, rec.id, dest) == 2
    assert (dest / "metadata.jsonl").is_file()
    assert not (dest / "record.json").exists()  # the record stays home

    assert training_datasets.delete_dataset(tmp_path, rec.id)
    assert training_datasets.list_datasets(tmp_path) == []
    with pytest.raises(LookupError):
        training_datasets.copy_into(tmp_path, rec.id, dest)


# ── capability display names (the duplicate-picker fix) ──────────────────


def test_alias_rows_have_their_own_display_names():
    assert (
        CAPABILITY_DETAILS["chatterbox-nano"].display_name
        != CAPABILITY_DETAILS["chatterbox-turbo"].display_name
    )
    mlx17 = CAPABILITY_DETAILS["qwen3-base-1.7b-mlx"].display_name
    mlx06 = CAPABILITY_DETAILS["qwen3-base-0.6b-mlx"].display_name
    base = CAPABILITY_DETAILS["qwen3-base"].display_name
    assert len({mlx17, mlx06, base}) == 3


# ── widened contracts ────────────────────────────────────────────────────


def test_train_request_accepts_dataset_id_without_samples():
    req = TrainVoiceRequest(engine="qwen3", name="x", dataset_id="ds-abc")
    assert req.samples == []
    assert req.dataset_id == "ds-abc"


def test_train_job_carries_epochs_and_sample_count():
    job = TrainJob(
        job_id="t", engine="qwen3", voice_name="x", phase="queued",
        progress=0.0, epochs=5, sample_count=12,
    )
    assert (job.epochs, job.sample_count) == (5, 12)
