"""Shared task metric calculations."""


def calculate_cost_value_ratio(effort_rub, financial_effect):
    """Return cost/value where cost is RUB and value is stored in million RUB."""
    if effort_rub is None or financial_effect is None:
        return None
    cost = float(effort_rub)
    value_mln = float(financial_effect)
    if cost <= 0 or value_mln <= 0:
        return None
    return round(cost / (value_mln * 1_000_000), 4)
