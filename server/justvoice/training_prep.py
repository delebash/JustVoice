# SPDX-License-Identifier: MIT
"""The Preparer job — long recordings → gated, transcribed clips.

Alexandria's contract (alexandria-audiobook app.py `preparer_*` +
`app/static/index.html` preparer tab, read 2026-08-20/21): a SINGLE prep
slot, a background run with streamed progress, a cancel door, results
fetched when the run finishes, and a BATCH mode where several recordings
queue up and each becomes its own training set. This module is that
contract host-side; the API surface is /v1/train/prepare* in
training_api.py.

Single and batch are ONE code path — a batch of one. A second "simple"
path for the common case is how the two drift apart.

Gates, all from ``settings.training.validation``:
  * duration bounds        — before transcription, on the cut length
  * estimated SNR          — against the recording's own measured noise
                             floor (the silences the split removed)
  * transcript confidence  — after transcription, on Whisper's own
                             certainty (engines/whisper/engine.py
                             `_sequence_confidence`). A clip the
                             transcriber was unsure about carries text
                             that is probably wrong, and a wrong
                             transcript teaches the voice wrong sounds.

Any gate whose measurement is None means UNKNOWN and does not fire — a
missing measurement must never masquerade as a failing one.

Cutting method: amplitude silence-split (audio/segmenter.py). Alexandria's
own cutter is unknown — their repo ships the Preparer UI but not
alexandria_preparer.py itself — so parity is to the CONTRACT, not their
(unavailable) implementation.
"""

from __future__ import annotations

import base64
import logging
import tempfile
import threading
from pathlib import Path

log = logging.getLogger(__name__)

# The whole log is kept, not a tail: a preparation that dropped 40 clips
# is only auditable if every drop line survives. The API trims for polling.
_LOG_CAP = 2000

_LOCK = threading.RLock()
_STATE: dict = {
    "running": False,
    "status": "idle",  # idle | splitting | gating | transcribing | done | failed | cancelled
    "progress": "",
    "logs": [],
    "cancel": False,
    "queue": [],          # one row per recording — the processing queue
    "files": None,        # per-recording results once finished
    "transcribe_error": None,
    "error": None,
}


def status() -> dict:
    with _LOCK:
        return {
            "running": _STATE["running"],
            "status": _STATE["status"],
            "progress": _STATE["progress"],
            "logs": list(_STATE["logs"])[-40:],
            "queue": [dict(r) for r in _STATE["queue"]],
            "error": _STATE["error"],
        }


def result() -> dict | None:
    with _LOCK:
        if _STATE["files"] is None:
            return None
        return {
            "files": _STATE["files"],
            "transcribe_error": _STATE["transcribe_error"],
            "logs": list(_STATE["logs"]),
        }


def cancel() -> bool:
    with _LOCK:
        if not _STATE["running"]:
            return False
        _STATE["cancel"] = True
        return True


def _log(line: str) -> None:
    with _LOCK:
        _STATE["logs"].append(line)
        if len(_STATE["logs"]) > _LOG_CAP:
            del _STATE["logs"][: len(_STATE["logs"]) - _LOG_CAP]
        _STATE["progress"] = line


def _cancelled() -> bool:
    with _LOCK:
        return bool(_STATE["cancel"])


def start(
    files: list[tuple[str, bytes]],
    language: str | None,
    *,
    dataset_names: list[str] | None = None,
    save_datasets: bool = False,
    min_confidence: float | None = None,
    min_snr_db: float | None = None,
) -> None:
    """Kick off a prep run over one or more recordings.

    `files` is [(filename, wav bytes)]. `dataset_names[i]` names the dataset
    the i-th recording becomes; absent, the file's own stem is used.
    `min_confidence` / `min_snr_db` override the operator's thresholds for
    THIS run only (Alexandria puts both on the Preparer screen; the settings
    stay the durable defaults). Raises RuntimeError if a run is already in
    progress — one slot, by contract.
    """
    if not files:
        raise ValueError("no recordings to prepare")
    with _LOCK:
        if _STATE["running"]:
            raise RuntimeError("a preparation run is already in progress — cancel it first")
        _STATE.update(
            running=True, status="splitting", progress="", logs=[],
            cancel=False, files=None, transcribe_error=None, error=None,
            queue=[
                {
                    "name": name,
                    "status": "pending",
                    "chunk_count": None,
                    "kept": None,
                    "dataset_id": None,
                    "dataset_name": None,
                    "error": None,
                }
                for name, _ in files
            ],
        )

    t = threading.Thread(
        target=_run_queue,
        args=(files, language, dataset_names, save_datasets,
              min_confidence, min_snr_db),
        daemon=True,
        name="jv-preparer",
    )
    t.start()


