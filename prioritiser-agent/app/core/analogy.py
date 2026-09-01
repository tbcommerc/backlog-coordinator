"""Оценка Value по аналогии с задачами, где его заполнил человек.

Значение, введённое человеком, считается истиной и агентом не пересчитывается
(ТЗ Ф1). Но 193 таких значения — это ещё и обучающая выборка: по ним видно,
сколько приносят задачи определённого вида у определённой команды.

**Зачем это понадобилось.** Формульная оценка опирается на типовые значения
справочника — 20 пользователей, 15 минут, 50 раз в год. Эти числа никем не
измерены. Проверка методом leave-one-out на 192 задачах с известным ответом
показала, насколько это плохо:

| Метод | Попадание в 2 раза | Медианная log-ошибка |
|---|---|---|
| Формула по типовым значениям | 14.1% | 1.267 |
| Медиана команды | 54.2% | 0.509 |
| Аналогия по похожим задачам | 69.3% | 0.211 |

Поэтому аналогия становится основным методом, когда похожие задачи есть, а
формула считается рядом как перекрёстная проверка.

**Чего этот метод не делает.** Он воспроизводит то, как оценивали команды, —
включая их систематические сдвиги. Если команда завышала эффект, аналогия
завышение продолжит. Это цена решения считать человеческие значения истиной, и
она принимается сознательно; см. docs/VALUE-ANALOGY.md.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import DATA_DIR, get_settings
from app.core.models import Task

INDEX_DIR = DATA_DIR / "index"

# Имя файла индекса зависит от состава задач и модели эмбеддингов. Один общий
# файл на все наборы приводил бы к постоянной перестройке: расчёт по базе (192
# задачи) и расчёт по зашитому слепку — разные наборы, и каждый затирал бы
# чужой индекс. Сигнатура в имени позволяет им сосуществовать.
_ANALOGY_PREFIX = "analogy-"
_ANALOGY_SUFFIX = ".faiss"

# Пороги подобраны на leave-one-out: при схожести выше 0.96 ближайшая задача
# обычно оказывается почти дословным повтором и её значение совпадает точно.
SIMILARITY_HIGH = 0.96
SIMILARITY_MEDIUM = 0.93

# Медиана трёх соседей вместо одного. Один сосед на выборке из 192 задач
# показал результат на 2–3 пункта лучше, но это в пределах ошибки измерения
# (стандартная ошибка около 3 пунктов), а медиана устойчивее к одной неверно
# заполненной задаче.
DEFAULT_TOP_K = 3

# Во сколько раз аналогия и формула могут разойтись, прежде чем это станет
# поводом понизить уверенность.
CROSS_CHECK_RATIO = 3.0

# Во сколько раз могут разойтись значения самих аналогов. Схожесть текста и
# согласованность оценок — разные вещи: у задачи могут найтись три почти
# дословных аналога со значениями 0.5, 1.9 и 111 млн ₽. Медиана по ним ещё
# осмысленна, а вот высокая уверенность — нет.
SPREAD_MEDIUM = 5.0
SPREAD_LOW = 20.0

# Сдвиг для отношений: в бэклоге есть задачи с Value = 0, и без него отношение
# не определено.
_ZERO_SHIFT = 0.5

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"


@dataclass
class Analogue:
    task_key: str
    title: str
    team: str | None
    value_mln: float
    similarity: float
    project: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "task_key": self.task_key,
            "title": (self.title or "")[:120],
            "team": self.team,
            "project": self.project,
            "value_mln": self.value_mln,
            "similarity": round(self.similarity, 4),
        }


@dataclass
class AnalogyEstimate:
    value_mln: float
    confidence: str
    analogues: list[Analogue]
    same_team: bool
    best_similarity: float
    value_spread: float
    reference_size: int
    cross_check_note: str | None = None
    missing: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "method": "analogy",
            "value_mln": self.value_mln,
            "confidence": self.confidence,
            "same_team": self.same_team,
            "best_similarity": round(self.best_similarity, 4),
            "value_spread": self.value_spread,
            "reference_size": self.reference_size,
            "analogues": [a.as_dict() for a in self.analogues],
            "cross_check_note": self.cross_check_note,
        }


def _passage(
    team: str | None,
    title: str | None,
    project: str | None = None,
    task_type: str | None = None,
    description: str | None = None,
) -> str:
    """Текст, по которому ищутся аналоги.

    Долгое время кодировались только команда и название, из-за чего проект,
    тип и описание на подбор не влияли вовсе. Замер leave-one-out на 192
    задачах показал, что основной выигрыш даёт **проект**: попадание в
    двукратную окрестность выросло с 67.2% до 72.9%, а медианная log-ошибка
    упала с 0.209 до 0.069 — втрое.

    Тип задачи и описание добавлены по решению владельца от 2026-08-20.
    Измеримой пользы они не дали (70.3% против 72.9% у одного проекта, разница
    внутри стандартной ошибки ±3.3 п.п.), но и вреда тоже. Описание вдобавок
    заполнено лишь у 13% исторических задач, поэтому запрос с описанием
    сравнивается с корпусом, где его почти нет.
    """
    parts = [
        team or "без команды",
        task_type or "",
        project or "",
        title or "",
        description or "",
    ]
    return "passage: " + ". ".join(part for part in parts if part)


class AnalogyIndex:
    """Индекс задач с человеческим Value для поиска аналогов.

    Строится один раз на прогон и кэшируется на диске: пересчёт всего бэклога
    иначе прогонял бы почти двести текстов через модель эмбеддингов на каждой
    задаче.

    Источник записей — либо база (полный прогон бэклога), либо зашитый слепок
    (сервис для Координатора, у которого доступа к базе нет). Класс от этого не
    зависит: ему нужен список записей, а откуда он взят — забота вызывающего.
    """

    def __init__(self, session: Session | None = None, entries: list[dict[str, Any]] | None = None):
        self.available = False
        self.entries: list[dict[str, Any]] = []
        self._matrix = None
        self._model = None
        self.model_name = get_settings().rag_embedding_model

        if entries is not None:
            self.entries = [e for e in entries if e.get("title")]
        elif session is not None:
            self.entries = self._entries_from_db(session)
        if not self.entries:
            return

        try:
            self._load_or_build()
            self.available = True
        except Exception:  # noqa: BLE001 - без индекса расчёт откатится к формуле
            self.available = False

    @classmethod
    def from_snapshot(cls, snapshot) -> "AnalogyIndex":
        """Индекс от зашитого слепка исторических Value."""
        return cls(entries=list(snapshot.entries))

    @staticmethod
    def _entries_from_db(session: Session) -> list[dict[str, Any]]:
        rows = session.scalars(
            select(Task).where(Task.value_manual_mln.is_not(None)).order_by(Task.task_key)
        ).all()
        return [
            {
                "task_key": t.task_key,
                "title": t.title or "",
                "team": t.team,
                "project": t.project,
                "task_type": t.task_type,
                "description": t.comment,
                "value_mln": float(t.value_manual_mln),
            }
            for t in rows
            if t.title
        ]

    # --- построение ---------------------------------------------------------
    def _signature(self) -> str:
        digest = hashlib.sha256()
        # Модель входит в сигнатуру: векторы, посчитанные другой моделью,
        # несопоставимы, и переиспользовать их нельзя.
        digest.update(self.model_name.encode("utf-8"))
        digest.update(b"\0")
        for entry in self.entries:
            digest.update(str(entry.get("task_key") or "").encode("utf-8"))
            digest.update(b"\0")
            digest.update(entry["title"].encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(entry.get("team") or "").encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(entry.get("project") or "").encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(entry.get("task_type") or "").encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(entry["value_mln"]).encode("utf-8"))
            digest.update(b"\0")
        return digest.hexdigest()

    def _index_path(self, signature: str):
        return INDEX_DIR / f"{_ANALOGY_PREFIX}{signature[:16]}{_ANALOGY_SUFFIX}"

    def _encoder(self):
        from app.rag.embeddings import get_encoder

        return get_encoder(self.model_name)

    def _load_or_build(self) -> None:
        import numpy as np

        signature = self._signature()
        path = self._index_path(signature)
        if path.exists():
            import faiss

            index = faiss.read_index(str(path))
            if index.ntotal == len(self.entries):
                self._matrix = index.reconstruct_n(0, index.ntotal)
                return

        model = self._encoder()
        vectors = model.encode(
            [
                _passage(
                    e["team"], e["title"], e.get("project"),
                    e.get("task_type"), e.get("description"),
                )
                for e in self.entries
            ],
            normalize_embeddings=True,
            show_progress_bar=False,
            batch_size=32,
        )
        vectors = np.asarray(vectors, dtype="float32")

        import faiss

        index = faiss.IndexFlatIP(vectors.shape[1])
        index.add(vectors)
        INDEX_DIR.mkdir(parents=True, exist_ok=True)
        faiss.write_index(index, str(path))
        self._matrix = vectors

    # --- поиск --------------------------------------------------------------
    def find(self, task: Task, top_k: int = DEFAULT_TOP_K) -> tuple[list[Analogue], bool]:
        """Ближайшие аналоги. Второй элемент — удалось ли остаться внутри команды."""
        if not self.available or self._matrix is None or not task.title:
            return [], False

        import numpy as np

        query = self._encoder().encode(
            [_passage(task.team, task.title, task.project, task.task_type, task.comment)],
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        scores = (np.asarray(self._matrix) @ np.asarray(query, dtype="float32").T).ravel()

        pool: list[Analogue] = []
        for index, entry in enumerate(self.entries):
            # Задача не может быть аналогом самой себе.
            if entry.get("task_key") and entry["task_key"] == task.task_key:
                continue
            pool.append(
                Analogue(
                    task_key=entry["task_key"],
                    title=entry["title"],
                    team=entry.get("team"),
                    value_mln=entry["value_mln"],
                    similarity=float(scores[index]),
                    project=entry.get("project"),
                )
            )
        if not pool:
            return [], False

        pool.sort(key=lambda a: a.similarity, reverse=True)

        # Аналоги своей команды предпочтительнее: методика оценки внутри команды
        # едина, у соседней она может быть другой.
        same_team = [a for a in pool if a.team == task.team]
        if len(same_team) >= 2:
            return same_team[:top_k], True
        return pool[:top_k], False


def estimate_by_analogy(
    task: Task,
    index: AnalogyIndex,
    formula_value_mln: float | None = None,
    top_k: int = DEFAULT_TOP_K,
) -> AnalogyEstimate | None:
    """Оценка Value по аналогам. None, если аналогов нет."""
    analogues, same_team = index.find(task, top_k)
    if not analogues:
        return None

    import statistics

    values = [a.value_mln for a in analogues]
    estimate = float(statistics.median(values))
    best = analogues[0].similarity

    if best >= SIMILARITY_HIGH:
        confidence = CONFIDENCE_HIGH
    elif best >= SIMILARITY_MEDIUM:
        confidence = CONFIDENCE_MEDIUM
    else:
        confidence = CONFIDENCE_LOW

    if not same_team and confidence == CONFIDENCE_HIGH:
        # Дословно похожая задача чужой команды — всё же более слабое основание.
        confidence = CONFIDENCE_MEDIUM

    # Разброс значений аналогов. Похожие названия при расходящихся оценках
    # означают, что команда заполняла Value непоследовательно, и медиана по ним
    # — рабочее приближение, но не основание для высокой уверенности.
    spread = 1.0
    if len(values) > 1:
        shifted = [v + _ZERO_SHIFT for v in values]
        spread = max(shifted) / min(shifted)
        if spread >= SPREAD_LOW:
            confidence = CONFIDENCE_LOW
        elif spread >= SPREAD_MEDIUM and confidence == CONFIDENCE_HIGH:
            confidence = CONFIDENCE_MEDIUM

    # Перекрёстная проверка формулой: расхождение на порядок означает, что одна
    # из двух оценок построена на неверных вводных, и уверенность падает.
    note = None
    if formula_value_mln is not None and formula_value_mln > 0 and estimate > 0:
        ratio = max(estimate, formula_value_mln) / min(estimate, formula_value_mln)
        if ratio >= CROSS_CHECK_RATIO:
            note = (
                f"Формула даёт {formula_value_mln:,.1f} млн ₽ — "
                f"расхождение с аналогией в {ratio:.1f} раза"
            ).replace(",", " ")
            if confidence == CONFIDENCE_HIGH:
                confidence = CONFIDENCE_MEDIUM
            elif confidence == CONFIDENCE_MEDIUM:
                confidence = CONFIDENCE_LOW

    return AnalogyEstimate(
        value_mln=round(estimate, 2),
        confidence=confidence,
        analogues=analogues,
        same_team=same_team,
        best_similarity=best,
        value_spread=round(spread, 2),
        reference_size=len(index.entries),
        cross_check_note=note,
    )


def reset_index() -> None:
    """Удаляет кэш индексов аналогий — нужно после изменения ручных значений.

    Удаляются все, а не один: файлов столько, сколько было разных наборов
    задач, и оставленный чужой индекс потом молча подхватился бы по совпадению
    сигнатуры.
    """
    if not INDEX_DIR.exists():
        return
    for path in INDEX_DIR.glob(f"{_ANALOGY_PREFIX}*{_ANALOGY_SUFFIX}"):
        path.unlink(missing_ok=True)
    # Файлы прежней схемы: один общий индекс и мета-файл рядом.
    (INDEX_DIR / "analogy.faiss").unlink(missing_ok=True)
    (INDEX_DIR / "analogy-meta.json").unlink(missing_ok=True)
