# Threat model AI Assistant V2

Статус: AS-IS для dev/synthetic контура, проверено 19.09.2026.

## Trust boundaries и поток данных

```text
Browser --DMB JWT--> DMB gateway --signed actor envelope--> Assistant V2
                                                        |
                                                        +--service credential + envelope--> DMB adapter --> DMB services/DB
Assistant V2 --> isolated assistant_v2 PostgreSQL
```

Основные угрозы и реализованные барьеры:

| Угроза | Барьер |
|---|---|
| Обход pilot scope | env allowlist в DMB, `403` до proxy, `pilot_allowed` в envelope |
| Подмена/replay actor | issuer/audience/expiry/signature/jti; replay cache в V2 и adapter |
| IDOR между кейсами | CaseParticipant проверяется на каждом case/artifact command |
| Prompt injection | source считается data; deny-by-default tools; schema и evidence guards |
| Автоприменение решения моделью | agent создаёт только proposal; confirmation/review/diff decision — human command |
| SSRF/generic egress | agent не имеет generic HTTP tool; adapter URL задаётся конфигурацией |
| Изменение защищённых данных | DTO и diff allowlist исключают users/roles/teams/dictionaries/owners |
| Stale/lost update | expected_version, SQLAlchemy version predicate, base digest и explicit rebase |
| Утечка raw content | audit/outbox/metrics хранят bounded metadata, refs и digest |
| Отказ V2 | V2 non-blocking для DMB readiness; gateway возвращает контролируемый `503` |

Остаточные риски до production: in-process replay store не общий для реплик;
HS256 secrets не имеют утверждённой rotation; retention, provider residency,
backup expiry, SLO и cost ceiling не утверждены. Поэтому real-data/provider gates
остаются выключенными.
