import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pricing  # noqa: E402


def make_call(**overrides):
    call = dict(
        request_id="req-1",
        session_id="sess-1",
        agent="main",
        model="claude-sonnet-5",
        timestamp="2026-08-28T00:00:00Z",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_read_tokens=0,
        cache_write_5m_tokens=0,
        cache_write_1h_tokens=0,
    )
    call.update(overrides)
    return call


def test_call_cost_known_model_computes_expected_dollar_amount():
    # claude-sonnet-5: $2.00/MTok input, $10.00/MTok output, $0.20/MTok
    # cache_read, $2.50/MTok cache_write_5m, $4.00/MTok cache_write_1h.
    row = make_call(
        model="claude-sonnet-5",
        input_tokens=1_000_000,
        output_tokens=500_000,
        cache_read_tokens=2_000_000,
        cache_write_5m_tokens=1_000_000,
        cache_write_1h_tokens=500_000,
    )

    cost = pricing.call_cost(row)

    expected = (2.00 * 1) + (10.00 * 0.5) + (0.20 * 2) + (2.50 * 1) + (4.00 * 0.5)
    assert cost == pytest.approx(expected)


def test_call_cost_opus_5_5_computes_expected_dollar_amount():
    # claude-opus-5-5: $4.00/MTok input, $20.00/MTok output, $0.20/MTok
    # cache_read, $5.00/MTok cache_write_5m, $8.00/MTok cache_write_1h.
    row = make_call(
        model="claude-opus-5-5",
        input_tokens=1_000_000,
        output_tokens=500_000,
        cache_read_tokens=2_000_000,
        cache_write_5m_tokens=1_000_000,
        cache_write_1h_tokens=500_000,
    )

    cost = pricing.call_cost(row)

    expected = (4.00 * 1) + (20.00 * 0.5) + (0.20 * 2) + (5.00 * 1) + (8.00 * 0.5)
    assert cost == pytest.approx(expected)


def test_call_cost_fable_5_1_computes_expected_dollar_amount():
    # claude-fable-5-1: $10.00/MTok input, $50.00/MTok output, $1.00/MTok
    # cache_read, $12.50/MTok cache_write_5m, $20.00/MTok cache_write_1h.
    row = make_call(
        model="claude-fable-5-1",
        input_tokens=1_000_000,
        output_tokens=500_000,
        cache_read_tokens=2_000_000,
        cache_write_5m_tokens=1_000_000,
        cache_write_1h_tokens=500_000,
    )

    cost = pricing.call_cost(row)

    expected = (10.00 * 1) + (50.00 * 0.5) + (1.00 * 2) + (12.50 * 1) + (20.00 * 0.5)
    assert cost == pytest.approx(expected)


def test_call_cost_unknown_model_returns_unknown():
    row = make_call(model="claude-nonexistent-9000")

    assert pricing.call_cost(row) == "unknown"


def test_group_cost_mixed_priced_and_unpriced_models_returns_none():
    rows = [
        make_call(request_id="req-1", model="claude-sonnet-5"),
        make_call(request_id="req-2", model="claude-nonexistent-9000"),
    ]

    assert pricing.group_cost(rows) is None


def test_group_cost_all_known_models_sums_each_row():
    rows = [
        make_call(request_id="req-1", model="claude-sonnet-5", input_tokens=1_000_000, output_tokens=0),
        make_call(request_id="req-2", model="claude-haiku-4-5-20251001", input_tokens=1_000_000, output_tokens=0),
    ]

    total = pricing.group_cost(rows)

    # $2.00 (sonnet-5 input) + $1.00 (haiku-4-5 input)
    assert total == pytest.approx(3.00)


def test_call_cost_partial_rate_set_returns_unknown_instead_of_raising():
    # A local price table where a real model is missing one rate key —
    # call_cost must degrade to "unknown" rather than raising KeyError
    # when a row has nonzero tokens on exactly that missing field.
    partial_prices = {
        "claude-partial-model": {
            "input": 2.00,
            "output": 10.00,
            "cache_read": 0.20,
            "cache_write_5m": 2.50,
            # cache_write_1h intentionally missing
        }
    }
    row = make_call(model="claude-partial-model", cache_write_1h_tokens=500_000)

    assert pricing.call_cost(row, prices=partial_prices) == "unknown"


def test_call_cost_partial_rate_set_with_zero_on_missing_field_still_unknown():
    # Even when the missing field's token count happens to be zero, the
    # rate set is still partial — this must not "accidentally" compute a
    # real dollar figure that only looks correct because that field was 0.
    partial_prices = {
        "claude-partial-model": {
            "input": 2.00,
            "output": 10.00,
            "cache_read": 0.20,
            "cache_write_5m": 2.50,
        }
    }
    row = make_call(model="claude-partial-model", cache_write_1h_tokens=0)

    assert pricing.call_cost(row, prices=partial_prices) == "unknown"