def _run_queue(
    files: list[tuple[str, bytes]],
    language: str | None,
    dataset_names: list[str] | None,
    save_datasets: bool,
    min_confidence: float | None = None,
    min_snr_db: float | None = None,
) -> None:
    """Walk the queue. One recording failing never kills the rest — its row
    carries the reason and the run moves on, which is the whole point of
    queueing a batch overnight."""
    from .app_state import get_state
    from .storage import training_datasets

    out_files: list[dict] = []
    transcribe_error: str | None = None
    try:
        for i, (name, buf) in enumerate(files):
            if _cancelled():
                _mark(i, status="cancelled")
                continue
            _mark(i, status="running")
            label = f"[{i + 1}/{len(files)}] {name}"
            _log(f"{label}: starting.")
            try:
                chunks, err = _prepare_one(
                    buf, language, label,
                    min_confidence=min_confidence, min_snr_db=min_snr_db,
                )
            except Exception as e:
                log.warning("preparer: %s failed", name, exc_info=True)
                _mark(i, status="failed", error=str(e))
                _log(f"{label}: FAILED — {e}")
                out_files.append({"name": name, "chunks": [], "error": str(e)})
                continue
            if err and transcribe_error is None:
                transcribe_error = err
            if _cancelled():
                _mark(i, status="cancelled")
                out_files.append({"name": name, "chunks": chunks, "error": None})
                continue

            kept = [c for c in chunks if c["accepted"]]
            row: dict = {
                "name": name,
                "chunks": chunks,
                "kept": len(kept),
                "error": None,
                "dataset_id": None,
                "dataset_name": None,
            }
            if save_datasets and kept:
                ds_name = _dataset_name_for(name, dataset_names, i)
                try:
                    rec = training_datasets.create_dataset(
                        Path(get_state().data_dir),
                        ds_name,
                        [
                            {"wav_b64": c["wav_b64"], "transcript": c["transcript"]}
                            for c in kept
                        ],
                        language=language,
                        origin="prepared",
                    )
                    row["dataset_id"] = rec.id
                    row["dataset_name"] = rec.name
                    _log(f"{label}: saved {len(kept)} clips as dataset “{rec.name}”.")
                except Exception as e:
                    log.warning("preparer: dataset save failed", exc_info=True)
                    row["error"] = f"clips are ready but the dataset save failed: {e}"
                    _log(f"{label}: dataset save FAILED — {e}")
            elif save_datasets:
                _log(f"{label}: no clips passed the gates — nothing to save.")

            out_files.append(row)
            _mark(
                i,
                status="done",
                chunk_count=len(chunks),
                kept=len(kept),
                dataset_id=row["dataset_id"],
                dataset_name=row["dataset_name"],
                error=row["error"],
            )
            _log(f"{label}: {len(kept)} of {len(chunks)} clips usable.")

        final = "cancelled" if _cancelled() else "done"
        with _LOCK:
            _STATE.update(
                running=False, status=final,
                files=out_files, transcribe_error=transcribe_error,
            )
        _log("Cancelled." if final == "cancelled" else "Done.")
    except Exception as e:
        log.warning("preparer run failed", exc_info=True)
        with _LOCK:
            _STATE.update(running=False, status="failed", error=str(e), files=out_files)
        _log(f"Failed: {e}")


def _dataset_name_for(filename: str, names: list[str] | None, i: int) -> str:
    if names and i < len(names) and (names[i] or "").strip():
        return names[i].strip()
    stem = Path(filename).stem.strip()
    return stem or f"recording {i + 1}"


def _mark(index: int, **fields) -> None:
    with _LOCK:
        if 0 <= index < len(_STATE["queue"]):
            _STATE["queue"][index].update(fields)




