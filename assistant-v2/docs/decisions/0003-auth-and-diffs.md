# ADR-0003: actor envelope, adapter и ProposedDiff

Статус: принято для локального раннего пилота 19.09.2026.

DMB gateway повторно аутентифицирует browser JWT и выпускает короткоживущий
HS256 actor envelope с issuer/audience, jti, user/team snapshot, bounded
permission snapshot, purpose, request_id и trace_id. V2 и adapter проверяют
подпись, audience, issuer, expiry, pilot flag и replay в пределах процесса.
Adapter дополнительно требует отдельный service credential и заново загружает
активного пользователя и object policy из DMB.

ProposedDiff содержит base version/digest, source revision/digest, evidence и
allowlisted operations. В раннем пилоте разрешены только безопасные поля Task:
`title`, `description`, `comment`, `link_mockups`, `link_requirements`.
Пользователь принимает операции поштучно; adapter проверяет актуальность и
возвращает prefill существующей Task form. Сохранение выполняет человек через
обычный DMB lifecycle. Endpoint atomic apply отсутствует.

Для multi-instance/production требуется отдельное security-решение о mTLS,
rotation и распределённом replay store; текущий credential не объявляется
production-ready.
