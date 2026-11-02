"""Интервал, в который попадает истинное значение Value в 95% случаев.

Точечная оценка без интервала вводит в заблуждение: «25 млн ₽» выглядит
одинаково убедительно и когда истина лежит между 11 и 148, и когда между 0.1 и
1275. Уровень уверенности сообщает то же самое словом, но в решении о приоритете
словом пользоваться неудобно — нужен диапазон в рублях.

Множители не выведены из предположения о нормальности: распределение Value
тянется от 0 до 3600 млн ₽ и близко к логнормальному лишь отчасти. Они получены
конформной калибровкой на фактических ошибках — `scripts/value_calibrate.py`
прогоняет leave-one-out по задачам, где Value заполнил человек, и берёт квантили
остатков. Поэтому заявленные 95% — измеренная величина, а не обещание.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Методы, у которых значение точное и интервал не нужен.
EXACT_SOURCES = ("manual", "zero")


@dataclass(frozen=True)
class ValueInterval:
    low_mln: float
    high_mln: float
    coverage: float
    calibrated: bool
    method: str
    confidence: str

    @property
    def is_exact(self) -> bool:
        return self.low_mln == self.high_mln

    def as_dict(self) -> dict[str, Any]:
        return {
            "low_mln": self.low_mln,
            "high_mln": self.high_mln,
            "coverage": self.coverage,
            "calibrated": self.calibrated,
            "method": self.method,
            "confidence": self.confidence,
        }

    def format_range(self) -> str:
        """Человекочитаемый диапазон с разрядностью по величине значения."""

        def render(value: float) -> str:
            if value >= 100:
                return f"{value:,.0f}".replace(",", " ")
            if value >= 10:
                return f"{value:.0f}"
            if value >= 1:
                return f"{value:.1f}"
            return f"{value:.2f}"

        return f"{render(self.low_mln)}–{render(self.high_mln)} млн ₽"


def _entry(calibration: dict[str, Any], method: str, confidence: str) -> dict[str, Any] | None:
    methods = calibration.get("methods") or {}
    levels = methods.get(method) or {}
    return levels.get(confidence) or levels.get("low")


def compute_interval(
    value_mln: float | None,
    source: str,
    confidence: str,
    calibration: dict[str, Any],
) -> ValueInterval | None:
    """Интервал для точечной оценки. None, если значения нет."""
    if value_mln is None:
        return None

    coverage = float(calibration.get("target_coverage", 0.95))

    if source in EXACT_SOURCES:
        # Ручное значение — истина по методике, ноль регуляторки — тоже.
        # Рисовать вокруг них диапазон значило бы придумывать неопределённость,
        # которой нет.
        return ValueInterval(
            low_mln=value_mln,
            high_mln=value_mln,
            coverage=1.0,
            calibrated=True,
            method=source,
            confidence=confidence,
        )

    # Формульные методы калибровались вместе: у обоих одна природа ошибки —
    # типовые значения справочника. У среднего природа ошибки своя, и оно
    # калибруется отдельно; пока собственных наблюдений нет, запись
    # наследуется от формулы — более широкой из двух.
    if source == "analogy":
        method = "analogy"
    elif source == "blended":
        method = "blended" if "blended" in (calibration.get("methods") or {}) else "formula"
    else:
        method = "formula"
    entry = _entry(calibration, method, confidence)
    if entry is None:
        return None

    down = float(entry.get("down_factor", 1.0)) or 1.0
    up = float(entry.get("up_factor", 1.0)) or 1.0

    # Нулевая оценка не делится и не умножается. Верхнюю границу берём из
    # абсолютного сдвига: «ноль» по аналогии не означает «точно ноль».
    if value_mln <= 0:
        return ValueInterval(
            low_mln=0.0,
            high_mln=round(up, 2),
            coverage=coverage,
            calibrated=bool(entry.get("calibrated", False)),
            method=method,
            confidence=confidence,
        )

    return ValueInterval(
        low_mln=round(value_mln / down, 2),
        high_mln=round(value_mln * up, 2),
        coverage=coverage,
        calibrated=bool(entry.get("calibrated", False)),
        method=method,
        confidence=confidence,
    )
