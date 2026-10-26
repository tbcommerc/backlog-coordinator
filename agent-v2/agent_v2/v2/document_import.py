"""Deterministic import of an existing requirement into the V2 workspace."""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ImportedRequirement:
    title: str
    fields: dict[str, str]
    unmapped_sections: list[str]


_HEADING_TO_FIELD = {
    "проблема": "need_statement",
    "описание проблемы": "need_statement",
    "бизнес проблема": "need_statement",
    "problem": "need_statement",
    "problem statement": "need_statement",
    "бизнес цель": "business_goal",
    "цель": "business_goal",
    "бизнес ценность": "business_goal",
    "business goal": "business_goal",
    "business value": "business_goal",
    "as is": "as_is",
    "текущий процесс": "as_is",
    "текущее состояние": "as_is",
    "to be": "to_be",
    "целевой процесс": "to_be",
    "целевое состояние": "to_be",
    "scope in": "scope_in",
    "в объеме": "scope_in",
    "в объёме": "scope_in",
    "scope out": "scope_out",
    "за рамками": "scope_out",
    "за рамками требования": "scope_out",
    "за границами": "scope_out",
    "за границами изменения": "scope_out",
    "в границах изменения": "scope_in",
    "вне объема": "scope_out",
    "вне объёма": "scope_out",
    "роли": "role",
    "основная роль": "role",
    "участники": "actors",
    "акторы": "actors",
    "actors": "actors",
    "пользователи": "actors",
    "процесс": "process",
    "бизнес процесс": "process",
    "сценарии": "scenarios",
    "пользовательские сценарии": "scenarios",
    "основной сценарий": "scenarios",
    "альтернативные сценарии": "alternative_scenarios",
    "исключения": "exception_scenarios",
    "исключительные сценарии": "exception_scenarios",
    "бизнес правила": "business_rules",
    "правила": "business_rules",
    "данные и интеграции": "data_integrations",
    "интеграции": "data_integrations",
    "функциональные требования": "functional_requirements",
    "нефункциональные требования": "non_functional_requirements",
    "критерии приемки": "acceptance_criteria",
    "критерии приёмки": "acceptance_criteria",
    "acceptance criteria": "acceptance_criteria",
    "метрики успеха": "success_metrics",
    "критерии бизнес успеха": "success_metrics",
    "функциональные требования к решению": "functional_requirements",
    "нефункциональные требования к решению": "non_functional_requirements",
    "ограничения": "constraints",
    "зависимости": "dependencies",
    "риски": "risks",
    "открытые вопросы": "open_questions",
    "вопросы для уточнения": "open_questions",
    "намеренно оставленные вопросы для проверки агента v2": "open_questions",
}


def _normalize_heading(value: str) -> str:
    value = value.casefold().replace("ё", "е")
    value = re.sub(r"[*_`:#]+", " ", value)
    value = re.sub(r"[^a-zа-я0-9\s-]", " ", value)
    return " ".join(value.replace("-", " ").split())


def heading_slot(value: str) -> str:
    """Shared vocabulary for import and source coverage; unknown is not a fact."""
    return _HEADING_TO_FIELD.get(_normalize_heading(value), "")


def document_heading(line: str) -> str:
    markdown = re.match(r'^\s{0,3}#{1,6}\s+(.+?)\s*$', line)
    bold = re.fullmatch(r'\s*\*\*(.+?)\*\*\s*:?\s*', line)
    if markdown or bold:
        return (markdown or bold).group(1)
    business_heading = _normalize_heading(line) in {'бизнес требование', 'бизнес требования'}
    # Unknown labels with a colon still terminate the preceding section.
    unknown_label = len(line.strip()) <= 100 and line.strip().endswith(':')
    return line.strip().rstrip(':') if heading_slot(line) or business_heading or unknown_label else ''


def inline_document_title(line: str) -> str:
    match = re.match(r'^\s*(?:\*\*)?Название\s*:(?:\*\*)?\s*(.+?)\s*$', line, re.I)
    return match.group(1) if match else ''


def _clean_body(lines: list[str]) -> str:
    cleaned: list[str] = []
    for line in lines:
        text = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", line).strip()
        if text and text != "—":
            cleaned.append(text)
    return "; ".join(cleaned)


def parse_requirement_document(content: str) -> ImportedRequirement:
    """Parse common Markdown/plain-text headings without inventing missing facts."""
    text = (content or "").replace("\r\n", "\n").strip()
    if not text:
        return ImportedRequirement(title="", fields={}, unmapped_sections=[])

    title = ""
    current_heading = ""
    current_lines: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    heading_pattern = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*$")

    def flush() -> None:
        nonlocal current_lines
        if current_heading or current_lines:
            sections.append((current_heading, current_lines))
        current_lines = []

    for line in text.split("\n"):
        inline_title = inline_document_title(line)
        if inline_title and not title:
            title = inline_title
            continue
        match = heading_pattern.match(line)
        if match:
            heading = match.group(2).strip()
            if len(match.group(1)) == 1 and not title and not current_heading and not current_lines:
                title = heading
                current_heading = ""
                continue
            flush()
            current_heading = heading
            continue
        bare_heading = document_heading(line)
        if bare_heading:
            flush()
            current_heading = bare_heading
            continue
        current_lines.append(line)
    flush()

    fields: dict[str, str] = {}
    unmapped: list[str] = []
    preamble: list[str] = []
    for heading, lines in sections:
        body = _clean_body(lines)
        if not body:
            continue
        if not heading:
            preamble.append(body)
            continue
        key = _HEADING_TO_FIELD.get(_normalize_heading(heading))
        if not key:
            unmapped.append(heading)
            continue
        fields[key] = "; ".join(filter(None, (fields.get(key, ""), body)))

    if preamble and "need_statement" not in fields:
        fields["need_statement"] = "; ".join(preamble)
    if not fields:
        fields["need_statement"] = _clean_body(text.split("\n"))
    return ImportedRequirement(title=title, fields=fields, unmapped_sections=unmapped)
