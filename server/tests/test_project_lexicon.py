# SPDX-License-Identifier: MIT
"""A project's pronunciation lexicon reaches the audio (decided 2026-09-30,
docs/plans/2026-09-30-project-lexicon.md).

Before it, Overview had no lexicon row, the render read only the personas'
lexicons — every persona's, on every line of the chapter — and the cache was
keyed on which lexicons were attached, so choosing one re-rendered the book.
These pin the six rules:

  a  Overview can choose the book's lexicon, and clear it
  b  every render door reads it — the chapter resolver and the single-line door
  c  the book's lexicon wins over the persona's, whatever kind of entry each has
  d  the name scan counts a name as handled only where the render handles it
  e  the cache is keyed on what the lexicons change in a line
  f  a line is read with its own speaker's persona lexicon, not the whole cast's
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import justvoice.engines.manager as manager_module
from justvoice import render_core
from justvoice.api import render_chapter_api
from justvoice.app import create_app
from justvoice.database.models import Block, Project, Scene
from justvoice.models import ChapterLine, Lexicon, LexiconEntry, Persona, RenderChapterRequest, Settings
from justvoice.render_core import RenderedLine, _apply_lexicons, line_lexicons, probe_line_cached, render_line

from tests.conftest_db import tmp_db  # noqa: F401 — pytest discovers via fixture name
from tests.speaker_fixtures import speaker_played_by

NOW = datetime.now(timezone.utc)


def _lex(lid: str, *entries: dict) -> Lexicon:
    return Lexicon(
        id=lid, name=lid, created_at=NOW, updated_at=NOW,
        entries=[LexiconEntry(**e) for e in entries],
    )


def _lexicons(*lexes: Lexicon):
    by_id = {lx.id: lx for lx in lexes}
    return SimpleNamespace(get=lambda lid: by_id.get(lid))


# ── c · the book's lexicon wins, in a fixed order ───────────────────────


def test_line_lexicons_puts_the_book_first_and_never_repeats():
    assert line_lexicons("book", "persona") == ["book", "persona"]
    assert line_lexicons(None, "persona") == ["persona"]
    assert line_lexicons("book", None) == ["book"]
    assert line_lexicons("same", "same") == ["same"]
    assert line_lexicons(None, None) == []


def test_the_first_lexicon_wins_a_word_both_respell():
    st = SimpleNamespace(lexicons=_lexicons(
        _lex("book", {"grapheme": "Worcester", "alias": "Wooster"}),
        _lex("persona", {"grapheme": "Worcester", "alias": "Wusster"}),
    ))
    assert _apply_lexicons("To Worcester.", ["book", "persona"], st)[0] == "To Wooster."
    assert _apply_lexicons("To Worcester.", ["persona", "book"], st)[0] == "To Wusster."


def test_the_books_pronunciation_beats_the_personas_respelling():
    """An IPA entry never touched the text, so a later lexicon's respelling
    of the same word replaced it first and the IPA found nothing to say."""
    st = SimpleNamespace(lexicons=_lexicons(
        _lex("book", {"grapheme": "Worcester", "phoneme_ipa": "wˈʊstər"}),
        _lex("persona", {"grapheme": "worcester", "alias": "Wusster"},
             {"grapheme": "Worcester", "alias": "Wusster"}),
    ))
    text, ipa_map = _apply_lexicons("To Worcester.", ["book", "persona"], st, ipa_capable=True)
    assert text == "To Worcester."
    assert ipa_map == {"Worcester": "wˈʊstər"}


def test_a_respelling_claims_only_its_own_spelling():
    """A respelling matches its exact spelling. The book's "worcester" does
    nothing to "Worcester", so it must not silence the persona's entry that
    does — that would leave the word unhandled by both."""
    st = SimpleNamespace(lexicons=_lexicons(
        _lex("book", {"grapheme": "worcester", "alias": "wooster"}),
        _lex("persona", {"grapheme": "Worcester", "alias": "Wooster"}),
    ))
    assert _apply_lexicons("To Worcester.", ["book", "persona"], st)[0] == "To Wooster."


def test_words_differ_the_way_the_matchers_see_them():
    """Both matchers compare lowercased. casefold() folds ß to ss, so "Maße"
    and "Masse" — two words to the engine — collided and the second lost
    its pronunciation."""
    st = SimpleNamespace(lexicons=_lexicons(_lex(
        "book",
        {"grapheme": "Maße", "phoneme_ipa": "mˈaːsə"},
        {"grapheme": "Masse", "phoneme_ipa": "mˈasə"},
    )))
    assert _apply_lexicons("Die Masse.", ["book"], st, ipa_capable=True)[1] == {"Masse": "mˈasə"}


def test_an_entry_the_engine_cannot_use_decides_nothing():
    """IPA-only on an engine that takes no phonemes does nothing, so it
    claims nothing: the persona's respelling is what gets said."""
    st = SimpleNamespace(lexicons=_lexicons(
        _lex("book", {"grapheme": "Worcester", "phoneme_ipa": "wˈʊstər"}),
        _lex("persona", {"grapheme": "Worcester", "alias": "Wusster"}),
    ))
    assert _apply_lexicons("To Worcester.", ["book", "persona"], st, ipa_capable=False) == ("To Wusster.", {})


