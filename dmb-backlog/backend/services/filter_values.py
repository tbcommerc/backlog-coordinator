"""Read-only filter cardinality: scalar compatibility and explicit OR lists."""
import json
from fastapi import HTTPException


def filter_values(value, *, numeric=False, allowed=None):
    if value is None or value == '':
        return []
    try:
        values = json.loads(value) if isinstance(value, str) and value.startswith('[') else [value]
        if not isinstance(values, list) or not 1 <= len(values) <= 100:
            raise ValueError()
        if any(isinstance(item, (dict, list, bool)) or item is None for item in values):
            raise ValueError()
        if numeric and any(not str(item).isdigit() for item in values):
            raise ValueError()
        values = list(dict.fromkeys(int(item) if numeric else str(item) for item in values))
        if numeric and any(item <= 0 for item in values):
            raise ValueError()
        if allowed is not None and any(item not in allowed for item in values):
            raise ValueError()
        return values
    except (ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(422, 'Недопустимые значения фильтра')
