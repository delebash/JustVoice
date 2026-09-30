# SPDX-License-Identifier: MIT
"""Speaker identification — parser + discover/promote endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from llm_runner.llm import LLMNotConfiguredError

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from justvoice.extraction.identify import SpeakerCandidate, parse_candidates
from tests.jw_fixtures import book_json

# ── parser ───────────────────────────────────────────────────────────


def test_parse_plain_array():
    raw = '[{"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 11}]'
    out = parse_candidates(raw, ["Mara Vance"])
    assert out == [SpeakerCandidate(name="Tom Harlan", role_hint="neighbor", approx_lines=11)]


def test_parse_code_fenced_with_chatter():
    raw = 'Sure! Here are the new speakers:\n```json\n[{"name": "The Stranger"}]\n```\nLet me know!'
    out = parse_candidates(raw, [])
    assert [c.name for c in out] == ["The Stranger"]


def test_parse_dedupes_known_and_self_case_insensitive():
    raw = '[{"name": "MARA VANCE"}, {"name": "Tom"}, {"name": "tom"}, {"name": "narrator"}]'
    out = parse_candidates(raw, ["Mara Vance"])
    assert [c.name for c in out] == ["Tom"]


def test_parse_keeps_the_evidence_quote():
    raw = '[{"name": "Edith", "role_hint": "poured the tea", "approx_lines": 0, "evidence": "Edith’s hands"}]'
    out = parse_candidates(raw, [])
    assert out == [SpeakerCandidate(name="Edith", role_hint="poured the tea", approx_lines=0,
                                    evidence="Edith’s hands")]


def test_the_shipped_prompt_asks_for_named_people_not_speakers_or_descriptors():
    """2026-09-27: the old default asked for speakers only and offered "the
    stranger" as a name — the demo got "child" / "the elder" and lost Edith."""
    from justvoice.extraction.identify import IDENTIFY_SYSTEM

    assert "whether or not they speak" in IDENTIFY_SYSTEM
    assert '"child"' in IDENTIFY_SYSTEM and "are not characters" in IDENTIFY_SYSTEM
    assert '"evidence"' in IDENTIFY_SYSTEM
    assert "the stranger" not in IDENTIFY_SYSTEM.lower()
    assert "named object" in IDENTIFY_SYSTEM            # fix B — not "Gudgeon" the maul
    assert "nickname" in IDENTIFY_SYSTEM                # fix 2 — not "Ode" for Odeline


def test_parse_garbage_returns_empty():
    assert parse_candidates("I could not find any JSON to give you.", []) == []
    assert parse_candidates('{"name": "not a list"}', []) == []


# ── endpoints ────────────────────────────────────────────────────────


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


def _import_project(client) -> tuple[str, str]:
    # A real JustWrite book.json (tests/jw_fixtures.py). Its lines arrive
    # SPEAKERLESS — JustWrite does not attribute dialogue — which is exactly
    # the state these discovery tests are about.
    r = client.post("/v1/projects/import?source=justwrite", json=book_json())
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    scenes = client.get(f"/v1/projects/{pid}/scenes").json()
    return pid, scenes[0]["id"]


def test_discover_501_without_llm(client, monkeypatch):
    """No LLM configured must map to 501, and the no-LLM state is FORCED.

    This used to assert 501 while relying on the machine simply not having a
    working LLM. That made it pass for the wrong reason — and it broke the
    moment the engine venv was repaired, because a real local LLM then answered
    and returned 200. It had never been testing the 501 mapping at all.

    Its sibling below forces the LLM path by patching; this forces the other
    side of the same seam, so both are independent of what is installed.
    """
    from llm_runner.llm import dispatch

    def refuse(*_a, **_kw):
        raise LLMNotConfiguredError("no LLM provider registered")

    monkeypatch.setattr(dispatch, "chat", refuse)
    monkeypatch.setattr("justvoice.extraction.identify.identify_speakers", refuse, raising=False)

    _pid, scene_id = _import_project(client)
    r = client.post(f"/v1/scenes/{scene_id}/discover-speakers", json={"text": "“Hi,” said Tom."})
    assert r.status_code == 501, r.text


