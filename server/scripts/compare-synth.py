# SPDX-License-Identifier: MIT
"""The Python half of compare-synth.mjs — one real line through the speech runtime.

    python compare-synth.py <data_dir> <request.json> <out.wav> <out.json>

Boots the store layer on <data_dir> (a COPY of a real data root), loads the request's engine
through the engine manager (placement, admission, warm-up — the app's own load door), speaks
one line through manager.synth, stops everything (shutdown_manager) and writes the WAV and
what the load answered.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")


def main(data_dir: str, request: str, out_wav: str, out_json: str) -> None:
    from llm_runner.llm import db as llm_db

    from justvoice.app_state import AppState, set_state
    from justvoice.database import init_db
    from justvoice.database import session as db_session
    from justvoice.engines.manager import get_manager, shutdown_manager

    req = json.loads(Path(request).read_text(encoding="utf-8"))
    d = Path(data_dir)
    init_db(d)
    llm_db.configure_storage(db_session.SessionLocal)
    set_state(AppState(d))
    mgr = get_manager()
    try:
        t0 = time.monotonic()
        loaded = mgr.load(req["engine"], variant=req["variant"])
        t1 = time.monotonic()
        wav, headers = mgr.synth(req["engine"], req["body"])
        t2 = time.monotonic()
        info = {"loaded": loaded, "headers": headers, "device": mgr.resolved_device_for(req["engine"]),
                "placement_reason": mgr.placement_reason_for(req["engine"]),
                "variant": mgr.current_variant_id(req["engine"]),
                "load_s": round(t1 - t0, 2), "synth_s": round(t2 - t1, 2)}
    finally:
        shutdown_manager()
    Path(out_wav).write_bytes(wav)
    Path(out_json).write_text(json.dumps(info), encoding="utf-8")


if __name__ == "__main__":
    main(*sys.argv[1:])
