# SPDX-License-Identifier: MIT
"""The Python half of compare-asr.mjs — one transcription and one word alignment through the
speech runtime's recogniser.

    python compare-asr.py <data_dir> <in.wav> <text> <out.json>

Boots the store layer on <data_dir> (a COPY of a real data root), loads speech recognition
through the engine manager, transcribes <in.wav> and aligns it to <text>, stops everything
(shutdown_manager) and writes both answers.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")


def main(data_dir: str, wav: str, text: str, out_json: str) -> None:
    import base64

    from llm_runner.llm import db as llm_db

    from justvoice.app_state import AppState, set_state
    from justvoice.database import init_db
    from justvoice.database import session as db_session
    from justvoice.engines.manager import get_manager, shutdown_manager

    d = Path(data_dir)
    init_db(d)
    llm_db.configure_storage(db_session.SessionLocal)
    set_state(AppState(d))
    mgr = get_manager()
    b64 = base64.b64encode(Path(wav).read_bytes()).decode()
    try:
        mgr.load("asr", variant="qwen3-asr-1.7b-q8")
        heard = mgr.transcribe({"wav_b64": b64, "language": "en"})
        words = mgr.align({"wav_b64": b64, "text": text, "language": "en"})
    finally:
        shutdown_manager()
    Path(out_json).write_text(json.dumps({"text": heard, "words": words}), encoding="utf-8")


if __name__ == "__main__":
    main(*sys.argv[1:])
