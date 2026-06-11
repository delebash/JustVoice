# SPDX-License-Identifier: GPL-3.0-or-later
"""Book / manuscript import adapter — EPUB, DOCX, Markdown, plain text.

The audiobook entry point for users who don't come from JustWrite: a
finished book file goes in, chapters + paragraph lines come out. No
speaker data exists in these formats, so no characters are emitted —
speakers are discovered later by Script extraction (CONCEPTS.md §3).

Parsing is stdlib-only on purpose (zipfile + xml.etree + html.parser):
headless `justvoice-server serve` must import books without the
renderer or any optional dependency.

Format handling:
  - EPUB  — spine order from the OPF; one chapter per spine document;
            chapter title from the first <h1>–<h3>; nav/cover and
            near-empty front-matter docs are skipped with a warning.
  - DOCX  — paragraphs from word/document.xml; "Heading 1/2/3" styles
            start a new chapter.
  - MD    — "#" / "##" headings start a new chapter.
  - TXT   — short "Chapter N…"-style lines start a new chapter;
            otherwise the whole file is one scene.
"""

from __future__ import annotations

import io
import re
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

from ...errors import bad_request
from ..standard_schema import (
    StandardImport,
    StandardLine,
    StandardProject,
    StandardScene,
)

SOURCE_ID = "book_prose"

# Spine documents with fewer words than this and no heading are treated
# as front matter (title page, dedication) and skipped with a warning.
_FRONT_MATTER_MAX_WORDS = 15

_BLOCK_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"}
_HEADING_TAGS = {"h1", "h2", "h3"}


def parse(raw: bytes, *, filename: str | None = None) -> StandardImport:
    ext = _extension(filename)
    if raw[:2] == b"PK":
        names = _zip_names(raw)
        if "META-INF/container.xml" in names or ext == ".epub":
            return _parse_epub(raw, filename)
        if "word/document.xml" in names or ext == ".docx":
            return _parse_docx(raw, filename)
        raise bad_request("book_prose import: zip file is neither EPUB nor DOCX")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise bad_request("book_prose import: file is not UTF-8 text, EPUB, or DOCX") from None
    if ext in (".md", ".markdown") or _looks_like_markdown(text):
        return _parse_markdown(text, filename)
    return _parse_txt(text, filename)


# ── shared helpers ───────────────────────────────────────────────────


