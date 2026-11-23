"""Stable editor-to-reference binding; data reconciliation is an explicit command.

Revision ID: d352a19c40e8
Revises: d251c98e30f7
"""
from alembic import op
import sqlalchemy as sa

revision = "d352a19c40e8"
down_revision = "d251c98e30f7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("dictionary_items", sa.Column("reference_id", sa.Integer(), nullable=True))
    op.create_index("uq_dictionary_reference", "dictionary_items", ["dict_type", "reference_id"], unique=True)


def downgrade():
    op.drop_index("uq_dictionary_reference", table_name="dictionary_items")
    op.drop_column("dictionary_items", "reference_id")
