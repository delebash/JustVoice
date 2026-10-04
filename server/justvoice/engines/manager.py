"""Speech engine manager — discovery, the runtime install, per-kind slots, memory.

Each engine lives in `server/justvoice/engines/<id>/` as a catalog: `manifest.py`
(metadata, capabilities, and the model VARIANTS with their pinned GGUF files). Every
variant's models run in the ONE audio.cpp speech runtime (`engines/audiocpp/`, the
2026-10-01 switch — docs/plans/2026-10-01-audiocpp-switch.md):

On Install: the runtime binary for this machine (+ eSpeak NG) — once, for every engine.
On Download: the variant's file(s) into the speech cache (`speech_cache.py`).
On Load: the model's PLACEMENT is decided — the graphics card or the CPU, per model, Auto
  from what was measured (`placement_for`, docs/plans/2026-10-02-cpu-placement.md §8) — the
  runtime process for that placement is (re)started with every downloaded model in its
  config, and the slot (`audiocpp/slot.py: AudioCppSlot`) warms the chosen model. One slot
  per kind (tts / stt), the kit's VRAM arbiter books each kind's measured share (a CPU-placed
  model books nothing on a discrete card).
On Synth / Transcribe / Align: the slot maps our request onto audio.cpp's HTTP API.
On Uninstall: the engine's downloaded models are deleted; the runtime stays.

Until 2026-10-01 each engine was a Python subprocess in its own uv-built venv; that
machinery is gone, and voice training with it (removed 2026-10-02).
"""

from __future__ import annotations

import atexit
import logging
import os
import shutil
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from .audiocpp.slot import AudioCppSlot

log = logging.getLogger(__name__)


# ─── Constants ────────────────────────────────────────────────────────


ENGINES_DIR = Path(__file__).resolve().parent


def engines_runtime_root() -> Path:
    """Where engine MUTABLE state lives — the speech runtime's builds and eSpeak NG
    (`<root>/audiocpp/…`).

    Unfrozen this is `ENGINES_DIR` itself: the source tree is writable and
    everything stays beside the code it belongs to (.gitignore keeps it out of git).

    Frozen it CANNOT be. A PyInstaller build unpacks `justvoice/engines/`
    into the bundle, which is read-only in `--onedir` and a per-run temp
    directory in `--onefile`. Frozen therefore roots under the data dir the user
    chose: `<data_dir>/engines-runtime` — deliberately SHORT, because Windows still
    caps most path APIs at 260 characters.
    """
    if not getattr(sys, "frozen", False):
        return ENGINES_DIR
    from ..paths import default_data_dir

    return default_data_dir() / "engines-runtime"


# Folder names that aren't engines — skip during discovery.
NOT_ENGINES = {"__pycache__", "__init__", "base", "catalog", "factory", "registry", "model_catalog",
               "kokoro_voices", "_torch_helpers", "external_openai", "audiocpp"}

# The speech measured currency (the 2026-08-13/14 redesign, amended —
# docs/plans/2026-08-13-speech-catalog-redesign.md §10). The probes can
# shell out (nvidia-smi / typeperf), so every polling/per-line caller goes
# through a short TTL cache. There is NO pre-load estimate constant: the
# only numbers in the pricing chain are measured ones.
PROBE_TTL_S = 2.0


@contextmanager
def _kind_busy(kind: str):
    """Mark the arbiter's `kind` busy for the block (Q1's never-evict-busy —
    the 2026-08-13 VRAM wiring, step 4). Best-effort: without the shared stack
    there is no ledger and nothing to protect."""
    try:
        from llm_runner.runner.arbiter import get_arbiter

        arb = get_arbiter()
    except Exception:  # noqa: BLE001
        arb = None
    if arb is not None:
        arb.busy_begin(kind)
    try:
        yield
    finally:
        if arb is not None:
            arb.busy_end(kind)


def _current_os_label() -> str:
    """Normalised OS string used by manifests' SUPPORTED_OSES lists."""
    if sys.platform == "win32":
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


# ─── Manifest loading ─────────────────────────────────────────────────


class EngineManifest:
    """Lightweight wrapper around an engine's manifest.py module."""

    def __init__(self, engine_dir: Path, module: Any):
        self.engine_dir = engine_dir
        self.module = module

    @property
    def id(self) -> str:
        return getattr(self.module, "ID", self.engine_dir.name)

    @property
    def name(self) -> str:
        return getattr(self.module, "NAME", self.id)

    @property
    def description(self) -> str:
        return getattr(self.module, "DESCRIPTION", "")

    @property
    def license(self) -> str:
        return getattr(self.module, "LICENSE", "")

    @property
    def weights_license(self) -> str:
        """Model-weights license — distinct from the framework code license.
        Falls back to LICENSE when WEIGHTS_LICENSE is unset."""
        return getattr(self.module, "WEIGHTS_LICENSE", "") or getattr(self.module, "LICENSE", "")

    @property
    def kind(self) -> str:
        """Phase 2 / Slice 1 — engine discriminator. Defaults to "tts"."""
        return self.kinds[0]

    @property
    def kinds(self) -> list[str]:
        """Engines redesign: multi-capability engines declare
        KINDS = ["tts", "stt"]; single-capability manifests keep KIND.
        Always non-empty; kinds[0] is the primary (slot + section)."""
        ks = getattr(self.module, "KINDS", None)
        if isinstance(ks, (list, tuple)) and ks:
            return [str(k) for k in ks]
        return [getattr(self.module, "KIND", "tts")]

    @property
    def capabilities(self) -> dict[str, bool]:
        return getattr(self.module, "CAPABILITIES", {})

    @property
    def requirements(self) -> dict[str, Any]:
        return getattr(self.module, "REQUIREMENTS", {})

    @property
    def static_voices(self) -> list[dict[str, Any]]:
        """Voices the engine ships statically — exposed to the host catalog
        even when the engine isn't loaded. Cloning-based engines leave this
        empty; their voices are user-created and stored host-side.
        """
        return getattr(self.module, "STATIC_VOICES", [])

    @property
    def default_variant_id(self) -> str | None:
        """The model variant `/v1/engines/<id>/load` loads when no variant is
        specified (the user's Set-as-default choice is layered over it by
        `EngineManager._resolved_default_variant`)."""
        return getattr(self.module, "DEFAULT_VARIANT_ID", None)

    @property
    def isolation(self) -> str:
        """Always "audiocpp": every engine's models run in the one shared speech
        runtime (the 2026-10-01 switch). The UI reads it to show the runtime row
        instead of a per-engine Install. Until 2026-10-01 the answer was "venv" —
        each engine its own Python environment."""
        return "audiocpp"

    @property
    def supported_oses(self) -> list[str]:
        """OSes this engine can run on. Values: "windows" | "linux" | "macos".

        ENFORCED AT `install_engine()`. The catalog still LISTS a blocked engine;
        `EngineInfo.supported_on_this_os` carries the verdict so the UI can show
        why. Every shipped manifest declares explicitly — `test_os_gate.py` fails
        if a new one forgets."""
        return getattr(self.module, "SUPPORTED_OSES", ["windows", "linux", "macos"])

    @property
    def deprecated(self) -> str:
        """Non-empty = marked for removal. The string is the user-facing why.
        The catalog hides it while it is uninstalled; Voice engine setup never
        offers it."""
        return getattr(self.module, "DEPRECATED", "") or ""

    def supports_current_os(self) -> bool:
        """True if this engine declares support for the host's OS."""
        return _current_os_label() in self.supported_oses

    @property
    def uses_audiocpp(self) -> bool:
        """True when this engine's models run in the audio.cpp runtime (every variant row
        carries an `audiocpp` block — docs/plans/2026-10-01-audiocpp-switch.md)."""
        rows = getattr(self.module, "VARIANTS", None) or []
        return bool(rows) and all(r.get("audiocpp") for r in rows)

    @property
    def is_installed(self) -> bool:
        """True when this engine can run: the shared speech runtime is installed for
        the configured backend. Its models download separately, into the speech
        cache, and a Load fetches a missing one first."""
        from .audiocpp.runtime import installed_exe

        return installed_exe() is not None


def discover_engines() -> dict[str, EngineManifest]:
    """Scan engines/*/ for manifest.py and load each. Returns id → manifest.

    Uses regular `importlib.import_module` (not spec_from_file_location) so
    each engine package's `__init__.py` runs and relative imports inside
    `manifest.py` (e.g. `from .voices import ...`) resolve correctly.
    """
    import importlib

    out: dict[str, EngineManifest] = {}
    for child in sorted(ENGINES_DIR.iterdir()):
        if not child.is_dir():
            continue
        if child.name in NOT_ENGINES or child.name.startswith("_"):
            continue
        manifest_path = child / "manifest.py"
        if not manifest_path.is_file():
            continue
        if not (child / "__init__.py").is_file():
            log.warning("engine dir %s has manifest.py but no __init__.py — skipping", child)
            continue
        module_name = f"justvoice.engines.{child.name}.manifest"
        try:
            # Always re-import so manifest edits are picked up on refresh.
            if module_name in importlib.sys.modules:
                mod = importlib.reload(importlib.sys.modules[module_name])
            else:
                mod = importlib.import_module(module_name)
            manifest = EngineManifest(child, mod)
            out[manifest.id] = manifest
            log.info("discovered engine: %s (%s)", manifest.id, manifest.name)
        except Exception as e:
            log.exception("failed to load manifest %s: %s", module_name, e)
    return out


# ─── Install ──────────────────────────────────────────────────────────


class InstallError(RuntimeError):
    pass


class TermsRequired(RuntimeError):
    """An engine refused a use its own terms gate until the user accepts them (manifest
    TERMS — Pocket TTS cloning, decided 2026-10-02). The API answers 403 with
    `code: terms_required` and the engine id, so the app can show the terms."""

    def __init__(self, engine_id: str, message: str):
        super().__init__(message)
        self.engine_id = engine_id

    def api_error(self):
        """The 403 problem the app keys on: type `…/terms-required`, plus the engine."""
        from ..errors import ApiError

        return ApiError(403, "terms-required", "Terms not accepted", str(self),
                        extra={"engine": self.engine_id})


