"""KB loader - reads curated documents from kb_seed/ (manifest + markdown).

Each .md file is split into sections by '##' headers. Every section becomes a
searchable chunk tagged with metadata from manifest.json.
"""
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from ..config import settings


@dataclass
class Chunk:
    doc_id: str
    doc_title: str
    domain: str
    status: str          # approved | draft
    priority: int
    section: str
    text: str
    products: list = field(default_factory=list)
    modules: list = field(default_factory=list)
    processes: list = field(default_factory=list)
    version: str | None = None
    updated_at: str | None = None

    @property
    def source_label(self) -> str:
        return f"{self.doc_title} · {self.section}"


@dataclass
class Document:
    id: str
    title: str
    domain: str
    status: str
    priority: int
    products: list
    modules: list
    processes: list
    content: str
    chunks: list = field(default_factory=list)
    version: str | None = None
    updated_at: str | None = None


def _split_sections(text: str):
    """Split markdown by '## ' headers, keeping the header text."""
    lines = text.splitlines()
    sections = []
    current_title = ""
    current_lines = []
    for line in lines:
        if line.startswith("## "):
            if current_title or current_lines:
                sections.append((current_title, "\n".join(current_lines).strip()))
            current_title = line[3:].strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_title or current_lines:
        sections.append((current_title, "\n".join(current_lines).strip()))
    return [s for s in sections if s[1]]


class KnowledgeBase:
    def __init__(self, kb_dir: Path = None):
        self.kb_dir = Path(kb_dir) if kb_dir else settings.KB_DIR
        self.documents: dict[str, Document] = {}
        self.chunks: list[Chunk] = []
        self.load()

    def load(self):
        manifest_path = self.kb_dir / "manifest.json"
        if not manifest_path.exists():
            return
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for meta in manifest.get("documents", []):
            md_path = self.kb_dir / f"{meta['id']}.md"
            if not md_path.exists():
                continue
            content = md_path.read_text(encoding="utf-8")
            doc = Document(
                id=meta["id"],
                title=meta.get("title", meta["id"]),
                domain=meta.get("domain", ""),
                status=meta.get("status", "draft"),
                priority=meta.get("priority", 0),
                products=meta.get("products", []),
                modules=meta.get("modules", []),
                processes=meta.get("processes", []),
                content=content,
                version=meta.get("version"),
                updated_at=meta.get("updated_at"),
            )
            for section_title, section_text in _split_sections(content):
                chunk = Chunk(
                    doc_id=doc.id,
                    doc_title=doc.title,
                    domain=doc.domain,
                    status=doc.status,
                    priority=doc.priority,
                    section=section_title,
                    text=section_text,
                    products=doc.products,
                    modules=doc.modules,
                    processes=doc.processes,
                    version=doc.version,
                    updated_at=doc.updated_at,
                )
                doc.chunks.append(chunk)
                self.chunks.append(chunk)
            self.documents[doc.id] = doc

    def approved_chunks(self) -> list[Chunk]:
        """Retrieval harness: only curated approved sources."""
        return [c for c in self.chunks if c.status == "approved"]

    def stats(self) -> dict:
        return {
            "documents": len(self.documents),
            "chunks": len(self.chunks),
            "approved": len(self.approved_chunks()),
        }


kb = KnowledgeBase()
