"""Input harness - validates every incoming user message before it reaches
the LLM: domain classification, prompt injection, PII / bank secrecy and
prohibited requests.

Verdicts: in_domain | possibly_in_domain | out_of_domain | malicious_or_policy_violation
"""
import re
from dataclasses import dataclass, field
from difflib import get_close_matches

# ---- Domain vocabulary (enriched from KB ontology at startup) ------------
STRONG_DOMAIN_TERMS = [
    "облигац", "еврооблигац", "акци", "паи", "пай", "пиф", "структурн",
    "дериватив", "форвард", "фьючерс", "опцион", "своп", "репо",
    "депозитарн", "расчёт", "расчет", "клиринг", "маржин", "фиксинг",
    "контрагент", "пост-трейд", "претрейд", "портфель", "сделка", "сделок",
    "лимит", "отчётность", "отчетность", "поручение", "валютн", "свопц",
    "депозитарная расписка", "кодан", "компенсирующ",
]
WEAK_DOMAIN_TERMS = [
    "торговл", "инвестиц", "банк", "платформ", "казначейств", "продукт",
    "процесс", "требовани", "задача", "доработк", "бэк-офи", "фронт-офи",
    "риск", "комплаенс", "клиент", "запрос", "доступ",
]

# A requirement can be valid without investment vocabulary. Users naturally
# speak about fields, cards and filters, so domain evidence is combined with
# the shape of a change request instead of relying on a flat keyword list.
CHANGE_ACTION_PATTERNS = [
    r"\bдобав\w*", r"\bсозда\w*", r"\bизмен\w*", r"\bпоменя\w*",
    r"\bвывест\w*", r"\bвывод\w*", r"\bпоказыва\w*", r"\bотобража\w*",
    r"\bскры\w*", r"\bудал\w*", r"\bперенес\w*", r"\bавтоматиз\w*",
    r"\bдоработ\w*", r"\bнастро\w*", r"\bрасшир\w*", r"\bнужн\w*",
    r"\bхочу\b", r"\bтребуется\b", r"\bсформир\w*", r"\bвыгруз\w*",
]
SYSTEM_OBJECT_PATTERNS = [
    r"\bатрибут\w*", r"\bпол[ея]\b", r"\bпризнак\w*", r"\bкарточк\w*",
    r"\bформ[аыуе]\b", r"\bэкран\w*", r"\bстраниц\w*", r"\bраздел\w*",
    r"\bреестр\w*", r"\bсправочник\w*", r"\bтаблиц\w*", r"\bсписок\w*",
    r"\bкнопк\w*", r"\bфильтр\w*", r"\bколонк\w*", r"\bстатус\w*",
    r"\bотч[её]т\w*", r"\bуведомлен\w*", r"\bинтеграц\w*", r"\bapi\b",
    r"\bвыгрузк\w*", r"\bзагрузк\w*", r"\bполе\b",
]
GENERIC_BUSINESS_OBJECT_PATTERNS = [
    r"\bклиент\w*", r"\bконтрагент\w*", r"\bсделк\w*", r"\bпоручен\w*",
    r"\bзаявк\w*", r"\bдоговор\w*", r"\bдокумент\w*", r"\bпользовател\w*",
    r"\bрол[ьи]\b", r"\bпродукт\w*", r"\bпортфел\w*", r"\bоперац\w*",
]
SYSTEM_OBJECT_WORDS = [
    "атрибут", "поле", "признак", "карточка", "форма", "экран", "страница",
    "раздел", "реестр", "справочник", "таблица", "список", "кнопка", "фильтр",
    "колонка", "статус", "отчет", "уведомление", "интеграция", "выгрузка", "загрузка",
]
BUSINESS_OBJECT_WORDS = [
    "клиент", "контрагент", "сделка", "поручение", "заявка", "договор",
    "документ", "пользователь", "продукт", "портфель", "операция",
]

