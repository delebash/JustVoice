"""Mastering — ffmpeg shell-out for ACX / INaudio / podcast / YouTube presets.

The orchestration writes the raw WAV to a temp file, builds the right
ffmpeg filtergraph for the preset, captures stdout. Requires ffmpeg
on PATH (or bundled — see system_info.detect()'s ffmpeg block).
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from .audio.wav import write_wav_container
from .models import MasterPresetSettings

log = logging.getLogger(__name__)


def have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def master(
    pcm: bytes,
    sample_rate: int,
    channels: int,
    *,
    preset_name: str,
    presets: MasterPresetSettings,
    title: str | None = None,
    author: str | None = None,
    book: str | None = None,
) -> bytes:
    """Apply a mastering preset and return encoded audio bytes."""
    if not have_ffmpeg():
        raise RuntimeError(
            "ffmpeg not on PATH. Install ffmpeg or set its bundled path before /v1/master."
        )
    preset = {
        "acx": presets.acx,
        "inaudio": presets.inaudio,
        "podcast": presets.podcast,
        "youtube": presets.youtube,
    }.get(preset_name)
    if preset is None:
        raise ValueError(f"Unknown mastering preset: {preset_name}")

    # ffmpeg filter chain
    af_chain = [
        "highpass=f=80",
        f"loudnorm=I={preset.loudness_target_lufs}:TP={preset.true_peak_dbfs}:LRA={preset.loudness_range_lu}",
        "dynaudnorm=g=15:p=0.95",
        f"aresample={preset.sample_rate}",
    ]
    if channels != preset.channels:
        af_chain.append(f"pan={'mono|c0=0.5*c0+0.5*c1' if preset.channels == 1 else 'stereo|c0=c0|c1=c0'}")

    # Pad with head + tail silence per preset
    silence_head = f"adelay={int(preset.head_silence_secs * 1000)}|{int(preset.head_silence_secs * 1000)}"
    silence_tail = f"apad=pad_dur={preset.tail_silence_secs}"
    af_chain.insert(0, silence_head)
    af_chain.insert(0, silence_tail)

    af = ",".join(af_chain)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as in_f:
        in_f.write(write_wav_container(pcm, sample_rate, channels))
        in_path = in_f.name
    suffix = "." + preset.format
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as out_f:
        out_path = out_f.name

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        in_path,
        "-af",
        af,
        "-ac",
        str(preset.channels),
        "-ar",
        str(preset.sample_rate),
    ]
    if preset.format == "mp3":
        cmd += ["-codec:a", "libmp3lame", "-b:a", f"{preset.bitrate_kbps}k", "-id3v2_version", "4"]
    elif preset.format == "m4a":
        cmd += ["-codec:a", "aac", "-b:a", f"{preset.bitrate_kbps}k"]
    elif preset.format == "wav":
        pass  # default PCM
    if title:
        cmd += ["-metadata", f"title={title}"]
    if author:
        cmd += ["-metadata", f"artist={author}"]
    if book:
        cmd += ["-metadata", f"album={book}"]
    cmd.append(out_path)

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=600)
        if result.returncode != 0:
            err = result.stderr.decode("utf-8", errors="ignore")[-1500:]
            raise RuntimeError(f"ffmpeg failed (exit {result.returncode}): {err}")
        return Path(out_path).read_bytes()
    finally:
        try:
            Path(in_path).unlink()
        except Exception:
            pass
        try:
            Path(out_path).unlink()
        except Exception:
            pass
