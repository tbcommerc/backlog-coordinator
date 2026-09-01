"""Requirement draft schema (JSON artifact).

The agent never approves a requirement itself - it only produces a Draft that
is sent to PO / BA for review (human-in-the-loop). Every claim references
sources and open questions are kept explicit (traceability).
"""
from typing import Optional
from pydantic import BaseModel, Field


class DraftSource(BaseModel):
    doc_id: str = ""
    source: str = ""
    text: str = ""
    record_id: str = ""
    source_type: str = ""
    title: str = ""
    section: Optional[str] = None
    uri: Optional[str] = None
    score: Optional[float] = None
    raw_score: Optional[float] = None
    provider: str = ""
    rank: Optional[int] = None
    version: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class RequirementDraft(BaseModel):
    id: str
    title: str
    intent: str = ""
    problem_statement: str = ""
    current_process: str = ""
    target_process: str = ""
    business_value: str = ""
    user_roles: list[str] = Field(default_factory=list)
    department: str = ""
    product: str = ""
    module: str = ""
    scenarios: list[str] = Field(default_factory=list)
    business_rules: list[str] = Field(default_factory=list)
    data_integrations: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    open_question_details: list[dict] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    regulatory_flags: list[str] = Field(default_factory=list)
    priority: str = "Средний"
    duplicates: list[dict] = Field(default_factory=list)
    sources: list[DraftSource] = Field(default_factory=list)
    field_provenance: dict[str, dict] = Field(default_factory=dict)
    field_confidence: dict[str, float] = Field(default_factory=dict)
    completeness_score: int = 0
    confidence: str = "low"          # low | medium | high
    quality_score: int = 0
    quality_level: str = "low"
    quality_profile: str = ""
    quality_issues: list[dict] = Field(default_factory=list)
    conflicts: list[dict] = Field(default_factory=list)
    gaps: list[dict] = Field(default_factory=list)
    review_findings: list[dict] = Field(default_factory=list)
    review_blocked: bool = False
    status: str = "Draft"            # Draft / Needs Review / Approved
    created_by: dict = Field(default_factory=dict)


def to_markdown(draft: RequirementDraft) -> str:
    """Render the draft as text for the task description."""
    L = []
    L.append(f"# {draft.title}")
    L.append(f"**Статус:** {draft.status} · **Полнота:** {draft.completeness_score}% · **Качество:** {draft.quality_score}% · **Уверенность:** {draft.confidence}")
    if draft.intent:
        L.append(f"**Тип обращения:** {draft.intent}")
    L.append("")
    L.append("## Проблема")
    L.append(draft.problem_statement or "—")
    L.append("")
    L.append("## Текущий процесс (As-Is)")
    L.append(draft.current_process or "—")
    L.append("")
    L.append("## Целевой процесс")
    L.append(draft.target_process or "—")
    L.append("")
    L.append("## Бизнес-ценность")
    L.append(draft.business_value or "—")
    L.append("")
    L.append("## Пользователи")
    L.append(", ".join(draft.user_roles) if draft.user_roles else "—")
    if draft.department:
        L.append(f"**Подразделение:** {draft.department}")
    L.append("")
    L.append(f"**Продукт:** {draft.product or '—'}  **Модуль:** {draft.module or '—'}  **Приоритет:** {draft.priority}")
    L.append("")
    if draft.scenarios:
        L.append("## Пользовательские сценарии")
        L.extend(f"- {s}" for s in draft.scenarios)
        L.append("")
    if draft.business_rules:
        L.append("## Бизнес-правила")
        L.extend(f"- {r}" for r in draft.business_rules)
        L.append("")
    if draft.data_integrations:
        L.append("## Данные и интеграции")
        L.extend(f"- {d}" for d in draft.data_integrations)
        L.append("")
    L.append("## Критерии приёмки")
    L.extend(f"- {c}" for c in draft.acceptance_criteria) if draft.acceptance_criteria else L.append("- —")
    L.append("")
    if draft.regulatory_flags:
        L.append("## Регуляторные флаги")
        L.extend(f"- {f}" for f in draft.regulatory_flags)
        L.append("")
    if draft.risks:
        L.append("## Риски")
        L.extend(f"- {r}" for r in draft.risks)
        L.append("")
    if draft.dependencies:
        L.append("## Зависимости")
        L.extend(f"- {d}" for d in draft.dependencies)
        L.append("")
    if draft.open_questions:
        L.append("## Открытые вопросы")
        L.extend(f"- {q}" for q in draft.open_questions)
        L.append("")
    if draft.gaps:
        L.append("## Реестр пробелов")
        for gap in draft.gaps:
            L.append(f"- [{gap.get('criticality', 'low')}] {gap.get('question', '')}")
        L.append("")
    if draft.review_findings:
        L.append("## Независимая проверка")
        L.extend(f"- [{f.get('severity', 'warning')}] {f.get('message', '')}" for f in draft.review_findings)
        L.append("")
    if draft.conflicts:
        L.append("## Обнаруженные противоречия")
        L.extend(f"- {c.get('message', '')}" for c in draft.conflicts)
        L.append("")
    if draft.assumptions:
        L.append("## Допущения")
        L.extend(f"- {a}" for a in draft.assumptions)
        L.append("")
    if draft.sources:
        L.append("## Источники")
        for s in draft.sources:
            L.append(f"- {s.source}")
        L.append("")
    if draft.duplicates:
        L.append("## Похожие требования")
        for d in draft.duplicates:
            L.append(f"- {d.get('id')}: {d.get('title')} ({d.get('status')})")
        L.append("")
    return "\n".join(L)