def test_discover_with_stubbed_llm(client, monkeypatch):
    _pid, scene_id = _import_project(client)

    def fake_identify(text, known, *, settings, run_fn=None, raw_out=None):
        # The cast arrives as people, not bare names (fix 2): name, aliases,
        # and the character sheet the model gets one line of.
        assert "Mara Vance" in [k["name"] for k in known]
        assert all("aliases" in k and "description" in k for k in known)
        return [SpeakerCandidate(name="Tom Harlan", role_hint="neighbor", approx_lines=3)]

    monkeypatch.setattr("justvoice.extraction.identify.identify_speakers", fake_identify)
    r = client.post(f"/v1/scenes/{scene_id}/discover-speakers", json={"text": "“Hi,” said Tom."})
    assert r.status_code == 200, r.text
    assert r.json()["candidates"] == [
        {"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 3, "evidence": None,
         "evidence_found": None}
    ]
    assert r.json()["named_cast"] == [], "the text names nobody in the cast"


def _speakers(client, pid):
    return client.get(f"/v1/projects/{pid}/speakers").json()["speakers"]


def test_add_makes_a_speaker_and_no_persona(client):
    """Since 2026-09-29 Discover's Add makes a speaker in this book; the
    library of personas (the voices) is not touched. Adding the same name
    again is refused — names are unique within a book."""
    pid, _scene_id = _import_project(client)
    body = {"candidates": [{"name": "Tom Harlan", "description": "neighbor"}]}
    r1 = client.post(f"/v1/projects/{pid}/speakers/promote", json=body)
    assert r1.status_code == 200, r1.text
    assert len(r1.json()["created"]) == 1 and r1.json()["reused"] == []
    tom = next(sp for sp in _speakers(client, pid) if sp["name"] == "Tom Harlan")
    assert (tom["id"], tom["description"], tom["persona_id"]) == (r1.json()["created"][0], "neighbor", None)
    assert client.get("/v1/personas").json()["personas"] == []
    assert client.post(f"/v1/projects/{pid}/speakers/promote", json=body).status_code == 409


def _scan(client, monkeypatch, scene_id, names):
    def fake_identify(text, known, *, settings, run_fn=None, raw_out=None):
        return [SpeakerCandidate(name=n, role_hint=None, approx_lines=2) for n in names]

    monkeypatch.setattr("justvoice.extraction.identify.identify_speakers", fake_identify)
    r = client.post(f"/v1/scenes/{scene_id}/discover-speakers", json={"text": "“Hi,” said Tom."})
    assert r.status_code == 200, r.text


def _saved(client, pid, scene_id):
    scene = next(s for s in client.get(f"/v1/projects/{pid}/scenes").json() if s["id"] == scene_id)
    return scene["metadata"].get("discover")


def test_a_scan_is_saved_on_its_chapter_and_replaces_the_last_one(client, monkeypatch):
    """Decided 2026-09-27 ("both"): a chapter's scan survives a restart."""
    pid, scene_id = _import_project(client)
    _scan(client, monkeypatch, scene_id, ["Tom Harlan", "The Stranger"])
    saved = _saved(client, pid, scene_id)
    assert saved["scanned_at"]
    assert [c["name"] for c in saved["candidates"]] == ["Tom Harlan", "The Stranger"]

    _scan(client, monkeypatch, scene_id, ["Old Crow"])
    assert [c["name"] for c in _saved(client, pid, scene_id)["candidates"]] == ["Old Crow"]


def test_add_and_ignore_keep_the_saved_scan(client, monkeypatch):
    """Decided 2026-09-29 ("your rec go"): Add and Ignore change a name's status,
    they don't remove it — the chapter's record of who it names stays whole."""
    pid, scene_id = _import_project(client)
    _scan(client, monkeypatch, scene_id, ["Tom Harlan", "The Stranger", "Old Crow"])
    everyone = ["Tom Harlan", "The Stranger", "Old Crow"]

    r = client.post(f"/v1/projects/{pid}/speakers/promote",
                    json={"candidates": [{"name": "tom harlan"}]})
    assert r.status_code == 200, r.text
    assert [c["name"] for c in _saved(client, pid, scene_id)["candidates"]] == everyone

    r = client.post(f"/v1/projects/{pid}/discover/ignore", json={"names": ["THE STRANGER"]})
    assert r.status_code == 200 and r.json() == {"ignored": ["THE STRANGER"]}
    assert [c["name"] for c in _saved(client, pid, scene_id)["candidates"]] == everyone


