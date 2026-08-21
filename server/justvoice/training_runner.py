# SPDX-License-Identifier: MIT
"""Host-owned LoRA training runs — one subprocess per job.

Managed engines live in subprocess procs the registry never holds, and a
training run needs the whole GPU, so training is a host concern, not an
adapter method:

    training_api → start() → dataset on disk → evict every loaded engine
      → spawn the engine's trainer script inside the engine's own
        environment → tail JSON-lines progress into the training registry
      → on success, mint the trained Voice (source="lora", adapter_path)

Per-engine trainer scripts, each an attributed adaptation of a
code-verified upstream recipe:

    qwen3       engines/qwen3/train_lora.py       (Alexandria, MIT)
    chatterbox  engines/chatterbox/train_lora.py  (gokhaneraslan, Apache-2.0)

The trainer contract: argv[1] is a JSON job-config path; stdout is one JSON
object per line —
    {"event":"phase","phase":"preparing"}
    {"event":"validation","accepted":N,"rejected":M,"reports":[...],"usable_seconds":S}
    {"event":"progress","progress":0.42,"loss":2.31,"eta_seconds":800}
    {"event":"completed","adapter_path":"...","final_loss":0.281}
    {"event":"error","message":"..."}
— and exit 0 exactly when a `completed` event was emitted.

Cancel kills the whole process tree: on Windows the spawned python can be a
launcher shim whose real interpreter is a child (the 2026-08-14 finding), so
a bare kill() would orphan the training loop on the GPU.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import subprocess
import threading
import wave
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from .engines.capability_details import lookup as lookup_capability
from .storage.training_jobs import JOB_LOG_CAP
from .engines.manager import (
    ENGINES_DIR,
    _venv_python,
    engines_runtime_root,
    get_manager,
)

log = logging.getLogger("justvoice.training")

# The job log ring is bounded by the store that owns it
# (storage.training_jobs.JOB_LOG_CAP, imported with the other locals).
_LOG_FLUSH_EVERY = 10


@dataclass(frozen=True)
class TrainerSpec:
    script: Path
    default_variant: str


ENGINE_SPECS: dict[str, TrainerSpec] = {
    "qwen3": TrainerSpec(
        script=ENGINES_DIR / "qwen3" / "train_lora.py",
        default_variant="qwen3-base-1.7b",
    ),
    "chatterbox": TrainerSpec(
        script=ENGINES_DIR / "chatterbox" / "train_lora.py",
        default_variant="chatterbox-turbo-v1",
    ),
}


def supports(engine_id: str) -> bool:
    return engine_id in ENGINE_SPECS


def default_variant(engine_id: str) -> str | None:
    spec = ENGINE_SPECS.get(engine_id)
    return spec.default_variant if spec else None


# job_id → (Popen, cancelled-flag)
_RUNS: dict[str, tuple[subprocess.Popen, threading.Event]] = {}
_RUNS_LOCK = threading.Lock()


def _python_for(engine_id: str) -> Path:
    """The engine's own interpreter.

    There is no fallback any more: since 2026-08-22 every engine has its own
    venv, so a missing one means the engine is not installed and training has
    nothing to run in. The old fallback pointed at the shared venv — which is
    also why LoRA training could be started against an environment that had
    never installed `peft`.
    """
    return _venv_python(engines_runtime_root() / engine_id / ".venv")


def _wav_seconds(wav_bytes: bytes) -> float:
    try:
        with wave.open(BytesIO(wav_bytes)) as w:
            rate = w.getframerate() or 1
            return w.getnframes() / float(rate)
    except Exception:
        return 0.0


def start(job_id: str, engine_id: str, request: dict) -> None:
    """Write the dataset, evict engines, spawn the trainer, tail progress.

    Raises LookupError / ValueError for user-fixable problems (they become
    400s); anything after the spawn reports through the registry instead.
    """
    from .app_state import get_state

    st = get_state()
    spec = ENGINE_SPECS.get(engine_id)
    if spec is None:
        raise LookupError(f"engine '{engine_id}' has no trainer")
    if not spec.script.exists():
        raise LookupError(f"trainer script missing: {spec.script}")

    variant = request.get("variant") or spec.default_variant
    cap = lookup_capability(variant)
    if cap is None or not cap.supports_training:
        raise LookupError(f"variant '{variant}' does not support fine-tuning")
    defaults = cap.training_defaults

    # The base checkpoint must already be on disk — training never triggers
    # a multi-GB download as a side effect.
    from . import speech_cache

    if not speech_cache.variant_on_disk(st.data_dir, engine_id, variant):
        raise LookupError(
            f"the {variant} checkpoint is not downloaded — install it in "
            f"Engines first"
        )
    model_dir = Path(speech_cache.variant_dir(st.data_dir, engine_id, variant))

    # ── Dataset on disk: WAVs + metadata.jsonl (audio_filepath / text) ──
    samples = request.get("samples") or []
    job_dir = Path(st.data_dir) / "training" / job_id
    dataset_dir = job_dir / "dataset"
    output_dir = job_dir / "adapter"
    dataset_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    longest: tuple[float, str, str] | None = None  # (seconds, filename, text)
    dataset_id = request.get("dataset_id")
    ref_index = request.get("ref_index")
    if dataset_id:
        # A saved dataset: copy its files in (copy, not reference — ref.wav
        # is written beside the clips and must not mutate the stored set).
        # copy_into plants ref.wav/ref_text.txt when the dataset names a
        # reference clip, or when this run overrides it.
        from .storage import training_datasets

        training_datasets.copy_into(
            Path(st.data_dir), dataset_id, dataset_dir, ref_index=ref_index
        )
        for line in (dataset_dir / "metadata.jsonl").read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
                name, text = row["audio_filepath"], (row.get("text") or "").strip()
                secs = _wav_seconds((dataset_dir / name).read_bytes())
            except Exception:
                continue
            if longest is None or secs > longest[0]:
                longest = (secs, name, text)
    else:
        chosen: tuple[str, str] | None = None  # (filename, text)
        with open(dataset_dir / "metadata.jsonl", "w", encoding="utf-8") as meta:
            for i, s in enumerate(samples):
                try:
                    wav = base64.b64decode(s["wav_b64"])
                except Exception as e:
                    raise ValueError(f"sample {i}: invalid base64 ({e})")
                name = f"sample_{i:04d}.wav"
                (dataset_dir / name).write_bytes(wav)
                text = (s.get("transcript") or "").strip()
                meta.write(json.dumps({"audio_filepath": name, "text": text}) + "\n")
                secs = _wav_seconds(wav)
                if i == ref_index:
                    chosen = (name, text)
                if longest is None or secs > longest[0]:
                    longest = (secs, name, text)
        if chosen is not None:
            longest = (0.0, chosen[0], chosen[1])

    # The reference clip (x-vector anchor) — the voice's identity: the
    # speaker embedding is extracted from it before training AND it is
    # replayed as the voice prompt on every later render (the trainer
    # copies it beside the adapter as ref_sample.wav). An explicit choice
    # wins; the longest clip is only the fallback for nobody choosing.
    #
    # For a saved dataset, copy_into already planted ref.wav/ref_text.txt
    # from the dataset's own choice, so only write the fallback here when
    # it did not.
    if longest is not None and not (dataset_dir / "ref.wav").is_file():
        (dataset_dir / "ref.wav").write_bytes(
            (dataset_dir / longest[1]).read_bytes()
        )
        (dataset_dir / "ref_text.txt").write_text(longest[2], encoding="utf-8")

    config = {
        "job_id": job_id,
        "engine": engine_id,
        "variant": variant,
        "model_dir": str(model_dir),
        "dataset_dir": str(dataset_dir),
        "output_dir": str(output_dir),
        "language": request.get("language"),
        "epochs": request.get("epochs") or (defaults.epochs if defaults else None),
        "learning_rate": request.get("learning_rate")
        or (defaults.learning_rate if defaults else None),
        "batch_size": request.get("batch_size")
        or (defaults.batch_size if defaults else None),
        "grad_accum": request.get("grad_accum")
        or (defaults.grad_accum if defaults else None),
        "lora_rank": request.get("lora_rank")
        or (defaults.lora_rank if defaults else None),
        "lora_alpha": request.get("lora_alpha")
        or (defaults.lora_alpha if defaults else None),
        "precision": defaults.precision if defaults else None,
        "target_modules": list(defaults.target_modules) if defaults else [],
    }
    config_path = job_dir / "job.json"
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    # ── The whole card: every loaded speech engine unloads first. ──
    try:
        get_manager().unload(None)
    except Exception:
        log.warning("engine eviction before training failed", exc_info=True)

    python = _python_for(engine_id)
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.Popen(
        [str(python), str(spec.script), str(config_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(spec.script.parent),
        env=env,
    )
    cancelled = threading.Event()
    with _RUNS_LOCK:
        _RUNS[job_id] = (proc, cancelled)
    threading.Thread(
        target=_tail, args=(job_id, proc, cancelled), daemon=True,
        name=f"train-{job_id[:12]}",
    ).start()


def cancel(job_id: str) -> bool:
    with _RUNS_LOCK:
        run = _RUNS.get(job_id)
    if not run:
        return False
    proc, cancelled = run
    cancelled.set()
    _kill_tree(proc)
    return True


def _kill_tree(proc: subprocess.Popen) -> None:
    try:
        import psutil

        root = psutil.Process(proc.pid)
        for child in root.children(recursive=True):
            try:
                child.kill()
            except Exception:
                pass
        root.kill()
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _tail(job_id: str, proc: subprocess.Popen, cancelled: threading.Event) -> None:
    from .app_state import get_state

    st = get_state()
    tail_lines: list[str] = []
    completed: dict | None = None
    # Trainer chatter destined for the job's log window. Buffered rather
    # than written per line: a run emits thousands of lines and a store
    # write each would be the dominant cost of training.
    pending: list[str] = []

    def flush_logs() -> None:
        if not pending:
            return
        job = st.training.get(job_id)
        existing = list(job.logs) if job else []
        st.training.update(job_id, logs=(existing + pending)[-JOB_LOG_CAP:])
        pending.clear()

    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.strip()
        if not line:
            continue
        tail_lines.append(line)
        del tail_lines[:-30]
        try:
            event = json.loads(line)
        except ValueError:
            # Trainer chatter — the [DATA]/[TRAIN]/[DONE] prints. This is
            # the only narrative of what a run is doing; a progress bar
            # cannot say WHY a run stalled or which clip it rejected.
            pending.append(line)
            if len(pending) >= _LOG_FLUSH_EVERY:
                flush_logs()
            continue
        kind = event.get("event")
        try:
            if kind == "phase":
                st.training.update(job_id, phase=event.get("phase"))
            elif kind == "validation":
                from .models import DatasetValidation

                st.training.update(
                    job_id,
                    phase="preparing",
                    validation=DatasetValidation(
                        accepted=int(event.get("accepted") or 0),
                        rejected=int(event.get("rejected") or 0),
                        reports=event.get("reports") or [],
                        usable_seconds=float(event.get("usable_seconds") or 0.0),
                    ),
                )
            elif kind == "progress":
                job = st.training.get(job_id)
                curve = list(job.loss_curve) if job else []
                if event.get("loss") is not None:
                    curve.append(float(event["loss"]))
                st.training.update(
                    job_id,
                    phase="running",
                    progress=float(event.get("progress") or 0.0),
                    loss_curve=curve,
                    eta_seconds=event.get("eta_seconds"),
                )
            elif kind == "completed":
                completed = event
            elif kind == "error":
                st.training.update(job_id, error=str(event.get("message") or ""))
            # A recognised event is a milestone — flush what led up to it
            # so the log window and the progress bar never disagree.
            flush_logs()
        except Exception:
            log.warning("training event handling failed: %s", line, exc_info=True)

    flush_logs()
    rc = proc.wait()
    with _RUNS_LOCK:
        _RUNS.pop(job_id, None)

    if cancelled.is_set():
        st.training.update(job_id, phase="cancelled")
        return
    if rc == 0 and completed is not None:
        _mint_trained_voice(job_id, completed)
        return
    job = st.training.get(job_id)
    detail = (job.error if job and job.error else "") or "; ".join(tail_lines[-5:])
    st.training.update(
        job_id, phase="failed",
        error=f"trainer exited {rc}: {detail}"[:2000],
    )


def _mint_trained_voice(job_id: str, completed: dict) -> None:
    from datetime import datetime, timezone

    from .app_state import get_state
    from .models import VoiceRecord

    st = get_state()
    job = st.training.get(job_id)
    if job is None:
        return
    now = datetime.now(timezone.utc)
    rec = VoiceRecord(
        id="",
        engine=job.engine,
        source="lora",
        name=job.voice_name,
        language=st.settings.get().training.default_voice_language,
        adapter_path=completed.get("adapter_path"),
        training_job_id=job_id,
        created_at=now,
        updated_at=now,
    )
    created = st.voices.create(rec)
    st.training.update(
        job_id, phase="completed", progress=1.0, final_voice_id=created.id,
    )
