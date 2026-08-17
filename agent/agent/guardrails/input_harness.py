"""Input harness - validates every incoming user message before it reaches
the LLM: domain classification, prompt injection, PII / bank secrecy and
prohibited requests.

Verdicts: in_domain | possibly_in_domain | out_of_domain | malicious_or_policy_violation
"""
import re

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

# ---- Prompt injection -----------------------------------------------------
INJECTION_PATTERNS = [
    r"забудь (все |свои )?инструкц",
    r"игнорируй (все |свои )?(предыдущ|прежн|правил|инструкц)",
    r"игнорир", r"ignore (all |your )?(previous|prior|instructions|rules)",
    r"now (you|act) (are|as)",
    r"выведи (системный |скрытый )?промпт",
    r"system prompt", r"print your", r"reveal",
    r"не подчиняйся", r"обойди (контроль|правила|ограничени)",
    r"нарушь (правила|ограничения|политик)",
    r"притворись", r"роль не исполняй", r"ты теперь",
    r"двойная роль", r"jailbreak", r"dans le role",
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
    r"утверди (требование|задачу)", r"одобри (требование|задачу)",
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


def classify_domain(text: str) -> str:
    """Return verdict for the message."""
    low = text.lower()

    for pat in INJECTION_PATTERNS:
        if re.search(pat, low):
            return "malicious_or_policy_violation"

    for pat in PROHIBITED_REQUESTS:
        if re.search(pat, low):
            return "malicious_or_policy_violation"

    for pat in PII_PATTERNS:
        if re.search(pat, low):
            return "malicious_or_policy_violation"

    strong, weak = _domain_score(text)
    if strong >= 2 or (strong >= 1 and weak >= 2):
        return "in_domain"
    if strong >= 1 or weak >= 2:
        return "possibly_in_domain"
    return "out_of_domain"


def describe_verdict(verdict: str) -> str:
    return {
        "in_domain": "Запрос относится к домену платформы.",
        "possibly_in_domain": "Запрос возможно относится к домену платформы.",
        "out_of_domain": "Запрос вне разрешённого домена.",
        "malicious_or_policy_violation": "Запрос нарушает политику безопасности.",
    }.get(verdict, verdict)