def test_a_scan_records_the_cast_members_the_chapter_names(client, monkeypatch):
    """The book's speakers are found by name in the text, without the AI: the
    fixture book has Mara Vance, named here in full and by her first name."""
    pid, scene_id = _import_project(client)
    mara = next(sp for sp in _speakers(client, pid) if sp["name"] == "Mara Vance")
    _stub(monkeypatch, [])
    text = "Rain fell. Mara Vance opened the door. Later Mara laughed."
    r = client.post(f"/v1/scenes/{scene_id}/discover-speakers", json={"text": text})
    assert r.status_code == 200, r.text
    expect = [{"speaker_id": mara["id"], "name": "Mara Vance", "mentions": 2,
               "evidence": "Mara Vance opened the door."}]
    assert r.json()["named_cast"] == expect
    assert _saved(client, pid, scene_id)["named_cast"] == expect


def _stub(monkeypatch, cands):
    def fake_identify(text, known, *, settings, run_fn=None, raw_out=None):
        return [SpeakerCandidate(**c) for c in cands]

    monkeypatch.setattr("justvoice.extraction.identify.identify_speakers", fake_identify)


def _discover(client, scene_id, text="Brick said nothing. Tom Harlan laughed."):
    r = client.post(f"/v1/scenes/{scene_id}/discover-speakers", json={"text": text})
    assert r.status_code == 200, r.text
    return r.json()["candidates"]


def test_a_cast_member_named_by_first_or_last_name_is_not_proposed(client, monkeypatch):
    """The fixture book has Mara Vance: "Mara" alone is her, not a newcomer."""
    _pid, scene_id = _import_project(client)
    _stub(monkeypatch, [{"name": "Mara"}, {"name": "Tom Harlan"}])
    assert [c["name"] for c in _discover(client, scene_id)] == ["Tom Harlan"]


def test_add_casts_a_new_speaker_with_the_persona_of_exactly_its_name(client, monkeypatch):
    """"In your library" (2026-09-29) = a persona of EXACTLY the found name —
    Add makes the speaker already cast with it. A first name alone is not
    that name, and two personas sharing the name mean neither."""
    pid, scene_id = _import_project(client)
    from justvoice.app_state import get_state

    brick = client.post("/v1/personas", json={"name": "Brick Halvorn"}).json()
    # Two personas of one name: the API refuses the second since 2026-09-29, but a
    # library from before then can hold them — the store makes them here.
    for _ in range(2):
        get_state().personas.create("Anna")
    r = client.post(f"/v1/projects/{pid}/speakers/promote", json={"candidates": [
        {"name": "brick  halvorn"}, {"name": "Brick"}, {"name": "Anna"}]})
    assert r.status_code == 200, r.text
    cast = {sp["name"]: sp["persona_id"] for sp in _speakers(client, pid)}
    assert cast["brick halvorn"] == brick["id"]
    assert cast["Brick"] is None and cast["Anna"] is None
    # Now a speaker — so a re-scan proposes nobody new, and records him.
    _stub(monkeypatch, [{"name": "Brick Halvorn"}])
    assert _discover(client, scene_id, text="Brick Halvorn said nothing.") == []
    named = _saved(client, pid, scene_id)["named_cast"]
    assert next(sp["id"] for sp in _speakers(client, pid) if sp["name"] == "brick halvorn") in [
        n["speaker_id"] for n in named]


