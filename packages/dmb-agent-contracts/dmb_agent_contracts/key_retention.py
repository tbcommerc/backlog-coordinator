"""Freeze each key's guarantee independently of later retention settings."""
from datetime import datetime,timedelta,timezone

MARKER='_key_expires_at_v1'


def frozen_profile(profile,created,days):
    if type(days) is not int or not 7<=days<=90:
        raise ValueError('idempotency_retention_requires_7_to_90_days')
    if created.tzinfo is None:
        created=created.replace(tzinfo=timezone.utc)
    return {**profile,MARKER:(created+timedelta(days=days)).isoformat()}


def public_profile(profile):
    return {key:value for key,value in (profile or {}).items() if key!=MARKER}


def public_row(row):
    return {**dict(row),'profile':public_profile(row['profile'])}


def expiry(row):
    created=row['created_at']
    if created.tzinfo is None:
        created=created.replace(tzinfo=timezone.utc)
    try:
        value=datetime.fromisoformat(row['profile'][MARKER])
        if value.tzinfo is not None and value>=created+timedelta(days=7):
            return value
    except (KeyError,TypeError,ValueError):
        pass
    # Old rows did not freeze their policy. Preserve the greatest window the
    # shipped configuration allowed rather than shorten an existing promise.
    return created+timedelta(days=90)


def tombstone_profile(row):
    return {MARKER:expiry(row).isoformat()}
