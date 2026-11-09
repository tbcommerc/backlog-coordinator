"""Сборка корпуса для RAG.

Корпус состоит из трёх слоёв:

1. **Знания о трайбе** — `data/knowledge/tribe-catalog.yaml` и
   `tribe-products-DMB.md`, взятые из strategy-decomposer. Это обезличенные
   описания команд и продуктов, и именно из них агент понимает, чем занимается
   команда, чью задачу он оценивает.
2. **Исторические задачи бэклога** — 446 записей. Дают аналогии вида
   «похожие задачи этой команды имели Value ~50 млн ₽».
3. **Методика** — документы из `docs/`, чтобы агент мог сослаться на правило,
   по которому выбрал метод расчёта.

**Чего в корпусе нет и не будет.** Зашифрованный K3-пакет strategy-decomposer
(`RAG/package/*.age`) сюда не копируется и не расшифровывается. Если переменная
`SD_REPO_ROOT` указывает на локальный клон, слой 1 читается оттуда по месту, а
K3-материал подключается только при явном `PRIORITISER_RAG_ALLOW_K3=1` — и всё
равно остаётся в исходном репозитории, а не в этом.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import select

from value_priority_assessor.config import DATA_DIR, KNOWLEDGE_DIR, REPO_ROOT, get_settings

CHUNK_CHARS = 1200
CHUNK_OVERLAP = 200

HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$", re.MULTILINE)

# Пакет K3 помечает каждый файл строкой происхождения. В индексируемый текст она
# не идёт (это метаданные, а не знание), но сохраняется в metadata чанка, чтобы
# агент мог назвать источник утверждения.
ORIGINAL_SOURCE_RE = re.compile(r"(?m)^Original source:\s*(.+?)\s*$")

K3_DIR = KNOWLEDGE_DIR / "k3"


@dataclass
class Chunk:
    chunk_id: str
    source: str
    layer: str          # knowledge | backlog | methodology
    title: str
    text: str
    metadata: dict[str, Any]


def _split_markdown(text: str, source: str, layer: str) -> list[Chunk]:
    """Режет markdown по заголовкам, длинные секции — по символам.

    Резать по заголовкам, а не по фиксированному окну, важно для нашего корпуса:
    описание продукта команды — это цельная секция, и разорванная пополам она
    перестаёт отвечать на вопрос «чем занимается Pre-Trade».
    """
    positions = [(m.start(), m.group(2)) for m in HEADING_RE.finditer(text)]
    sections: list[tuple[str, str]] = []

    if not positions:
        sections.append(("", text))
    else:
        if positions[0][0] > 0:
            sections.append(("", text[: positions[0][0]]))
        for index, (start, title) in enumerate(positions):
            end = positions[index + 1][0] if index + 1 < len(positions) else len(text)
            sections.append((title, text[start:end]))

    chunks: list[Chunk] = []
    for title, body in sections:
        body = body.strip()
        if not body:
            continue
        if len(body) <= CHUNK_CHARS:
            pieces = [body]
        else:
            pieces = []
            start = 0
            while start < len(body):
                pieces.append(body[start : start + CHUNK_CHARS])
                start += CHUNK_CHARS - CHUNK_OVERLAP
        for order, piece in enumerate(pieces):
            chunks.append(
                Chunk(
                    chunk_id=f"{source}#{len(chunks)}",
                    source=source,
                    layer=layer,
                    title=title or Path(source).stem,
                    text=piece,
                    metadata={"section": title, "part": order},
                )
            )
    return chunks


def _knowledge_chunks() -> list[Chunk]:
    """Обезличенные знания о трайбе: каталог команд и описания продуктов."""
    chunks: list[Chunk] = []
    directories = [KNOWLEDGE_DIR]

    sd_root = get_settings().sd_repo_root
    if sd_root is not None:
        # Читаем каталог strategy-decomposer по месту, ничего не копируя.
        directories.append(sd_root / "data")

    seen: set[str] = set()
    for directory in directories:
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*")):
            # Слой K3 собирается отдельно: у него своя классификация,
            # свой набор запросов для проверки качества и свой выключатель.
            if K3_DIR in path.parents or path == K3_DIR:
                continue
            if path.suffix.lower() not in {".md", ".yaml", ".yml", ".txt"}:
                continue
            if path.name in seen:
                continue
            seen.add(path.name)
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            source = str(path.relative_to(REPO_ROOT)) if REPO_ROOT in path.parents else str(path)
            chunks.extend(_split_markdown(text, source, "knowledge"))
    return chunks


def k3_installed() -> bool:
    return (K3_DIR / "corpus").is_dir() and any((K3_DIR / "corpus").glob("*.md"))


def k3_manifest() -> dict[str, Any]:
    pointer = K3_DIR / "current.json"
    if not pointer.exists():
        return {}
    try:
        return json.loads(pointer.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def k3_source_map() -> dict[str, dict[str, Any]]:
    """Имя файла корпуса → логическое имя источника и канонический идентификатор.

    Файлы в пакете названы хешами, а набор контрольных запросов ссылается на
    человекочитаемые имена («products_ДИД.txt») и на канонический `form-4441`.
    Без этой карты нельзя ни проверить качество выдачи, ни показать пользователю
    вменяемое название источника.
    """
    mapping: dict[str, dict[str, Any]] = {}
    manifest = K3_DIR / "corpus" / "manifest.json"
    if manifest.exists():
        try:
            payload = json.loads(manifest.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
        for entry in payload.get("sources", []):
            file_name = Path(str(entry.get("file", ""))).name
            if file_name:
                mapping[file_name] = {"source": entry.get("source"), "canonical_id": None}

    private = K3_DIR / "manifest.private.json"
    if private.exists():
        try:
            payload = json.loads(private.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
        for canonical_id, entry in (payload.get("canonical_sources") or {}).items():
            file_name = Path(str(entry.get("path", ""))).name
            if file_name in mapping:
                mapping[file_name]["canonical_id"] = canonical_id
    return mapping


# Пакет предразмечен на секции служебными заголовками — они не годятся как
# название фрагмента в выдаче, поэтому подменяются именем источника.
_UNINFORMATIVE_HEADING_RE = re.compile(
    r"^(Legacy chunk \d+|Extracted legacy RAG source)$", re.IGNORECASE
)


def _k3_chunks() -> list[Chunk]:
    """Корпус K3 из пакета strategy-decomposer.

    Требует установленного пакета (`scripts/rag_package_install.py install`).
    Отключается переменной `PRIORITISER_RAG_ALLOW_K3=0` — на случай демонстраций
    и внешних показов, где материалы этой классификации показывать нельзя.
    """
    if not get_settings().rag_allow_k3 or not k3_installed():
        return []

    sources = k3_source_map()
    chunks: list[Chunk] = []

    for path in sorted((K3_DIR / "corpus").glob("*.md")):
        if path.name == "manifest.json":
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        match = ORIGINAL_SOURCE_RE.search(text)
        original = match.group(1) if match else None
        body = ORIGINAL_SOURCE_RE.sub("", text)

        entry = sources.get(path.name) or {}
        logical = entry.get("source") or original or path.stem

        produced = _split_markdown(body, f"k3:{path.name}", "k3")
        for chunk in produced:
            if _UNINFORMATIVE_HEADING_RE.match(chunk.title.strip()):
                chunk.title = str(logical)
            chunk.metadata |= {
                "classification": "K3",
                "logical_source": logical,
                "canonical_id": entry.get("canonical_id"),
                "original_source": original,
            }
        chunks.extend(produced)
    return chunks


def _methodology_chunks() -> list[Chunk]:
    docs = REPO_ROOT / "docs"
    chunks: list[Chunk] = []
    if not docs.is_dir():
        return chunks
    for path in sorted(docs.glob("*.md")):
        # Deployment instructions are not business methodology.
        if path.name == "REMOTE_TOOLS.md":
            continue
        text = path.read_text(encoding="utf-8")
        chunks.extend(_split_markdown(text, str(path.relative_to(REPO_ROOT)), "methodology"))
    return chunks


def _backlog_chunks(session=None) -> list[Chunk]:
    """Одна задача — один чанк: дробить постановку из одной строки бессмысленно."""
    rows: Iterable[dict[str, Any]]

    if session is not None:
        from value_priority_assessor.core.models import Task

        tasks = session.scalars(select(Task)).all()
        rows = [
            {
                "key": t.task_key,
                "team": t.team,
                "title": t.title,
                "type": t.task_type,
                "value": t.value_internal_mln,
                "value_manual": t.value_manual_mln,
                "effort": t.effort_man_days,
                "priority": t.priority,
                "deadline": str(t.deadline) if t.deadline else None,
            }
            for t in tasks
        ]
    else:
        seed = DATA_DIR / "backlog_seed.json"
        if not seed.exists():
            return []
        raw = json.loads(seed.read_text(encoding="utf-8"))
        rows = [
            {
                "key": r.get("ID задачи"),
                "team": r.get("Ответственная команда / кластер"),
                "title": r.get("Наименование задачи / краткая постановка"),
                "type": r.get("Тип задачи"),
                "value": None,
                "value_manual": r.get("Фин. эффект (value в млн руб.)"),
                "effort": r.get("Оценка трудозатрат (ч/д)"),
                "priority": r.get("Приоритет задачи в бэклоге команды"),
                "deadline": r.get("Срок выполнения"),
            }
            for r in raw
        ]

    chunks: list[Chunk] = []
    for row in rows:
        if not row.get("title"):
            continue
        parts = [
            f"Задача {row['key']} (команда {row['team']}, тип {row['type']}).",
            str(row["title"]),
        ]
        if row.get("value_manual") is not None:
            parts.append(f"Финансовый эффект по оценке команды: {row['value_manual']} млн ₽.")
        if row.get("value") is not None:
            parts.append(f"Value по методике агента: {row['value']} млн ₽.")
        if row.get("effort") is not None:
            parts.append(f"Трудозатраты: {row['effort']} ч/д.")
        if row.get("deadline"):
            parts.append(f"Срок: {row['deadline']}.")

        chunks.append(
            Chunk(
                chunk_id=f"backlog:{row['key']}",
                source="data/backlog_seed.json",
                layer="backlog",
                title=str(row["title"])[:120],
                text=" ".join(parts),
                metadata={k: v for k, v in row.items() if k != "title"},
            )
        )
    return chunks


def build_corpus(session=None) -> list[Chunk]:
    """Собирает все слои корпуса."""
    return (
        _k3_chunks()
        + _knowledge_chunks()
        + _backlog_chunks(session)
        + _methodology_chunks()
    )


def corpus_signature(chunks: list[Chunk]) -> str:
    """Отпечаток корпуса для инвалидации сохранённого векторного индекса.

    Считается по идентификаторам и содержимому чанков: пересборка индекса нужна
    ровно тогда, когда изменился хоть один чанк, и не нужна при перезапуске
    процесса. Без этого каждый вызов CLI заново прогонял бы 1000+ чанков через
    модель эмбеддингов — секунды вместо миллисекунд на каждый запрос.
    """
    digest = hashlib.sha256()
    for chunk in chunks:
        digest.update(chunk.chunk_id.encode("utf-8"))
        digest.update(b"\0")
        digest.update(chunk.text.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()
