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


# Nothing shipped is marked today: the two engines the 2026-08-17 roster marked
# (TADA, MOSS-TTSD) were removed outright with the 2026-10-01 switch. The
# mechanism stays for the next one, so these tests mark Kokoro for the length of
# a test.
REASON = "Marked for removal in this test — the reason a user reads on the badge."


@pytest.fixture
def marked(monkeypatch):
    m = discover_engines()["kokoro"]
    monkeypatch.setattr(m.module, "DEPRECATED", REASON, raising=False)
    return m


def test_no_shipped_engine_is_marked():
    marked = {eid for eid, m in discover_engines().items() if m.deprecated}
    assert marked == set(), f"an engine is marked for removal: {sorted(marked)}"


def test_the_mark_is_the_reason_a_user_reads(marked):
    """The flag is a sentence, not a boolean — the UI shows it verbatim."""
    assert marked.deprecated == REASON


def test_an_unmarked_engine_reports_an_empty_string_not_none():
    """`deprecated` is always a string, so the renderer can `.trim()` it."""
    for eid, m in discover_engines().items():
        assert isinstance(m.deprecated, str), f"{eid} returned {type(m.deprecated)}"


def test_marking_does_NOT_block_install(marked, monkeypatch):
    """The user said mark and hide, NOT remove: a marked engine somebody already
    installed keeps working, and installing it again stays possible. This test
    exists so a later change cannot quietly promote the mark into a gate — the
    way the OS gate is one."""
    called: list[str] = []
    monkeypatch.setattr(mgr_mod, "_install_audiocpp_runtime",
                        lambda *a, **k: called.append("runtime"))
    mgr_mod.install_engine(marked)  # must not raise
    assert called == ["runtime"]


def test_the_catalog_serves_the_mark(marked, tmp_path):
    from fastapi.testclient import TestClient

    from justvoice.app import create_app

    with TestClient(create_app(data_dir=tmp_path)) as client:
        body = client.get("/v1/engines").json()

    served = {e["id"]: e for e in body["engines"] if e.get("backend") == "managed"}
    assert served, "no managed engines served"
    assert served["kokoro"]["deprecated"] == REASON
    for engine_id, row in served.items():
        if engine_id != "kokoro":
            assert row["deprecated"] == "", engine_id
