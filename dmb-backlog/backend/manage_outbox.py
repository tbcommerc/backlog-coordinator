"""Operator CLI for dead-letter inspection and replay."""
from __future__ import annotations

import argparse
import json

from database import SessionLocal
from models import EventOutbox
from outbox_admin import (
    DeadLetterConflict,
    DeadLetterNotFound,
    requeue_dead_letter,
    serialize_dead_letter,
)


def list_events(limit: int) -> int:
    db = SessionLocal()
    try:
        rows = db.query(EventOutbox).filter(
            EventOutbox.dead_lettered_at.is_not(None)
        ).order_by(EventOutbox.dead_lettered_at.desc()).limit(limit).all()
        print(json.dumps(
            [serialize_dead_letter(row) for row in rows],
            ensure_ascii=False,
            default=str,
            indent=2,
        ))
        return 0
    finally:
        db.close()


def requeue_event(event_id: int, expected_attempts: int, confirmed: bool) -> int:
    if not confirmed:
        print("Refusing replay without --yes")
        return 2
    db = SessionLocal()
    try:
        try:
            result = requeue_dead_letter(
                db,
                event_id=event_id,
                expected_attempts=expected_attempts,
                actor_user_id=None,
                request_id=f"cli-outbox-requeue-{event_id}",
                trace_id=None,
            )
            db.commit()
        except (DeadLetterConflict, DeadLetterNotFound) as exc:
            db.rollback()
            print(str(exc))
            return 1
        print(
            f"Requeued event {result.event_id} ({result.event_type}); "
            f"previous attempts={result.previous_attempts}"
        )
        return 0
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="List dead-letter events")
    listing.add_argument("--limit", type=int, default=50)
    replay = commands.add_parser("requeue", help="Replay one dead-letter event")
    replay.add_argument("event_id", type=int)
    replay.add_argument("--expected-attempts", type=int, required=True)
    replay.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    if args.command == "list":
        return list_events(max(1, min(args.limit, 500)))
    return requeue_event(args.event_id, args.expected_attempts, args.yes)


if __name__ == "__main__":
    raise SystemExit(main())