def test_a_blank_row_claims_nothing():
    """The import seeds every name as a blank row. It must not stop a later
    lexicon's real entry for the same word."""
    st = SimpleNamespace(lexicons=_lexicons(
        _lex("book", {"grapheme": "Worcester", "alias": ""}),
        _lex("persona", {"grapheme": "Worcester", "alias": "Wooster"}),
    ))
    assert _apply_lexicons("To Worcester.", ["book", "persona"], st)[0] == "To Wooster."


# ── e · the cache follows what a lexicon changes in the line ────────────


def test_the_ipa_map_holds_only_this_lines_words():
    st = SimpleNamespace(lexicons=_lexicons(_lex(
        "book",
        {"grapheme": "Worcester", "phoneme_ipa": "wˈʊstər"},
        {"grapheme": "Beauchamp", "phoneme_ipa": "bˈiːtʃəm"},
    )))

    def ipa_for(text):
        return _apply_lexicons(text, ["book"], st, ipa_capable=True)[1]

    assert ipa_for("To Worcester.") == {"Worcester": "wˈʊstər"}
    assert ipa_for("to WORCESTER, then.") == {"Worcester": "wˈʊstər"}
    assert ipa_for("Nothing to see.") == {}
    # A different word — the engine's matcher never half-matches it either.
    assert ipa_for("Worcestershire sauce") == {}


def test_the_host_keeps_exactly_the_words_an_ipa_splice_speaks():
    """render_core decides which IPA entries a line carries; the engine-side
    splice decides which it speaks — two matchers, one rule. The splice was
    kokoro/ipa.py until the 2026-10-01 switch and returns with the runtime's
    text+IPA input (switch plan §5); these are the words it spoke for each text,
    taken from it before it went, so the host matcher cannot drift meanwhile."""
    full = {"Worcester": "W", "Mara Vance": "MV", "Mara": "M", "Dr.": "D", "A.": "AA"}
    st = SimpleNamespace(lexicons=_lexicons(_lex(
        "book", *[{"grapheme": g, "phoneme_ipa": p} for g, p in full.items()]
    )))
    spoken = {
        "To Worcester.": ["Worcester"],
        "worcester and Mara Vance": ["Mara Vance", "Worcester"],
        "Mara came. Mara Vance left.": ["Mara", "Mara Vance"],
        "Worcestershire": [],
        "Nobody here.": [],
        # An entry ending in punctuation never matches the regex, but the
        # splice still spoke it when it sat alone between two matches.
        "Marathon Dr.A.": ["A.", "Dr."],
        "Worcester Dr. Worcester": ["Worcester"],
        "Dr.": [],
        "   ": [],
    }
    for text, words in spoken.items():
        kept = _apply_lexicons(text, ["book"], st, ipa_capable=True)[1]
        assert sorted(kept) == words, text


class _Cache:
    def __init__(self):
        self.d = {}

    def has(self, scope, key):
        return (scope, key) in self.d

    def get(self, scope, key):
        return self.d.get((scope, key))

    def put(self, scope, key, data):
        self.d[(scope, key)] = data


class _FakeManifest:
    id = "mock-tts"
    kind = "tts"
    capabilities = {"paralinguistic_tags": False}
    static_voices = [{"id": "mv_1", "name": "MV"}]


class _FakeManager:
    def __init__(self):
        self.synths = []
        self.current = {}

    def get_manifest(self, engine_id):
        return _FakeManifest() if engine_id == "mock-tts" else None

    def manifests(self):
        return {"mock-tts": _FakeManifest()}

    def current_for(self, kind):
        return self.current.get(kind)

    def load(self, engine_id, device="auto", **kw):
        self.current["tts"] = engine_id
        return {}

    def synth(self, engine_id, body):
        self.synths.append(dict(body))
        return b"\x00\x10" * 400, {"sample_rate": 16000, "channels": 1, "is_wav_container": False}


