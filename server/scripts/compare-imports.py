# SPDX-License-Identifier: MIT
"""The Python half of the import parity check (wave D of step 5).

    python compare-imports.py run <jobs.json> <data_dir> <out.json>

For every job (an input file through one adapter, with a split mode): the StandardImport the
adapter makes (or its error), the dry-run preview the real POST /v1/projects/import answers
(projects_api's router on a bare FastAPI, as tests/test_import_book_prose.py mounts it), and —
for the jobs marked so — the rows the import writes into a COPY of the dev database
(`_materialize_standard` + `_materialize_lexicon` + one commit, the endpoint's own core). Also
`html_blocks` over every HTML text the job file lists. compare-imports.mjs runs the JS twin and
compares.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _result(fn):
    from justvoice.errors import ApiError

    try:
        return {"ok": fn()}
    except ApiError as e:
        return {"error": {"status": e.status_code, "detail": e.detail}}
    except Exception as e:  # noqa: BLE001 — a crash is a result to compare too
        return {"crash": f"{type(e).__name__}: {e}"}


def run(jobs_path: str, data_dir: str, out_path: str) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from llm_runner.platform import install_error_handlers

    from justvoice.api import projects_api
    from justvoice.api.projects_api import _materialize_lexicon, _materialize_standard
    from justvoice.app_state import AppState, set_state
    from justvoice.database import get_db, init_db
    from justvoice.database import session as db_session
    from justvoice.imports import list_adapters, run_adapter
    from justvoice.imports.adapters.book_prose import html_blocks

    import logging

    logging.disable(logging.CRITICAL)  # the routes log every refusal; the answers are what count
    spec = json.loads(Path(jobs_path).read_text(encoding="utf-8"))
    d = Path(data_dir)
    init_db(d)
    set_state(AppState(d))

    app = FastAPI()
    app.include_router(projects_api.router)
    install_error_handlers(app, type_base="https://justvoice.dev/errors/")

    def _db():
        s = db_session.SessionLocal()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    client = TestClient(app, raise_server_exceptions=False)

    out: dict = {"adapters": [a.model_dump(mode="json") for a in list_adapters()], "jobs": [], "html": []}
    for job in spec["jobs"]:
        raw = Path(spec["inputs"][job["input"]]).read_bytes()
        res = _result(lambda: run_adapter(job["source"], raw, filename=job["filename"], split_on=job.get("split_on")))
        rec: dict = {"std": {"ok": res["ok"].model_dump(mode="json")} if "ok" in res else res}
        if job.get("preview"):
            data = {"source": job["source"], "dry_run": "true"}
            if job.get("split_on"):
                data["split_on"] = job["split_on"]
            r = client.post("/v1/projects/import", data=data, files={"file": (job["filename"] or "", raw, "application/octet-stream")})
            try:
                body = r.json()
            except ValueError:
                body = {"detail": None}
            rec["preview"] = {"status": r.status_code, "body": body if r.status_code == 200 else {"detail": body.get("detail")}}
        if job.get("materialize") and "ok" in res:
            std = res["ok"]
            db = db_session.SessionLocal()
            try:
                project, scenes, blocks, created, reused = _materialize_standard(std, db)
                _materialize_lexicon(std, project, db)
                db.commit()
                rec["materialized"] = {"scenes": scenes, "blocks": blocks, "created": len(created), "reused": len(reused)}
            finally:
                db.close()
        out["jobs"].append(rec)

    for text in spec["html"]:
        out["html"].append({
            "plain": _result(lambda: html_blocks(text)),
            "skip": _result(lambda: html_blocks(text, skip_classes=frozenset({"scene-mark"}))),
        })

    Path(out_path).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1] == "run":
        run(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise SystemExit(f"unknown command {sys.argv[1]!r}")