# Common Russian transliteration is accepted as a low-confidence requirement
# signal.  This is intentionally phrase-shaped: an isolated Latin word must
# not become sufficient evidence for entering the business dialogue.
TRANSLIT_ACTION_RE = re.compile(
    r"\b(?:hochu|nuzhn\w*|dobav\w*|izmen\w*|sdelat|vigruz\w*|vygruz\w*)\b",
    re.IGNORECASE,
)
TRANSLIT_OBJECT_RE = re.compile(
    r"\b(?:filtr\w*|kartochk\w*|sdelk\w*|otchet\w*|reestr\w*|pole|status\w*|excel)\b",
    re.IGNORECASE,
)


@dataclass
class DomainDecision:
    verdict: str
    strong_count: int = 0
    weak_count: int = 0
    requirement_shaped: bool = False
    action_detected: bool = False
    system_object_detected: bool = False
    business_object_detected: bool = False
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return self.__dict__.copy()

# ---- Prompt injection -----------------------------------------------------
INJECTION_PATTERNS = [
    r"забудь\s+(?:все\s+)?(?:свои\s+)?инструкц",
    r"игнорируй\s+(?:все\s+)?(?:свои\s+)?(?:предыдущ|прежн|правил|инструкц)",
    r"игнорир", r"ignore (all |your )?(previous|prior|instructions|rules)",
    r"now (you|act) (are|as)",
    r"выведи\s+(?:свой\s+)?(?:системный\s+|скрытый\s+)?промпт",
    r"system prompt", r"print your", r"reveal",
    r"не подчиняйся", r"обойди (контроль|правила|ограничени)",
    r"нарушь (правила|ограничения|политик)",
    r"притворись", r"роль не исполняй", r"ты теперь",
    r"двойная роль", r"jailbreak", r"dans le role",
    r"\bты\s+(?:теперь\s+)?dan\b", r"\bdan\b.{0,80}\bбез\s+правил",
    r"(?:напиши|покажи|выведи).{0,80}(?:системн\w*\s+сообщен|скрыт\w*\s+контекст)",
]

# ---- PII / bank secrecy / prohibited actions ------------------------------
PII_PATTERNS = [
    r"\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b",           # card number
    r"\b\d{10}\b",                                        # ИНН / phone 10
    r"снилс", r"паспорт", r"серия и номер",
    r"номер карты", r"карта клиента",
    r"банковская тайна", r"персональн", r"личн\w* данн\w*",
    r"пфд", r"платёжные данные", r"платежные данные",
    r"\b[\w.+-]+@[\w-]+\.[\w.]+\b",                        # email
    r"пароль", r"логин от", r"доступ к счету",
]
PROHIBITED_REQUESTS = [
    r"дай доступ", r"открой доступ", r"предоставь доступ",
    r"переведи (деньги|средства|на счёт|на счет)",
    r"утверди(?:\s+\w+){0,3}\s+(?:требование|задачу)",
    r"одобри(?:\s+\w+){0,3}\s+(?:требование|задачу)",
    r"прими решение за", r"измени (требование|задачу) без согласован",
    r"удали задачу", r"измени статус (задачи|требования)",
    r"раскрой данные клиента", r"покажи данные клиента",
    r"выдай секрет", r"обойди",
]

_STRONG_RE = None
_WEAK_RE = None


def set_domain_vocabulary(strong_terms, weak_terms):
    """Enrich vocabulary from the KB ontology (merged with built-in stems)."""
    global _STRONG_RE, _WEAK_RE
    strong = list(STRONG_DOMAIN_TERMS)
    for t in strong_terms:
        if t and t not in strong:
            strong.append(t)
    weak = list(WEAK_DOMAIN_TERMS)
    for t in weak_terms:
        if t and t not in weak:
            weak.append(t)
    _STRONG_RE = re.compile("|".join(re.escape(t) for t in strong), re.IGNORECASE)
    _WEAK_RE = re.compile("|".join(re.escape(t) for t in weak), re.IGNORECASE)


