"""Адаптеры GigaChat: публичный API и внутренний контур банка (GigaCode).

Оба говорят по OpenAI-совместимой схеме `/chat/completions`, различаются только
способом авторизации:

* публичный контур — Authorization key из личного кабинета меняется на
  access_token по OAuth, токен живёт 30 минут;
* внутренний контур — базовый URL и сертификат выдаёт владелец контура,
  переменные те же, что в strategy-decomposer (GIGACODE_LLM_BASE_URL и
  GIGACODE_CA_BUNDLE).

Ни один секрет в репозиторий не попадает: всё читается из окружения.
"""

from __future__ import annotations

import os
import time
import uuid

import httpx

from app.llm.base import SYSTEM_PROMPT, TaskHints, build_user_prompt, parse_hints

OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
PUBLIC_BASE_URL = "https://gigachat.devices.sberbank.ru/api/v1"
DEFAULT_MODEL = "GigaChat-2-Max"

# Запас, чтобы не отправить запрос с токеном, истекающим в этот же момент.
TOKEN_EXPIRY_BUFFER_SECONDS = 60


class GigaChatAdapter:
    """Публичный GigaChat API (developers.sber.ru)."""

    name = "gigachat"

    def __init__(self, model: str | None = None, timeout: float = 30.0) -> None:
        self.model = model or DEFAULT_MODEL
        self.timeout = timeout
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self.last_usage: dict[str, int | float | None] = {}

        ca_bundle = os.getenv("GIGACHAT_CA_BUNDLE", "").strip()
        # Сертификат Минцифры не входит в системный trust store — если путь
        # задан, доверяем именно ему.
        self._verify: str | bool = ca_bundle or True

    # --- авторизация --------------------------------------------------------
    def _fetch_token(self) -> str:
        credentials = os.getenv("GIGACHAT_CREDENTIALS", "").strip()
        if not credentials:
            raise RuntimeError("не задан GIGACHAT_CREDENTIALS")
        scope = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")

        response = httpx.post(
            OAUTH_URL,
            headers={
                "Authorization": f"Basic {credentials}",
                "RqUID": str(uuid.uuid4()),
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            data={"scope": scope},
            timeout=self.timeout,
            verify=self._verify,
        )
        response.raise_for_status()
        payload = response.json()

        self._token = payload["access_token"]
        # expires_at приходит в миллисекундах epoch.
        self._token_expires_at = float(payload.get("expires_at", 0)) / 1000.0
        return self._token

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_expires_at - TOKEN_EXPIRY_BUFFER_SECONDS:
            return self._token
        return self._fetch_token()

    def _base_url(self) -> str:
        return PUBLIC_BASE_URL

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._access_token()}"}

    # --- вызов --------------------------------------------------------------
    def classify(self, task_text: str, team: str | None, team_class: str) -> TaskHints:
        user_prompt = build_user_prompt(task_text, team, team_class)
        started = time.perf_counter()

        response = httpx.post(
            f"{self._base_url()}/chat/completions",
            headers={**self._auth_headers(), "Content-Type": "application/json"},
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.1,
                "max_tokens": 512,
            },
            timeout=self.timeout,
            verify=self._verify,
        )
        response.raise_for_status()
        payload = response.json()

        usage = payload.get("usage") or {}
        self.last_usage = {
            "tokens_in": usage.get("prompt_tokens"),
            "tokens_out": usage.get("completion_tokens"),
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }

        text = payload["choices"][0]["message"]["content"]
        return parse_hints(text, self.name)


    def complete(self, system: str, user: str, schema: dict | None = None) -> str:
        """Свободный вызов для оценки по рубрике.

        GigaChat не поддерживает structured outputs, поэтому схема служит
        подсказкой в промпте, а разбор ответа делает parse_json_object.
        """
        response = httpx.post(
            f"{self._base_url()}/chat/completions",
            headers={**self._auth_headers(), "Content-Type": "application/json"},
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.1,
                "max_tokens": 1024,
            },
            timeout=self.timeout,
            verify=self._verify,
        )
        response.raise_for_status()
        payload = response.json()
        usage = payload.get("usage") or {}
        self.last_usage = {
            "tokens_in": usage.get("prompt_tokens"),
            "tokens_out": usage.get("completion_tokens"),
        }
        return payload["choices"][0]["message"]["content"]


class GigaCodeAdapter(GigaChatAdapter):
    """Внутренний контур банка: тот же протокол, другой endpoint и сертификат.

    Проверить этот путь можно только изнутри контура — снаружи endpoint
    недоступен. Схема авторизации повторяет плагин gigacode-auth.js
    из strategy-decomposer.
    """

    name = "gigacode"

    def __init__(self, model: str | None = None, timeout: float = 30.0) -> None:
        super().__init__(model=model, timeout=timeout)
        ca_bundle = os.getenv("GIGACODE_CA_BUNDLE", "").strip()
        self._verify = ca_bundle or True

    def _base_url(self) -> str:
        base = os.getenv("GIGACODE_LLM_BASE_URL", "").strip()
        if not base:
            raise RuntimeError("не задан GIGACODE_LLM_BASE_URL")
        return base.rstrip("/")

    def _access_token(self) -> str:
        # Во внутреннем контуре токен выдаёт сам прокси по учётной записи
        # пользователя; отдельного OAuth-обмена, как в публичном API, нет.
        token = os.getenv("GIGACODE_TOKEN", "").strip()
        if token:
            return token
        return super()._access_token()
