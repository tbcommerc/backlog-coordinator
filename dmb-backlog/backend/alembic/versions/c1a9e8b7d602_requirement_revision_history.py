"""Keep submitted requirement snapshots and review decisions.

Only ordinary requirement records are affected. Existing records receive empty
history containers; the first edit captures their available snapshot without
inventing past revisions or decision dates.
"""
from alembic import op
import sqlalchemy as sa

revision = "c1a9e8b7d602"
down_revision = "b8d4e6f2a901"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("requirement_requests", sa.Column("revision_history", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))
    op.add_column("requirement_requests", sa.Column("status_history", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))


def downgrade():
    op.drop_column("requirement_requests", "status_history")
    op.drop_column("requirement_requests", "revision_history")
