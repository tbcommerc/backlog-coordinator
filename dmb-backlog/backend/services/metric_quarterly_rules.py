"""Quarterly v2 rules. Decimal values never pass through binary floats."""
from calendar import monthrange
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext

RULES_VERSION = 'quarterly-1'


def decimal_value(value):
    if not isinstance(value, (str, Decimal)):
        raise ValueError('Передайте десятичное число строкой')
    if isinstance(value,str):
        import re
        if not re.fullmatch(r'-?\d+(?:\.\d{1,10})?',value):
            raise ValueError('Используйте десятичную запись без экспоненты')
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise ValueError('Некорректное число')
    if not number.is_finite() or abs(number) > Decimal('1e15') or number.as_tuple().exponent < -10:
        raise ValueError('Допустимо до 10 знаков после запятой, модуль не более 1e15')
    return number.normalize() if number else Decimal(0)


def canonical(value):
    if value is None:
        return None
    if not value:
        return '0'
    with localcontext() as ctx:
        ctx.prec = 60
        value = Decimal(value).quantize(Decimal('0.0000000001'))
    return format(value, 'f').rstrip('0').rstrip('.')


def quarter_dates(year, quarter):
    if not 1 <= year <= 9999 or quarter not in (1, 2, 3, 4):
        raise ValueError('Некорректный год или квартал')
    month = quarter * 3
    return date(year, month - 2, 1), date(year, month, monthrange(year, month)[1])


def validate_plan(p, at, active=True):
    if p.baseline_date and (p.baseline_date > p.start_date or p.baseline_date > at):
        raise ValueError('Дата базы не позже начала квартала и сегодня')
    if not active:
        return
    if p.target is None or p.result_type not in ('volume', 'change', 'threshold', 'range'):
        raise ValueError('Заполните тип и план')
    if p.result_type == 'range':
        if p.direction != 'range' or p.upper is None or p.upper < p.target:
            raise ValueError('Укажите корректные границы диапазона')
    elif p.direction not in ('up', 'down'):
        raise ValueError('Укажите направление')
    if p.result_type == 'volume' and (p.direction != 'up' or p.target < 0):
        raise ValueError('Объём: неотрицательный план, направление вверх')
    if p.result_type == 'change':
        if p.baseline is None or p.baseline_date is None:
            raise ValueError('Укажите базу и её дату')
        if not (p.target > p.baseline if p.direction == 'up' else p.target < p.baseline):
            raise ValueError('Цель должна соответствовать направлению изменения')


def result(p, value, final=False):
    answer = dict(outcome='no_data', is_final=final, progress=None, deviation=None)
    if value is None or p.target is None:
        return answer
    value, target = Decimal(value), Decimal(p.target)
    with localcontext() as ctx:
        ctx.prec = 60
        if p.result_type == 'range':
            achieved = target <= value <= p.upper
            deviation = value-target if value < target else value-p.upper if value > p.upper else Decimal(0)
        else:
            achieved = value >= target if p.direction == 'up' else value <= target
            deviation = value-target
        progress = None
        if p.result_type == 'volume' and target > 0:
            progress = value / target * 100
        elif p.result_type == 'change' and p.baseline is not None and target != p.baseline:
            progress = (value-p.baseline) / (target-p.baseline) * 100
        answer.update(outcome=('within_range' if achieved else 'outside_range') if p.result_type == 'range' else ('achieved' if achieved else 'not_achieved'),
                      progress=canonical(progress), deviation=canonical(deviation))
    return answer


def annual(periods, expected, aggregation, scale=100, exclusions=None):
    """Input: quarter -> {plan, fact, state}; missing quarters remain explicit."""
    exclusions = exclusions or {}
    cancelled = [q for q in expected if periods.get(q, {}).get('state') == 'cancelled']
    participating = [q for q in expected if str(q) not in exclusions and q not in cancelled]
    present = {q: periods[q] for q in participating if q in periods}
    closed = [q for q, p in present.items() if p['state'] == 'completed' and p.get('fact') and p['fact']['status'] == 'final']
    missing = [q for q in participating if not present.get(q, {}).get('fact')]
    answer = dict(confirmed_value=None, preliminary_value=None, final_value=None, plan=None,
                  completeness='empty', reason=None, scope_adjusted=expected != [1, 2, 3, 4] or bool(exclusions or cancelled),
                  coverage=dict(expected=expected, participating=participating, closed=closed, missing=missing,
                                unplanned=[q for q in participating if q not in present], excluded=exclusions, cancelled=cancelled,
                                cancellation_reasons={str(q):periods[q].get('cancellation_reason') for q in cancelled}))
    if not participating or aggregation == 'none':
        return answer
    signatures = {(p['plan'].get('result_type'), p['plan'].get('unit_snapshot'), p['plan'].get('method_snapshot'), p['plan'].get('direction')) for p in present.values()}
    if len(signatures) > 1:
        return {**answer, 'completeness': 'not_calculable', 'reason': 'not_comparable'}
    facts = {q: p['fact'] for q, p in present.items() if p.get('fact')}
    if aggregation == 'ratio' and any(f.get('numerator') is None or f.get('denominator') is None for f in facts.values()):
        return {**answer, 'completeness': 'not_calculable', 'reason': 'missing_components'}

    def aggregate(quarters):
        chosen = [facts[q] for q in quarters if q in facts]
        if not chosen:
            return None
        with localcontext() as ctx:
            ctx.prec = 60
            if aggregation == 'last':
                q = max(participating)
                return canonical(Decimal(facts[q]['value'])) if q in quarters and q in facts else None
            if aggregation == 'ratio':
                return canonical(sum(Decimal(f['numerator']) for f in chosen) / sum(Decimal(f['denominator']) for f in chosen) * scale)
            return canonical(sum(Decimal(f['value']) for f in chosen))

    answer['confirmed_value'] = aggregate(closed)
    answer['preliminary_value'] = aggregate(list(facts))
    answer['completeness'] = 'complete' if len(closed) == len(participating) else 'partial' if facts else 'empty'
    if answer['completeness'] == 'complete':
        answer['final_value'] = answer['confirmed_value']
    if aggregation == 'sum' and len(present) == len(participating) and all(p['plan'].get('target') is not None for p in present.values()):
        answer['plan'] = canonical(sum(Decimal(p['plan']['target']) for p in present.values()))
    elif aggregation == 'last' and max(participating) in present:
        answer['plan'] = present[max(participating)]['plan'].get('target')
    answer['progress']=None;answer['deviation']=None
    if answer['final_value'] is not None and answer['plan'] is not None:
        value,target=Decimal(answer['final_value']),Decimal(answer['plan'])
        answer['deviation']=canonical(value-target)
        if aggregation=='sum' and signatures and next(iter(signatures))[0]=='volume' and target>0:
            with localcontext() as ctx:
                ctx.prec=60;answer['progress']=canonical(value/target*100)
    return answer