def _wav_seconds(data: bytes) -> float | None:
    """A WAV's duration from its RIFF header — data bytes / byte rate, so any sample
    format reads. None when the bytes are not a WAV this can walk."""
    import struct

    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    i, rate, size = 12, None, None
    while i + 8 <= len(data):
        cid, n = data[i:i + 4], struct.unpack("<I", data[i + 4:i + 8])[0]
        if cid == b"fmt " and i + 20 <= len(data):
            rate = struct.unpack("<I", data[i + 16:i + 20])[0]
        elif cid == b"data":
            size = min(n, len(data) - i - 8)
            break
        i += 8 + n + (n & 1)
    return size / rate if rate and size else None


def memory_in_use_mb() -> int | None:
    """Memory in use on the pool models load into (the GPU on a discrete box),
    read fresh — the kit's one door, a single fast device query. For the
    load log lines; None = unmeasurable."""
    try:
        from llm_runner.runner.hardware import used_pool_mb

        return used_pool_mb(fresh=True)
    except Exception:  # noqa: BLE001 — measuring is informative only
        return None


def _mb(v: int | None) -> str:
    return "?" if v is None else str(v)


def install_engine(
    manifest: EngineManifest,
    progress: Callable[[str, str | None], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
    on_bytes: Callable[[int, int | None], None] | None = None,
) -> None:
    """Install an engine — which, since the 2026-10-01 switch, means installing the
    ONE speech runtime every engine shares (idempotent: a second engine finds it there).

    Refuses outright when the manifest does not declare the host OS. This is THE os
    gate; see `EngineManifest.supported_oses`.
    """
    if not manifest.supports_current_os():
        raise InstallError(
            f"{manifest.id} does not support {_current_os_label()} — "
            f"the manifest declares {', '.join(manifest.supported_oses)}."
        )
    _install_audiocpp_runtime(progress, cancel_check, on_bytes)


def _install_audiocpp_runtime(
    progress: Callable[[str, str | None], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
    on_bytes: Callable[[int, int | None], None] | None = None,
) -> None:
    """Install the ONE speech runtime every audio.cpp engine shares: the pinned server
    build for this machine (the kit's verified acquisition), then eSpeak NG for Kokoro.
    Installing any engine installs it; a second engine finds it already there. Over an older
    pinned build it is the update: the old build runs until this finishes, then stops."""
    from .audiocpp import dev_build, espeak, release, runtime

    emit = progress or (lambda phase, line: None)
    if dev_build.current() is not None:
        # `npm run dev` runs our checkout's own build — nothing to download but eSpeak NG.
        emit("installing", "eSpeak NG (Kokoro's pronunciation)")
        try:
            espeak.install(engines_runtime_root())
        except Exception as e:  # noqa: BLE001
            raise InstallError(f"eSpeak NG install failed: {e}") from e
        runtime.forget_installed()
        emit("done", "speech runtime ready (development build)")
        return
    last = {"mb": -1}

    def _prog(done: int, total: int | None) -> None:
        if on_bytes is not None:
            on_bytes(done, total)   # the job's bytes — the runtime row's bar (decided 2026-10-03)
        mb = done // (1024 * 1024)
        if mb // 16 != last["mb"]:
            last["mb"] = mb // 16
            emit("downloading", f"speech runtime: {mb} MB"
                 + (f" of {total // (1024 * 1024)} MB" if total else ""))

    emit("downloading", "speech runtime (audio.cpp)")
    # An older pinned build still runs until this finishes (the runtime row's "Update to …").
    was = runtime.installed_tag()
    replaced = runtime.installed_exe() if was is not None and was != release.TAG else None
    try:
        runtime.install(on_progress=_prog, cancel_check=cancel_check)
    except Exception as e:  # noqa: BLE001 — every failure is the install's answer
        if "cancel" in str(e).lower() or type(e).__name__ == "DownloadCancelled":
            raise InstallError("cancelled by user") from e
        raise InstallError(f"speech runtime install failed: {e}") from e
    emit("installing", "eSpeak NG (Kokoro's pronunciation)")
    try:
        espeak.install(engines_runtime_root())
    except Exception as e:  # noqa: BLE001
        raise InstallError(f"eSpeak NG install failed: {e}") from e
    runtime.forget_installed()
    if was is not None and was != release.TAG:
        # An update: the processes still run the older build. Free the speech slots (their
        # bookings go with them) and stop both, so the next load starts the pinned build —
        # the same as changing the backend (speech_runtime_api.set_speech_runtime).
        stop_speech_runtime()
        log.info("speech runtime updated %s → %s; both processes stopped", was, release.TAG)
        if replaced is not None:
            _remove_replaced_build(replaced.parent, was)
    emit("done", "speech runtime ready")


def stop_speech_runtime() -> None:
    """Free every speech slot the runtime holds (their bookings go with them) and stop all of
    its processes, so the next load starts them again — after an update, or once the Japanese
    dictionary is installed (the processes read its folder when they start)."""
    from .audiocpp import runtime

    mgr = get_manager()
    for kind in ("tts", "stt"):
        slot = mgr.loaded_for(kind)
        if slot is not None and getattr(slot.manifest, "uses_audiocpp", False):
            mgr.unload(kind)
    runtime.shutdown_server()


def install_japanese_dictionary(
    on_bytes: Callable[[int, int | None], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> Path:
    """The optional Japanese dictionary (gap 7), then a runtime restart if it was running, so
    the processes start again with its folder."""
    from .audiocpp import japanese, runtime

    root = japanese.install(engines_runtime_root(), on_progress=on_bytes, cancel_check=cancel_check)
    if any(srv.is_running() for srv in runtime.servers()):
        stop_speech_runtime()
    return root


def _remove_replaced_build(build_dir: Path, tag: str) -> None:
    """After an update the older build is never run again, so its folder goes — 2 GB for a CUDA
    build (decided 2026-10-03). Only the build the update replaced: another backend's build of
    that release keeps working until it is updated. The release's folder goes once empty."""
    from .audiocpp import runtime

    root = runtime._runtime_root().resolve()
    build_dir = build_dir.resolve()
    if build_dir.parent.name != tag or root not in build_dir.parents:
        log.warning("not removing %s: not an older speech runtime build under %s", build_dir, root)
        return
    for attempt in range(5):
        try:
            shutil.rmtree(build_dir)
            break
        except FileNotFoundError:
            break
        except OSError as e:
            if attempt == 4:   # the stopped process can hold its DLLs for a moment
                log.warning("could not remove the older speech runtime %s: %s", build_dir, e)
                return
            time.sleep(1)
    log.info("removed the older speech runtime build %s", build_dir)
    try:
        if not any(build_dir.parent.iterdir()):
            build_dir.parent.rmdir()
    except OSError:
        pass


# ─── Manager ──────────────────────────────────────────────────────────


def _runtime_build() -> str:
    """The speech runtime build a measurement belongs to: the installed release's tag, or
    `npm run dev`'s own build ("dev · <commit>"). "" when there is none."""
    try:
        from .audiocpp import dev_build, runtime

        dev = dev_build.current()
        return dev.version if dev is not None else (runtime.installed_tag() or "")
    except Exception:  # noqa: BLE001 — bare tests
        return ""


def _new_slot(m: EngineManifest, placement: str = "gpu") -> AudioCppSlot:
    """The slot a load fills: one model in the speech runtime's process for `placement`
    ("gpu" | "cpu") and the engine's kind. The one seam tests swap for a fake (it was the
    `EngineProcess` class until 2026-10-01)."""
    from .audiocpp.slot import AudioCppSlot

    return AudioCppSlot(m, placement)


def _x(v: float) -> str:
    """A real-time factor the way the rows say it: 3.2×, 12×."""
    return f"{v:.1f}×" if v < 10 else f"{v:.0f}×"


class EngineManager:
    """Top-level manager. One process per `kind` slot loaded at a time
    (Phase 2 / Slice 1 — was a single _current slot pre-Profile-kill).

    Slots map: kind ("tts" | "stt") → AudioCppSlot (a model in the shared
    speech runtime — until 2026-10-01, an engine subprocess). Loading
    a new engine of the same kind unloads the prior occupant of THAT slot;
    other kinds stay loaded. Required for speaker attribution (needs LLM
    + TTS resident simultaneously) and similar mixed-kind workflows.

    `_current` is kept as a back-compat alias pointing at the TTS slot so
    callers that haven't been ported to the kind-aware API (current_id(),
    _require_current(), synth()) keep working.
    """

    def __init__(self):
        self._manifests: dict[str, EngineManifest] = {}
        # Per-kind slot map (Phase 2 / Slice 1).
        self._loaded: dict[str, AudioCppSlot] = {}
        # Per-engine last loaded variant — surfaced as EngineInfo.current_variant_id
        # so the UI shows server truth not local-state.
        self._current_variants: dict[str, str] = {}
        self._lock = threading.RLock()
        # Engine ids the client has requested to cancel-load. Checked by
        # `cancel_check` callbacks inside `load()`. Adds are made by the
        # `/v1/engines/{id}/cancel-load` endpoint; entries are removed at
        # the end of `load()` (whether the cancel landed in time or not).
        self._cancel_load_requests: set[str] = set()
        # Per-kind activity locks — held around an engine's in-flight synth /
        # transcribe HTTP call, and by load/unload around terminating a slot's
        # occupant. Guarantees a load can never kill an engine process
        # mid-line now that endpoints await instead of blocking the event
        # loop (§7b P2-6 of docs/plans/2026-08-08-vram-think.md). Lock
        # order: activity → self._lock, never the reverse.
        self._activity_locks: dict[str, threading.Lock] = {}
        # The 2026-08-13 VRAM wiring: engine_id → the device its last confirmed
        # load actually resolved to (Q2: always visible, never hidden), and the
        # once-per-process kit hardware snapshot the device policy + admission
        # read (None until first use; detect shells out to nvidia-smi).
        self._resolved_devices: dict[str, str] = {}
        # Why each loaded engine runs where it does (CPU placement, 2026-10-02) — the
        # Speech engines row says it. engine_id → the reason clause.
        self._placement_reasons: dict[str, str] = {}
        self._hw_cache = None
        self._hw_detected = False
        # The measured true-up's probe TTL cache: key → (monotonic ts, value).
        # Keys: "pool" (device-wide used) and "pid:<n>" (one engine process).
        self._probe_cache: dict[str, tuple[float, int | None]] = {}
        self.refresh_manifests()

    # ─── Per-kind slot helpers (Phase 2 / Slice 1) ────────────────────

    @property
    def _current(self) -> AudioCppSlot | None:
        """Back-compat alias for callers that haven't been ported to the
        kind-aware API. Returns the TTS slot's process or None."""
        return self._loaded.get("tts")

    @_current.setter
    def _current(self, proc: AudioCppSlot | None) -> None:
        if proc is None:
            self._loaded.pop("tts", None)
        else:
            self._loaded["tts"] = proc

    def loaded_for(self, kind: str) -> AudioCppSlot | None:
        """The kind's loaded slot, or None. A slot whose model died with its process (a crash, a
        restart) is dropped here WITH its booking — before 2026-10-04 it stayed booked, and a
        reload of the same engine was refused against its own ghost (audit §5 C1)."""
        with self._lock:
            proc = self._loaded.get(kind)
            if proc is None or proc.is_alive():
                return proc
            if getattr(proc, "is_dead", lambda: False)():
                self._drop_dead_slot(kind, proc)
            return None

    def _drop_dead_slot(self, kind: str, proc) -> None:
        """Forget a slot whose model is gone, and free its booking (self._lock held; the
        arbiter's lock is a leaf — `make_room` never holds it while it evicts)."""
        engine_id = proc.manifest.id
        log.warning("the %s model %s is no longer loaded — its runtime process stopped",
                    kind, engine_id)
        self._loaded.pop(kind, None)
        self._current_variants.pop(engine_id, None)
        self._resolved_devices.pop(engine_id, None)
        self._placement_reasons.pop(engine_id, None)
        self._release_engine(kind, engine_id)

    def current_for(self, kind: str) -> str | None:
        proc = self.loaded_for(kind)
        return proc.manifest.id if proc else None

    def _activity(self, kind: str) -> threading.Lock:
        """The kind's activity lock (see __init__). Created on first use."""
        with self._lock:
            lock = self._activity_locks.get(kind)
            if lock is None:
                lock = threading.Lock()
                self._activity_locks[kind] = lock
            return lock

    # ─── VRAM arbitration (the 2026-08-13 wiring — vram-think §6 step 3) ──
    #
    # The manager joins the kit's process-wide VramArbiter (the shared ledger
    # the bundled LLM runner already runs): device resolves HERE (the one load
    # door), a booking load admits via the shared `make_room`, a confirmed load
    # reserves with source="declared" (§13.1 — a manifest price never reads as
    # measured truth), and every unload path releases. All kit calls are
    # best-effort lazy imports so bare unit tests run without the shared stack.

    def _hardware(self):
        """The kit's hardware snapshot, detected once per process (it shells
        out to nvidia-smi). None when detection is unavailable — resolution
        then falls to CPU and admission books nothing."""
        if not self._hw_detected:
            self._hw_detected = True
            try:
                from llm_runner.runner.hardware import detect

                self._hw_cache = detect()
            except Exception:  # noqa: BLE001 — no kit / detect failure → honest CPU fallback
                self._hw_cache = None
        return self._hw_cache

    def _resolve_device(self, m: EngineManifest, requested: str | None) -> str:
        """Where a model runs: where the ONE speech runtime runs — the backend of its
        installed build (settings.engines.speech_runtime, the 2026-10-01 switch). That is
        what the engine card shows and what the memory booking reads ("cpu" books nothing
        on a discrete card). A per-call `requested` device has nothing to move and is
        ignored; it stays in the signature for the load API's shape.

        Until the switch this was Q2's ladder (decided 2026-08-08): an explicit request →
        the per-engine Device setting → the `cpu_adequate` auto policy."""
        from .audiocpp.runtime import backend_of, installed_exe

        exe = installed_exe()
        return backend_of(exe) if exe is not None else "cpu"

    # ── Placement: the graphics card or the CPU, per model (2026-10-02) ───────────
    # docs/plans/2026-10-02-cpu-placement.md §8. The user's choice per model (Auto / GPU /
    # CPU — engine_overrides[id].placements) and, for Auto, the decided order:
    #   1. the GPU when nothing else is on the card, or when the model's MEASURED
    #      graphics-memory size fits beside the AI model;
    #   2. else the CPU, when it speaks at least `cpu_min_realtime` (2×) real time there;
    #   3. else the GPU with the AI model unloaded first — the kit's eviction event, so
    #      the app's existing toast says so.
    # A model never measured on the card counts as not fitting while an AI model is on it
    # (decision 1, 2026-10-02) — no size is ever guessed.

    @staticmethod
    def _user_placement(engine_id: str, variant: str | None) -> str:
        """The user's choice for this model: "auto" | "gpu" | "cpu"."""
        try:
            from ..app_state import get_state

            ov = get_state().settings.get().engines.engine_overrides.get(engine_id)
            return ((ov.placements.get(variant or "") if ov else None) or "auto")
        except Exception:  # noqa: BLE001 — no state (bare tests / mid-boot) → Auto
            return "auto"

    @staticmethod
    def _variant_row(m, variant: str | None) -> dict | None:
        rows = getattr(getattr(m, "module", None), "VARIANTS", None) or []
        return next((r for r in rows if r.get("id") == variant), None)

    def cpu_speed(self, kind: str, engine_id: str, variant: str | None) -> tuple[float | None, bool]:
        """(seconds of audio per second of work on the CPU, measured on THIS machine?).
        The newest speed this machine recorded for the model, else the manifest's reference
        figure (§6), else (None, False) — never offered to the CPU by Auto."""
        try:
            from llm_runner.llm.stores import get_model_measurement_store
            from llm_runner.runner.hardware import current_machine_key

            mk = current_machine_key()
            for row in get_model_measurement_store().list(f"{kind}:{engine_id}:{variant or ''}"):
                if (row.machineKey == mk and row.source == "speed" and (row.backend or "") == "cpu"
                        and float(getattr(row, "realtimeX", 0) or 0) > 0):
                    return float(row.realtimeX), True
        except Exception:  # noqa: BLE001 — bare tests / store not wired
            pass
        ref = (self._variant_row(self.get_manifest(engine_id), variant) or {}).get("cpu_realtime")
        return (float(ref), False) if ref else (None, False)

    # ── The price: what a model takes, measured, at the length it is given (audit §13.3) ──

    def split_chars_for(self, engine_id: str, variant: str | None) -> int | None:
        """The longest piece a line reaches this model in: the user's size for it
        (`engine_overrides[id].split_chars[variant]`), else the catalog's (`split_chars` on the
        variant row), else None — no bound of its own. `line_split_chars` puts it under
        `generation.max_chunk_chars`."""
        try:
            from ..app_state import get_state

            ov = get_state().settings.get().engines.engine_overrides.get(engine_id)
            mine = int((ov.split_chars.get(variant or "") if ov else 0) or 0)
            if mine > 0:
                return mine
        except Exception:  # noqa: BLE001 — no state (bare tests / mid-boot) → the catalog's
            pass
        row = self._variant_row(self.get_manifest(engine_id), variant) or {}
        return int(row["split_chars"]) if row.get("split_chars") else None

    def effective_split(self, engine_id: str, variant: str | None) -> int:
        """The piece length this model actually gets — its split size under the global cap —
        and the one its price is measured at."""
        from ..audio.chunked import DEFAULT_MAX_CHUNK_CHARS

        cap = DEFAULT_MAX_CHUNK_CHARS
        try:
            from ..app_state import get_state

            cap = int(get_state().settings.get().generation.max_chunk_chars or cap)
        except Exception:  # noqa: BLE001
            pass
        split = self.split_chars_for(engine_id, variant)
        return min(cap, split) if split else cap

    def _price_mb(self, kind: str, engine_id: str, variant: str | None, device: str | None) -> int:
        """What loading exactly this model on `device` takes, measured on this machine at the
        piece length it is given now: the largest `"peak"` reading of this variant (its
        calibrated first load, and any line that went higher since). 0 = never measured
        there. Placement and the memory check both ask this one function. Only readings of the
        runtime build running now count: a new build can change what a model takes (the
        2026-10-04 decoder fixes cut Qwen3's by gigabytes), and a price only ever rises within
        a build, so the first load on a new build calibrates again.

        Until 2026-10-04 the check took the largest load reading of ANY variant of the engine
        and placement the newest of this one, from one process both kinds shared: VoiceDesign
        was priced at CustomVoice 0.6B's 6,249 MB while placement read 105 MB (audit §5 B1)."""
        if not device:
            return 0
        try:
            from llm_runner.llm.stores import get_model_measurement_store
            from llm_runner.runner.hardware import current_machine_key

            mk = current_machine_key()
            want = {"split_chars": str(self.effective_split(engine_id, variant)),
                    "runtime": _runtime_build()}
            best = 0
            for row in get_model_measurement_store().list(self._measure_id(kind, engine_id, variant)):
                flags = {f.flagName: f.flagValue for f in (row.switches or [])}
                if (row.machineKey == mk and row.source == "peak" and (row.backend or "") == device
                        and row.vramModelMb > 0 and all(flags.get(k) == v for k, v in want.items())):
                    best = max(best, int(row.vramModelMb))
            return best
        except Exception:  # noqa: BLE001 — bare tests / store not wired
            return 0

    def _ai_model_on_card(self) -> bool:
        """Is an AI model holding the graphics card now? A sleeping one holds nothing (the
        runner idle-unloaded it); the tiny pinned embedder is not the AI model."""
        hw = self._hardware()
        try:
            from llm_runner.runner.arbiter import get_arbiter
            from llm_runner.runner.hardware import mem_arch

            if hw is None or mem_arch(hw) != "discrete":
                return False
            snap = get_arbiter().snapshot(hw)
        except Exception:  # noqa: BLE001 — no kit → nothing to protect
            return False
        return any(r.get("kind") == "llm" and not r.get("asleep") and not r.get("pinned")
                   and int(r.get("vram_mb") or 0) > 0 for r in snap.get("reservations") or [])

    def _free_card_mb(self, kind: str, engine_id: str) -> int | None:
        """Graphics memory a load of `engine_id` could use now, after the safety margin:
        the measured truth and the ledger, whichever says less (as `_admit_memory`), plus
        what this kind's current occupant gives back when it is replaced. None = unknown."""
        hw = self._hardware()
        try:
            from llm_runner.runner.arbiter import get_arbiter
            from llm_runner.runner.hardware import budget_total_mb

            arb = get_arbiter()
            total = int(budget_total_mb(hw)) if hw is not None else 0
            if total <= 0:
                return None
            committed = max(0, total - arb.remaining_mb(hw))
            used = self.pool_used_mb(fresh=True)
            free = total - max(committed, used if used is not None else 0)
            with self._lock:
                occ = self._loaded.get(kind)
            if occ is not None and occ.manifest.id != engine_id:
                free += int(arb.reserved_mb(f"{kind}:{occ.manifest.id}") or 0)
            return free - self._safety_margin_mb()
        except Exception:  # noqa: BLE001
            return None

    def placement_for(self, m, kind: str, variant: str | None) -> tuple[str, str, bool]:
        """Where a load of this model goes now: ("gpu" | "cpu", why — a clause the row says
        after "Runs on the CPU ·", unload the AI model first?)."""
        from .audiocpp.runtime import backend_of, cpu_min_realtime, installed_exe

        exe = installed_exe()
        if exe is not None and backend_of(exe) == "cpu":
            return "cpu", "this machine's speech runtime is the CPU build", False
        choice = self._user_placement(m.id, variant)
        x, here = self.cpu_speed(kind, m.id, variant)
        speed = (f"{_x(x)} real time {'here' if here else 'on the reference machine'}" if x else "")
        if choice == "gpu":
            return "gpu", "your choice", False
        if choice == "cpu":
            return "cpu", "your choice" + (f" — {speed}" if speed else ""), False
        if not self._ai_model_on_card():
            return "gpu", "nothing else is on the graphics card", False
        prior = self._price_mb(kind, m.id, variant, backend_of(exe) if exe is not None else None)
        free = self._free_card_mb(kind, m.id) if prior else None
        if prior and free is not None and prior <= free:
            return "gpu", f"it fits beside the AI model ({prior} MB)", False
        if x is not None and x >= cpu_min_realtime():
            return "cpu", f"{speed}, which keeps the graphics card for the AI model", False
        slow = f"only {speed} on the CPU" if x else "it has no usable speed on the CPU"
        return "gpu", f"{slow}, so the AI model makes room", not prior

    def _unload_ai_model(self, engine_id: str) -> None:
        """Auto's third step for a model never measured on the card: unload the AI model
        before the load (decision 1, 2026-10-02). Through the kit's `make_room`, so the
        eviction event — and the app's toast — say who made room for whom. Speech kinds
        are protected; a busy AI model (mid-answer) is protected by the arbiter itself."""
        hw = self._hardware()
        try:
            from llm_runner.runner.arbiter import get_arbiter
            from llm_runner.runner.hardware import budget_total_mb

            total = int(budget_total_mb(hw)) if hw is not None else 0
            if total <= 0:
                return
            arb = get_arbiter()

            def _llm_mb() -> int:
                return sum(int(r.get("vram_mb") or 0) for r in arb.snapshot(hw).get("reservations") or []
                           if r.get("kind") == "llm" and not r.get("asleep"))

            before_llm, before_used = _llm_mb(), self.pool_used_mb(fresh=True)
            arb.make_room(total, protected_kinds=("tts", "stt"), hardware=hw,
                          reason=f"loading {engine_id}")
            freed = before_llm - _llm_mb()
            # An unloaded model's memory drains over a second or two. Wait for the card to
            # show it before the load reads the card — the first Turbo and VoiceDesign loads
            # were refused "only 4,101 MB free" with the AI model already gone (audit §5 B2).
            if freed > 0 and before_used is not None:
                deadline = time.monotonic() + 6.0
                while time.monotonic() < deadline:
                    used = self.pool_used_mb(fresh=True)
                    if used is None or used <= before_used - freed * 0.8:
                        break
                    time.sleep(0.4)
        except Exception:  # noqa: BLE001 — no kit → nothing to unload
            log.debug("AI-model unload before %s unavailable", engine_id, exc_info=True)

    def placement_reason_for(self, engine_id: str) -> str:
        with self._lock:
            return self._placement_reasons.get(engine_id, "")

    def _record_cpu_speed(self, kind: str, proc, audio_s: float | None, wall_s: float) -> None:
        """The first line (or clip) a CPU-placed model handles after each load records its
        real-time factor in the kit's measurement store — from then on Auto reads THIS
        machine's number, not the manifest's reference. Best-effort; never fails the work."""
        if getattr(proc, "placement", "gpu") != "cpu" or getattr(proc, "speed_recorded", True):
            return
        if not audio_s or audio_s < 2.0 or wall_s <= 0:
            return
        proc.speed_recorded = True
        engine_id = proc.manifest.id
        with self._lock:
            variant = self._current_variants.get(engine_id) or ""
        try:
            from llm_runner.llm.stores import get_model_measurement_store
            from llm_runner.runner.hardware import current_machine_key

            get_model_measurement_store().record(
                f"{kind}:{engine_id}:{variant}", machine_key=current_machine_key(),
                source="speed", label="CPU real-time factor", tokens_per_sec=0.0,
                vram_total_mb=0, at=int(time.time() * 1000), rows=[],
                kind="stt" if kind == "stt" else "tts",
                realtime_x=round(audio_s / wall_s, 2), backend="cpu",
            )
        except Exception:  # noqa: BLE001
            log.debug("CPU speed record failed for %s", engine_id, exc_info=True)

    def _books_memory(self, resolved_device: str) -> bool:
        """THE ONE-POOL RULING (2026-08-13, "your rec go"): on one-pool boxes
        (integrated/unified — CPU and GPU are the same physical bytes) EVERY
        managed load books its measured footprint into the pool ledger; on
        discrete boxes only a device-resolved load holds VRAM (cpu is free —
        its RAM is display-only, §8.18). "cuda" in Q2's ruling means "a GPU
        device": kokoro's directml/coreml arms hold device memory the same
        way, so any non-cpu resolve books on discrete too."""
        hw = self._hardware()
        if hw is None:
            return False
        try:
            from llm_runner.runner.hardware import mem_arch

            if mem_arch(hw) != "discrete":
                return True
        except Exception:  # noqa: BLE001 — no kit → nothing to book against
            return False
        return resolved_device != "cpu"

    @staticmethod
    def _safety_margin_mb() -> int:
        """The runner config's existing margin knob (P5-4: the SAME knob the
        LLM admission subtracts — no new hardcoded value); the kit's seed
        default when the shared service isn't wired."""
        try:
            from llm_runner.runner.lifecycle import get_service

            return int(get_service().config().safety_margin_mb)
        except Exception:  # noqa: BLE001 — standalone/bare tests → the seed default
            try:
                from llm_runner.runner.config import DEFAULT_SAFETY_MARGIN_MB

                return int(DEFAULT_SAFETY_MARGIN_MB)
            except Exception:  # noqa: BLE001
                return 1024

    # ── The measured currency (the 2026-08-13/14 redesign, amended) ───────
    # The declared `vram_min_mb` died first (scaffold-invented fiction: 350M
    # turbo booked 4096); the ESTIMATE ladder that replaced it died the next
    # day (plan doc §10): run against real engines it priced turbo at
    # 4,455 MB — WORSE than the deleted number — because repos ship
    # alternative checkpoints that never co-load; a file's size is a fact,
    # a file's size predicting VRAM is a model with unpriced error terms.
    # The chain now: a PRIOR MEASURED footprint of this engine on this box
    # admits AND books early (covering the seconds between admission and the
    # post-load true-up); a FIRST-EVER load gets NO arithmetic — no invented
    # number, no eviction on its behalf: attempt, measure, book, persist
    # ("not measured yet" until the probe lands). Measurement is per-PID
    # over the engine's process TREE — tree, because Windows venv pythons
    # are launcher SHIMS whose child holds the memory (proven live: 4 MB at
    # the Popen pid, 1131 MB at its child); per-PID rather than a device
    # delta, because JV loads don't serialize under the runner's router
    # lock — a concurrent runner load would cross-charge a delta. The delta
    # survives only as the last-resort fallback on boxes with no
    # per-process arm (AMD Linux), labeled "computed", never persisted.

    def pool_used_mb(self, *, fresh: bool = False) -> int | None:
        """Measured used memory of the budget pool — THE kit's cached door.

        Delegates to `llm_runner.runner.hardware.used_pool_mb`, which owns the
        TTL cache for the whole family (2026-08-14). JustVoice used to keep its
        own cache over the same nvidia-smi call, so the speech strip and the LLM
        strip on the SAME page could report different occupancy at the same
        instant — two caches, two truths, the defect this redesign exists to
        remove. `fresh=True` bypasses the cache for the load door, which must
        never admit against a stale reading."""
        try:
            from llm_runner.runner.hardware import used_pool_mb

            return used_pool_mb(fresh=fresh)
        except Exception:  # noqa: BLE001 — no kit → honestly unmeasurable
            return None

    def _engine_proc_mb(self, proc: AudioCppSlot, *, fresh: bool = True) -> int | None:
        """Measured memory held by the slot's process — its process TREE
        (pid + descendants, summed: Windows venv pythons are launcher shims
        whose CHILD holds the memory; the single-pid probe read 4 MB where
        the child held 1131): dedicated device memory on discrete boxes
        (per-PID — exact attribution even while the runner loads
        concurrently; on Windows-WDDM the GPU Process Memory counter arm,
        where nvidia-smi answers N/A), resident set on one-pool boxes (UMA:
        the pool take IS system memory). None = unmeasurable — the caller
        falls back to the device-wide delta or books nothing."""
        pid = getattr(getattr(proc, "proc", None), "pid", None)
        if not pid:
            return None
        now = time.monotonic()
        key = f"pid:{pid}"
        if not fresh:
            hit = self._probe_cache.get(key)
            if hit is not None and now - hit[0] < PROBE_TTL_S:
                return hit[1]
        try:
            from llm_runner.runner.hardware import (
                mem_arch,
                process_tree_device_mem_mb,
                process_tree_rss_mb,
            )
        except Exception:  # noqa: BLE001 — no kit
            return None
        hw = self._hardware()
        if hw is not None and mem_arch(hw) != "discrete":
            val = process_tree_rss_mb(pid)
        else:
            val = process_tree_device_mem_mb(pid)
        self._probe_cache[key] = (now, val)
        return val

    def _admit_memory(self, m: EngineManifest, kind: str, engine_id: str,
                      needed_mb: int, credit_mb: int = 0) -> None:
        """Budget admission for a booking load whose PRIOR MEASURED footprint
        is known (the amended §10 chain — a first-ever load skips admission
        entirely: no invented number may evict anything). Prices on MEASURED
        free memory: free = budget pool − the measured used probe (what
        nvidia-smi would say), not ledger arithmetic — the ledger can't see
        other apps' usage. When free is short, `make_room`'s ledger target
        is inflated by the UNLEDGERED usage (measured used − committed), so
        evicting to ledger-room yields real room. An unmeasurable box falls
        back to the ledger-remaining arithmetic (the wiring's original
        behavior). Runs with NO manager locks held (cross-app lock-order
        rule); busy kinds are protected inside `make_room`; a refusal is
        HONEST and leaves the world exactly as it was.

        `credit_mb`: what the kind's current occupant gives back when this load replaces it
        (its booking) — counted as free, so replacing a speech model never evicts the AI model
        in place of the speech model that is going anyway, and a variant switch is checked
        against what it really adds (audit 2026-10-04 §13.3, §5 B5)."""
        needed = int(needed_mb)
        if needed <= 0:
            return
        try:
            from llm_runner.runner.arbiter import get_arbiter
        except Exception:  # noqa: BLE001 — bare tests: nothing to admit against
            return
        arb = get_arbiter()
        # Reconcile the LLM sleepers first (the 2026-08-15 sleeping-child fix): the
        # runner's ledger keeps a booking for a child the router idle-unloaded, and
        # this door is the one that used to walk straight into that phantom memory —
        # it prices on the MEASURED probe, which correctly showed the gigabytes as
        # free, so a TTS engine moved in while the booking still stood and the ledger
        # ended over the card. Best-effort: no runner (bare tests) → nothing to sync.
        try:
            from llm_runner.runner.lifecycle import get_service

            get_service().reconcile_sleeping(force=True)
        except Exception:  # noqa: BLE001 — standalone/bare tests
            log.debug("sleeping-set reconcile unavailable at the speech door", exc_info=True)
        hw = self._hardware()
        margin = self._safety_margin_mb()
        want = max(0, needed + margin - max(0, int(credit_mb)))
        used = self.pool_used_mb(fresh=True)
        total = 0
        if hw is not None:
            try:
                from llm_runner.runner.hardware import budget_total_mb

                total = int(budget_total_mb(hw))
            except Exception:  # noqa: BLE001
                total = 0
        if used is not None and total > 0:
            committed = max(0, total - arb.remaining_mb(hw))
            # The pool is occupied by the WORSE of the two truths (2026-08-15). The
            # measurement alone was this door's whole answer, and it cannot see a
            # booking whose allocation has not landed yet — a model admitted seconds
            # ago, or a crashed engine's lingering reservation. The ledger alone
            # cannot see other programs. Neither is safe by itself; the max is.
            free = max(0, total - max(used, committed))
            if want <= free:
                return
            foreign = max(0, used - committed)
            target = want + foreign
        else:
            free = None
            if want <= arb.remaining_mb(hw):
                return
            target = want
        if arb.make_room(target, exclude=f"{kind}:{engine_id}", hardware=hw,
                         reason=f"loading {engine_id}"):
            # Eviction frees device memory ASYNCHRONOUSLY (a terminated child
            # drains over ~a second). Wait briefly for the measured number to
            # agree; if it stays short, proceed — the ledger says room, and
            # the spawn OOM remains the last net.
            if free is not None:
                deadline = time.monotonic() + 4.0
                while time.monotonic() < deadline:
                    u = self.pool_used_mb(fresh=True)
                    c = max(0, total - arb.remaining_mb(hw))
                    if u is None or max(0, total - max(u, c)) >= want:
                        break
                    time.sleep(0.4)
            return
        snap = arb.snapshot(hw)
        have = f"{free} MB free of {total} MB (measured, minus what is booked)" \
            if free is not None else \
            f"{snap['remaining_mb']} MB of {snap['vram_total_mb']} MB unbooked"
        resident = ", ".join(
            f"{r['key']} ({r['vram_mb']} MB{' · asleep' if r.get('asleep') else ''})"
            for r in snap["reservations"]
        ) or "nothing"
        busy = ", ".join(snap["busy_kinds"]) or "none"
        raise RuntimeError(
            f"not enough memory to load {engine_id}: it needs ~{needed} MB "
            f"(+{margin} MB safety margin) but only {have} remain. "
            f"Resident: {resident}; busy: {busy}. "
            f"Wait for the current work to finish or unload something first."
        )

    def _reserve_engine(self, m: EngineManifest, kind: str, mb: int,
                        source: str) -> None:
        """Book the confirmed load at `mb` with its honest provenance —
        "measured" when a per-PID probe produced the number, "computed" when
        the estimate stands (§13.1: an estimate must never read as live
        truth). Key = "kind:engine_id"; kind maps to the arbiter's tts/stt
        vocabulary (never "llm" — the runner's count scope, P5-3);
        `evict_fn` is our any-thread evictor. A crashed engine's reservation
        lingers until its slot next loads/unloads — conservative."""
        try:
            from llm_runner.runner.arbiter import get_arbiter
        except Exception:  # noqa: BLE001
            return
        arb_kind = "stt" if kind == "stt" else "tts"
        get_arbiter().reserve(
            f"{kind}:{m.id}", int(mb), kind=arb_kind,
            evict_fn=lambda k=kind, eid=m.id: self._evict_for_arbiter(k, eid),
            source=source,
        )

    def _record_speech_load(self, m: EngineManifest, kind: str,
                            variant: str | None, mb: int, device: str) -> None:
        """Persist a measured peak as a `"peak"` row in the shared measurement store (id
        `kind:engine:variant`, kind-tagged tts/stt, backend = the device, flag `split_chars` =
        the piece length it was measured at) — what `_price_mb` reads on the next load. Keeps
        the newest 5 per length and runtime build (flag `runtime`). Best-effort: persistence
        must never fail a load.

        (Until 2026-10-04 these were `"load"` rows of a process both kinds shared — a computed
        share; they are never read again, audit §13.3.)"""
        try:
            from llm_runner.llm.model_measurements_api import MeasurementFlag
            from llm_runner.llm.stores import get_model_measurement_store
            from llm_runner.runner.hardware import current_machine_key

            store = get_model_measurement_store()
            model_id = self._measure_id(kind, m.id, variant)
            mk = current_machine_key()
            split = str(self.effective_split(m.id, variant))
            build = _runtime_build()
            store.record(
                model_id, machine_key=mk, source="peak",
                label=f"speech peak ({device}, pieces of {split} characters, {build})",
                tokens_per_sec=0.0, vram_total_mb=0, at=int(time.time() * 1000),
                rows=[MeasurementFlag(flagName="split_chars", flagValue=split),
                      MeasurementFlag(flagName="runtime", flagValue=build)],
                vram_model_mb=int(mb), kind="stt" if kind == "stt" else "tts", backend=device,
            )
            store.prune_load_rows(model_id, mk, {"split_chars", "runtime"}, keep=5, source="peak")
        except Exception:  # noqa: BLE001
            log.debug("speech peak persist failed for %s", m.id, exc_info=True)

    @staticmethod
    def _measure_id(kind: str, engine_id: str, variant: str | None) -> str:
        return f"{kind}:{engine_id}:{variant or ''}".rstrip(":")

    def bump_engine_reservation_async(self, kind: str) -> None:
        """Fire-and-forget high-water bump for the synthesis/transcription hot
        path — the probe can shell out for ~1 s (typeperf) and must never add
        latency to a render line. The TTL cache inside makes the thread a
        near-no-op when a probe ran recently."""
        threading.Thread(
            target=lambda: self.bump_engine_reservation(kind),
            name=f"{kind}-highwater", daemon=True,
        ).start()

    def bump_engine_reservation(self, kind: str, *, fresh: bool = False) -> None:
        """The raise-only HIGH-WATER re-probe (Opus finding 2): TTS allocates
        at generate(), not load — a post-load number misses render peak and
        would over-admit into it. Called when work completes (synth /
        transcribe / clone, TTL-absorbed so per-line calls collapse; the
        scheduler's busy→idle transition passes fresh=True for the settled
        peak); torch's caching allocator keeps freed memory in the process
        pool, so the probe sees ~peak even lazily. Never lowers a booking;
        best-effort."""
        with self._lock:
            proc = self._loaded.get(kind)
        if proc is None:
            return
        engine_id = proc.manifest.id
        # The kind's own process (audit §13.2): its whole measurement is this model's.
        mb = self._engine_proc_mb(proc, fresh=fresh)
        if not mb:
            return
        try:
            from llm_runner.runner.arbiter import get_arbiter

            arb = get_arbiter()
            cur = arb.reserved_mb(f"{kind}:{engine_id}")
            if cur is None or mb > cur:
                # Occupant re-check (hardening): the probe ran unlocked — the
                # slot may have swapped while it shelled out; never book for
                # an engine that no longer holds it.
                with self._lock:
                    occ = self._loaded.get(kind)
                    variant = self._current_variants.get(engine_id)
                    device = self._resolved_devices.get(engine_id, "")
                if occ is None or occ.manifest.id != engine_id:
                    return
                # cur is None = "not measured yet" (no per-process arm fired
                # at the load door). The first measured probe CREATES the
                # booking — but only when the resolved device books at all
                # (a CPU-placed engine on a discrete box books nothing).
                if cur is None and not self._books_memory(device):
                    return
                m = self.get_manifest(engine_id)
                if m is not None:
                    self._reserve_engine(m, kind, mb, "measured")
                    self._record_speech_load(m, kind, variant, mb, device)
        except Exception:  # noqa: BLE001
            pass

    @staticmethod
    def _booking_mb(key: str) -> int:
        """What `key` holds booked now (0 = nothing, or no kit)."""
        try:
            from llm_runner.runner.arbiter import get_arbiter

            return int(get_arbiter().reserved_mb(key) or 0)
        except Exception:  # noqa: BLE001
            return 0

    def _release_engine(self, kind: str, engine_id: str) -> None:
        """Drop the booking (idempotent — `make_room` releases evicted rows
        itself; a second release is a no-op)."""
        try:
            from llm_runner.runner.arbiter import get_arbiter
        except Exception:  # noqa: BLE001
            return
        get_arbiter().release(f"{kind}:{engine_id}")

    def _evict_for_arbiter(self, kind: str, engine_id: str) -> None:
        """The evictor `make_room` executes for one of OUR reservations — safe
        from ANY thread (a runner admission calls it holding no JV locks; we
        never call `make_room` while holding ours). Terminates the slot ONLY if
        this engine still occupies it; the reservation itself is released by
        `make_room` on the attempt."""
        with self._activity(kind), self._lock:
            proc = self._loaded.get(kind)
            if proc is not None and proc.manifest.id == engine_id:
                try:
                    proc.terminate()
                except Exception:  # noqa: BLE001 — already dying is fine
                    pass
                self._loaded.pop(kind, None)
                self._current_variants.pop(engine_id, None)
                self._resolved_devices.pop(engine_id, None)
                self._placement_reasons.pop(engine_id, None)

    def resolved_device_for(self, engine_id: str) -> str | None:
        """The device the last confirmed load of this engine actually resolved
        to (shown on the Speech-engines card — Q2: the resolved device is
        always visible, never hidden). None = not loaded this process."""
        with self._lock:
            return self._resolved_devices.get(engine_id)

    def current_variant_id(self, engine_id: str) -> str | None:
        with self._lock:
            return self._current_variants.get(engine_id)

    def resolved_default_variant(self, engine_id: str) -> str:
        """Public door for the API layer: what a no-variant load of this engine
        resolves to (user Set-as-default override → manifest → heuristics)."""
        m = self.get_manifest(engine_id)
        return self._resolved_default_variant(m) if m else ""

    @staticmethod
    def _user_default_variant(engine_id: str) -> str:
        """The operator's own default-model choice for this engine
        (settings.engines.engine_overrides[id].default_variant — written by the
        Speech-engines page's "Set as default" row action, parity batch
        2026-08-06). Best-effort: unit tests run without app state → ""."""
        try:
            from ..app_state import get_state

            ov = get_state().settings.get().engines.engine_overrides.get(engine_id)
            return (ov.default_variant or "") if ov else ""
        except Exception:  # noqa: BLE001 — no state / mid-boot → manifest order
            return ""

    def _resolved_default_variant(self, m: EngineManifest) -> str:
        """What variant id a no-variant load actually resolves to, so the
        Engines page can highlight the right model row (user-hit twice:
        load via Voices → both rows said "Load model").

        Order: the USER's default_variant override (Set as default) → manifest
        DEFAULT_VARIANT_ID → sole catalog variant → the first variant already in
        the speech cache → first catalog variant as best effort.
        """
        user = self._user_default_variant(m.id)
        if user:
            return user
        if m.default_variant_id:
            return m.default_variant_id
        try:
            from .model_catalog import models_for

            variants = models_for(m.id)
        except Exception:
            return ""
        if not variants:
            return ""
        if len(variants) > 1:
            try:
                from .. import speech_cache
                from ..app_state import get_state

                data_dir = get_state().data_dir
                for v in variants:
                    if speech_cache.variant_on_disk(data_dir, m.id, v.id):
                        return v.id
            except Exception:  # noqa: BLE001 — bare tests / no app state
                pass
        return variants[0].id

    def _ensure_variant_local(self, m: EngineManifest, variant_id: str | None,
                              progress, cancel_check) -> str | None:
        """The load door's acquisition step (phase ②, plan doc §12): make sure the
        variant's file(s) are in the speech cache before the runtime is told about
        them, and return that folder — or None when there is nothing to fetch (no
        variant, no app state, no catalog row). Plain files, the kit downloader, no
        hub code, no symlinks."""
        if not variant_id:
            return None
        try:
            from .. import speech_cache
            from ..app_state import get_state

            data_dir = get_state().data_dir
        except Exception:  # noqa: BLE001 — bare tests / no app state
            return None
        if speech_cache.variant_on_disk(data_dir, m.id, variant_id):
            return str(speech_cache.variant_dir(data_dir, m.id, variant_id))
        try:
            from ..api.engine_sources_api import resolve_source

            src, _prov = resolve_source(m.id, variant_id)
        except Exception:  # noqa: BLE001 — no catalog row → nothing to fetch
            return None
        repo = src.get("hf_repo")
        if not repo:
            return None
        if progress:
            progress("downloading-model",
                     f"fetching {variant_id} into the speech cache")
        last = {"pct": -1}

        def _prog(done: int, total: int) -> None:
            if progress and total:
                pct = int(done * 100 / total)
                if pct != last["pct"]:
                    last["pct"] = pct
                    progress("downloading-model",
                             f"{variant_id}: {pct}% of {total // (1024 * 1024)} MB")

        sources = src.get("sources") or [{
            "hf_repo": repo, "revision": src.get("revision"),
            "files": src.get("files")}]
        try:
            speech_cache.fetch_hf_variant(
                data_dir, m.id, variant_id, sources,
                on_progress=_prog,
                cancel_check=(lambda: bool(cancel_check())) if cancel_check else None,
            )
        except Exception as e:  # noqa: BLE001 — incl. DownloadCancelled
            if "cancel" in str(e).lower() or type(e).__name__ == "DownloadCancelled":
                raise RuntimeError("cancelled by user") from e
            raise RuntimeError(
                f"model download failed for {m.id}/{variant_id}: {e}") from e
        return str(speech_cache.variant_dir(data_dir, m.id, variant_id))

    def request_cancel_load(self, engine_id: str) -> bool:
        """Mark an in-flight load for cancellation. Returns True if a load is
        actually in progress for that engine; False otherwise (no-op cancel).
        The load loop polls `cancel_check()` at safe points and raises
        `RuntimeError("cancelled")` to short-circuit. Side effect: unloads the
        engine's model if it was already in the runtime."""
        with self._lock:
            self._cancel_load_requests.add(engine_id)
            # Find this engine across all kind slots and terminate it — and free its booking,
            # which used to outlive the cancelled slot (audit §5 C3).
            for kind, proc in list(self._loaded.items()):
                if proc.manifest.id == engine_id:
                    try:
                        proc.terminate()
                    except Exception:
                        pass
                    self._loaded.pop(kind, None)
                    self._current_variants.pop(engine_id, None)
                    self._resolved_devices.pop(engine_id, None)
                    self._placement_reasons.pop(engine_id, None)
                    self._release_engine(kind, engine_id)
                    return True
        return False

    def refresh_manifests(self) -> None:
        with self._lock:
            self._manifests = discover_engines()

    def manifests(self) -> dict[str, EngineManifest]:
        with self._lock:
            return dict(self._manifests)

    def get_manifest(self, engine_id: str) -> EngineManifest | None:
        with self._lock:
            return self._manifests.get(engine_id)

    def status(self, engine_id: str) -> str:
        """One of: not_installed | installed | loaded."""
        with self._lock:
            m = self._manifests.get(engine_id)
            if not m:
                return "not_installed"
            for proc in self._loaded.values():
                if proc.manifest.id == engine_id and proc.is_alive():
                    return "loaded"
            return "installed" if m.is_installed else "not_installed"

    def current_id(self) -> str | None:
        """Back-compat: returns the TTS slot's engine id. New callers
        should use current_for(kind) explicitly."""
        return self.current_for("tts")

    # ─── Install / Uninstall ──────────────────────────────────────────

    def install(
        self,
        engine_id: str,
        progress: Callable[[str, str | None], None] | None = None,
        cancel_check: Callable[[], bool] | None = None,
        on_bytes: Callable[[int, int | None], None] | None = None,
    ) -> None:
        m = self.get_manifest(engine_id)
        if m is None:
            raise InstallError(f"unknown engine: {engine_id}")
        install_engine(m, progress=progress, cancel_check=cancel_check, on_bytes=on_bytes)

    def uninstall(self, engine_id: str) -> dict:
        """Delete every downloaded model of this engine (its speech-cache folder),
        unloading it first. The runtime is shared and stays; the engine's catalog
        (`manifest.py`) is source and stays."""
        m = self.get_manifest(engine_id)
        if m is None:
            raise InstallError(f"unknown engine: {engine_id}")
        freed = []
        with self._lock:
            for kind, proc in list(self._loaded.items()):
                if proc.manifest.id == engine_id:
                    proc.terminate()
                    self._loaded.pop(kind, None)
                    freed.append(kind)
            self._current_variants.pop(engine_id, None)
            self._resolved_devices.pop(engine_id, None)
        # The booking goes with the memory, as on every other unload path.
        for kind in freed:
            self._release_engine(kind, engine_id)
        removed = []
        # The server restarts without these models on its next use (its config
        # lists only what is on disk).
        try:
            from ..app_state import get_state
            from ..paths import speech_cache_root

            root = speech_cache_root(get_state().data_dir) / engine_id
        except Exception:  # noqa: BLE001 — bare tests / no app state
            root = None
        if root is not None and root.exists():
            shutil.rmtree(root, ignore_errors=True)
            if root.exists():
                # A file the runtime still holds open (Windows refuses the delete).
                raise InstallError(
                    f"some {m.name} model files are still in use and were not deleted — "
                    f"unload the model and try again ({root})")
            removed.append("models")
        return {"engine_id": engine_id, "removed": removed}

    # ─── Load / Unload ────────────────────────────────────────────────

    def load(
        self,
        engine_id: str,
        device: str = "auto",
        variant: str | None = None,
        progress: Callable[[str, str | None], None] | None = None,
        cancel_check: Callable[[], bool] | None = None,
    ) -> dict:
        m = self.get_manifest(engine_id)
        if m is None:
            raise RuntimeError(f"unknown engine: {engine_id}")

        # Drop any stale cancel flag and compose the caller's `cancel_check`
        # (if any) with our flag-driven one. Either signal aborts the load.
        with self._lock:
            self._cancel_load_requests.discard(engine_id)
        _server_cancel = lambda: engine_id in self._cancel_load_requests  # noqa: E731
        if cancel_check is None:
            effective_cancel = _server_cancel
        else:
            effective_cancel = lambda: _server_cancel() or cancel_check()  # noqa: E731

        def _maybe_cancel() -> None:
            if effective_cancel():
                raise RuntimeError("cancelled by user")

        early_mb = 0  # a prior-measured booking made BEFORE the load confirms
        try:
            _maybe_cancel()

            # Install is what fetches the speech runtime — Load never installs a
            # program behind the user's back (it does fetch a missing MODEL file,
            # below: a download, on the row's own bar).
            if not m.is_installed:
                raise RuntimeError(
                    f"the speech runtime is not installed yet, so {m.name} cannot load. "
                    f"Install it on AI Settings → Speech engines."
                )

            _maybe_cancel()

            target_kind = m.kind
            # Where it runs (CPU placement, 2026-10-02): decided before anything moves, for
            # the variant this load will end up with.
            cur0 = self.loaded_for(target_kind)
            planned = (variant if variant not in (None, "", "auto")
                       else ((self._current_variants.get(engine_id)
                              if cur0 is not None and cur0.manifest.id == engine_id else None)
                             or self._resolved_default_variant(m) or None))
            placement, why, unload_ai = self.placement_for(m, target_kind, planned)
            from .audiocpp.slot import effective_placement

            placement = effective_placement(placement)
            # This engine already holds the slot with the same (or unspecified) variant in
            # the same place: that path early-returns below and must never fetch or check.
            _already = (
                cur0 is not None and cur0.manifest.id == engine_id
                and cur0.is_alive()
                and getattr(cur0, "placement", "gpu") == placement
                and (variant in (None, "", "auto")
                     or self._current_variants.get(engine_id) == variant)
            )

            # Refuse before changing anything (audit 2026-10-04 §13.3, §5 B2). The device, the
            # price and the memory check come FIRST — before a file is fetched or the AI model
            # is unloaded — so a refused load leaves no download and no eviction behind. The
            # price is exactly this model's measured peak at the piece length it will be given
            # (`_price_mb`); a known one admits and books EARLY, so the ledger covers the
            # seconds until the post-load true-up. The check credits what the kind's current
            # occupant gives back when it is replaced — so a variant switch is checked too
            # (§5 B5) and replacing a speech model never evicts the AI model in its place. A
            # model never measured here gets no arithmetic: it loads, calibrates, is measured.
            device = "cpu" if placement == "cpu" else self._resolve_device(m, device)
            books = self._books_memory(device)
            price = (self._price_mb(target_kind, engine_id, planned, device)
                     if books and not _already else 0)
            if price > 0:
                credit = (self._booking_mb(f"{target_kind}:{cur0.manifest.id}")
                          if cur0 is not None else 0)
                self._admit_memory(m, target_kind, engine_id, price, credit_mb=credit)
                self._reserve_engine(m, target_kind, price, "measured")
                early_mb = price
            # Phase ② (plan doc §12): the planned variant's files are LOCAL before the runtime
            # is told about them — network leaves the load path.
            local_dir = None
            if not _already:
                local_dir = self._ensure_variant_local(
                    m, planned, progress, effective_cancel)
            if unload_ai and not _already and not price:
                # Auto's third step, for a model never measured on the card (decision 1); it
                # waits for the AI model's memory to drain before the load reads the card.
                self._unload_ai_model(engine_id)
            # A load with no price on the card measures one: its warm-up is a full-length
            # piece, and what the process holds after it is this model's peak (§13.3).
            calibrate = books and not _already and not price
            # The device-delta fallback's BEFORE snapshot (boxes with no
            # per-process probe arm, e.g. AMD Linux) — taken after admission's
            # settle loop so an evicted victim's drain isn't charged to this
            # load. The delta is attributable only when nothing else loads
            # concurrently, which JV cannot guarantee → it books as "computed"
            # and is never persisted as measurement evidence.
            pool_before = self.pool_used_mb(fresh=True) if books else None
            gpu_before = pool_before if books else memory_in_use_mb()

            # Activity lock first (lock order: activity → self._lock): a
            # terminate must wait for the slot's in-flight synth line.
            with self._activity(target_kind), self._lock:
                # Unload the SAME-KIND slot's prior occupant — other kinds
                # stay loaded (Phase 2 / Slice 1).
                prior = self._loaded.get(target_kind)
                moving = (prior is not None and prior.manifest.id == engine_id
                          and getattr(prior, "placement", "gpu") != placement)
                # Another variant of the loaded engine is a different model: the slot
                # serves whichever row its own /load set, so it must load again. Until
                # 2026-10-02 this path relabelled the variant and returned, and the old
                # model went on speaking under the new name (CustomVoice → Base, English
                # → Spanish, 8-bit → 16-bit all kept the first model loaded).
                switching = (prior is not None and prior.manifest.id == engine_id
                             and variant not in (None, "", "auto")
                             and self._current_variants.get(engine_id) not in (None, variant))
                if prior and (prior.manifest.id != engine_id or moving or switching):
                    log.info(
                        "unloading %s engine %s before loading %s%s",
                        target_kind, prior.manifest.id, engine_id,
                        f" on the {placement.upper()}" if moving
                        else f" as {variant}" if switching else "",
                    )
                    prior.terminate()
                    self._loaded.pop(target_kind, None)
                    self._release_engine(target_kind, prior.manifest.id)
                    self._resolved_devices.pop(prior.manifest.id, None)
                    self._placement_reasons.pop(prior.manifest.id, None)
                elif prior and prior.manifest.id == engine_id and prior.is_alive():
                    # Already loaded — just return current voices. Record the
                    # RESOLVED variant: "auto"/None must map to the default
                    # id or the Engines page can't tell which row is loaded
                    # (user-hit: load via Voices → both rows said "Load").
                    if variant not in (None, "", "auto"):
                        self._current_variants[engine_id] = variant
                    elif not self._current_variants.get(engine_id):
                        self._current_variants[engine_id] = self._resolved_default_variant(m)
                    return prior.get("/voices").json()

                if progress:
                    progress("loading", f"loading {engine_id} on the "
                                        f"{'CPU' if placement == 'cpu' else 'graphics card'}…")
                proc = _new_slot(m, placement)
                proc.spawn()
                self._loaded[target_kind] = proc

            _maybe_cancel()

            # A FRESH no-variant load resolves the default HERE (parity batch
            # 2026-08-06): the slot receives `variant` verbatim, so
            # the user's Set-as-default choice must be substituted before the
            # POST — otherwise it would only relabel a row while the engine
            # still loaded its own default. Deliberately AFTER the
            # already-loaded early-return above: a no-variant re-load of a
            # loaded engine keeps whatever is loaded (the Voices preview path —
            # pinned by test_already_loaded_reload_keeps_resolved_variant).
            if variant in (None, "", "auto"):
                variant = self._resolved_default_variant(m) or None

            # Now POST /load to the engine — this is where the model actually
            # comes into memory. `model_dir` (the speech-cache variant dir)
            # makes the engine load plain local files; None = its legacy way.
            if progress:
                progress("loading_weights", f"loading {engine_id} weights")
            r = proc.post("/load", json={
                "device": device, "variant": variant, "model_dir": local_dir,
                # A full-length warm-up piece when this model has no price on the card yet.
                "calibrate_chars": self.effective_split(engine_id, variant) if calibrate else 0,
            })
            if r.status_code != 200:
                log.warning("engine %s /load failed: %s", engine_id, r.text[:400])
                with self._activity(target_kind), self._lock:
                    proc.terminate()
                    self._loaded.pop(target_kind, None)
                    self._resolved_devices.pop(engine_id, None)
                # Defensive — nothing is reserved before a 200, but a release
                # is idempotent and the F1 lesson (a reservation nobody
                # releases is a lying ledger) is worth the belt.
                self._release_engine(target_kind, engine_id)
                raise RuntimeError(f"engine load failed: {r.text}")
            if effective_cancel():
                # Cancelled while the model came in — Load no longer holds the server's event
                # loop, so a Cancel lands mid-load now (audit §13.2). Unload it before anything
                # is booked for it; `request_cancel_load` may already have dropped the slot.
                with self._activity(target_kind), self._lock:
                    try:
                        proc.terminate()
                    except Exception:  # noqa: BLE001 — already gone is fine
                        pass
                    if self._loaded.get(target_kind) is proc:
                        self._loaded.pop(target_kind, None)
                    self._resolved_devices.pop(engine_id, None)
                self._release_engine(target_kind, engine_id)
                raise RuntimeError("cancelled by user")
            # Record what actually LOADED: the slot answers with the variant it
            # resolved, which differs from the request when the request names a
            # model the catalog no longer has (a stored "whisper-turbo" dictation
            # setting resolves to the speech-recognition default — and the card
            # must say so, not echo the stale name).
            try:
                loaded_as = (r.json() or {}).get("variant")
            except Exception:  # noqa: BLE001 — a fake/legacy answer without a body
                loaded_as = None
            with self._lock:
                self._current_variants[engine_id] = (
                    loaded_as
                    or (variant if variant not in (None, "", "auto")
                        else self._resolved_default_variant(m))
                )
                self._resolved_devices[engine_id] = device
                self._placement_reasons[engine_id] = why
            # Book the CONFIRMED load at its MEASURED footprint — the per-PID TREE probe of the
            # kind's own process (audit §13.2), so nothing of another kind's is in it and a
            # concurrent runner load can't cross-charge. A known price stays the booking's floor
            # (the warm-up of a priced load is a short line, so what it measures is below the
            # peak a full piece reaches). What is RECORDED as this model's peak (§13.3): a
            # calibrated load's measurement (its warm-up was a full-length piece), or any
            # measurement above the price. A clip-only family's first load can't calibrate —
            # its lines record the peaks (the high-water bump). Probe miss on a box with no
            # per-process arm (AMD Linux) → the device-wide delta across the load, honestly
            # "computed" and never persisted; an EARLY booking keeps the price instead. Nothing
            # measurable at all → no booking — the strip says "not measured yet".
            if books:
                measured = self._engine_proc_mb(proc, fresh=True)
                try:
                    calibrated = bool((r.json() or {}).get("calibrated"))
                except Exception:  # noqa: BLE001 — a fake/legacy answer without a body
                    calibrated = False
                if measured:
                    self._reserve_engine(m, target_kind, max(measured, early_mb), "measured")
                    if calibrated or (early_mb and measured > early_mb):
                        self._record_speech_load(
                            m, target_kind, self._current_variants.get(engine_id),
                            measured, device,
                        )
                elif not early_mb:
                    after = self.pool_used_mb(fresh=True)
                    delta = (
                        max(0, after - pool_before)
                        if after is not None and pool_before is not None
                        else 0
                    )
                    if delta > 0:
                        self._reserve_engine(m, target_kind, delta, "computed")
            log.info("engine %s loaded %s: pid %s, server pid %d; memory in use %s -> %s MB",
                     engine_id, self._current_variants.get(engine_id),
                     getattr(getattr(proc, "proc", None), "pid", None), os.getpid(),
                     _mb(gpu_before), _mb(memory_in_use_mb()))
            # (The qwen3-llm adapter hook died with the engine — F1 Phase 2:
            # the shared stack's bundled runner is THE local LLM.)
            if progress:
                progress("warming_up", f"{engine_id} ready")
            return r.json()
        except Exception:
            # Never leak the EARLY booking on a failed/cancelled load — the
            # non-200 arm already released; release is idempotent.
            if early_mb:
                self._release_engine(m.kind, engine_id)
            raise
        finally:
            # Always clear the cancel flag — leaving stale "cancelled" state
            # would block the next load attempt.
            with self._lock:
                self._cancel_load_requests.discard(engine_id)

    def unload(self, kind: str | None = None) -> dict:
        """Unload the engine in the given kind's slot.

        kind=None means "unload all slots" (back-compat with the
        pre-Slice-1 /v1/engines/unload behavior that emptied the single
        loaded slot). New callers should pass kind explicitly.
        """
        if kind is not None:
            return self._unload_kind(kind)
        with self._lock:
            kinds = list(self._loaded.keys())
        if not kinds:
            return {"previous_engine": None}
        # Back-compat: surface the first kind's previous engine.
        prev = None
        for k in kinds:
            out = self._unload_kind(k)
            if prev is None:
                prev = out.get("previous_engine")
        with self._lock:
            self._current_variants.clear()
        return {"previous_engine": prev}

    def _unload_kind(self, kind: str) -> dict:
        # Activity lock first: never terminate a slot mid-synth/transcribe.
        with self._activity(kind), self._lock:
            proc = self._loaded.get(kind)
            if not proc:
                return {"previous_engine": None}
            prev = proc.manifest.id
            try:
                proc.terminate()
            except Exception:
                pass
            self._loaded.pop(kind, None)
            self._current_variants.pop(prev, None)
            self._resolved_devices.pop(prev, None)
            self._placement_reasons.pop(prev, None)
        # Free the booking with the memory (the 2026-08-13 wiring — every
        # unload path releases; idempotent beside make_room's own release).
        self._release_engine(kind, prev)
        return {"previous_engine": prev}

    # ─── Synth / voices / clone — HTTP proxy ─────────────────────────

    def voices(self, engine_id: str) -> list[dict]:
        proc = self._require_current(engine_id)
        r = proc.get("/voices")
        r.raise_for_status()
        return r.json().get("voices", [])

    def synth(self, engine_id: str, body: dict) -> tuple[bytes, dict]:
        """Returns (audio_bytes, headers_dict_for_re_export)."""
        m = self.get_manifest(engine_id)
        kind = m.kind if m else "tts"
        with self._activity(kind):
            proc = self._require_current(engine_id)
            t0 = time.perf_counter()
            r = proc.post("/synth", json=body)
            wall = time.perf_counter() - t0
        # High-water true-up: generate() is where a TTS engine's memory peaks
        # (Opus finding 2) — async + TTL-absorbed, raise-only, never blocks
        # the line.
        self.bump_engine_reservation_async(kind)
        if r.status_code == 403:
            payload = r.json() if callable(getattr(r, "json", None)) else {}
            if (payload or {}).get("code") == "terms_required":
                raise TermsRequired(engine_id, payload.get("detail") or "accept the engine's terms first")
        if r.status_code != 200:
            raise RuntimeError(f"engine synth failed: {r.text}")
        self._record_cpu_speed(kind, proc, _wav_seconds(r.content or b""), wall)
        # Mirror the engine's audio headers back through to the host caller.
        sample_rate = r.headers.get("X-JustVoice-Sample-Rate")
        channels = r.headers.get("X-JustVoice-Channels")
        is_wav = r.headers.get("X-JustVoice-WAV-Container") == "1"
        return r.content, {
            "media_type": r.headers.get("content-type", "audio/wav"),
            "sample_rate": int(sample_rate) if sample_rate else None,
            "channels": int(channels) if channels else 1,
            "is_wav_container": is_wav,
        }

    def clone(self, engine_id: str, body: dict) -> dict:
        m = self.get_manifest(engine_id)
        with self._activity(m.kind if m else "tts"):
            proc = self._require_current(engine_id)
            r = proc.post("/clone", json=body)
        self.bump_engine_reservation_async(m.kind if m else "tts")
        if r.status_code != 200:
            raise RuntimeError(f"engine clone failed: {r.text}")
        return r.json()

    def chat(self, body: dict, *, timeout: float = 300.0) -> str:
        """Chat completion via the loaded llm-slot engine (G1 wiring).
        body matches the shim's ChatBody: prompt/system/max_tokens/
        temperature/examples."""
        proc = self.loaded_for("llm")
        if proc is None:
            raise RuntimeError(
                "no local LLM engine loaded — install + load 'qwen3-llm' on "
                "the Engines tab, or configure an external provider"
            )
        r = proc.post("/chat", json=body, timeout=timeout)
        if r.status_code != 200:
            raise RuntimeError(f"engine chat failed: {r.text}")
        return r.json().get("text", "")

    def transcribe(self, body: dict, *, timeout: float = 600.0) -> str:
        """Transcription via the loaded stt-slot engine (G2 wiring).
        body matches the shim's TranscribeBody: wav_b64/audio_path/language.
        stt-busy for the call's duration (the 2026-08-13 VRAM wiring, step 4 —
        Q1's never-evict-busy: a mid-transcription whisper is not a victim).

        Returns the text."""
        with self._activity("stt"), _kind_busy("stt"):
            proc = self.loaded_for("stt")
            if proc is None:
                raise RuntimeError(
                    "no STT engine loaded — install + load 'whisper' on the "
                    "Engines tab first"
                )
            t0 = time.perf_counter()
            r = proc.post("/transcribe", json=body, timeout=timeout)
            wall = time.perf_counter() - t0
        self.bump_engine_reservation_async("stt")
        if r.status_code != 200:
            raise RuntimeError(f"engine transcribe failed: {r.text}")
        if getattr(proc, "placement", "gpu") == "cpu" and not getattr(proc, "speed_recorded", True):
            self._record_cpu_speed("stt", proc, _input_seconds(body), wall)
        return r.json().get("text") or ""

    def align(self, body: dict, *, timeout: float = 600.0) -> list[dict]:
        """Word timings via the loaded stt-slot engine — the /align door.
        body: wav_b64/audio_path + text + language. Same busy/reservation
        contract as transcribe; the host maps the hypothesis onto the
        known text (justvoice.alignment)."""
        with self._activity("stt"), _kind_busy("stt"):
            proc = self.loaded_for("stt")
            if proc is None:
                raise RuntimeError(
                    "no STT engine loaded — install + load 'whisper' on the "
                    "Engines tab first"
                )
            r = proc.post("/align", json=body, timeout=timeout)
        self.bump_engine_reservation_async("stt")
        if r.status_code == 501:
            raise RuntimeError(r.json().get("detail", "word alignment unsupported"))
        if r.status_code != 200:
            raise RuntimeError(f"engine align failed: {r.text}")
        return r.json().get("words") or []

    def _require_current(self, engine_id: str) -> AudioCppSlot:
        with self._lock:
            for proc in self._loaded.values():
                if proc.manifest.id == engine_id and proc.is_alive():
                    return proc
            raise RuntimeError(
                f"engine {engine_id} is not loaded — POST /v1/engines/{engine_id}/load first"
            )


def _input_seconds(body: dict) -> float | None:
    """The length of a transcription's input audio (a path or base64 WAV)."""
    try:
        if body.get("audio_path"):
            return _wav_seconds(Path(body["audio_path"]).read_bytes())
        if body.get("wav_b64"):
            import base64

            return _wav_seconds(base64.b64decode(body["wav_b64"]))
    except (OSError, ValueError):
        return None
    return None


# ─── Singleton accessor ───────────────────────────────────────────────


_manager: EngineManager | None = None
_manager_lock = threading.Lock()
_atexit_registered = False


def get_manager() -> EngineManager:
    """The process-wide engine manager, created on first use.

    Creating one also arms an `atexit` reaper that stops the speech runtime: it
    is a child of this process, and FastAPI's `shutdown` event is not the only
    way out (25 of 27 test files build `TestClient(app)` without entering it, so
    lifespan never runs there).

    Registered lazily so importing this module has no side effect, and only
    once — `atexit` would otherwise call it repeatedly.

    LIMIT: `atexit` runs on normal interpreter exit, not on SIGKILL or Windows
    `TerminateProcess`. Those are covered elsewhere: on Windows the runtime sits
    in a kill-on-close Job Object (the kit's `spawn_child`), so it dies with this
    process however it dies; `engines/leftovers.py` sweeps anything older at
    startup; and the desktop shell closes through POST /v1/shutdown before it
    ever hard-kills.
    """
    global _manager, _atexit_registered
    with _manager_lock:
        if _manager is None:
            _manager = EngineManager()
        if not _atexit_registered:
            atexit.register(shutdown_manager)
            _atexit_registered = True
        return _manager


def shutdown_manager() -> None:
    """Called on JustVoice server shutdown — unload every slot and stop the runtime."""
    global _manager
    with _manager_lock:
        if _manager is None:
            return
        _manager.unload()
        _manager = None
    # The one audio.cpp server goes with us, whatever was loaded in it.
    from .audiocpp.runtime import shutdown_server

    shutdown_server()