def _extension(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return "." + filename.rsplit(".", 1)[1].lower()


def _stem(filename: str | None, fallback: str) -> str:
    if not filename:
        return fallback
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    return name.rsplit(".", 1)[0] or fallback


def _zip_names(raw: bytes) -> set[str]:
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            return set(zf.namelist())
    except zipfile.BadZipFile:
        return set()


def _slug(text: str, fallback: str = "scene") -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s[:64] or fallback


def _unique_id(base: str, taken: set[str]) -> str:
    sid, n = base, 2
    while sid in taken:
        sid = f"{base}_{n}"
        n += 1
    taken.add(sid)
    return sid


def _build(
    *,
    name: str,
    language: str,
    description: str | None,
    chapters: list[tuple[str | None, list[str]]],
    source_prefix: str,
    warnings: list[str],
) -> StandardImport:
    scenes: list[StandardScene] = []
    taken: set[str] = set()
    for idx, (title, paragraphs) in enumerate(chapters, start=1):
        base = _slug(title or f"chapter_{idx}", f"chapter_{idx}")
        scene = StandardScene(
            id=_unique_id(base, taken),
            title=title or f"Chapter {idx}",
            kind="chapter",
            lines=[
                StandardLine(text=p, source_ref=f"{source_prefix}:ch{idx}:p{pi}")
                for pi, p in enumerate(paragraphs, start=1)
            ],
        )
        scenes.append(scene)
    if not scenes:
        raise bad_request("book_prose import: no readable text found")
    return StandardImport(
        source=SOURCE_ID,
        project=StandardProject(
            name=name, kind="audiobook", description=description, language=language
        ),
        characters=[],  # prose carries no speaker data — Script discovers them
        scenes=scenes,
        warnings=warnings,
    )


# ── EPUB ─────────────────────────────────────────────────────────────


class _XhtmlBlocks(HTMLParser):
    """Collects ("h"|"p", text) blocks from one XHTML document, in order."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[tuple[str, str]] = []
        self._tag: str | None = None
        self._buf: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in ("script", "style"):
            self._skip_depth += 1
        elif tag in _BLOCK_TAGS and self._skip_depth == 0:
            self._flush()
            self._tag = tag
        elif tag == "br" and self._tag:
            self._buf.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in _BLOCK_TAGS:
            self._flush()

    def handle_data(self, data: str) -> None:
        if self._tag and self._skip_depth == 0:
            self._buf.append(data)

    def _flush(self) -> None:
        if self._tag:
            text = re.sub(r"\s+", " ", "".join(self._buf)).strip()
            if text:
                kind = "h" if self._tag in _HEADING_TAGS else "p"
                self.blocks.append((kind, text))
        self._tag, self._buf = None, []

    def close(self) -> None:  # flush a trailing unterminated block
        self._flush()
        super().close()


def _xml_root(data: bytes, what: str) -> ET.Element:
    try:
        return ET.fromstring(data)
    except ET.ParseError as e:
        raise bad_request(f"book_prose import: malformed {what} ({e})") from None


def _parse_epub(raw: bytes, filename: str | None) -> StandardImport:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    container = _xml_root(zf.read("META-INF/container.xml"), "container.xml")
    rootfile = container.find(
        ".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile"
    )
    if rootfile is None or not rootfile.get("full-path"):
        raise bad_request("book_prose import: EPUB container has no rootfile")
    opf_path = rootfile.get("full-path")
    opf_dir = opf_path.rsplit("/", 1)[0] + "/" if "/" in opf_path else ""
    opf = _xml_root(zf.read(opf_path), "OPF package")

    ns_opf = "{http://www.idpf.org/2007/opf}"
    ns_dc = "{http://purl.org/dc/elements/1.1/}"
    title = (opf.findtext(f".//{ns_dc}title") or "").strip()
    creator = (opf.findtext(f".//{ns_dc}creator") or "").strip()
    language = (opf.findtext(f".//{ns_dc}language") or "").strip() or "en-US"

    manifest: dict[str, tuple[str, str, str]] = {}  # id -> (href, media, properties)
    for item in opf.iter(f"{ns_opf}item"):
        manifest[item.get("id", "")] = (
            item.get("href", ""),
            item.get("media-type", ""),
            item.get("properties", "") or "",
        )

    warnings: list[str] = []
    chapters: list[tuple[str | None, list[str]]] = []
    for itemref in opf.iter(f"{ns_opf}itemref"):
        href, media, props = manifest.get(itemref.get("idref", ""), ("", "", ""))
        if not href or "html" not in media:
            continue
        if "nav" in props.split() or "cover-image" in props.split():
            continue
        full = opf_dir + href
        try:
            doc = zf.read(full)
        except KeyError:
            warnings.append(f"spine document missing from archive: {href}")
            continue
        extractor = _XhtmlBlocks()
        extractor.feed(doc.decode("utf-8", errors="replace"))
        extractor.close()
        heading = next((t for k, t in extractor.blocks if k == "h"), None)
        paragraphs = [t for k, t in extractor.blocks if k == "p"]
        words = sum(len(p.split()) for p in paragraphs)
        if not paragraphs or (heading is None and words < _FRONT_MATTER_MAX_WORDS):
            warnings.append(f"skipped front matter: {href}")
            continue
        chapters.append((heading, paragraphs))

    desc = f"by {creator}" if creator else None
    return _build(
        name=title or _stem(filename, "Imported book"),
        language=language,
        description=desc,
        chapters=chapters,
        source_prefix="epub",
        warnings=warnings,
    )


# ── DOCX ─────────────────────────────────────────────────────────────


def _parse_docx(raw: bytes, filename: str | None) -> StandardImport:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    try:
        doc = _xml_root(zf.read("word/document.xml"), "word/document.xml")
    except KeyError:
        raise bad_request("book_prose import: DOCX has no word/document.xml") from None

    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    title: str | None = None
    try:
        core = _xml_root(zf.read("docProps/core.xml"), "docProps/core.xml")
        title = (core.findtext("{http://purl.org/dc/elements/1.1/}title") or "").strip() or None
    except KeyError:
        pass

    chapters: list[tuple[str | None, list[str]]] = []
    current: tuple[str | None, list[str]] | None = None
    for para in doc.iter(f"{ns}p"):
        style_el = para.find(f"{ns}pPr/{ns}pStyle")
        style = (style_el.get(f"{ns}val") or "") if style_el is not None else ""
        text = re.sub(r"\s+", " ", "".join(t.text or "" for t in para.iter(f"{ns}t"))).strip()
        if not text:
            continue
        if re.match(r"(?i)^heading\s*[1-3]$|^h[1-3]$", style.replace("_", " ")):
            current = (text, [])
            chapters.append(current)
        else:
            if current is None:
                current = (None, [])
                chapters.append(current)
            current[1].append(text)

    chapters = [c for c in chapters if c[1]]
    return _build(
        name=title or _stem(filename, "Imported manuscript"),
        language="en-US",
        description=None,
        chapters=chapters,
        source_prefix="docx",
        warnings=[],
    )


# ── Markdown / plain text ────────────────────────────────────────────


def _looks_like_markdown(text: str) -> bool:
    return bool(re.search(r"(?m)^#{1,3}\s+\S", text))


def _split_paragraphs(body: str) -> list[str]:
    return [
        re.sub(r"\s+", " ", chunk).strip()
        for chunk in re.split(r"\n\s*\n", body)
        if chunk.strip()
    ]


def _parse_markdown(text: str, filename: str | None) -> StandardImport:
    chapters: list[tuple[str | None, list[str]]] = []
    current_title: str | None = None
    buf: list[str] = []

    def flush() -> None:
        paragraphs = _split_paragraphs("\n".join(buf))
        if paragraphs or current_title:
            chapters.append((current_title, paragraphs))

    for line in text.splitlines():
        m = re.match(r"^(#{1,3})\s+(.*\S)\s*$", line)
        if m:
            if buf or current_title is not None:
                flush()
            current_title, buf = m.group(2), []
        else:
            buf.append(line)
    flush()

    chapters = [c for c in chapters if c[1]]
    return _build(
        name=_stem(filename, "Imported manuscript"),
        language="en-US",
        description=None,
        chapters=chapters,
        source_prefix="md",
        warnings=[],
    )


_TXT_CHAPTER_RE = re.compile(
    r"(?i)^\s*(chapter|part|book)\s+([0-9]+|[ivxlc]+|\w+)\b[^\n]{0,40}$"
)


def _parse_txt(text: str, filename: str | None) -> StandardImport:
    chapters: list[tuple[str | None, list[str]]] = []
    current_title: str | None = None
    buf: list[str] = []

    def flush() -> None:
        paragraphs = _split_paragraphs("\n".join(buf))
        if paragraphs:
            chapters.append((current_title, paragraphs))

    for line in text.splitlines():
        if len(line) < 60 and _TXT_CHAPTER_RE.match(line):
            flush()
            current_title, buf = line.strip(), []
        else:
            buf.append(line)
    flush()

    return _build(
        name=_stem(filename, "Imported text"),
        language="en-US",
        description=None,
        chapters=chapters,
        source_prefix="txt",
        warnings=[],
    )
