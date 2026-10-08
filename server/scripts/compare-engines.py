# SPDX-License-Identifier: MIT
"""The Python half of compare-engines.mjs — the speech-engine layer's read answers.

    python compare-engines.py <data_dir> <out.json>

Boots the store layer on <data_dir> (a COPY of a real data root — init_db + AppState + the
shared measurement store on the same database), then dumps every read answer the engine layer
gives: the manifests, the model catalog, the capability rows, the manager's per-variant
answers (status, default variant, split sizes, CPU speed, price, placement), the runtime's
install answers, runtime options, the speech cache, the runtime entries a load registers, and
the request mapping for a fixed set of synth bodies (the JSON text httpx would send).
Paths are written as they are; the JS side normalises both before comparing.

Run with JustVoice's venv; JUST_AI_HOME / LLM_RUNNER_CACHE point into temp (set by the caller).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

SAMPLES = json.loads(Path(__file__).with_name("compare-engines-samples.json").read_text(encoding="utf-8"))


def plain(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, Path):
        return str(v)
    if isinstance(v, dict):
        return {str(k): plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set, frozenset)):
        return [plain(x) for x in v]
    if hasattr(v, "model_dump"):
        return plain(v.model_dump(mode="json"))
    if hasattr(v, "__dataclass_fields__"):
        return plain({k: getattr(v, k) for k in v.__dataclass_fields__})
    return repr(v)


def attempt(fn):
    try:
        return {"ok": plain(fn())}
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {e}"}


def main(data_dir: str, out: str) -> None:
    from llm_runner.llm import db as llm_db
    from llm_runner.runner.hardware import detect

    from justvoice import speech_cache
    from justvoice.app_state import AppState, set_state
    from justvoice.database import init_db
    from justvoice.database import session as db_session
    from justvoice.engines import capability_details, leftovers, model_catalog
    from justvoice.engines.audiocpp import espeak, japanese, release, runtime, runtime_options, slot
    from justvoice.engines.manager import EngineManager, engines_runtime_root

    d = Path(data_dir)
    init_db(d)
    llm_db.configure_storage(db_session.SessionLocal)
    set_state(AppState(d))
    detect()

    mgr = EngineManager()
    manifests = mgr.manifests()
    out_d: dict = {"runtime_root": str(engines_runtime_root()), "data_dir": str(d)}

    engines = {}
    for eid, m in manifests.items():
        mod = m.module
        engines[eid] = {
            "id": m.id, "name": m.name, "description": m.description, "license": m.license,
            "weights_license": m.weights_license, "kind": m.kind, "kinds": m.kinds,
            "capabilities": m.capabilities, "requirements": m.requirements,
            "static_voices": m.static_voices, "default_variant_id": m.default_variant_id,
            "isolation": m.isolation, "supported_oses": m.supported_oses, "deprecated": m.deprecated,
            "supports_current_os": m.supports_current_os(), "uses_audiocpp": m.uses_audiocpp,
            "is_installed": m.is_installed, "terms": getattr(mod, "TERMS", None),
            "variants": getattr(mod, "VARIANTS", []), "pending": getattr(mod, "PENDING_VARIANTS", []),
            "audiocpp_voice": getattr(mod, "AUDIOCPP_VOICE", None),
        }
    out_d["engines"] = plain(engines)

    catalog = {}
    for eid in manifests:
        variants = model_catalog.models_for(eid)
        dv = model_catalog.default_variant_for(eid)
        catalog[eid] = {
            "models": plain(variants),
            "default": dv.id if dv else None,
            "sources": {v.id: model_catalog.sources_for(eid, v.id) for v in variants},
        }
    out_d["catalog"] = plain(catalog)

    out_d["capabilities"] = plain(capability_details.CAPABILITY_DETAILS)
    lookups = {}
    for eid, m in manifests.items():
        for r in list(getattr(m.module, "VARIANTS", [])) + list(getattr(m.module, "PENDING_VARIANTS", [])):
            row = capability_details.lookup(r["id"])
            lookups[r["id"]] = row.engine_id if row else None
    for probe in ("chatterbox", "qwen3-cv", "totally-unknown-engine", "chatterbox-multilingual-v2-q8"):
        row = capability_details.lookup(probe)
        lookups[probe] = row.engine_id if row else None
    out_d["lookups"] = lookups

    exe = runtime.installed_exe()
    backend = runtime.backend_of(exe) if exe else None
    out_d["runtime"] = plain({
        "configured_backend": runtime.configured_backend(), "configured_gpu": runtime.configured_gpu(),
        "physical_cores": runtime.physical_cores(), "cpu_threads": runtime.cpu_threads(),
        "gpu_threads": runtime.gpu_threads(), "start_timeout": runtime.start_timeout(),
        "request_timeout": runtime.request_timeout(), "cpu_min_realtime": runtime.cpu_min_realtime(),
        "available_backends": runtime.available_backends(),
        "selected_asset": runtime.selected_asset().model_dump(by_alias=True) if runtime.selected_asset() else None,
        "installed_exe": str(exe) if exe else None, "installed_tag": runtime.installed_tag(),
        "backend": backend,
        "has_feature": {f: runtime.has_feature(f) for f in list(release.FEATURES) + ["no_such_feature"]},
        "pinned_has": {f: release.pinned_has(f) for f in list(release.FEATURES) + ["no_such_feature"]},
        "binaries": [b.model_dump(by_alias=True) for b in release.binaries()],
        "espeak_paths": [str(p) for p in espeak.paths(engines_runtime_root())] if espeak.paths(engines_runtime_root()) else None,
        "dictionary_dir": str(japanese.dictionary_dir(engines_runtime_root()) or "") or None,
        "child_env": {k: v for k, v in runtime._child_env().items() if k.startswith("AUDIOCPP_")},
        "managed_runtime": slot.managed_runtime(),
        "leftover_roots": list(leftovers._audiocpp_roots()),
    })

    per_variant = {}
    for eid, m in manifests.items():
        kind = m.kind
        for r in getattr(m.module, "VARIANTS", []):
            vid = r["id"]
            per_variant[f"{eid}/{vid}"] = plain({
                "split_chars_for": mgr.split_chars_for(eid, vid),
                "effective_split": mgr.effective_split(eid, vid),
                "cpu_speed": mgr.cpu_speed(kind, eid, vid),
                "price_backend": mgr._price_mb(kind, eid, vid, backend),
                "price_cpu": mgr._price_mb(kind, eid, vid, "cpu"),
                "placement": attempt(lambda: mgr.placement_for(m, kind, vid)),
                "user_placement": EngineManager._user_placement(eid, vid),
                "on_disk": speech_cache.variant_on_disk(d, eid, vid),
                "disk_bytes": speech_cache.variant_disk_bytes(d, eid, vid),
                "runtime_options": runtime_options.describe(eid, r),
                "session_options": runtime_options.session_options_for(eid, r),
                "entries": attempt(lambda: [e.to_config() for e in slot._entries_for(m, r)]),
                "variant_spec": (slot.variant_spec(m, vid) or {}).get("id"),
            })
    out_d["per_variant"] = per_variant

    # The same placements with an AI model on the card (6.8 GB booked, as gemma measured).
    from llm_runner.runner.arbiter import get_arbiter

    get_arbiter().reserve("llm:gemma", 6800, kind="llm", evict_fn=lambda: None, source="measured")
    beside = {}
    for eid, m in manifests.items():
        for r in getattr(m.module, "VARIANTS", []):
            beside[f"{eid}/{r['id']}"] = attempt(lambda m=m, r=r: mgr.placement_for(m, m.kind, r["id"]))
    get_arbiter().release("llm:gemma")
    out_d["placement_beside_ai"] = beside

    out_d["manager"] = plain({
        "status": {eid: mgr.status(eid) for eid in manifests},
        "resolved_default": {eid: mgr.resolved_default_variant(eid) for eid in manifests},
        "any_on_disk": {eid: speech_cache.any_variant_on_disk(d, eid) for eid in manifests},
        "current_id": mgr.current_id(),
        "runtime_build": __import__("justvoice.engines.manager", fromlist=["_runtime_build"])._runtime_build(),
        "installed_entries_tts": attempt(lambda: [e.to_config() for e in slot.installed_entries("tts")]),
        "installed_entries_stt": attempt(lambda: [e.to_config() for e in slot.installed_entries("stt")]),
    })

    from httpx._content import encode_json

    requests = []
    for s in SAMPLES:
        m = manifests[s["engine"]]
        row = next(r for r in list(m.module.VARIANTS) + list(getattr(m.module, "PENDING_VARIANTS", []))
                   if r["id"] == s["variant"])

        def one(row=row, body=s["body"]):
            req = slot.to_speech_request(row, body)
            _h, stream = encode_json(req)
            return {"req": req, "text": b"".join(stream).decode("utf-8"),
                    "features": slot.features_needed(row, body)}

        requests.append({"name": s["name"], **attempt(one)})
    out_d["requests"] = requests
    out_d["calibration"] = {str(n): slot.calibration_text(n) for n in (0, 39, 40, 120, 128, 200, 240, 400, 800, 5000)}
    out_d["refusals"] = {f: slot.feature_refusal(f) for f in list(release.FEATURES) + ["mystery"]}

    Path(out).write_text(json.dumps(out_d, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(*sys.argv[1:])