def test_add_keeps_the_other_spellings_as_also_called(client, monkeypatch):
    """A merged proposal ("Old Sedge" + "Sedge") becomes one speaker that knows
    both names. The saved scan keeps both names (Add changes status only)."""
    pid, scene_id = _import_project(client)
    _stub(monkeypatch, [{"name": "Old Sedge"}, {"name": "Sedge"}])
    _discover(client, scene_id)
    r = client.post(f"/v1/projects/{pid}/speakers/promote",
                    json={"candidates": [{"name": "Old Sedge", "aliases": ["Sedge"]}]})
    [new_id] = r.json()["created"]
    assert next(sp for sp in _speakers(client, pid) if sp["id"] == new_id)["aliases"] == ["Sedge"]
    assert [c["name"] for c in _saved(client, pid, scene_id)["candidates"]] == ["Old Sedge", "Sedge"]


def test_the_quote_is_checked_against_the_chapter(client, monkeypatch):
    """Fix 3: an invented quote is flagged, a real one (any quote marks) passes."""
    _pid, scene_id = _import_project(client)
    _stub(monkeypatch, [{"name": "Tom Harlan", "evidence": "Tom Harlan laughed"},
                        {"name": "Old Crow", "evidence": "Old Crow spat"}])
    got = {c["name"]: c["evidence_found"] for c in _discover(client, scene_id)}
    assert got == {"Tom Harlan": True, "Old Crow": False}


def test_ignore_is_remembered_across_scans_and_can_be_undone(client, monkeypatch):
    """Fix 4: an ignored name is remembered for the project. Since 2026-09-29 a
    re-scan still records it — the page shows it as Ignored, with Undo."""
    pid, scene_id = _import_project(client)
    _stub(monkeypatch, [{"name": "Gudgeon"}, {"name": "Tom Harlan"}])
    _discover(client, scene_id)
    r = client.post(f"/v1/projects/{pid}/discover/ignore", json={"names": ["Gudgeon"]})
    assert r.json()["ignored"] == ["Gudgeon"]
    assert client.get(f"/v1/projects/{pid}").json()["discover_ignored"] == ["Gudgeon"]
    assert [c["name"] for c in _discover(client, scene_id)] == ["Gudgeon", "Tom Harlan"]

    r = client.post(f"/v1/projects/{pid}/discover/unignore", json={"names": ["gudgeon"]})
    assert r.json()["ignored"] == []
    assert client.get(f"/v1/projects/{pid}").json()["discover_ignored"] == []


def test_analyze_gets_speaker_aliases(client):
    """"Also called" reaches attribution: anchors.py and the prompt read `aliases`."""
    from justvoice.api.extraction_api import _resolve_cast
    from justvoice.database import session as db_session

    pid, scene_id = _import_project(client)
    mara = next(sp for sp in _speakers(client, pid) if sp["name"] == "Mara Vance")
    r = client.patch(f"/v1/speakers/{mara['id']}", json={"aliases": ["Mara", " mara ", "Mara Vance"]})
    assert r.json()["aliases"] == ["Mara"], "trimmed, de-duplicated, never the speaker's own name"
    db = db_session.SessionLocal()
    try:
        cast = _resolve_cast(scene_id, db)
    finally:
        db.close()
    assert next(c for c in cast if c["name"] == "Mara Vance")["aliases"] == ["Mara"]


def test_ignore_on_a_missing_project_is_404(client):
    assert client.post("/v1/projects/nope/discover/ignore", json={"names": ["x"]}).status_code == 404


# ── The ad-hoc discovery door (the attribution Lab's identify twin) ──


