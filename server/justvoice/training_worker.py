"""Voice fine-tuning worker — Phase 5 A.

Reusable training pipeline that engine adapters delegate to via their
``train_start`` impl. Encapsulates dataset validation, the training
loop, cancellation, and result persistence.

In-process variant: instead of HTTP-posting callbacks to a separate
core (the original sidecar arrangement), this updates the training
registry directly. Engine-agnostic infrastructure — engine-specific
LoRA / tokenizer concerns live in the closure each adapter passes as
``train_step``.

Heavy dependencies (``peft``, ``transformers``, ``faster-whisper``,
``speechbrain``) are loaded lazily by the engine adapters that need
them. This module only needs the stdlib + numpy-style math.
"""

from __future__ import annotations

import base64
import io
import json
import math
import struct
import threading
import time
import traceback
import wave
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable


# ─── Dataset validation ────────────────────────────────────────────────


@dataclass
class SampleReport:
    index: int
    accepted: bool
    duration_seconds: float
    rejection_reason: str | None = None
    snr_db: float | None = None


@dataclass
class DatasetValidation:
    accepted: int = 0
    rejected: int = 0
    reports: list[SampleReport] = field(default_factory=list)
    usable_seconds: float = 0.0
    avg_wer: float | None = None
    speaker_consistency: float | None = None


