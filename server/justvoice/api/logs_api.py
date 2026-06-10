# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/logs — recent server log lines for Settings → Logs.

Backed by the in-process ring buffer (justvoice.logbuffer); no log files
are written. `tail` feeds the live preview pane, `download` streams the
whole buffer as a text attachment.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from ..logbuffer import tail as tail_lines

router = APIRouter(tags=["system"])


@router.get("/v1/logs/tail")
async def logs_tail(lines: int = 100) -> dict:
    items = tail_lines(lines)
    return {"text": "\n".join(items), "lines": len(items)}


@router.get("/v1/logs/download")
async def logs_download() -> PlainTextResponse:
    items = tail_lines(2000)
    return PlainTextResponse(
        "\n".join(items),
        headers={"Content-Disposition": "attachment; filename=justvoice-logs.txt"},
    )