@pytest.fixture()
def fake_mgr(monkeypatch):
    mgr = _FakeManager()
    monkeypatch.setattr(manager_module, "get_manager", lambda: mgr)
    return mgr


def _render_state(lexicons):
    settings = SimpleNamespace(
        limits=SimpleNamespace(text_max_chars=5000),
        cache=SimpleNamespace(enabled=True),
        generation=SimpleNamespace(max_chunk_chars=800, crossfade_ms=50),
    )
    from justvoice.engines.registry import EngineRegistry

    st = SimpleNamespace(
        settings=SimpleNamespace(get=lambda: settings),
        engines=EngineRegistry(),
        voices=SimpleNamespace(get=lambda vid: None),
        lexicons=lexicons,
    )
    st._render_cache = _Cache()
    return st


def test_a_lexicon_re_renders_only_the_lines_it_changes(fake_mgr):
    """Choosing a lexicon on Overview used to re-render every line of the
    book, because the key held the lexicon's id."""
    st = _render_state(_lexicons(_lex("book", {"grapheme": "Worcester", "alias": "Wooster"})))
    render_line(st, voice="mv_1", text="Hi there.", cache_scope="s")
    render_line(st, voice="mv_1", text="To Worcester.", cache_scope="s")
    assert len(fake_mgr.synths) == 2

    # The lexicon is chosen. The line without its word is still cached…
    assert probe_line_cached(st, "mv_1", "Hi there.", lexicons=["book"], cache_scope="s") is True
    render_line(st, voice="mv_1", text="Hi there.", lexicons=["book"], cache_scope="s")
    assert len(fake_mgr.synths) == 2
    # …and the line with it is a new render, of the respelt text.
    assert probe_line_cached(st, "mv_1", "To Worcester.", lexicons=["book"], cache_scope="s") is False
    render_line(st, voice="mv_1", text="To Worcester.", lexicons=["book"], cache_scope="s")
    assert len(fake_mgr.synths) == 3
    assert fake_mgr.synths[-1]["text"] == "To Wooster."

    # Taking the lexicon off again finds the first render.
    render_line(st, voice="mv_1", text="To Worcester.", cache_scope="s")
    assert len(fake_mgr.synths) == 3


def test_an_ipa_edit_re_renders_only_the_lines_with_that_word(fake_mgr, monkeypatch):
    """Every IPA entry used to ride on every line, so on Kokoro any IPA edit
    re-rendered the whole chapter."""
    monkeypatch.setattr(render_core, "_supports_phoneme_input", lambda engine_id: True)
    box = {"book": _lex("book", {"grapheme": "Worcester", "phoneme_ipa": "one"})}
    st = _render_state(SimpleNamespace(get=lambda lid: box.get(lid)))

    def both():
        render_line(st, voice="mv_1", text="Hi there.", lexicons=["book"], cache_scope="s")
        render_line(st, voice="mv_1", text="To Worcester.", lexicons=["book"], cache_scope="s")

    both()
    assert len(fake_mgr.synths) == 2
    assert "ipa_map" not in fake_mgr.synths[0]["delivery"]
    assert fake_mgr.synths[1]["delivery"]["ipa_map"] == {"Worcester": "one"}

    box["book"] = _lex("book", {"grapheme": "Worcester", "phoneme_ipa": "two"})
    both()
    assert len(fake_mgr.synths) == 3, "only the line that says Worcester re-renders"
    assert fake_mgr.synths[2]["delivery"]["ipa_map"] == {"Worcester": "two"}


# ── f + b · the chapter resolver: each line's own lexicons ──────────────


def _persona(pid: str, *, lexicon_id: str | None = None) -> Persona:
    return Persona(
        id=pid, name=f"P {pid}", voice_id=f"voice-{pid}", default_delivery={},
        lexicon_id=lexicon_id, created_at=NOW, updated_at=NOW,
    )


def _personas(*personas: Persona):
    by_id = {p.id: p for p in personas}
    return SimpleNamespace(personas=SimpleNamespace(get=lambda pid: by_id.get(pid)))


