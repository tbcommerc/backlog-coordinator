# ADR-0002: идентификаторы, lineage и canonical digest

Статус: принято для dev/synthetic контура 19.09.2026.

Идентификаторы V2 — случайные UUIDv4 в строковом представлении. Digest —
`sha256-jcs-v1`: SHA-256 от UTF-8 JSON с сортировкой ключей, компактными
разделителями и нормализацией datetime/date/enum. Algorithm id хранится рядом.

SourceArtifact, SourceFragment, ArtifactRevision, DecisionRecord и AuditEvent
append-only на уровне application API. Исправление источника использует
`supersedes`; правка BR создаёт новый `revision_no`. Confirmed claim сохраняет
ссылки на evidence. Audit/outbox пишутся в той же транзакции и не содержат raw
source/message/prompt.

До утверждения retention/erasure/backup expiry сервис отклоняет
`approved_real`; допустима только классификация `synthetic`. Аудио отклоняется.
