# SPDX-License-Identifier: MIT
"""audiocpp_dsp — the server's audio math, in the DSP program built from our audio.cpp fork.

Every piece of sample math this server did in numpy, scipy and python-stretch — the effects
chain, a line's pace, gain and pitch, the joins between a line's pieces, a line's silence trim
and its fit to a chapter's rate, the analyzer, Kokoro blends — is a request to `audiocpp_dsp`
(the move off Python, docs/plans/2026-10-07-electron-node-plan.md §3; decided 2026-10-07: a
separate program "shipped with the app instead of downloaded", with no models and no GPU, so it
works with nothing installed — cloud voices included). The C++ was proven against the Python
it replaced, output for output, before that Python was deleted: identical 16-bit audio
everywhere except Signalsmith Stretch (pitch and pace), which moved to its newest version with
a fixed seed and now repeats exactly (the fork's `dsp/tests/parity/`).

It starts on first use through the kit's spawn door — a kill-on-close Job Object on Windows,
so it dies with this server however this server dies; elsewhere `JUSTVOICE_SERVER_PID` lets
the leftover sweep find it — on a free loopback port, logs to `<data>/logs/audiocpp-dsp.log`,
and is started again if it died. Where it is, first found wins:

1. `JUSTVOICE_DSP_EXE` — an explicit path;
2. the development build `npm run dev` names (`JUSTVOICE_AUDIOCPP_BUILD`, its bin folder);
3. beside a packaged server's executable;
4. a source checkout's `../audio.cpp/build/jv-dev/bin` — what `npm run dev` builds.
"""

from __future__ import annotations

import atexit
import functools
import json
import logging
import os
import struct
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

EXE_NAME = "audiocpp_dsp.exe" if sys.platform == "win32" else "audiocpp_dsp"
ENV_EXE = "JUSTVOICE_DSP_EXE"


class DspError(RuntimeError):
    """The DSP program refused a request (`status` 400) or could not be reached (503)."""

    def __init__(self, message: str, status: int = 503):
        super().__init__(message)
        self.status = status


def find_exe() -> Path:
    """The `audiocpp_dsp` this server runs (the module docstring's order)."""
    candidates: list[Path] = []
    if os.environ.get(ENV_EXE):
        candidates.append(Path(os.environ[ENV_EXE]))
    from ..engines.audiocpp import dev_build

    if (dev := dev_build.current()) is not None:
        candidates.append(dev.bin_dir / EXE_NAME)
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).parent / EXE_NAME)
    repo = Path(__file__).resolve().parents[3]
    candidates.append(repo.parent / "audio.cpp" / "build" / "jv-dev" / "bin" / EXE_NAME)
    for c in candidates:
        if c.is_file():
            return c
    raise DspError(
        f"{EXE_NAME} is not built — `npm run dev` builds it with the speech runtime from "
        f"../audio.cpp (or set {ENV_EXE}). Looked in: " + "; ".join(str(c) for c in candidates)
    )


def _log_path() -> Path:
    try:
        from ..app_state import get_state

        root = Path(get_state().data_dir)
    except Exception:  # noqa: BLE001 — no app state (a test, a script): the default data folder
        from ..paths import default_data_dir

        root = default_data_dir()
    path = root / "logs" / "audiocpp-dsp.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class _Program:
    def __init__(self):
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._job = None
        self._port = 0
        self._log = None

    def url(self) -> str:
        with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                self._start()
            return f"http://127.0.0.1:{self._port}"

    def _start(self) -> None:
        from llm_runner.platform.procs import NO_CONSOLE
        from llm_runner.runner.process import close_job, spawn_child

        from ..engines.audiocpp.runtime import _child_env, _free_port, _rotate_log, start_timeout

        if self._job is not None:
            close_job(self._job)
        exe = find_exe()
        self._port = _free_port()
        log_path = _log_path()
        _rotate_log(log_path)
        if self._log is not None:
            self._log.close()
        self._log = open(log_path, "ab")  # noqa: SIM115 — owned by the child for its lifetime
        popen = functools.partial(subprocess.Popen, cwd=str(exe.parent), creationflags=NO_CONSOLE, env=_child_env())
        self._proc, self._job = spawn_child(popen, [str(exe), "--port", str(self._port)], self._log)
        deadline = time.monotonic() + start_timeout()
        while time.monotonic() < deadline:
            if self._proc.poll() is not None:
                raise DspError(f"{EXE_NAME} exited with {self._proc.returncode} on start (log: {log_path})")
            try:
                if httpx.get(f"http://127.0.0.1:{self._port}/health", timeout=2).status_code == 200:
                    log.info("%s up on :%d (pid %d, %s)", EXE_NAME, self._port, self._proc.pid, exe)
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.05)
        self.stop_locked()
        raise DspError(f"{EXE_NAME} did not answer within {start_timeout():.0f} s (log: {log_path})")

    def stop_locked(self) -> None:
        from llm_runner.runner.process import close_job

        proc, self._proc = self._proc, None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                proc.kill()
        if self._job is not None:
            close_job(self._job)
            self._job = None
        if self._log is not None:
            self._log.close()
            self._log = None

    def stop(self) -> None:
        with self._lock:
            self.stop_locked()


