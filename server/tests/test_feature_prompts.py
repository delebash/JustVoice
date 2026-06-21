# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/ai/prompts (JustVoice) — per-feature prompts are DB-seeded and
Lab-editable; the one-shot endpoints read their prompt from the DB, not a
hardcoded constant. See docs/plans/2026-06-21-feature-prompts-db-seed.md."""

from fastapi.testclient import TestClient

from justvoice.app import create_app


def test_prompts_seeded_and_editable(tmp_path):
    c = TestClient(create_app(data_dir=tmp_path))

    r = c.get("/v1/ai/prompts")
    assert r.status_code == 200, r.text
    by_key = {p["key"]: p for p in r.json()["prompts"]}
    # The one-shot features migrated this increment.
    assert "smart_assign" in by_key and "render_preset_suggest" in by_key and "show_notes" in by_key
    assert "casting director" in by_key["smart_assign"]["system"]
    assert by_key["smart_assign"]["builtIn"] is True

    # Edit persists to the DB and reads back.
    r = c.put("/v1/ai/prompts/smart_assign", json={
        "feature": "smart_assign", "system": "EDITED", "userTemplate": "",
        "temperature": 0.5, "think": False,
    })
    assert r.status_code == 200, r.text
    assert r.json()["system"] == "EDITED" and r.json()["temperature"] == 0.5
    assert c.get("/v1/ai/prompts/smart_assign").json()["system"] == "EDITED"

    # Reset restores the seeded default.
    r = c.post("/v1/ai/prompts/smart_assign/reset")
    assert r.status_code == 200, r.text
    assert "casting director" in r.json()["system"] and r.json()["temperature"] == 0.2


def test_reset_and_get_unknown(tmp_path):
    c = TestClient(create_app(data_dir=tmp_path))
    assert c.post("/v1/ai/prompts/nope/reset").status_code == 400
    assert c.get("/v1/ai/prompts/nope").status_code == 404


def test_endpoints_have_no_hardcoded_system_constant():
    # The migrated endpoints must not carry a SYSTEM_PROMPT constant anymore —
    # the prompt comes from the DB store.
    from justvoice.api import preset_suggest_api, projects_api, smart_assign_api

    assert not hasattr(smart_assign_api, "SYSTEM_PROMPT")
    assert not hasattr(preset_suggest_api, "SYSTEM_PROMPT")
    assert not hasattr(projects_api, "SHOW_NOTES_SYSTEM")