def _seed(db, *, book_lexicon: str | None, speakers: list[str]):
    # tmp_db does not enforce foreign keys, so the lexicon ids need no rows.
    db.add(Project(id="proj-1", name="P", project_type="audiobook", default_lexicon_id=book_lexicon))
    db.flush()
    db.add(Scene(id="scene-1", project_id="proj-1", position=0, title="Ch 1"))
    db.flush()
    for i, pid in enumerate(speakers):
        db.add(Block(scene_id="scene-1", position=i, text=f"Line {i}.",
                     speaker_id=speaker_played_by(db, "scene-1", pid)))
    db.commit()


def test_each_line_gets_the_books_lexicon_then_its_own_personas(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    db = session_factory()
    _seed(db, book_lexicon="lex-book", speakers=["crow", "narrator", "crow"])
    db.close()

    lines = render_chapter_api._resolve_scene_to_lines(
        "scene-1", _personas(_persona("crow", lexicon_id="lex-crow"), _persona("narrator")),
    )
    assert [line.lexicons for line in lines] == [
        ["lex-book", "lex-crow"],
        ["lex-book"],            # Old Crow's slang never reaches the narrator
        ["lex-book", "lex-crow"],
    ]


def test_a_book_with_no_lexicon_keeps_only_the_personas(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    db = session_factory()
    _seed(db, book_lexicon=None, speakers=["crow", "narrator"])
    db.close()

    lines = render_chapter_api._resolve_scene_to_lines(
        "scene-1", _personas(_persona("crow", lexicon_id="lex-crow"), _persona("narrator")),
    )
    assert [line.lexicons for line in lines] == [["lex-crow"], None]


def _capture_chapter_render(monkeypatch, lines):
    """Run the two chapter doors over `lines`; return each render_line's lexicons."""
    seen: list[list[str]] = []
    settings = Settings()
    state = SimpleNamespace(settings=SimpleNamespace(get=lambda: settings))
    monkeypatch.setattr(render_chapter_api, "get_state", lambda: state)
    monkeypatch.setattr(render_chapter_api, "_resolve_scene_to_lines", lambda *a, **k: lines)
    monkeypatch.setattr(render_chapter_api, "render_line",
                        lambda st, **kw: seen.append(kw["lexicons"]) or object())

    async def no_warm(*a, **k):
        return None

    monkeypatch.setattr(render_chapter_api, "warm_lines", no_warm)
    monkeypatch.setattr(render_chapter_api, "concat_lines", lambda rendered, silence_ms: object())
    monkeypatch.setattr(render_chapter_api, "_master_scene_pcm", lambda c, t: (b"RIFF", t, None))
    monkeypatch.setattr(render_chapter_api, "_scene_master_target", lambda *a, **k: (None, "none"))
    return seen, state


def test_the_chapter_doors_render_each_line_with_its_own_lexicons(monkeypatch):
    lines = [
        ChapterLine(voice="v", text="One.", lexicons=["lex-book", "lex-crow"]),
        ChapterLine(voice="v", text="Two.", lexicons=["lex-book"]),
    ]
    seen, state = _capture_chapter_render(monkeypatch, lines)
    # Studio's Render.
    asyncio.run(render_chapter_api.render_chapter(RenderChapterRequest(scene_id="s1")))
    # The M4B export, the ACX check and the captions.
    render_chapter_api.render_scene_to_wav(state, "s1", master=False)
    assert seen == [["lex-book", "lex-crow"], ["lex-book"]] * 2


def test_a_requests_own_lexicons_follow_the_lines(monkeypatch):
    lines = [
        ChapterLine(voice="v", text="One.", lexicons=["lex-book"]),
        ChapterLine(voice="v", text="Two."),
    ]
    seen, _state = _capture_chapter_render(monkeypatch, lines)
    asyncio.run(render_chapter_api.render_chapter(
        RenderChapterRequest(scene_id="s1", lexicons=["lex-req", "lex-book"])))
    assert seen == [["lex-book", "lex-req"], ["lex-req", "lex-book"]]


# ── the app-level doors: Overview's save, the single line, the scan ─────


@pytest.fixture()
def client(tmp_path):
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


def _post(client, url, body):
    r = client.post(url, json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _book(client):
    """A book with a chosen lexicon, a second lexicon nobody chose, and Old
    Crow — played by a persona with a lexicon of its own."""
    pid = _post(client, "/v1/projects", {"name": "Harbor", "project_type": "audiobook"})["id"]
    book = _post(client, "/v1/lexicons", {
        "name": "Harbor names", "scope": "project", "project_id": pid,
        "entries": [{"grapheme": "Elara", "alias": "eh-LAH-ra"}],
    })["id"]
    spare = _post(client, "/v1/lexicons", {
        "name": "Old list", "scope": "project", "project_id": pid,
        "entries": [{"grapheme": "Brindlewood", "alias": "BRIN-dul-wood"}],
    })["id"]
    slang = _post(client, "/v1/lexicons", {
        "name": "Crow's slang", "entries": [{"grapheme": "Harbek", "alias": "AR-bek"}],
    })["id"]
    persona = _post(client, "/v1/personas", {"name": "Gravel", "voice_id": "af_heart", "lexicon_id": slang})["id"]
    crow = _post(client, f"/v1/projects/{pid}/speakers", {"name": "Old Crow", "persona_id": persona})["id"]
    scene = _post(client, f"/v1/projects/{pid}/scenes", {"title": "One"})["id"]
    said = _post(client, f"/v1/scenes/{scene}/blocks", {
        "position": 0, "speaker_id": crow,
        "text": "They told Harbek about Elara and Brindlewood.",
    })["id"]
    _post(client, f"/v1/scenes/{scene}/blocks", {
        "position": 1, "text": "Much later Harbek met Elara again.",
    })
    r = client.patch(f"/v1/projects/{pid}", json={"default_lexicon_id": book})
    assert r.status_code == 200, r.text
    return SimpleNamespace(pid=pid, book=book, spare=spare, slang=slang, said=said)


def test_overview_sets_clears_and_refuses_an_unknown_lexicon(client):
    b = _book(client)
    assert client.get(f"/v1/projects/{b.pid}").json()["default_lexicon_id"] == b.book
    # A save that says nothing about the lexicon leaves it.
    r = client.patch(f"/v1/projects/{b.pid}", json={"name": "Harbor Lights"})
    assert r.json()["default_lexicon_id"] == b.book
    # "None" on Overview.
    r = client.patch(f"/v1/projects/{b.pid}", json={"default_lexicon_id": None})
    assert r.status_code == 200 and r.json()["default_lexicon_id"] is None
    r = client.patch(f"/v1/projects/{b.pid}", json={"default_lexicon_id": "lex_nope"})
    assert r.status_code == 404
    assert client.get(f"/v1/projects/{b.pid}").json()["default_lexicon_id"] is None


def test_the_single_line_door_reads_the_books_lexicon_first(client, monkeypatch):
    """Lines ↻, a render job and the voiceline export all render a line
    through this one function — it read the persona's lexicon only."""
    b = _book(client)
    seen = {}

    def fake_render_line(state, **kw):
        seen.update(kw)
        return RenderedLine(pcm=b"\x00\x10" * 40, sample_rate=16000, channels=1, effective_delivery={})

    monkeypatch.setattr(render_core, "render_line", fake_render_line)
    from justvoice.api._speaker_helpers import persona_for_block
    from justvoice.app_state import get_state
    from justvoice.database import session as db_session
    from justvoice.export_voicelines import _render_block_production

    db = db_session.SessionLocal()
    try:
        block = db.get(Block, b.said)
        _render_block_production(get_state(), persona_for_block(db, block), block)
    finally:
        db.close()
    assert seen["lexicons"] == [b.book, b.slang]


def test_the_scan_counts_a_name_as_handled_only_where_the_render_handles_it(client):
    b = _book(client)
    r = client.post(f"/v1/projects/{b.pid}/pronunciation-report")
    assert r.status_code == 200, r.text
    words = {w["word"]: w["count"] for w in r.json()["words"]}
    # The book's chosen lexicon covers Elara on every line.
    assert "Elara" not in words
    # A book-scoped lexicon nobody chose is not read by the render.
    assert words.get("Brindlewood") == 1
    # The persona's lexicon covers Harbek on Old Crow's line only.
    assert words.get("Harbek") == 1

# ── §6 · 1 · Generate reads the lexicons the page sends ─────────────────


class _GenManager(_FakeManager):
    """A loaded managed engine with one voice, as `_find_managed_voice_owner` sees it."""

    def current_id(self):
        return "mock-tts"

    def voices(self, engine_id):
        return [{"id": "mv_1", "name": "MV"}]


class _NowScheduler:
    """Runs the one interactive item on the spot."""

    def submit(self, specs, interactive=False):
        result = specs[0][1]()
        return SimpleNamespace(
            items=[SimpleNamespace(result=result, error=None)],
            wait_async=_no_wait, raise_if_failed=lambda: None,
        )


async def _no_wait():
    return None


@pytest.fixture()
def gen_mgr(monkeypatch):
    import justvoice.synth_scheduler as scheduler_module
    from justvoice.api import generate_api

    mgr = _GenManager()
    monkeypatch.setattr(manager_module, "get_manager", lambda: mgr)
    monkeypatch.setattr(generate_api, "get_manager", lambda: mgr)
    monkeypatch.setattr(scheduler_module, "get_scheduler", lambda: _NowScheduler())
    return mgr


def test_generate_reads_the_lexicons_it_is_sent(client, gen_mgr):
    """Generate sent the persona's lexicon and showed its preview, and the
    server read none of it — a line on Generate was said one way and the same
    line in the chapter another."""
    lex = _post(client, "/v1/lexicons", {
        "name": "Harbor names", "entries": [{"grapheme": "Worcester", "alias": "Wooster"}],
    })["id"]
    r = client.post("/v1/generate", json={"voice": "mv_1", "text": "To Worcester.", "lexicons": [lex]})
    assert r.status_code == 200, r.text
    assert gen_mgr.synths[-1]["text"] == "To Wooster."
    # Sent none, read none.
    client.post("/v1/generate", json={"voice": "mv_1", "text": "To Worcester."})
    assert gen_mgr.synths[-1]["text"] == "To Worcester."


def test_generate_carries_the_ipa_of_the_words_it_says(client, gen_mgr, monkeypatch):
    monkeypatch.setattr(render_core, "_supports_phoneme_input", lambda engine_id: True)
    lex = _post(client, "/v1/lexicons", {
        "name": "Harbor names",
        "entries": [{"grapheme": "Worcester", "phoneme_ipa": "wˈʊstər"},
                    {"grapheme": "Beauchamp", "phoneme_ipa": "bˈiːtʃəm"}],
    })["id"]
    client.post("/v1/generate", json={"voice": "mv_1", "text": "To Worcester.", "lexicons": [lex]})
    body = gen_mgr.synths[-1]
    assert body["text"] == "To Worcester."
    assert body["delivery"]["ipa_map"] == {"Worcester": "wˈʊstər"}


# ── §6 · 3 · a new book lexicon is chosen for a book that has none ──────


def test_a_new_book_lexicon_is_chosen_for_a_book_that_has_none(client):
    """Only an import used to choose one, so a lexicon made by hand on the
    Lexicons page did nothing until someone found Overview's row."""
    pid = _post(client, "/v1/projects", {"name": "Harbor", "project_type": "audiobook"})["id"]
    first = _post(client, "/v1/lexicons", {"name": "Harbor names", "scope": "project", "project_id": pid})["id"]
    assert client.get(f"/v1/projects/{pid}").json()["default_lexicon_id"] == first
    # A second one leaves the book's choice alone…
    _post(client, "/v1/lexicons", {"name": "More names", "scope": "project", "project_id": pid})
    assert client.get(f"/v1/projects/{pid}").json()["default_lexicon_id"] == first
    # …and a reusable or a persona's lexicon never chooses itself.
    other = _post(client, "/v1/projects", {"name": "Ember", "project_type": "audiobook"})["id"]
    _post(client, "/v1/lexicons", {"name": "Nautical"})
    assert client.get(f"/v1/projects/{other}").json()["default_lexicon_id"] is None


# ── an IPA entry reaches only an engine that takes phonemes ─────────────


def test_apply_lexicons_routes_ipa_and_alias_by_capability():
    from justvoice.models import Lexicon, LexiconEntry

    now = datetime.now(timezone.utc)
    lex = Lexicon(
        id="lx1", name="test", created_at=now, updated_at=now,
        entries=[
            LexiconEntry(grapheme="Worcester", phoneme_ipa="wˈʊstər"),
            LexiconEntry(grapheme="Dr.", alias="Doctor"),
        ],
    )

    class _Lexicons:
        def get(self, lid):
            return lex if lid == "lx1" else None

    class _State:
        lexicons = _Lexicons()

    # IPA-capable engine: alias substitutes text, IPA goes to the map.
    text, ipa_map = render_core._apply_lexicons(
        "Dr. Smith of Worcester", ["lx1"], _State(), ipa_capable=True
    )
    assert text == "Doctor Smith of Worcester"
    assert ipa_map == {"Worcester": "wˈʊstər"}

    # Engine that cannot take phonemes: the IPA entry does nothing —
    # a guessed pronunciation beats reading IPA letters aloud.
    text, ipa_map = render_core._apply_lexicons(
        "Dr. Smith of Worcester", ["lx1"], _State(), ipa_capable=False
    )
    assert text == "Doctor Smith of Worcester"
    assert ipa_map == {}
