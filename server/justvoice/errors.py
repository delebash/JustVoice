# SPDX-License-Identifier: MIT
"""ALIAS, not a copy — the whole error implementation lives in the kit
(`llm_runner.platform.errors`; JustWrite's file was the donor, and moving it
gave JustVoice the two improvements its old copy never got: every handled
error logged at a status-scaled level, and 422 validation failures logged +
problem+json instead of FastAPI's silent default). This module exists so the
~127 route/domain files importing `from ..errors import not_found` etc. keep
working against the ONE family implementation; there is no logic here to
drift, and the guard holds this file to exactly this shape. A later sweep may
dissolve it into direct kit imports — see the kit's docs/target-tree.md
"Alias registry". Handlers are registered by app.py via
`install_error_handlers(app, type_base=...)`."""

from llm_runner.platform.errors import (  # noqa: F401 — re-export, the alias's whole job
    ApiError,
    bad_request,
    conflict,
    forbidden,
    internal,
    not_found,
    not_implemented,
    service_unavailable,
    unauthorized,
)