def _prepare_one(
    buf: bytes,
    language: str | None,
    label: str,
    *,
    min_confidence: float | None = None,
    min_snr_db: float | None = None,
) -> tuple[list[dict], str | None]:
    """Split → gate → transcribe → gate again, for ONE recording.

    Returns (chunks, transcribe_error). Raises only when the recording is
    unusable (the split itself fails); a missing transcriber is REPORTED,
    not raised, because clips that merely lack transcripts are still worth
    keeping — the operator can transcribe them later.
    """
    from .app_state import get_state
    from .audio import segmenter
    from .audio.analyzer import analyze
    from .audio.wav import write_wav_container

    import math

    import numpy as np

    v = get_state().settings.get().training.validation
    # Per-run overrides beat the settings defaults for this run only.
    snr_floor = min_snr_db if min_snr_db is not None else v.min_snr_db
    conf_floor = (min_confidence if min_confidence is not None
                  else v.min_transcript_confidence)

    _log(f"{label}: splitting at silences…")
    with _LOCK:
        _STATE["status"] = "splitting"
    sr, pcm_chunks, noise_rms = segmenter.split_on_silence(
        buf, gap_secs=v.split_silence_secs, max_secs=v.max_sample_duration_secs
    )
    _log(f"{label}: {len(pcm_chunks)} segments found.")

    with _LOCK:
        _STATE["status"] = "gating"
    chunks: list[dict] = []
    for pcm in pcm_chunks:
        secs = len(pcm) / sr
        wav_bytes = write_wav_container(pcm.tobytes(), sr, 1)
        # SNR against the recording's OWN measured noise floor (the
        # silences this split removed). Falls back to the analyzer's
        # percentile estimate; both can be None = unknown = not gated.
        snr = None
        if noise_rms:
            x = pcm.astype(np.float64)
            chunk_rms = float(np.sqrt(np.mean(x * x)))
            if chunk_rms > 0:
                snr = 20.0 * math.log10(chunk_rms / noise_rms)
        else:
            try:
                snr = analyze(wav_bytes).loudness.snr_db
            except Exception:
                pass
        accepted, reason = True, ""
        if secs < v.min_sample_duration_secs:
            accepted, reason = False, f"under {v.min_sample_duration_secs} s"
        elif snr is not None and snr < snr_floor:
            accepted, reason = False, f"SNR {snr:.0f} dB under {snr_floor:.0f} dB"
        chunks.append(
            {
                "wav_b64": base64.b64encode(wav_bytes).decode(),
                "seconds": round(secs, 2),
                "snr_db": round(snr, 1) if snr is not None else None,
                "transcript": "",
                "confidence": None,
                "accepted": accepted,
                "reason": reason,
            }
        )
    kept = sum(1 for c in chunks if c["accepted"])
    _log(f"{label}: {kept} of {len(chunks)} clips pass the length and noise gates.")

    with _LOCK:
        _STATE["status"] = "transcribing"
    transcribe_error: str | None = None
    done = 0
    for c in chunks:
        if _cancelled():
            _log(f"{label}: cancelled.")
            return chunks, transcribe_error
        if not c["accepted"] or transcribe_error is not None:
            continue
        done += 1
        _log(f"{label}: transcribing clip {done} of {kept}…")
        tmp_path: Path | None = None
        try:
            from .api.captures_api import _stt_transcribe_detailed

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(base64.b64decode(c["wav_b64"]))
                tmp_path = Path(tmp.name)
            r = _stt_transcribe_detailed(str(tmp_path), language)
            c["transcript"] = r.get("text") or ""
            conf = r.get("confidence")
            c["confidence"] = conf
            # The confidence gate runs HERE, not beside the duration/SNR
            # gates, because it needs the transcript that only exists after
            # this call. None = UNKNOWN = the gate does not fire, the same
            # contract SNR uses above.
            if conf is not None and conf < conf_floor:
                c["accepted"] = False
                c["reason"] = (
                    f"transcript confidence {conf:.2f} under "
                    f"{conf_floor:.2f}"
                )
                _log(f"{label}: clip {done} dropped — {c['reason']}.")
        except Exception as e:  # whisper missing — clips stay usable
            transcribe_error = str(e)
            _log(f"{label}: transcription unavailable — {e}")
        finally:
            if tmp_path is not None:
                tmp_path.unlink(missing_ok=True)

    final_kept = sum(1 for c in chunks if c["accepted"])
    if final_kept != kept:
        _log(f"{label}: {kept - final_kept} more dropped on transcript confidence.")
    return chunks, transcribe_error
