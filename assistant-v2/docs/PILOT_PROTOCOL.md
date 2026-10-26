# Pilot protocol AI Assistant V2

Статус: BLOCKED для real-data/production на 19.09.2026.

Реализация допускает только локальный synthetic pilot. Для включения реальных
данных должны быть письменно утверждены owner, allowlist group, период, baseline,
sample, retention/erasure/backup expiry, transcript consent, provider/DPA/data
residency, SLO/error budget, cost ceiling и customer-confirmation policy.

Stop conditions: любой unauthorized access, автоматическое изменение DMB,
потеря source/evidence lineage, raw content в audit/metrics/log, неразрешённый
provider transfer или недостоверное confirmed claim. Решение keep/parallel/
replace принимает уполномоченный человек; первый pilot не заменяет V1.
