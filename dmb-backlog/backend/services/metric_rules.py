"""Calendar and result rules, independent from HTTP and persistence."""
import calendar
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

def today():
    return datetime.now(ZoneInfo('Europe/Moscow')).date()

def add_months(anchor, count):
    months = anchor.year * 12 + anchor.month - 1 + count
    year, month = divmod(months, 12)
    month += 1
    return date(year, month, min(anchor.day, calendar.monthrange(year, month)[1]))

def due_dates(period):
    anchor = period.first_due_date
    if period.cadence == 'none' or not anchor:
        return []
    result = []
    for i in range(3662):
        if period.cadence in ('monthly','quarterly'):
            value = add_months(anchor, i * (3 if period.cadence == 'quarterly' else 1))
        else:
            step = {'daily':1,'weekly':7}.get(period.cadence, period.interval_days or 1)
            value = anchor + timedelta(days=i*step)
        if value > period.end_date: break
        result.append(value)
    return result

def summarize(period, measurements, at=None):
    at = at or today()
    points = sorted(measurements, key=lambda x:(x.measured_on, x.id or 0))
    last = points[-1] if points else None
    value = float(last.value) if last else None
    baseline = float(period.baseline) if period.baseline is not None else None
    target = float(period.target) if period.target is not None else None
    upper = float(period.upper) if period.upper is not None else None
    progress = None
    achieved = False
    if value is not None and target is not None:
        if period.direction == 'range':
            achieved = upper is not None and target <= value <= upper
        else:
            achieved = value >= target if period.direction == 'up' else value <= target
            if baseline is not None and baseline != target:
                progress = round((value-baseline)/(target-baseline)*100, 2)
    slots = due_dates(period)
    missed, upcoming = [], []
    previous = period.start_date - timedelta(days=1)
    for due in slots:
        covered = any(previous < x.measured_on <= due for x in points)
        if not covered:
            if due < min(at, period.end_date + timedelta(days=1)): missed.append(due)
            else: upcoming.append(due)
        previous = due
    next_due = missed[0] if missed else upcoming[0] if upcoming else None
    freshness = 'closed' if period.state in ('completed','cancelled') else 'draft' if period.state=='draft' else 'overdue' if missed else 'missing' if not points else 'today' if next_due==at else 'current'
    outcome = 'no_data' if not points else 'achieved' if achieved else 'not_achieved'
    violations = 0
    if period.direction=='range' and target is not None and upper is not None:
        violations = sum(not target <= float(x.value) <= upper for x in points)
        outcome = 'no_data' if not points else 'violated' if violations else 'unconfirmed' if period.cadence == 'none' or missed or at < period.end_date else 'within_range'
    deviation = None
    if value is not None and target is not None:
        deviation = (value - target if period.direction != 'range' else
                     value - target if value < target else value - upper if upper is not None and value > upper else 0)
    return dict(fact=value, measured_on=last.measured_on if last else None, progress=progress, achieved=achieved,
                deviation=deviation,
                next_due=next_due, missed_count=len(missed), freshness=freshness,
                overdue_days=(at-next_due).days if missed else 0, outcome=outcome, violation_count=violations)
