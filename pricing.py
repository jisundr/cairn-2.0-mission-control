#!/usr/bin/env python3
"""Read-time cost lookup for cairn's token-metering feature. stdlib only.

Prices come from the checked-in `prices.json` table (model -> $/MTok for
input, output, cache_read, cache_write_5m, cache_write_1h) and are applied
here at READ time only, never baked into `calls`/`tool_uses` rows at write
time — a price update is a data edit to `prices.json`, never a migration.

An unrecognized model, or a recognized model missing one of the rate keys
a call actually used, reports cost "unknown" for that call. A rollup group
containing any unpriced model reports cost None for the whole group — never
a silently-partial sum.

Usage:
    import pricing
    pricing.call_cost(row)     # float, or the string "unknown"
    pricing.group_cost(rows)   # float, or None if any row is unpriced
"""
import json
from pathlib import Path

PRICES_FILENAME = "prices.json"

# Token-count fields on a `calls`-shaped row, matching db.py's columns.
_TOKEN_FIELDS = (
    ("input_tokens", "input"),
    ("output_tokens", "output"),
    ("cache_read_tokens", "cache_read"),
    ("cache_write_5m_tokens", "cache_write_5m"),
    ("cache_write_1h_tokens", "cache_write_1h"),
)

UNKNOWN = "unknown"


def prices_path() -> Path:
    return Path(__file__).resolve().parent / PRICES_FILENAME


def load_prices(path: Path | None = None) -> dict:
    with open(path or prices_path()) as f:
        return json.load(f)


# Loaded once at import time — read-time lookup, not baked into any row.
PRICES = load_prices()


def call_cost(row, prices: dict = PRICES):
    """Cost in dollars for one `calls`-shaped row, or the string "unknown"
    if `row["model"]` isn't in `prices`, or is in `prices` but missing a
    rate key that this row's nonzero token fields need.
    """
    rates = prices.get(row["model"])
    if rates is None:
        return UNKNOWN

    total_cents_per_mtok = 0.0
    for token_field, rate_key in _TOKEN_FIELDS:
        if rate_key not in rates:
            # A partial rate set (e.g. a model missing cache_write_1h)
            # must never silently price this call at 0 for that field —
            # degrade to "unknown" rather than raising KeyError.
            return UNKNOWN
        total_cents_per_mtok += row.get(token_field, 0) * rates[rate_key]
    return total_cents_per_mtok / 1_000_000


def group_cost(rows, prices: dict = PRICES):
    """Total cost in dollars for an iterable of `calls`-shaped rows, or None
    if any row's model is unpriced — never a partial sum over the priced
    rows only.
    """
    total = 0.0
    for row in rows:
        cost = call_cost(row, prices=prices)
        if cost == UNKNOWN:
            return None
        total += cost
    return total
