"""Mastering — ffmpeg shell-out for ACX / INaudio / podcast / YouTube presets.

The orchestration writes the raw WAV to a temp file, builds the right
ffmpeg filtergraph for the preset, captures stdout. Requires ffmpeg
on PATH (or bundled — see system_info.detect()'s ffmpeg block).

Two doors onto the same filtergraph:

- `master()` returns the preset's DELIVERABLE encoding (ACX → mp3,
  YouTube → m4a). This is what an export ships.
- `master_to_wav()` runs the identical processing and returns WAV. This is
  what a chapter render and the ACX QC measurement use: the loudness work
  is the part that decides whether a book passes, and doing it in WAV keeps
  the M4B assembly to ONE lossy generation instead of two.

`resolve_master_target()` is the single place that decides WHICH preset a
render uses. Before 2026-08-15 nothing decided: `/v1/render_chapter` only
mastered when a caller named a preset, Studio never named one, and the
Render tab's pill claimed ACX was "applied on render" while the bytes were
raw TTS output. The render preset's own `master` field was stored and never
read either.
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

# The presets `settings.mastering` actually carries.
MASTER_PRESET_NAMES = ("acx", "inaudio", "podcast", "youtube")

# What a project of each kind masters to when nothing more specific is set.
# Game voicelines and custom projects stay RAW on purpose: a game engine
# wants the unprocessed line to run its own bus through, and "custom" means
# the user has not told us what this is for.
KIND_MASTER_DEFAULTS = {
    "audiobook": "acx",
    "podcast": "podcast",
    "game_voicelines": None,
    "custom": None,
}


def resolve_master_target(
    *,
    requested: str | None = None,
    preset_master: str | None = None,
    project_master: str | None = None,
    project_type: str | None = None,
) -> tuple[str | None, str]:
    """Which mastering preset applies, and where the answer came from.

    Precedence, most specific first: the request → the render preset's
    `master` → the project's `mastering_preset` → the project kind's
    default. `"none"` at any level is a real answer meaning "ship it raw",
    and stops the search. Returns `(preset_name_or_None, source)` where
    source is one of request / preset / project / kind.
    """
    for value, source in (
        (requested, "request"),
        (preset_master, "preset"),
        (project_master, "project"),
    ):
        if not value:
            continue
        if value == "none":
            return None, source
        if value in MASTER_PRESET_NAMES:
            return value, source
        # "custom" (a real Project.mastering_preset value) and anything else
        # we have no filtergraph for. Raw is the honest outcome — inventing
        # ACX numbers for it would be worse than doing nothing.
        log.warning(
            "mastering: %s names target %r, which is not a known preset — "
            "rendering raw", source, value,
        )
        return None, source
    return KIND_MASTER_DEFAULTS.get(project_type or ""), "kind"


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
    return _run_master(
        pcm, sample_rate, channels,
        preset_name=preset_name, presets=presets,
        out_format=None, title=title, author=author, book=book,
    )


def master_to_wav(
    pcm: bytes,
    sample_rate: int,
    channels: int,
    *,
    preset_name: str,
    presets: MasterPresetSettings,
) -> bytes:
    """The same preset's processing, WAV out — no codec generation.

    Used by chapter renders (you are auditioning, not shipping) and by ACX
    QC (the numbers have to describe processed audio, and `analyze()` reads
    WAV). Metadata tags are deliberately absent: a WAV monitor is not the
    deliverable that carries a title.
    """
    return _run_master(
        pcm, sample_rate, channels,
        preset_name=preset_name, presets=presets, out_format="wav",
    )


def _run_master(
    pcm: bytes,
    sample_rate: int,
    channels: int,
    *,
    preset_name: str,
    presets: MasterPresetSettings,
    out_format: str | None,
    title: str | None = None,
    author: str | None = None,
    book: str | None = None,
) -> bytes:
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
    # The deliverable encoding is the preset's; callers who want the
    # processing without a codec generation pass out_format="wav".
    fmt = out_format or preset.format

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
    suffix = "." + fmt
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
    if fmt == "mp3":
        cmd += ["-codec:a", "libmp3lame", "-b:a", f"{preset.bitrate_kbps}k", "-id3v2_version", "4"]
    elif fmt == "m4a":
        cmd += ["-codec:a", "aac", "-b:a", f"{preset.bitrate_kbps}k"]
    elif fmt == "wav":
        cmd += ["-codec:a", "pcm_s16le"]
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
