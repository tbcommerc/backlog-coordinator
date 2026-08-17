"""Optional LLM rephrasing of template-generated assistant replies.

The dialogue machine stays deterministic (planner + slot machine + templates);
when an OpenAI-compatible provider is configured, assistant replies are passed
through the LLM to sound more natural. Any failure falls back to the original
template text so the chat never breaks.
"""
import logging
import time

from ..config import settings
from .openai_compat import OpenAICompatProvider

logger = logging.getLogger("agent_rephrase")

REPHRASE_SYSTEM = (
    "Ты — ассистент аналитика по сбору бизнес-требований к платформе "
    "сопровождения инвестиционных сделок. Тебе дан черновой текст реплики, "
    "которую ассистент покажет пользователю. Перепиши её естественнее и "
    "живее, НЕ изменяя смысл, факты, имена, названия, аббревиатуры, числа и "
    "структуру (списки, переносы строк, порядок пунктов). Не добавляй ничего "
    "нового, не задавай лишних вопросов, не добавляй приветствий и "
    "рассуждений. Верни ТОЛЬКО переписанный текст на русском языке."
)

REPHRASE_TIMEOUT = 3.0
REPHRASE_COOLDOWN = 300.0  # seconds to skip rephrasing after a failure

_cooldown_until = 0.0


def enabled() -> bool:
    return (
        (settings.LLM_PROVIDER or "mock").strip().lower() == "openai_compat"
        and bool(settings.OPENAI_API_KEY)
    )


def _tripped() -> bool:
    return time.time() < _cooldown_until


def _trip():
    global _cooldown_until
    _cooldown_until = time.time() + REPHRASE_COOLDOWN


def rephrase(text: str) -> str:
    """Return a rephrased version of ``text``, or the original text on failure.

    Fail-fast circuit breaker: a single slow/failed LLM call disables rephrasing
    for ``REPHRASE_COOLDOWN`` seconds so the chat never blocks on a dead LLM.
    """
    if not enabled() or not text:
        return text
    if _tripped():
        return text
    provider = OpenAICompatProvider()
    if not provider.available():
        return text
    try:
        out = provider.chat(
            [{"role": "user", "content": text}],
            system_prompt=REPHRASE_SYSTEM,
            temperature=0.4,
            max_tokens=512,
            timeout=REPHRASE_TIMEOUT,
        )
        out = (out or "").strip()
        if out:
            return out
        return text
    except Exception:
        _trip()
        logger.warning("LLM rephrase failed; disabling rephrasing for %.0fs", REPHRASE_COOLDOWN)
        return text
