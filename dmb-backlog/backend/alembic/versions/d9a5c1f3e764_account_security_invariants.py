"""Reconcile constraints for installations that applied the early additive revision."""
from alembic import op

revision = 'd9a5c1f3e764'
down_revision = 'c8f4b0e2d653'
branch_labels = None
depends_on = None


def upgrade():
    # The first additive revision may already have been installed while account
    # rollout was in progress. Reconcile without touching any credential value.
    op.execute("""
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'ck_user_password_present' AND conrelid = 'users'::regclass) THEN
        ALTER TABLE users ADD CONSTRAINT ck_user_password_present
          CHECK (credential_state = 'invited' OR password_hash IS NOT NULL);
      END IF;
    END $$;
    """)
    op.execute('CREATE INDEX IF NOT EXISTS ix_security_events_subject_time ON security_events (subject_id, created_at)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_auth_sessions_user_expiry ON auth_sessions (user_id, revoked_at, absolute_expires_at)')


def downgrade():
    raise RuntimeError('Security invariants must not be removed by rollback')