def decode_wav(b64: str) -> tuple[bytes, int, int]:
    """Decode a base64-encoded WAV. Returns (raw_pcm, sample_rate, channels)."""
    raw = base64.b64decode(b64)
    with wave.open(io.BytesIO(raw), "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        pcm = w.readframes(w.getnframes())
    return pcm, sr, ch


def estimate_snr_db(pcm: bytes) -> float:
    """Rough SNR estimate using 95th-percentile vs 10th-percentile sample
    magnitudes. Real voice is > 20 dB; below 15 dB is unusable."""
    n = len(pcm) // 2
    if n == 0:
        return 0.0
    samples = struct.unpack(f"<{n}h", pcm)
    abs_samples = sorted(abs(s) for s in samples)
    p95 = abs_samples[int(n * 0.95)] if n > 100 else max(abs_samples)
    p10 = abs_samples[int(n * 0.10)] if n > 100 else 1
    if p10 == 0:
        p10 = 1
    return 20.0 * math.log10(p95 / p10) if p95 > 0 else 0.0


def detect_clipping(pcm: bytes, threshold_count: int = 10) -> bool:
    n = len(pcm) // 2
    samples = struct.unpack(f"<{n}h", pcm)
    clipped = sum(1 for s in samples if s >= 32760 or s <= -32760)
    return clipped > threshold_count


def silence_ratio(pcm: bytes, silence_threshold: int = 100) -> float:
    n = len(pcm) // 2
    if n == 0:
        return 1.0
    samples = struct.unpack(f"<{n}h", pcm)
    silent = sum(1 for s in samples if abs(s) < silence_threshold)
    return silent / n


def validate_dataset(
    samples: list[dict],
    *,
    min_duration: float = 1.0,
    max_duration: float = 60.0,
    min_snr_db: float = 15.0,
    max_silence_ratio: float = 0.30,
) -> DatasetValidation:
    result = DatasetValidation()
    for idx, sample in enumerate(samples):
        report = SampleReport(index=idx, accepted=False, duration_seconds=0.0)
        try:
            pcm, sr, ch = decode_wav(sample.get("wav_b64", ""))
            duration = len(pcm) / (2 * sr * ch)
            report.duration_seconds = duration

            if duration < min_duration:
                report.rejection_reason = "too_short"
            elif duration > max_duration:
                report.rejection_reason = "too_long"
            else:
                if ch == 2:
                    n = len(pcm) // 4
                    stereo = struct.unpack(f"<{n*2}h", pcm)
                    mono = [(stereo[2 * i] + stereo[2 * i + 1]) // 2 for i in range(n)]
                    pcm = struct.pack(f"<{n}h", *mono)

                snr = estimate_snr_db(pcm)
                report.snr_db = snr
                if snr < min_snr_db:
                    report.rejection_reason = "low_snr"
                elif detect_clipping(pcm):
                    report.rejection_reason = "clipped"
                elif silence_ratio(pcm) > max_silence_ratio:
                    report.rejection_reason = "silence_too_long"

            if report.rejection_reason is None:
                report.accepted = True
                result.accepted += 1
                result.usable_seconds += duration
            else:
                result.rejected += 1
        except Exception as e:
            report.rejection_reason = f"decode_error: {e}"
            result.rejected += 1
        result.reports.append(report)
    return result


def _validation_to_dict(v: DatasetValidation) -> dict:
    return {
        "accepted": v.accepted,
        "rejected": v.rejected,
        "usable_seconds": v.usable_seconds,
        "avg_wer": v.avg_wer,
        "speaker_consistency": v.speaker_consistency,
        "reports": [asdict(r) for r in v.reports],
    }


# ─── Job control ───────────────────────────────────────────────────────


_JOBS_LOCK = threading.Lock()
_CANCEL_EVENTS: dict[str, threading.Event] = {}


def cancel(job_id: str) -> None:
    """Signal a job to stop after the current step. Idempotent."""
    with _JOBS_LOCK:
        _CANCEL_EVENTS.setdefault(job_id, threading.Event()).set()


def _is_cancelled(job_id: str) -> bool:
    with _JOBS_LOCK:
        ev = _CANCEL_EVENTS.get(job_id)
    return ev is not None and ev.is_set()


def _clear_cancel(job_id: str) -> None:
    with _JOBS_LOCK:
        _CANCEL_EVENTS.pop(job_id, None)


# ─── Callback dispatch ─────────────────────────────────────────────────


def post_callback(payload: dict) -> None:
    """Apply a training callback in-process.

    Calls the same logic as the ``POST /internal/training/callback``
    endpoint — fields map onto the ``TrainingCallback`` Pydantic model.
    """
    from .app_state import get_state
    from .models import VoiceRecord
    from datetime import datetime, timezone

    st = get_state()
    job_id = payload.get("job_id")
    if not job_id:
        return
    job = st.training.get(job_id)
    if not job:
        return

    phase = payload.get("phase")
    final_voice_id = None
    if phase == "completed":
        now = datetime.now(timezone.utc)
        rec = VoiceRecord(
            id="",
            engine=job.engine,
            source="lora",
            name=job.voice_name,
            language=st.settings.get().training.default_voice_language,
            adapter_path=payload.get("adapter_path"),
            training_job_id=job_id,
            created_at=now,
            updated_at=now,
        )
        created = st.voices.create(rec)
        final_voice_id = created.id

    loss_append = payload.get("loss_curve_append") or []
    new_loss = list(job.loss_curve) + list(loss_append)
    st.training.update(
        job_id,
        phase=phase,
        progress=payload.get("progress"),
        loss_curve=new_loss,
        eta_seconds=payload.get("eta_seconds"),
        validation=payload.get("validation"),
        error=payload.get("error"),
        final_voice_id=final_voice_id,
    )


# ─── Main loop ─────────────────────────────────────────────────────────


def run_training_job(
    job_id: str,
    request: dict,
    *,
    adapter_dir: Path,
    train_step: Callable[[int, dict], float],
    target_steps: int,
    sample_loss_every: int = 50,
) -> None:
    """Generic training loop. Engine adapters call this from ``train_start``
    with an engine-specific ``train_step`` closure that runs one step and
    returns the per-step loss.

    Operator-tunable thresholds come from the request's ``_server_config``
    block (injected by the API layer from ``settings.training``).
    """
    cfg = request.get("_server_config", {}) or {}
    val_cfg = cfg.get("validation", {}) or {}
    min_dur = float(val_cfg.get("min_sample_duration_secs", 1.0))
    max_dur = float(val_cfg.get("max_sample_duration_secs", 60.0))
    min_snr = float(val_cfg.get("min_snr_db", 15.0))
    max_silence = float(val_cfg.get("max_silence_ratio", 0.30))
    min_accepted = int(val_cfg.get("min_accepted_samples", 3))
    sample_loss_every = int(cfg.get("sample_loss_every", sample_loss_every))

    try:
        post_callback({"job_id": job_id, "phase": "validating", "progress": 0.0, "loss_curve_append": []})
        validation = validate_dataset(
            request.get("samples", []),
            min_duration=min_dur,
            max_duration=max_dur,
            min_snr_db=min_snr,
            max_silence_ratio=max_silence,
        )
        post_callback(
            {
                "job_id": job_id,
                "phase": "preparing",
                "progress": 0.0,
                "loss_curve_append": [],
                "validation": _validation_to_dict(validation),
            }
        )
        if validation.accepted < min_accepted:
            post_callback(
                {
                    "job_id": job_id,
                    "phase": "failed",
                    "progress": 0.0,
                    "loss_curve_append": [],
                    "validation": _validation_to_dict(validation),
                    "error": (
                        f"Dataset has only {validation.accepted} usable samples; "
                        f"need >= {min_accepted} for training to be meaningful "
                        f"(settings.training.validation.min_accepted_samples)."
                    ),
                }
            )
            return

        adapter_dir.mkdir(parents=True, exist_ok=True)
        loss_buffer: list[float] = []
        start = time.time()
        for step in range(target_steps):
            if _is_cancelled(job_id):
                post_callback(
                    {
                        "job_id": job_id,
                        "phase": "cancelled",
                        "progress": step / target_steps,
                        "loss_curve_append": loss_buffer,
                    }
                )
                return
            loss = train_step(step, request)
            loss_buffer.append(loss)
            if (step + 1) % sample_loss_every == 0 or step == target_steps - 1:
                elapsed = time.time() - start
                eta = (
                    int(elapsed * (target_steps - step - 1) / max(step + 1, 1))
                    if step > 0
                    else None
                )
                post_callback(
                    {
                        "job_id": job_id,
                        "phase": "running",
                        "progress": (step + 1) / target_steps,
                        "loss_curve_append": loss_buffer,
                        "eta_seconds": eta,
                    }
                )
                loss_buffer = []

        adapter_path = adapter_dir / "weights.safetensors"
        config_path = adapter_dir / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "engine": request.get("engine"),
                    "name": request.get("name"),
                    "epochs": request.get("epochs"),
                    "learning_rate": request.get("learning_rate"),
                    "base_voice": request.get("base_voice"),
                    "target_steps": target_steps,
                    "final_loss": loss_buffer[-1] if loss_buffer else 0.0,
                },
                indent=2,
            )
        )

        post_callback(
            {
                "job_id": job_id,
                "phase": "completed",
                "progress": 1.0,
                "loss_curve_append": loss_buffer,
                "adapter_path": (
                    str(adapter_path.relative_to(adapter_dir.parent.parent))
                    if adapter_path.exists()
                    else None
                ),
            }
        )
    except Exception as e:
        post_callback(
            {
                "job_id": job_id,
                "phase": "failed",
                "progress": 0.0,
                "loss_curve_append": [],
                "error": f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            }
        )
    finally:
        _clear_cancel(job_id)


def start_in_background(
    job_id: str,
    request: dict,
    *,
    adapter_dir: Path,
    train_step: Callable[[int, dict], float],
    target_steps: int,
) -> None:
    """Spawn run_training_job on a daemon thread. Returns immediately."""
    t = threading.Thread(
        target=run_training_job,
        args=(job_id, request),
        kwargs={
            "adapter_dir": adapter_dir,
            "train_step": train_step,
            "target_steps": target_steps,
        },
        daemon=True,
    )
    t.start()
