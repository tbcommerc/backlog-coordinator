"""Export a reviewed SQL upgrade for a DBA; never connects to the database."""
import argparse
import hashlib
import io
import os
from pathlib import Path
import tempfile
import sys

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--from-revision', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    stdout = str(args.output) == '-'
    output = args.output.resolve()
    if not stdout and output.exists():
        parser.error('Output already exists; choose a new release SQL filename')
    config = Config(str(Path(__file__).parent/'alembic.ini'), output_buffer=io.StringIO())
    scripts = ScriptDirectory.from_config(config)
    if args.from_revision in {'base','head','heads'}:
        parser.error('Specify the recorded revision; use the separate initial-schema artifact for an empty database')
    scripts.get_revision(args.from_revision)
    command.upgrade(config,args.from_revision+':head',sql=True)
    sql = config.output_buffer.getvalue()
    revision = scripts.get_revision(args.from_revision).revision
    precondition = ("SET LOCAL lock_timeout='120s';\nSELECT pg_advisory_xact_lock(709184521232);\n"
        "DO $$ BEGIN IF (SELECT version_num FROM alembic_version) IS DISTINCT FROM '"+revision+
        "' THEN RAISE EXCEPTION 'Unexpected database revision; DBA review required'; END IF; END $$;\n")
    if 'BEGIN;' not in sql:
        raise RuntimeError('Expected transactional PostgreSQL migration SQL')
    sql = '-- DBA ONLY: review, back up and apply outside the application.\n'+sql.replace('BEGIN;','BEGIN;\n'+precondition,1)
    if stdout:
        sys.stdout.write(sql)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=output.parent,delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(sql)
    try:
        os.replace(temporary,output)
    finally:
        temporary.unlink(missing_ok=True)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_name(output.name+'.sha256').write_text(digest+'  '+output.name+'\n',encoding='utf-8')
    print('DBA SQL exported; nothing executed against a database.')


if __name__ == '__main__':
    main()
