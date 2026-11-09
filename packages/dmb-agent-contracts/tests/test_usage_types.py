import pytest
from pydantic import ValidationError
from dmb_agent_contracts.chat import provider_usage

@pytest.mark.parametrize("value", [True, False, -1, "12", 1.5])
def test_provider_usage_requires_nonnegative_integer(value):
    with pytest.raises(ValidationError):
        provider_usage({"usage": {"prompt_tokens": value}})

def test_absent_usage_is_explicit_and_partial_usage_preserved():
    assert provider_usage({}).unavailable_reason == "provider_not_reported"
    result = provider_usage({"usage": {"prompt_tokens": 0}})
    assert result.input_tokens == 0 and result.output_tokens is None
    assert result.unavailable_reason == "provider_partial_usage"


@pytest.mark.parametrize('value',[True,False,-1,'0.25',float('inf'),float('nan')])
@pytest.mark.parametrize('field',['cost','allowance'])
def test_cost_and_allowance_are_finite_reported_numbers(field,value):
    usage={'cost':value} if field=='cost' else {'opencode':{'allowance':value}}
    with pytest.raises(ValidationError):
        provider_usage({'usage':usage})


def test_cost_and_allowance_are_independent_and_absence_is_not_zero():
    reported=provider_usage({'usage':{'cost':0,'opencode':{'allowance':0.125}}})
    assert reported.cost==0 and reported.allowance==0.125
    missing=provider_usage({'usage':{'prompt_tokens':5}})
    assert missing.cost is None and missing.allowance is None
    assert missing.unavailable_reason=='provider_partial_usage'
