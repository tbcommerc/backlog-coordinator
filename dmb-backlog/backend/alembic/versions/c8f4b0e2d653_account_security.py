"""Add account security schema only. No existing credentials are changed."""
from alembic import op
import sqlalchemy as sa

revision = 'c8f4b0e2d653'
down_revision = 'b7e3a9d1c542'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('users', 'login', type_=sa.String(254))
    op.alter_column('users', 'email', nullable=True)
    op.alter_column('users', 'password_hash', nullable=True)
    for column in [sa.Column('login_normalized', sa.String(254)),
        sa.Column('credential_state', sa.String(20), nullable=False, server_default='invited'),
        sa.Column('auth_version', sa.BigInteger(), nullable=False, server_default='1'),
        sa.Column('password_changed_at', sa.DateTime(timezone=True)),
        sa.Column('password_normalization_version', sa.Integer(), nullable=False, server_default='1')]:
        op.add_column('users', column)
    op.create_unique_constraint('uq_users_login_normalized', 'users', ['login_normalized'])
    op.create_check_constraint('ck_user_credentials', 'users', "credential_state IN ('invited','ready','reset_required')")
    op.create_check_constraint('ck_user_password_present', 'users', "credential_state = 'invited' OR password_hash IS NOT NULL")
    op.create_table('login_reservations',
        sa.Column('login_normalized', sa.String(254), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('retired_at', sa.DateTime(timezone=True)))
    op.create_table('auth_sessions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('auth_version', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_activity_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('absolute_expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True)),
        sa.Column('revoke_reason', sa.String(64)), sa.Column('ip_address', sa.String(64)), sa.Column('client_label', sa.String(256)))
    op.create_index('ix_auth_sessions_user_id', 'auth_sessions', ['user_id'])
    op.create_index('ix_auth_sessions_revoked_at', 'auth_sessions', ['revoked_at'])
    op.create_table('auth_challenges',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('issuer_id', sa.Integer(), sa.ForeignKey('users.id')),
        sa.Column('purpose', sa.String(48), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('auth_version', sa.BigInteger(), nullable=False),
        sa.Column('session_id', sa.String(36), sa.ForeignKey('auth_sessions.id')),
        sa.Column('target_user_id', sa.Integer()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True)), sa.Column('revoked_at', sa.DateTime(timezone=True)))
    op.create_index('ix_auth_challenges_user_id', 'auth_challenges', ['user_id'])
    op.create_index('uq_active_password_setup', 'auth_challenges', ['user_id'], unique=True,
        postgresql_where=sa.text("purpose IN ('invitation','recovery') AND used_at IS NULL AND revoked_at IS NULL"))
    op.create_table('security_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('actor_id', sa.Integer(), sa.ForeignKey('users.id')),
        sa.Column('subject_id', sa.Integer(), sa.ForeignKey('users.id')),
        sa.Column('session_id', sa.String(36)), sa.Column('action', sa.String(64), nullable=False),
        sa.Column('outcome', sa.String(16), nullable=False), sa.Column('reason', sa.String(256)),
        sa.Column('request_id', sa.String(64)), sa.Column('ip_address', sa.String(64)))
    op.create_index('ix_security_events_subject_id', 'security_events', ['subject_id'])
    op.add_column('refresh_sessions', sa.Column('auth_session_id', sa.String(36)))
    op.create_foreign_key('fk_refresh_auth_session', 'refresh_sessions', 'auth_sessions', ['auth_session_id'], ['id'])
    op.create_index('ix_refresh_sessions_auth_session_id', 'refresh_sessions', ['auth_session_id'])


def downgrade():
    raise RuntimeError('Security cutover cannot be downgraded to an application without session revocation')
