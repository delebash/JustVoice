# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/projects — project list + multi-adapter import pipeline.

The import endpoint replaces the older single-source
`?source=justwrite` query-string mode with a multipart form upload so
clients can ship any adapter's native file format without base64
roundtrips. The legacy ?source=justwrite query is still accepted for
backwards compatibility (and is still the route JustWrite hits).

Endpoints:
  GET  /v1/projects                          -> ProjectListResponse
  GET  /v1/projects/import/adapters          -> AdapterListResponse
  POST /v1/projects/import                   -> ImportRunResponse
  GET  /v1/projects/{id}                     -> ProjectRecord
  DELETE /v1/projects/{id}                   -> {deleted: True}
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, File, Form, Query, Request, UploadFile

from ..app_state import get_state
from ..errors import bad_request, not_found
from ..imports import list_adapters, run_adapter
from ..imports.standard_schema import (
    AdapterListResponse,
    ImportRunResponse,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["projects"])


@router.get("/v1/projects")
async def list_projects() -> dict[str, Any]:
    return {"projects": get_state().projects.list()}


@router.get("/v1/projects/import/adapters", response_model=AdapterListResponse)
async def list_import_adapters() -> AdapterListResponse:
    return AdapterListResponse(adapters=list_adapters())


@router.post("/v1/projects/import", response_model=ImportRunResponse)
async def import_project(
    request: Request,
    source: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    dry_run: bool | None = Form(default=None),
    source_q: str | None = Query(default=None, alias="source"),
    dry_run_q: bool | None = Query(default=None, alias="dry_run"),
) -> ImportRunResponse:
    """Run an import adapter.

    Multipart shape (preferred):
      multipart/form-data
        source     = adapter id (justwrite | csv_lines | srt | ...)
        file       = the source file
        dry_run    = "true" to parse + return preview without committing

    Backwards-compatible query-string shape (JustWrite's existing call):
      POST /v1/projects/import?source=justwrite&dry_run=true
      Content-Type: application/json | application/octet-stream | ...
      <raw body>
    """
    effective_source = (source or source_q or "").strip()
    if not effective_source:
        raise bad_request(
            "import: missing 'source' — pass as multipart form field or ?source= query param"
        )

    effective_dry_run = bool(dry_run if dry_run is not None else dry_run_q)

    filename: str | None = None
    raw: bytes
    if file is not None:
        raw = await file.read()
        filename = file.filename
    else:
        # If the multipart parser already consumed the stream above (e.g.
        # a multipart submission with `source=` but no file part), the
        # raw body is unrecoverable — surface the missing-file error
        # explicitly. Otherwise read the raw body (legacy query-string
        # callers without multipart).
        try:
            raw = await request.body()
        except RuntimeError:
            raw = b""
        if not raw:
            raise bad_request("import: no file uploaded and no raw request body")

    standard = run_adapter(effective_source, raw, filename=filename)

    if effective_dry_run:
        return ImportRunResponse(
            committed=False,
            project_id=None,
            standard=standard,
            warnings=standard.warnings,
        )

    record = get_state().projects.create_from_import(
        name=standard.project.name,
        kind=standard.project.kind,
        source=standard.source,
        standard_payload=standard.model_dump(),
    )
    standard.project.id = record["id"]
    return ImportRunResponse(
        committed=True,
        project_id=record["id"],
        standard=standard,
        warnings=standard.warnings,
    )


@router.get("/v1/projects/{project_id}")
async def get_project(project_id: str) -> dict[str, Any]:
    rec = get_state().projects.get(project_id)
    if rec is None:
        raise not_found(f"project {project_id}")
    return rec


@router.delete("/v1/projects/{project_id}")
async def delete_project(project_id: str) -> dict[str, Any]:
    if not get_state().projects.delete(project_id):
        raise not_found(f"project {project_id}")
    return {"deleted": True}
