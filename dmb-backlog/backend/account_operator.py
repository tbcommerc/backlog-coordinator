"""Read-only inventory and explicit maintenance-window cutover/recovery.
No command runs on startup. Mutations require --apply and an operator reason.
"""
import argparse
import json
import sys
from pathlib import Path
from sqlalchemy import text
from database import SessionLocal
from models import User, LoginReservation
from services import accounts, auth_sessions as sessions, auth_challenges as challenges
from services.credentials import normalize_login
from config import settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['report', 'cutover', 'preserve-passwords', 'recover-admin', 'prune'])
    parser.add_argument('--mapping', type=Path, help='Approved JSON object: user ID -> login')
    parser.add_argument('--user-id', type=int)
    parser.add_argument('--reason')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.operation == 'report':
            rows = db.query(User).order_by(User.id).all()
            seen, report = {}, []
            for user in rows:
                try:
                    login = normalize_login(user.email or '')
                    issue = 'collision' if login in seen else None
                    seen[login] = user.id
                except Exception:
                    login, issue = None, 'manual_mapping_required'
                report.append({'id': user.id, 'proposed_login': login, 'issue': issue})
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return
        if not args.apply or not args.reason or not sys.stdin.isatty():
            parser.error('Mutation requires an interactive protected console, --apply and --reason')
        if args.operation == 'prune':
            from services.auth_retention import prune
            print(json.dumps(prune(db)))
            return
        accounts.admin_lock(db)
        if args.operation == 'preserve-passwords':
            if not settings.AUTH_ALLOW_LEGACY_PASSWORDS:
                parser.error('AUTH_ALLOW_LEGACY_PASSWORDS must be explicitly enabled')
            users = db.query(User).order_by(User.id).with_for_update().all()
            normalized = {u.id: normalize_login(u.email or '') for u in users}
            if len(set(normalized.values())) != len(users):
                parser.error('Canonical email login collision')
            if any(u.login_normalized for u in users):
                parser.error('Cutover already started; refusing to overwrite accounts')
            if any(not u.password_hash or not u.password_hash.startswith(('$2a$', '$2b$', '$2y$', '$argon2id$')) for u in users):
                parser.error('Missing or unsupported existing password hash')
            for user in users:
                user.login_normalized = normalized[user.id]
                user.credential_state = 'ready'
                accounts.reserve(db, user.login_normalized, user)
                sessions.event(db, 'preserve_passwords_cutover', user.id, reason=args.reason)
            db.flush()
            db.execute(text('ALTER TABLE users ALTER COLUMN login_normalized SET NOT NULL'))
            accounts.commit(db)
            print(f'Compatibility rollout complete: {len(users)} accounts; passwords and existing account fields preserved.')
            return
        if args.operation == 'cutover':
            if not args.mapping:
                parser.error('--mapping is required; no implicit email/login conversion')
            mapping = json.loads(args.mapping.read_text(encoding='utf-8'))
            users = db.query(User).order_by(User.id).with_for_update().all()
            if set(mapping) != {str(u.id) for u in users}:
                parser.error('Mapping must cover every existing user exactly once')
            normalized = {key: normalize_login(value) for key, value in mapping.items()}
            if len(set(normalized.values())) != len(users):
                parser.error('Canonical login collision')
            if any(u.login_normalized for u in users):
                parser.error('Cutover already started; investigate instead of overwriting mappings')
            for user in users:
                user.login = user.login_normalized = normalized[str(user.id)]
                accounts.reserve(db, user.login, user)
                sessions.invalidate(db, user, 'cutover')
                user.password_hash, user.credential_state = None, 'invited'
                sessions.event(db, 'cutover', user.id, reason=args.reason)
            db.flush()
            db.execute(text('ALTER TABLE users ALTER COLUMN login_normalized SET NOT NULL'))
            accounts.commit(db)
            print('Cutover complete; public access must remain closed until administrator activation.')
        else:
            user = sessions.lock_user(db, args.user_id)
            if not user or not user.is_active or not user.login_normalized or not user.role or user.role.admin_access != 'full':
                parser.error('An existing active full administrator with an approved login is required')
            sessions.invalidate(db, user, 'operator_recovery')
            user.password_hash, user.credential_state = None, 'invited'
            result = challenges.issue(db, user, 'invitation', settings.AUTH_INVITE_MINUTES)
            sessions.event(db, 'operator_recovery', user.id, reason=args.reason)
            accounts.commit(db)
            print('One-time code (do not capture terminal output):', result['token'])
            print('Expires:', result['expires_at'].isoformat())

if __name__ == '__main__':
    main()