def test_discover_adhoc_free_text(client, monkeypatch):
    """POST /v1/extraction/discover-speakers — no scene, caller-supplied known
    names (parity batch 2026-08-06: the Lab's identify columns run this)."""

    def fake_identify(text, known, *, settings, run_fn=None, raw_out=None):
        assert known == ["Mara Vance"]
        assert "Tom" in text
        return [SpeakerCandidate(name="Tom Harlan", role_hint="neighbor", approx_lines=3)]

    monkeypatch.setattr("justvoice.extraction.identify.identify_speakers", fake_identify)
    r = client.post(
        "/v1/extraction/discover-speakers",
        json={"text": "“Hi,” said Tom.", "known_characters": ["Mara Vance"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["scene_id"] == "(adhoc)"
    assert r.json()["candidates"] == [
        {"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 3, "evidence": None,
         "evidence_found": None}
    ]


def test_discover_adhoc_threads_column_pins(client, monkeypatch):
    """The Lab column's pins (provider/model/temperature/prompts) thread through
    the route's run_fn into the shared run path's kwargs."""
    captured = {}

    def fake_run(action, variables, **overrides):
        captured.update(action=action, **overrides)

        class R:
            text = '[{"name": "Tom Harlan"}]'

        return R()

    monkeypatch.setattr("justvoice.engines.llm.run.run_feature", fake_run)
    r = client.post(
        "/v1/extraction/discover-speakers",
        json={
            "text": "“Hi,” said Tom.",
            "known_characters": ["Mara Vance"],
            "providerId": "anthropic",
            "model": "claude-sonnet-5",
            "temperature": 0.1,
            "systemPrompt": "CUSTOM DISCOVERY PROMPT",
        },
    )
    assert r.status_code == 200, r.text
    assert captured["action"] == "speaker_attribution.identify"
    assert captured["providerId"] == "anthropic"
    assert captured["model"] == "claude-sonnet-5"
    assert captured["temperature"] == 0.1
    assert captured["system"] == "CUSTOM DISCOVERY PROMPT"
    assert [c["name"] for c in r.json()["candidates"]] == ["Tom Harlan"]


# ── Speaker Lab per-column overrides reach the LLM call ──────────────


def test_analyze_text_threads_model_temp_prompt_overrides(client, monkeypatch):
    # The pipeline runs through the shared run path now (F1 Phase 2); the seam
    # is its run_feature import — capture what the Lab's overrides thread into
    # the RunRequest kwargs.
    captured = {}

    def fake_run(action, variables, **overrides):
        captured.update(action=action, variables=variables, **overrides)

        class R:
            text = '[{"speaker": "mara", "confidence": 0.9}]'

        return R()

    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", fake_run)
    r = client.post(
        "/v1/extraction/analyze-text",
        json={
            "text": '"Hello," said Mara.',
            "characters": [{"id": "mara", "name": "Mara"}],
            "model": "qwen3:14b",
            "temperature": 0.05,
            "systemPrompt": "CUSTOM PROMPT BODY",
        },
    )
    assert r.status_code == 200, r.text
    assert captured["model"] == "qwen3:14b"
    assert captured["temperature"] == 0.05
    assert captured["system"] == "CUSTOM PROMPT BODY"
    # A per-call model override is the model that actually runs, so Auto
    # judges IT (the old system's documented behavior, kept by the restore):
    # qwen3:14b reads 14B ≥ 14 → the Direct route (Auto is SIZE-ONLY since
    # the tier-debris cleanup 2026-08-07). The pipeline still never FORCES
    # think — the caller sent none, so it rides as None (Part 2, 2026-08-06:
    # the controls are real passthroughs; None = the route's preset value).
    assert captured["action"] == "speaker_attribution.direct"
    assert captured.get("think") is None
    assert 'id="mara"' in captured["variables"]["speakers"]
    assert r.json()["raw_llm"] == '[{"speaker": "mara", "confidence": 0.9}]'


# ── local LLM detection probe ────────────────────────────────────────


def test_detect_local_llm_providers(client, monkeypatch):
    class FakeResp:
        status_code = 200

        def json(self):
            return {"models": [{"name": "llama3.1:8b"}, {"name": "qwen3:14b"}]}

    def fake_get(url, timeout=None):
        if "11434" in url:
            return FakeResp()
        raise ConnectionError("down")

    import httpx

    monkeypatch.setattr(httpx, "get", fake_get)
    r = client.get("/v1/llm-providers/detect-local")
    assert r.status_code == 200, r.text
    det = r.json()["detected"]
    assert len(det) == 1
    assert det[0]["providerType"] == "ollama"
    assert "qwen3:14b" in det[0]["models"]
    assert det[0]["alreadyRegistered"] is False


# ── AI usage ledger ──────────────────────────────────────────────────


def test_usage_ledger_records_chat_calls(client, monkeypatch):
    from llm_runner.llm import get_ledger, get_llm_registry
    from llm_runner.llm.dispatch import set_ensure_local_model

    get_ledger().clear()

    class FakeAdapter:
        # The preset routes to local-llamacpp; registering the fake under that
        # id lets the REAL resolution find it (no resolve patching).
        provider_id = "local-llamacpp"
        provider_type = "openai-compat"
        default_model = "qwen3:8b"

        def chat(self, messages, *, model, temperature, max_tokens, system, think, **kwargs):
            # **kwargs: the shared chat() surface grows (extra=, reasoning knobs);
            # a strict stub signature breaks on every addition — tolerate like a
            # real adapter does.
            from llm_runner.llm import LLMResponse

            return LLMResponse(
                text='[{"speaker": "mara", "confidence": 0.9}]',
                model=model or self.default_model, prompt_tokens=120, completion_tokens=18,
            )

    get_llm_registry()._adapters = {}
    get_llm_registry().register(FakeAdapter())
    set_ensure_local_model(None)  # no bundled-runner load in unit tests
    r = client.post(
        "/v1/extraction/analyze-text",
        json={"text": '"Hi," said Mara.', "characters": [{"id": "mara", "name": "Mara"}]},
    )
    assert r.status_code == 200, r.text

    usage = client.get("/v1/ai-usage").json()
    feat = usage["by_feature"]["speaker_attribution"]
    assert feat["calls"] == 1 and feat["errors"] == 0
    assert feat["prompt_tokens"] == 120 and feat["completion_tokens"] == 18
    assert usage["recent"][0]["model"] == "qwen3:8b"

    client.delete("/v1/ai-usage")
    assert client.get("/v1/ai-usage").json()["total_calls"] == 0


# ── show notes ───────────────────────────────────────────────────────


def test_show_notes_501_without_llm_and_works_with_stub(client, monkeypatch):
    pid, _scene = _import_project(client)

    from llm_runner.llm import LLMResponse, get_llm_registry
    from llm_runner.llm.dispatch import set_ensure_local_model

    # Force the no-LLM half: an EMPTY registry makes the shared run path's own
    # resolution raise LLMNotConfiguredError — testing the real 501 mapping.
    get_llm_registry()._adapters = {}
    set_ensure_local_model(None)
    r = client.post(f"/v1/projects/{pid}/show-notes")
    assert r.status_code == 501, r.text

    # Success half: a capturing adapter under the preset's provider id — the
    # {{script}} template row renders the project's segments into the user turn.
    class FakeAdapter:
        provider_id = "local-llamacpp"
        provider_type = "openai-compat"
        default_model = "m"

        def chat(self, messages, *, model=None, system=None, **kwargs):
            # The chapter heading and its prose, rendered from the project's
            # segments. The speaker reads NARRATION, not "Mara Vance": a
            # JustWrite import arrives speakerless by design, and Analyze is
            # what assigns characters to lines.
            assert "## One" in messages[-1].content
            assert "NARRATION: Hello." in messages[-1].content
            assert "show notes" in (system or "").lower()
            return LLMResponse(text="## Episode summary\nA test episode.",
                               model=model or self.default_model)

    get_llm_registry().register(FakeAdapter())
    r = client.post(f"/v1/projects/{pid}/show-notes")
    assert r.status_code == 200, r.text
    assert r.json()["markdown"].startswith("## Episode summary")


def test_a_justwrite_characters_aliases_become_the_speakers_also_called(client):
    """A JustWrite book can list `aliases` per character; the import keeps them
    on the speaker (not only as prose in Who they are)."""
    book = book_json()
    book["characters"][0]["aliases"] = ["Mar", "The Widow"]
    name = book["characters"][0]["name"]
    r = client.post("/v1/projects/import?source=justwrite", json=book)
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    speaker = next(sp for sp in client.get(f"/v1/projects/{pid}/speakers").json()["speakers"]
                   if sp["name"] == name)
    assert speaker["aliases"] == ["Mar", "The Widow"]
