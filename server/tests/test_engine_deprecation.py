# SPDX-License-Identifier: MIT
"""Engines marked for removal must say so on the wire — and must still work.

The 2026-08-17 roster decision cut nine variants to six slots. The user's
ruling on how to land it, verbatim: *"dont remove them now you can mark them
for removal and hide them if you want"*. So this is deliberately a **soft**
mechanism:

  * a non-empty manifest `DEPRECATED` string marks the engine and carries the
    user-facing reason,
  * `EngineInfo.deprecated` puts it on the wire,
  * the renderer hides the row while the engine is uninstalled and badges it
    once it is installed, and Voice engine setup filters it out of every tier,
  * and **nothing blocks install or load** — an engine somebody already has
    keeps working until it is actually deleted.

The last point is the one worth a test: it would be very easy for a later
change to turn "marked" into "refused", which is exactly what the user said
not to do.

Reasoning for each engine lives in its manifest and in
`docs/plans/2026-08-17-engine-roster-and-platform.md` §2.7–2.8.
"""

from __future__ import annotations

import pytest

from justvoice.engines import manager as mgr_mod
from justvoice.engines.manager import discover_engines


# The roster decision. Engines here must carry a DEPRECATED reason; every
# other shipped engine must NOT — a stray mark would silently hide a keeper.
MARKED_FOR_REMOVAL = {"tada", "moss-tts"}


def test_exactly_the_decided_engines_are_marked():
    marked = {eid for eid, m in discover_engines().items() if m.deprecated}
    assert marked == MARKED_FOR_REMOVAL, (
        f"marked-for-removal set drifted from the 2026-08-17 roster decision: "
        f"expected {sorted(MARKED_FOR_REMOVAL)}, found {sorted(marked)}. "
        f"If the roster changed, change this test and the plan doc together."
    )


@pytest.mark.parametrize("engine_id", sorted(MARKED_FOR_REMOVAL))
def test_the_mark_carries_a_reason_a_user_can_read(engine_id):
    """The flag is a sentence, not a boolean — the UI shows it verbatim."""
    reason = discover_engines()[engine_id].deprecated
    assert reason, f"{engine_id} is marked with an empty reason"
    assert len(reason) > 30, f"{engine_id}'s reason is too terse to help: {reason!r}"
    assert reason[0].isupper(), f"{engine_id}'s reason should read as prose: {reason!r}"


def test_an_unmarked_engine_reports_an_empty_string_not_none():
    """`deprecated` is always a string, so the renderer can `.trim()` it."""
    for eid, m in discover_engines().items():
        assert isinstance(m.deprecated, str), f"{eid} returned {type(m.deprecated)}"


def test_marking_does_NOT_block_install(monkeypatch):
    """The user said mark and hide, NOT remove.

    A marked engine that somebody already installed has to keep working, and
    re-installing it must stay possible. This test exists so a later change
    cannot quietly promote the mark into a gate — the way the OS gate is one.
    """
    called: list[str] = []
    monkeypatch.setattr(
        mgr_mod, "_install_engine_isolated", lambda *a, **k: called.append("isolated")
    )

    for engine_id in sorted(MARKED_FOR_REMOVAL):
        m = discover_engines()[engine_id]
        assert m.deprecated  # precondition
        mgr_mod.install_engine(m)  # must not raise

    assert len(called) == len(MARKED_FOR_REMOVAL), (
        f"a marked engine was refused installation: {called}"
    )


def test_the_catalog_serves_the_mark():
    from fastapi.testclient import TestClient

    from justvoice.app import create_app

    with TestClient(create_app()) as client:
        body = client.get("/v1/engines").json()

    served = {e["id"]: e for e in body["engines"] if e.get("backend") == "managed"}
    assert served, "no managed engines served"

    manifests = discover_engines()
    for engine_id, row in served.items():
        assert "deprecated" in row, f"{engine_id} served no deprecated field"
        assert row["deprecated"] == manifests[engine_id].deprecated

    for engine_id in MARKED_FOR_REMOVAL:
        assert served[engine_id]["deprecated"], (
            f"{engine_id} is marked in its manifest but the catalog says otherwise"
        )
