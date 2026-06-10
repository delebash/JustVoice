# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the mastering preset values + their conformance to spec.

The actual ffmpeg shell-out in mastering.py is exercised by integration tests
(skipped without ffmpeg on PATH). This file validates that the preset defaults
target the correct spec without running ffmpeg.
"""

from __future__ import annotations

import pytest

from justvoice.models import MasterPreset, MasterPresetSettings


@pytest.fixture
def presets() -> MasterPresetSettings:
    return MasterPresetSettings()


def test_acx_preset_centers_in_acx_lufs_range(presets: MasterPresetSettings) -> None:
    # ACX spec: -23 LUFS <= integrated loudness <= -18 LUFS.
    # We center at -20 with a margin of 2-3 LU on either side.
    assert -23.0 <= presets.acx.loudness_target_lufs <= -18.0
    assert presets.acx.loudness_target_lufs == -20.0


def test_acx_peak_below_minus_three_dbfs(presets: MasterPresetSettings) -> None:
    # ACX spec: true peak <= -3 dB. We carry 0.5 dB of safety headroom.
    assert presets.acx.true_peak_dbfs <= -3.0
    assert presets.acx.true_peak_dbfs == -3.5


def test_acx_mp3_192_mono_44100(presets: MasterPresetSettings) -> None:
    """ACX retail format requirements per AudibleAvatar/ACX submission guide."""
    assert presets.acx.format == "mp3"
    assert presets.acx.bitrate_kbps == 192
    assert presets.acx.sample_rate == 44_100
    assert presets.acx.channels == 1


def test_acx_head_silence_within_spec(presets: MasterPresetSettings) -> None:
    # ACX wants 0.5-1 second of room-tone head silence.
    assert 0.5 <= presets.acx.head_silence_secs <= 1.0


def test_acx_tail_silence_within_spec(presets: MasterPresetSettings) -> None:
    # ACX wants 1-5 seconds of room-tone tail silence between sections.
    assert 1.0 <= presets.acx.tail_silence_secs <= 5.0


def test_podcast_louder_than_acx(presets: MasterPresetSettings) -> None:
    """Podcast platforms (Apple/Spotify) target -16 LUFS; audiobooks target -20."""
    assert presets.podcast.loudness_target_lufs > presets.acx.loudness_target_lufs


def test_youtube_loudest(presets: MasterPresetSettings) -> None:
    """YouTube normalizes to -14 LUFS; ours matches."""
    assert presets.youtube.loudness_target_lufs == -14.0


def test_master_preset_serializes(presets: MasterPresetSettings) -> None:
    """Pydantic round-trip — confirms cross-language API stability per CLAUDE.md."""
    payload = presets.model_dump()
    rebuilt = MasterPresetSettings.model_validate(payload)
    assert rebuilt == presets


def test_user_can_override_acx_preset() -> None:
    """Operator-tunable per CLAUDE.md — every knob in settings.json."""
    custom = MasterPreset(
        loudness_target_lufs=-22.0,
        true_peak_dbfs=-3.0,
        loudness_range_lu=7.0,
        sample_rate=44_100,
        channels=1,
        format="mp3",
        bitrate_kbps=192,
        head_silence_secs=0.75,
        tail_silence_secs=3.0,
    )
    presets = MasterPresetSettings(acx=custom)
    assert presets.acx.loudness_target_lufs == -22.0
