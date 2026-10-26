"""Independent immutable work meeting snapshots."""
from alembic import op
revision = 'a1b2c3d4e517'
down_revision = 'a1b2c3d4e516'
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE TABLE work_meeting_snapshots (meeting_id INTEGER PRIMARY KEY REFERENCES reporting_meetings(id), schema_version INTEGER NOT NULL, payload JSON NOT NULL, captured_at TIMESTAMPTZ NOT NULL DEFAULT now())")
    op.execute("""CREATE FUNCTION prevent_work_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Work meeting snapshots are immutable'; END $$""")
    op.execute("CREATE TRIGGER work_snapshot_immutable BEFORE UPDATE OR DELETE ON work_meeting_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_work_snapshot_mutation()")

def downgrade():
    raise RuntimeError('Preserve work snapshots; destructive downgrade is disabled')