_PROGRAM = _Program()
atexit.register(_PROGRAM.stop)


def stop() -> None:
    """Stop the program (the server's shutdown); the next request starts it again."""
    _PROGRAM.stop()


def _post(op: str, params: dict, parts: list[tuple[str, bytes]]) -> httpx.Response:
    """One request; a dead or unreachable program is started again and the request sent once
    more — it holds no state between requests."""
    from ..engines.audiocpp.runtime import request_timeout

    files = [("params", ("params", json.dumps(params).encode(), "application/json"))]
    files += [(name, (f"{name}-{uuid.uuid4().hex[:6]}", data, "application/octet-stream")) for name, data in parts]
    for attempt in (1, 2):
        try:
            r = httpx.post(f"{_PROGRAM.url()}/v1/dsp/{op}", files=files, timeout=request_timeout())
        except httpx.TransportError as e:
            if attempt == 2:
                raise DspError(f"{EXE_NAME} did not answer {op}: {e}") from e
            _PROGRAM.stop()
            continue
        if r.status_code == 200:
            return r
        try:
            message = r.json()["error"]["message"]
        except Exception:  # noqa: BLE001
            message = r.text[:300]
        raise DspError(f"{op}: {message}", status=400 if r.status_code == 400 else 503)
    raise AssertionError("unreachable")


def _wav(pcm: bytes, sample_rate: int, channels: int) -> bytes:
    from .wav import write_wav_container

    return write_wav_container(pcm, sample_rate, channels)


def _pcm(wav: bytes) -> bytes:
    from .wav import strip_wav_header

    return strip_wav_header(wav)


# ── a finished line ─────────────────────────────────────────────────────────

def shape(pcm: bytes, sample_rate: int, channels: int, *, stretch_factor: float | None = None,
          gain_db: float = 0.0, pitch_semitones: float = 0.0, effects: list | None = None) -> bytes:
    """16-bit PCM through pace (`stretch_factor`, 2.0 = twice as fast), gain, pitch, then the
    effects chain — each step only when given, in that order (render_core.shape_line_pcm)."""
    if not (stretch_factor or gain_db or pitch_semitones or effects):
        return pcm
    params = {"stretch_factor": stretch_factor, "gain_db": gain_db, "pitch_semitones": pitch_semitones, "effects": effects or []}
    return _pcm(_post("shape", params, [("audio", _wav(pcm, sample_rate, channels))]).content)


def apply_effects(wav: bytes, chain: list | None) -> bytes:
    """A WAV (16- or 32-bit PCM) through an effects chain; a 16-bit WAV back. A chain with no
    usable entry returns the input as it is."""
    if not chain:
        return wav
    return _post("shape", {"effects": chain}, [("audio", wav)]).content


# ── joins ───────────────────────────────────────────────────────────────────

def _join_rule(crossfade_ms: int) -> dict:
    from . import chunked

    return {"crossfade_ms": int(crossfade_ms), "pause_ms": chunked.PIECE_JOIN_PAUSE_MS,
            "silence_dbfs": chunked.PIECE_JOIN_SILENCE_DBFS, "window_ms": chunked.WINDOW_MS}


