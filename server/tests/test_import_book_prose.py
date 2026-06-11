# SPDX-License-Identifier: GPL-3.0-or-later
"""book_prose adapter — EPUB / DOCX / Markdown / TXT, synthetic fixtures."""

from __future__ import annotations

import io
import zipfile

import pytest

from justvoice.errors import ApiError
from justvoice.imports import get_adapter, run_adapter
from justvoice.imports.adapters.book_prose import parse

pytest_plugins = ["tests.conftest_db"]

# ── fixture builders ─────────────────────────────────────────────────

_CONTAINER = """<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""


def _opf(spine_items: list[str]) -> str:
    manifest = "\n".join(
        f'<item id="d{i}" href="{h}" media-type="application/xhtml+xml"/>'
        for i, h in enumerate(spine_items)
    )
    spine = "\n".join(f'<itemref idref="d{i}"/>' for i in range(len(spine_items)))
    return f"""<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Stillwater</dc:title>
    <dc:creator>S. K. Holloway</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>{manifest}</manifest>
  <spine>{spine}</spine>
</package>"""


def _xhtml(title: str | None, paragraphs: list[str]) -> str:
    h = f"<h1>{title}</h1>" if title else ""
    body = "".join(f"<p>{p}</p>" for p in paragraphs)
    return f"<html><head><title>x</title></head><body>{h}{body}</body></html>"


def _make_epub(docs: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("META-INF/container.xml", _CONTAINER)
        zf.writestr("OEBPS/content.opf", _opf(list(docs)))
        for href, content in docs.items():
            zf.writestr(f"OEBPS/{href}", content)
    return buf.getvalue()


_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _docx_para(text: str, style: str | None = None) -> str:
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{ppr}<w:r><w:t>{text}</w:t></w:r></w:p>"


def _make_docx(paras: list[tuple[str, str | None]], title: str | None = None) -> bytes:
    body = "".join(_docx_para(t, s) for t, s in paras)
    document = f'<?xml version="1.0"?><w:document xmlns:w="{_W}"><w:body>{body}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", document)
        if title:
            zf.writestr(
                "docProps/core.xml",
                '<?xml version="1.0"?><cp:coreProperties '
                'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
                'xmlns:dc="http://purl.org/dc/elements/1.1/">'
                f"<dc:title>{title}</dc:title></cp:coreProperties>",
            )
    return buf.getvalue()


# ── EPUB ─────────────────────────────────────────────────────────────


def test_epub_chapters_split_on_spine_with_titles():
    raw = _make_epub(
        {
            "title.xhtml": _xhtml(None, ["Stillwater. By S. K. Holloway."]),
            "ch1.xhtml": _xhtml(
                "The Lake House",
                ["The lake held the fog all morning.", "Mara watched it burn off."],
            ),
            "ch2.xhtml": _xhtml(
                "What the Water Keeps", ["Edith poured the tea without apology."]
            ),
        }
    )
    out = parse(raw, filename="stillwater.epub")
    assert out.source == "book_prose"
    assert out.project.name == "Stillwater"
    assert out.project.kind == "audiobook"
    assert out.project.language == "en"
    assert out.project.description == "by S. K. Holloway"
    assert [s.title for s in out.scenes] == ["The Lake House", "What the Water Keeps"]
    assert [len(s.lines) for s in out.scenes] == [2, 1]
    assert out.scenes[0].lines[0].text == "The lake held the fog all morning."
    assert out.scenes[0].lines[0].character_id is None  # prose: no speakers yet
    assert out.characters == []
    assert any("front matter" in w for w in out.warnings)  # title page skipped


def test_epub_detected_by_content_despite_wrong_extension():
    raw = _make_epub({"ch1.xhtml": _xhtml("One", ["Some honest paragraph text here."])})
    out = parse(raw, filename="mystery.bin")
    assert out.scenes[0].title == "One"


def test_epub_unique_scene_ids_for_duplicate_titles():
    raw = _make_epub(
        {
            "a.xhtml": _xhtml("Interlude", ["First interlude paragraph content."]),
            "b.xhtml": _xhtml("Interlude", ["Second interlude paragraph content."]),
        }
    )
    out = parse(raw, filename="book.epub")
    ids = [s.id for s in out.scenes]
    assert len(ids) == len(set(ids)) == 2


# ── DOCX ─────────────────────────────────────────────────────────────


def test_docx_headings_start_chapters():
    raw = _make_docx(
        [
            ("The Lake House", "Heading1"),
            ("The lake held the fog all morning.", None),
            ("Mara watched it burn off.", None),
            ("Old Debts", "Heading1"),
            ("Edith poured the tea.", None),
        ],
        title="Stillwater",
    )
    out = parse(raw, filename="stillwater.docx")
    assert out.project.name == "Stillwater"
    assert [s.title for s in out.scenes] == ["The Lake House", "Old Debts"]
    assert [len(s.lines) for s in out.scenes] == [2, 1]


def test_docx_without_headings_is_one_chapter():
    raw = _make_docx([("Only paragraph one.", None), ("Only paragraph two.", None)])
    out = parse(raw, filename="draft.docx")
    assert len(out.scenes) == 1
    assert len(out.scenes[0].lines) == 2
    assert out.project.name == "draft"  # falls back to file stem


# ── Markdown / TXT ───────────────────────────────────────────────────


def test_markdown_headings_split():
    text = "# One\n\nPara a.\n\nPara b.\n\n## Two\n\nPara c.\n"
    out = parse(text.encode(), filename="book.md")
    assert [s.title for s in out.scenes] == ["One", "Two"]
    assert [len(s.lines) for s in out.scenes] == [2, 1]


def test_txt_chapter_heuristic():
    text = "Chapter 1\n\nFirst paragraph.\n\nChapter 2\n\nSecond paragraph.\n"
    out = parse(text.encode(), filename="book.txt")
    assert [s.title for s in out.scenes] == ["Chapter 1", "Chapter 2"]


def test_txt_without_chapters_is_single_scene():
    out = parse(b"Just one blob of text.\n\nAnd another paragraph.", filename="note.txt")
    assert len(out.scenes) == 1
    assert len(out.scenes[0].lines) == 2


# ── errors + registry ────────────────────────────────────────────────


def test_unreadable_binary_rejected():
    with pytest.raises(ApiError):
        parse(b"\xff\xfe\x00\x01binarygarbage", filename="bad.epub")


def test_registered_and_runs_through_registry():
    assert get_adapter("book_prose") is not None
    out = run_adapter("book_prose", b"# T\n\nHello world paragraph.", filename="t.md")
    assert out.scenes[0].lines[0].text == "Hello world paragraph."


# ── endpoint: multipart dry-run through the real router ──────────────


def test_endpoint_multipart_dry_run_epub(db_session, tmp_path, monkeypatch):
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient

    from justvoice.api import projects_api
    from justvoice.database import get_db
    from justvoice.errors import ApiError, api_exception_handler, http_exception_handler

    app = FastAPI()
    app.include_router(projects_api.router)
    app.add_exception_handler(ApiError, api_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.dependency_overrides[get_db] = lambda: db_session

    raw = _make_epub(
        {
            "front.xhtml": _xhtml(None, ["Tiny title page."]),
            "ch1.xhtml": _xhtml("One", ["First chapter paragraph text goes here."]),
        }
    )
    client = TestClient(app, raise_server_exceptions=False)
    r = client.post(
        "/v1/projects/import",
        data={"source": "book_prose", "dry_run": "true"},
        files={"file": ("stillwater.epub", raw, "application/epub+zip")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["committed"] is False and body["project_id"] is None
    assert body["standard"]["project"]["name"] == "Stillwater"
    assert [s["title"] for s in body["standard"]["scenes"]] == ["One"]
    assert any("front matter" in w for w in body["warnings"])
