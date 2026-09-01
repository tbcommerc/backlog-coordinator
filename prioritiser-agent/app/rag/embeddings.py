"""Общий кэш модели эмбеддингов.

Модель весит порядка гигабайта и загружается около четырнадцати секунд. Её
используют два независимых потребителя — поиск по корпусу и поиск аналогов для
Value, — и каждый раньше держал свою копию: двойной расход памяти и двойная
задержка на старте.

Модель не имеет состояния между вызовами, поэтому один экземпляр на процесс
безопасен.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any


@lru_cache(maxsize=2)
def get_encoder(model_name: str) -> Any:
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name)


def reset_encoders() -> None:
    get_encoder.cache_clear()