def join(pieces: list[tuple[bytes, int, int]], crossfade_ms: int) -> bytes:
    """A line's pieces — `(pcm, rate, channels)` each — as one 16-bit PCM, every seam by
    chunked.PIECE_JOIN_* (the quiet on both sides cut to the piece pause, or a short crossfade)."""
    if not pieces:
        return b""
    parts = [("audio", _wav(pcm, sr, ch)) for pcm, sr, ch in pieces]
    return _pcm(_post("join", _join_rule(crossfade_ms), parts).content)


def stream_join(piece_wav: bytes, tail: bytes | None, *, last: bool, crossfade_ms: int) -> tuple[bytes, bytes | None]:
    """One piece of a streamed audition: joined onto the `tail` held from the piece before, then
    split into the 16-bit PCM that goes out now and the tail held for the next seam (opaque
    float32 bytes; None after the last piece)."""
    parts = [("audio", piece_wav)] + ([("tail", tail)] if tail else [])
    r = _post("stream-join", {**_join_rule(crossfade_ms), "last": last}, parts)
    k = int(r.headers["x-out-bytes"])
    return r.content[:k], (None if last else r.content[k:])


# ── a line in a chapter ─────────────────────────────────────────────────────

def fit(pcm: bytes, sample_rate: int, channels: int, to_rate: int, to_channels: int, *,
        trim_below_dbfs: float | None, trim_keep_ms: int) -> bytes:
    """16-bit PCM with its silent start and end trimmed (when `trim_below_dbfs` is given), then
    brought to (`to_rate`, `to_channels`) — render_core.concat_lines' per-line step."""
    if trim_below_dbfs is None and sample_rate == to_rate and channels == to_channels:
        return pcm
    trim = None if trim_below_dbfs is None else {"below_dbfs": trim_below_dbfs, "keep_ms": trim_keep_ms}
    params = {"trim": trim, "to_sample_rate": to_rate, "to_channels": to_channels}
    return _pcm(_post("fit", params, [("audio", _wav(pcm, sample_rate, channels))]).content)


def aligner_input(wav: bytes, sample_rate: int) -> bytes:
    """The forced aligner's input (engines/audiocpp/slot.as_16k_mono): channels averaged,
    resampled to `sample_rate`, rounded half to even — a WAV back."""
    return _post("aligner-input", {"sample_rate": int(sample_rate)}, [("audio", wav)]).content


# ── the analyzer ────────────────────────────────────────────────────────────

def loudness(wav: bytes) -> dict:
    """peak_dbfs, rms_dbfs (-inf for silence), crest_factor_db, silence_ratio, clipping_ratio."""
    got = _post("analyze", {}, [("audio", wav)]).json()
    return {k: (float("-inf") if v is None else v) for k, v in got.items()}


def sample_diff(wav_a: bytes, wav_b: bytes) -> dict:
    """sample_rmse, max_sample_delta, pct_identical_samples over the shorter (None for none)."""
    return _post("compare", {}, [("a", wav_a), ("b", wav_b)]).json()


def noise_margin(wav: bytes) -> float | None:
    return _post("noise-margin", {}, [("audio", wav)]).json()["noise_margin_db"]


# ── Kokoro blends ───────────────────────────────────────────────────────────

def f32_bytes(values) -> bytes:
    """A list of floats (a stored blend) as little-endian float32 bytes."""
    values = list(values)
    return struct.pack(f"<{len(values)}f", *values)


def f32_list(raw: bytes) -> list[float]:
    return list(struct.unpack(f"<{len(raw) // 4}f", raw))


def vectors_mean(vectors: list[bytes]) -> bytes:
    return _post("vectors/mean", {}, [("vector", v) for v in vectors]).content


def vectors_blend(vectors: list[bytes], weights: list[float], normalize: bool) -> bytes:
    return _post("vectors/blend", {"weights": [float(w) for w in weights], "normalize": bool(normalize)},
                 [("vector", v) for v in vectors]).content


def vectors_recombine(vectors: list[bytes], segments: list[tuple[int, float, float]], features: int) -> bytes:
    return _post("vectors/recombine", {"segments": [[i, float(a), float(b)] for i, a, b in segments], "features": int(features)},
                 [("vector", v) for v in vectors]).content