def _domain_score(text: str) -> tuple[int, int]:
    s = _STRONG_RE if _STRONG_RE else re.compile("|".join(re.escape(t) for t in STRONG_DOMAIN_TERMS), re.IGNORECASE)
    w = _WEAK_RE if _WEAK_RE else re.compile("|".join(re.escape(t) for t in WEAK_DOMAIN_TERMS), re.IGNORECASE)
    strong = len(set(s.findall(text)))
    weak = len(set(w.findall(text)))
    return strong, weak


def _matches_any(patterns: list[str], text: str) -> bool:
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns)


def _fuzzy_contains(words: list[str], text: str) -> bool:
    """Tolerate a single ordinary typo in meaningful words, not short tokens."""
    tokens = [token.replace("ё", "е") for token in re.findall(r"[а-яёa-z]{5,}", text.lower())]
    return any(get_close_matches(token, words, n=1, cutoff=0.84) for token in tokens)


def classify_domain_detailed(text: str) -> DomainDecision:
    """Return an explainable, multi-factor domain decision."""
    low = text.lower()

    for pat in INJECTION_PATTERNS:
        if re.search(pat, low):
            return DomainDecision("malicious_or_policy_violation", reasons=["prompt_injection"])

    for pat in PROHIBITED_REQUESTS:
        if re.search(pat, low):
            return DomainDecision("malicious_or_policy_violation", reasons=["prohibited_action"])

    for pat in PII_PATTERNS:
        if re.search(pat, low):
            return DomainDecision("malicious_or_policy_violation", reasons=["sensitive_data"])

    strong, weak = _domain_score(text)
    action = _matches_any(CHANGE_ACTION_PATTERNS, low)
    system_object = _matches_any(SYSTEM_OBJECT_PATTERNS, low) or _fuzzy_contains(SYSTEM_OBJECT_WORDS, low)
    business_object = _matches_any(GENERIC_BUSINESS_OBJECT_PATTERNS, low) or _fuzzy_contains(BUSINESS_OBJECT_WORDS, low)
    requirement_shaped = action and (system_object or business_object)
    translit_requirement = bool(TRANSLIT_ACTION_RE.search(low) and TRANSLIT_OBJECT_RE.search(low))
    base = dict(
        strong_count=strong, weak_count=weak, requirement_shaped=requirement_shaped,
        action_detected=action, system_object_detected=system_object,
        business_object_detected=business_object,
    )

    if translit_requirement:
        return DomainDecision("possibly_in_domain", reasons=["transliterated_change_request"], **base)
    if strong >= 2 or (strong >= 1 and weak >= 2):
        return DomainDecision("in_domain", reasons=["strong_domain_evidence"], **base)
    if action and system_object and (business_object or strong >= 1):
        return DomainDecision("in_domain", reasons=["domain_change_request"], **base)
    if strong >= 1 or weak >= 2:
        return DomainDecision("possibly_in_domain", reasons=["partial_domain_evidence"], **base)
    if action and system_object:
        return DomainDecision("possibly_in_domain", reasons=["generic_change_request"], **base)
    if requirement_shaped:
        return DomainDecision("possibly_in_domain", reasons=["business_change_request"], **base)
    if system_object or business_object:
        return DomainDecision("possibly_in_domain", reasons=["partial_business_object"], **base)
    return DomainDecision("out_of_domain", reasons=["no_domain_or_requirement_evidence"], **base)


def classify_domain(text: str) -> str:
    """Backward-compatible verdict-only API."""
    return classify_domain_detailed(text).verdict


def describe_verdict(verdict: str) -> str:
    return {
        "in_domain": "Запрос относится к домену платформы.",
        "possibly_in_domain": "Запрос возможно относится к домену платформы.",
        "out_of_domain": "Запрос вне разрешённого домена.",
        "malicious_or_policy_violation": "Запрос нарушает политику безопасности.",
    }.get(verdict, verdict)
