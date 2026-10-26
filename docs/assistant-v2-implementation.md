# AI Assistant V2 — фактическая реализация

> Статус: AS-IS PARTIAL, проверено по коду и тестам 19.09.2026. Это дополнение к
> нормативному [`assistant-v2-technical-spec.md`](assistant-v2-technical-spec.md),
> а не замена открытых product/security/privacy решений.

Этот greenfield-контур сохранён как legacy-прототип для диагностики и регрессии,
но больше не представлен отдельной страницей: пункта sidebar нет, а
`#/assistant-v2` перенаправляется на канонический fork-based UI `#/agent-v2`.

## Реализовано

- отдельный opt-in FastAPI service, DB role/database, Alembic, process, logs,
  health/readiness/metrics и global kill switch;
- DMB gateway с автоматическим допуском `admin=full`, pilot allowlist для
  остальных и signed actor envelope; read-only adapter с
  повторной DMB policy check и без передачи DMB DB credentials в V2;
- persisted data classification и fail-closed запрет real-data case,
  authorized snapshot и ProposedDiff при выключенном real-data gate;
- NeedCase, immutable sources/fragments, claims/evidence, versioned manual
  gaps/conflicts/decisions, deterministic readiness, lifecycle, human
  split/handoff, audit/idempotency/outbox;
- BusinessRequirement immutable revisions, deterministic validator и отдельный
  review gate;
- ProposedDiff с per-operation decision, stale/rebase, protected-field denylist
  и pilot handoff в существующую Task form без direct apply;
- manual-safe orchestrator, schema/evidence/tool guards и один следующий вопрос;
- lazy-loaded UI с единым понятным путём «Поручение → Уточнение →
  Требование → Проверка → Задача»; внутренние paths/status/rule ID в UI локализованы
  и представлены как поля и понятные действия.

## Намеренно выключено

Реальный LLM provider, реальные данные, сырое аудио, atomic DMB apply и
production rollout не включены. Причина — открытые V2-OPEN-001..008: retention,
legal/consent, provider/DPA/residency, SLO, cost, pilot ownership,
customer-confirmation policy и production service-auth/rotation.

Dev-решения о UUID/digest, non-blocking readiness и раннем signed credential
записаны в `assistant-v2/docs/decisions/`; они не заменяют production approval.

## Evidence

- `assistant-v2/tests/` — domain, workflow, security, diff и migration-policy;
- OpenAPI генерируется сервисом на `/openapi.json` и `/docs`;
- threat model, operations, pilot stop gate и V1 manifest находятся в
  `assistant-v2/docs/`.
