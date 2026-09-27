import json
import sys
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import backfill  # noqa: E402
import db  # noqa: E402
import server  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated_known_projects_default(tmp_path, monkeypatch):
    """A test that builds `TokenMeteringApp` without its own
    `known_projects_path` would otherwise fall through to
    `DEFAULT_KNOWN_PROJECTS_PATH` (`~/.claude/cairn/known-projects.json`) -
    whatever the machine actually running this suite has there, rather than
    a hermetic fixture. Point the default at a per-test path that never
    exists instead, so results don't depend on the developer's own
    machine state.
    """
    monkeypatch.setattr(server, "DEFAULT_KNOWN_PROJECTS_PATH", tmp_path / "unused-known-projects.json")


def make_call(**overrides):
    call = dict(
        request_id="req-1",
        session_id="sess-1",
        agent="main",
        model="claude-sonnet-5",
        timestamp="2026-08-28T12:00:00Z",
        input_tokens=100,
        output_tokens=200,
        cache_read_tokens=0,
        cache_write_5m_tokens=0,
        cache_write_1h_tokens=0,
    )
    call.update(overrides)
    return call


def make_tool_use(**overrides):
    tool_use = dict(
        tool_use_id="toolu-1",
        request_id="req-1",
        session_id="sess-1",
        agent="main",
        tool_name="Bash",
        timestamp="2026-08-28T12:00:00Z",
        detail=None,
    )
    tool_use.update(overrides)
    return tool_use


def make_project(tmp_path, name="proj", calls=(), tool_uses=(), events=(), labels=None):
    root = tmp_path / name
    root.mkdir()
    conn = db.connect(root / ".cairn")
    for c in calls:
        db.insert_call(conn, c)  # phase 2's db.py takes one row:dict, not **kwargs
    for t in tool_uses:
        db.insert_tool_use(conn, **t)
    for e in events:
        db.insert_usage_limit_event(conn, **e)
    for session_id, label in (labels or {}).items():
        db.save_session_label(conn, session_id=session_id, label=label)
    conn.commit()
    conn.close()
    return root


# --------------------------------------------------------------------------
# Range windows
# --------------------------------------------------------------------------


def test_resolve_range_day_counts():
    now = datetime(2026, 8, 28, 15, 30, tzinfo=timezone.utc)

    since, until, bucket = server.resolve_range("today", now=now)
    assert (since, until, bucket) == ("2026-08-28T00:00:00Z", "2026-08-28T15:30:00Z", "hour")

    since, until, bucket = server.resolve_range("7d", now=now)
    assert since == "2026-08-22T00:00:00Z"
    assert bucket == "day"

    since, _, _ = server.resolve_range("30d", now=now)
    assert since == "2026-07-30T00:00:00Z"

    since, _, _ = server.resolve_range("month", now=now)
    assert since == "2026-08-01T00:00:00Z"

    since, _, _ = server.resolve_range("6m", now=now)
    assert since == "2026-02-28T00:00:00Z"  # 182 days inclusive of today

    since, _, _ = server.resolve_range("13w", now=now)
    assert since == "2026-05-30T00:00:00Z"  # 91 days inclusive of today


def test_range_bounds_life_has_no_lower_bound():
    since, until = server.range_bounds("life", now=datetime(2026, 8, 28, tzinfo=timezone.utc))
    assert since is None
    assert until == "2026-08-28T00:00:00Z"


def test_fetch_calls_includes_subsecond_timestamps_at_the_lower_boundary(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[
            make_call(request_id="r1", timestamp="2026-08-28T00:00:00.500Z", input_tokens=1, output_tokens=0),
            make_call(request_id="r2", timestamp="2026-08-27T23:59:59.900Z", input_tokens=2, output_tokens=0),
        ],
    )
    app = server.TokenMeteringApp(root)
    projects = app.projects()

    rows = app._fetch_calls(projects, since="2026-08-28T00:00:00Z", until="2026-08-29T00:00:00Z")

    # r1 is a sub-second instant just *after* the lower bound - included.
    # r2 is a sub-second instant just *before* it (the prior day) - excluded.
    assert {r["request_id"] for r in rows} == {"r1"}


# --------------------------------------------------------------------------
# Rollup correctness: agent, model, tool/skill/mcp, day, heatmap
# --------------------------------------------------------------------------


def test_rollup_group_by_agent_sums_tokens_and_cost():
    rows = [
        make_call(request_id="r1", agent="main", input_tokens=1_000_000, output_tokens=0),
        make_call(request_id="r2", agent="builder", input_tokens=500_000, output_tokens=0),
        make_call(request_id="r3", agent="builder", input_tokens=500_000, output_tokens=0),
    ]
    grouped = {g["key"]: g for g in server.rollup_group(rows, key_fn=lambda r: r["agent"])}

    assert grouped["main"]["calls"] == 1
    assert grouped["main"]["tokens"] == 1_000_000
    assert grouped["main"]["cost"] == pytest.approx(2.00)
    assert grouped["builder"]["calls"] == 2
    assert grouped["builder"]["tokens"] == 1_000_000


def test_rollup_timeseries_zero_fills_and_buckets_by_day():
    rows = [
        make_call(request_id="r1", timestamp="2026-08-26T10:00:00Z", input_tokens=10, output_tokens=0),
        make_call(request_id="r2", timestamp="2026-08-26T18:00:00Z", input_tokens=20, output_tokens=0),
        make_call(request_id="r3", timestamp="2026-08-28T09:00:00Z", input_tokens=30, output_tokens=0),
    ]
    points = server.rollup_timeseries(rows, "2026-08-26T00:00:00Z", "2026-08-28T00:00:00Z", "day")
    by_bucket = {p["bucket"]: p for p in points}

    assert list(by_bucket) == ["2026-08-26", "2026-08-27", "2026-08-28"]
    assert by_bucket["2026-08-26"]["tokens"] == 30
    assert by_bucket["2026-08-26"]["calls"] == 2
    assert by_bucket["2026-08-27"]["tokens"] == 0
    assert by_bucket["2026-08-27"]["calls"] == 0
    assert by_bucket["2026-08-28"]["tokens"] == 30


def test_rollup_tool_group_separates_tool_skill_and_mcp_families():
    rows = [
        make_tool_use(tool_use_id="t1", tool_name="Bash"),
        make_tool_use(tool_use_id="t2", tool_name="Bash"),
        make_tool_use(tool_use_id="t3", tool_name="Skill", detail="review-pr"),
        make_tool_use(tool_use_id="t4", tool_name="Skill", detail="review-pr"),
        make_tool_use(tool_use_id="t5", tool_name="mcp__claude-in-chrome__navigate"),
    ]

    tools = {g["key"]: g["count"] for g in server.rollup_tool_group(rows, key_fn=server._tool_key)}
    skills = {g["key"]: g["count"] for g in server.rollup_tool_group(rows, key_fn=server._skill_key)}
    mcp = {g["key"]: g["count"] for g in server.rollup_tool_group(rows, key_fn=server._mcp_key)}

    assert tools == {"Bash": 2}
    assert skills == {"review-pr": 2}
    assert mcp == {"claude-in-chrome": 1}


def test_skill_key_buckets_unresolved_detail_instead_of_dropping_the_row():
    rows = [
        make_tool_use(tool_use_id="t1", tool_name="Skill", detail=None),
        make_tool_use(tool_use_id="t2", tool_name="Skill", detail="review-pr"),
    ]
    skills = {g["key"]: g["count"] for g in server.rollup_tool_group(rows, key_fn=server._skill_key)}
    assert skills == {"unknown": 1, "review-pr": 1}


def test_day_detail_accepts_an_unpadded_date_and_still_matches_zero_padded_rows(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[make_call(request_id="r1", timestamp="2026-08-05T10:00:00Z", input_tokens=100, output_tokens=0)],
    )
    app = server.TokenMeteringApp(root)

    detail = app.day_detail("2026-08-5")  # unpadded day, as a client might send

    assert detail["total_tokens"] == 100
    assert detail["by_model"][0]["calls"] == 1


def test_heatmap_returns_raw_per_call_timestamp_and_tokens_rows(tmp_path):
    # Bucketing (day-of-week/hour, in the viewer's local time zone) happens
    # client-side in ActivityHeatmap.tsx - the server only projects each
    # ranged call down to {timestamp, tokens}, unaggregated.
    root = make_project(
        tmp_path, "proj",
        calls=[
            make_call(request_id="r1", timestamp="2026-08-24T09:00:00Z", input_tokens=100, output_tokens=50),
            make_call(request_id="r2", timestamp="2026-08-25T14:00:00Z", input_tokens=10, output_tokens=5),
        ],
    )
    app = server.TokenMeteringApp(root)

    rows = app.heatmap("life")

    assert {r["timestamp"] for r in rows} == {"2026-08-24T09:00:00Z", "2026-08-25T14:00:00Z"}
    by_ts = {r["timestamp"]: r["tokens"] for r in rows}
    assert by_ts["2026-08-24T09:00:00Z"] == 150
    assert by_ts["2026-08-25T14:00:00Z"] == 15
    assert all(set(r) == {"timestamp", "tokens"} for r in rows)


def test_heatmap_is_bounded_by_range(tmp_path):
    # Relative to the actual wall clock (not a hardcoded date), matching how
    # `heatmap()`'s `range_key` -> `range_bounds()` -> `datetime.now()` chain
    # resolves "7d" in production - a hardcoded old/new pair would drift out
    # of (or into) range depending on when the suite runs.
    now = datetime.now(timezone.utc)
    old_ts = (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    recent_ts = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    root = make_project(
        tmp_path, "proj",
        calls=[
            make_call(request_id="old", timestamp=old_ts),
            make_call(request_id="recent", timestamp=recent_ts),
        ],
    )
    app = server.TokenMeteringApp(root)

    rows = app.heatmap("7d")

    assert {r["timestamp"] for r in rows} == {recent_ts}


# --------------------------------------------------------------------------
# Per-session trace ordering
# --------------------------------------------------------------------------


def test_session_trace_orders_calls_and_groups_by_agent(tmp_path):
    calls = [
        make_call(request_id="r-main-1", agent="main", timestamp="2026-08-27T14:00:00Z"),
        make_call(request_id="r-builder-1", agent="builder", timestamp="2026-08-27T14:05:00Z"),
        make_call(request_id="r-builder-2", agent="builder", timestamp="2026-08-27T14:15:00Z"),
        make_call(request_id="r-main-2", agent="main", timestamp="2026-08-27T14:20:00Z"),
    ]
    trace = server.build_session_trace("sess-1", calls)

    assert [a["agent"] for a in trace["agents"]] == ["main", "builder"]

    main_trace = trace["agents"][0]["trace"]
    assert [c["request_id"] for c in main_trace] == ["r-main-1", "r-main-2"]
    assert main_trace[0]["duration_seconds"] == pytest.approx(1200.0)  # 20 min later
    assert main_trace[1]["duration_seconds"] is None  # last call for this agent

    builder_trace = trace["agents"][1]["trace"]
    assert [c["request_id"] for c in builder_trace] == ["r-builder-1", "r-builder-2"]
    assert builder_trace[0]["duration_seconds"] == pytest.approx(600.0)  # 10 min later

    # Whole-session ordering (`global_position`) is independent of which
    # agent a call belongs to, unlike each agent's own `position` which
    # restarts at 1 - builder's 2nd call (r-builder-2, per-agent position 2)
    # is the whole session's 3rd call, ahead of main's 2nd call.
    assert [c["global_position"] for c in main_trace] == [1, 4]
    assert [c["position"] for c in main_trace] == [1, 2]
    assert [c["global_position"] for c in builder_trace] == [2, 3]
    assert [c["position"] for c in builder_trace] == [1, 2]

    # `global_position` must agree with what `call_detail()` independently
    # computes as `n` for the same call - the regression this spec exists
    # to make impossible to violate silently again.
    root = make_project(tmp_path, "proj", calls=calls)
    app = server.TokenMeteringApp(root)
    for agent_trace in (main_trace, builder_trace):
        for call in agent_trace:
            detail = app.call_detail("sess-1", call["global_position"])
            assert detail is not None
            assert detail["request_id"] == call["request_id"]


def test_session_trace_returns_none_for_unknown_session():
    assert server.build_session_trace("sess-missing", []) is None


def test_session_trace_includes_saved_label_when_present():
    calls = [make_call(request_id="r1", session_id="sess-1")]
    trace = server.build_session_trace("sess-1", calls, "Add a login page to the app")
    assert trace["label"] == "Add a login page to the app"


def test_session_trace_label_is_empty_when_no_saved_label():
    calls = [make_call(request_id="r1", session_id="sess-1")]
    trace = server.build_session_trace("sess-1", calls)
    assert trace["label"] == ""


def test_fetch_session_calls_matches_unbounded_fetch_then_python_filter(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[
            make_call(request_id="r1", session_id="sess-1", timestamp="2026-08-27T14:00:00Z"),
            make_call(request_id="r2", session_id="sess-1", timestamp="2026-08-27T14:05:00Z"),
            make_call(request_id="r3", session_id="sess-2", timestamp="2026-08-27T14:10:00Z"),
        ],
    )
    app = server.TokenMeteringApp(root)
    projects = app.projects()

    scoped = app._fetch_session_calls(projects, "sess-1")
    unbounded_then_filtered = [r for r in app._fetch_calls(projects) if r["session_id"] == "sess-1"]

    key = lambda rows: sorted(r["request_id"] for r in rows)  # noqa: E731
    assert key(scoped) == key(unbounded_then_filtered) == ["r1", "r2"]


def test_session_trace_and_call_detail_use_the_scoped_fetch_and_agree_with_before(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[
            make_call(request_id="r1", session_id="sess-1", timestamp="2026-08-27T14:00:00Z"),
            make_call(request_id="r2", session_id="sess-1", timestamp="2026-08-27T14:05:00Z"),
            make_call(request_id="r3", session_id="sess-2", timestamp="2026-08-27T14:10:00Z"),
        ],
    )
    app = server.TokenMeteringApp(root)

    trace = app.session_trace("sess-1")
    assert trace is not None
    all_request_ids = {c["request_id"] for agent in trace["agents"] for c in agent["trace"]}
    assert all_request_ids == {"r1", "r2"}

    detail = app.call_detail("sess-1", 1)
    assert detail["request_id"] == "r1"
    detail2 = app.call_detail("sess-1", 2)
    assert detail2["request_id"] == "r2"


def test_calls_session_id_query_uses_the_index(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[make_call(request_id="r1", session_id="sess-1")],
    )
    conn = server._open_readonly(root / ".cairn" / db.DB_FILENAME, "calls")
    try:
        plan = conn.execute(
            "EXPLAIN QUERY PLAN SELECT * FROM calls WHERE session_id = ?", ("sess-1",)
        ).fetchall()
    finally:
        conn.close()

    plan_text = " ".join(str(cell) for row in plan for cell in row)
    assert "idx_calls_session_id" in plan_text


# --------------------------------------------------------------------------
# Unpriced-model null propagation
# --------------------------------------------------------------------------


def test_unpriced_model_group_reports_null_pure_group_reports_number_individual_reports_unknown():
    priced = make_call(request_id="r1", model="claude-sonnet-5", input_tokens=1_000_000, output_tokens=0)
    unpriced = make_call(request_id="r2", model="claude-nonexistent-9000", agent="main")

    mixed_group = server.rollup_group([priced, unpriced], key_fn=lambda r: r["agent"])
    assert mixed_group[0]["cost"] is None

    pure_priced_group = server.rollup_group([priced], key_fn=lambda r: r["agent"])
    assert pure_priced_group[0]["cost"] == pytest.approx(2.00)

    import pricing

    assert pricing.call_cost(unpriced) == "unknown"


# --------------------------------------------------------------------------
# Cross-project union
# --------------------------------------------------------------------------


def test_cross_project_union_combines_rollups_across_known_projects(tmp_path):
    root_a = make_project(
        tmp_path, "project-a",
        calls=[make_call(request_id="a1", session_id="sess-a", agent="main", input_tokens=1_000_000, output_tokens=0)],
    )
    root_b = make_project(
        tmp_path, "project-b",
        calls=[make_call(request_id="b1", session_id="sess-b", agent="main", input_tokens=2_000_000, output_tokens=0)],
    )

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(root_b)]))

    app = server.TokenMeteringApp(root_a, known_projects_path=known_projects_path)
    projects = app.projects()
    assert {p.label for p in projects} == {"project-a", "project-b"}

    rows = app._ranged_calls("life", None)
    assert {r["project"] for r in rows} == {"project-a", "project-b"}
    grouped = server.rollup_group(rows, key_fn=lambda r: r["project"])
    totals = {g["key"]: g["tokens"] for g in grouped}
    assert totals == {"project-a": 1_000_000, "project-b": 2_000_000}


def test_discover_projects_disambiguates_colliding_last_segment_labels(tmp_path):
    org1 = tmp_path / "org1" / "backend"
    org2 = tmp_path / "org2" / "backend"
    org1.mkdir(parents=True)
    org2.mkdir(parents=True)

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(org2)]))

    projects = server.discover_projects(org1, known_projects_path)

    labels = {p.label for p in projects}
    assert labels == {"org1/backend", "org2/backend"}


def test_discover_projects_includes_an_existing_directory_entry(tmp_path):
    local_root = tmp_path / "local"
    local_root.mkdir()
    other_root = tmp_path / "other"
    other_root.mkdir()

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(other_root)]))

    projects = server.discover_projects(local_root, known_projects_path)

    assert {p.root for p in projects} == {local_root.resolve(), other_root.resolve()}


def test_discover_projects_excludes_a_nonexistent_path_without_raising(tmp_path):
    local_root = tmp_path / "local"
    local_root.mkdir()
    ghost_root = tmp_path / "torn-down-worktree"

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(ghost_root)]))

    projects = server.discover_projects(local_root, known_projects_path)

    assert {p.root for p in projects} == {local_root.resolve()}


def test_discover_projects_excludes_a_path_that_is_a_file_not_a_directory(tmp_path):
    local_root = tmp_path / "local"
    local_root.mkdir()
    clobbered_root = tmp_path / "clobbered"
    clobbered_root.write_text("not a directory")

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(clobbered_root)]))

    projects = server.discover_projects(local_root, known_projects_path)

    assert {p.root for p in projects} == {local_root.resolve()}


def test_discover_projects_prunes_ghosts_from_a_mixed_list_preserving_order(tmp_path):
    local_root = tmp_path / "local"
    local_root.mkdir()
    alive_1 = tmp_path / "alive-1"
    alive_2 = tmp_path / "alive-2"
    alive_1.mkdir()
    alive_2.mkdir()
    ghost = tmp_path / "ghost"

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(alive_1), str(ghost), str(alive_2)]))

    projects = server.discover_projects(local_root, known_projects_path)

    other_roots = [p.root for p in projects if p.root != local_root.resolve()]
    assert other_roots == [alive_1.resolve(), alive_2.resolve()]


def test_discover_projects_never_rewrites_known_projects_file(tmp_path):
    local_root = tmp_path / "local"
    local_root.mkdir()
    alive_root = tmp_path / "alive"
    alive_root.mkdir()
    ghost_root = tmp_path / "ghost"

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(alive_root), str(ghost_root)]))
    before = known_projects_path.read_bytes()

    server.discover_projects(local_root, known_projects_path)

    after = known_projects_path.read_bytes()
    assert after == before


def test_call_detail_resolves_the_correct_project_when_labels_collide(tmp_path):
    org1_dir = tmp_path / "org1"
    org2_dir = tmp_path / "org2"
    org1_dir.mkdir()
    org2_dir.mkdir()
    root_a = make_project(org1_dir, "backend", calls=[make_call(request_id="a1", session_id="sess-a")])
    root_b = make_project(org2_dir, "backend", calls=[make_call(request_id="b1", session_id="sess-b")])

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(root_b)]))

    app = server.TokenMeteringApp(root_a, known_projects_path=known_projects_path)
    assert {p.label for p in app.projects()} == {"org1/backend", "org2/backend"}

    detail_a = app.call_detail("sess-a", 1)
    detail_b = app.call_detail("sess-b", 1)

    assert detail_a["project"] == "org1/backend"
    assert detail_b["project"] == "org2/backend"


def test_absent_known_projects_file_means_project_scope_only(tmp_path):
    root = make_project(tmp_path, "solo-project")
    app = server.TokenMeteringApp(root, known_projects_path=tmp_path / "does-not-exist.json")
    assert [p.label for p in app.projects()] == ["solo-project"]


def test_empty_known_projects_file_means_project_scope_only(tmp_path):
    root = make_project(tmp_path, "solo-project")
    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text("")
    app = server.TokenMeteringApp(root, known_projects_path=known_projects_path)
    assert [p.label for p in app.projects()] == ["solo-project"]


def test_discover_projects_groups_a_known_root_under_its_containing_known_root(tmp_path):
    parent_root = tmp_path / "ai-worth-carrying"
    engine_root = parent_root / "engine"
    site_root = parent_root / "site"
    parent_root.mkdir()
    engine_root.mkdir()
    site_root.mkdir()

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(engine_root), str(site_root)]))

    projects = server.discover_projects(parent_root, known_projects_path)
    by_label = {p.label: p for p in projects}

    assert by_label["ai-worth-carrying"].parent is None
    assert by_label["engine"].parent == "ai-worth-carrying"
    assert by_label["site"].parent == "ai-worth-carrying"


def test_discover_projects_picks_the_nearest_containing_root_when_more_than_one_matches(tmp_path):
    grandparent = tmp_path / "org"
    parent = grandparent / "team"
    child = parent / "service"
    grandparent.mkdir()
    parent.mkdir(parents=True)
    child.mkdir()

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(grandparent), str(parent)]))

    projects = server.discover_projects(child, known_projects_path)
    by_label = {p.label: p for p in projects}

    assert by_label["service"].parent == "team"


def test_discover_projects_unrelated_roots_have_no_parent(tmp_path):
    root_a = tmp_path / "project-a"
    root_b = tmp_path / "project-b"
    root_a.mkdir()
    root_b.mkdir()

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(root_b)]))

    projects = server.discover_projects(root_a, known_projects_path)
    assert all(p.parent is None for p in projects)


def test_filter_projects_cascades_to_a_known_roots_children(tmp_path):
    """Goal 8's cascade: filtering by a parent project label matches that
    project's own sessions (there may be none - the common case when a
    rollup row's on-screen total is entirely its children's) plus every
    known child's, not just an exact `.label` match.
    """
    parent_root = make_project(tmp_path, "ai-worth-carrying")
    engine_root = make_project(
        parent_root, "engine",
        calls=[make_call(request_id="e1", session_id="sess-engine", agent="main", input_tokens=1_000_000, output_tokens=0)],
    )
    site_root = make_project(
        parent_root, "site",
        calls=[make_call(request_id="s1", session_id="sess-site", agent="main", input_tokens=2_000_000, output_tokens=0)],
    )

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(engine_root), str(site_root)]))

    app = server.TokenMeteringApp(parent_root, known_projects_path=known_projects_path)
    by_label = {p.label: p for p in app.projects()}
    assert by_label["engine"].parent == "ai-worth-carrying"
    assert by_label["site"].parent == "ai-worth-carrying"

    rows = app._ranged_calls("life", "ai-worth-carrying")
    assert {r["project"] for r in rows} == {"engine", "site"}
    grouped = server.rollup_group(rows, key_fn=lambda r: r["project"])
    totals = {g["key"]: g["tokens"] for g in grouped}
    assert totals == {"engine": 1_000_000, "site": 2_000_000}


def test_handle_api_projects_reports_the_system_hostname_and_each_projects_parent(tmp_path, monkeypatch):
    monkeypatch.setattr(server.socket, "gethostname", lambda: "my-laptop")
    root = make_project(tmp_path, "solo-project")
    app = server.TokenMeteringApp(root)

    status, body = app.handle_api("/api/projects", {})

    assert status == 200
    assert body["data"]["hostname"] == "my-laptop"
    assert body["data"]["projects"] == [{"label": "solo-project", "parent": None}]


# --------------------------------------------------------------------------
# Cold start: empty/missing tokens.db
# --------------------------------------------------------------------------


def test_cold_start_missing_db_returns_empty_results(tmp_path):
    root = tmp_path / "fresh-project"
    root.mkdir()
    app = server.TokenMeteringApp(root)

    assert app.agent_rollup("7d") == []
    assert app.sessions("7d") == []
    assert app.tool_rollup("7d") == []
    assert app.heatmap("7d") == []

    timeseries = app.timeseries("life")
    assert timeseries["points"] == []
    assert timeseries["total_tokens"] == 0
    assert timeseries["total_cost"] == 0.0


def test_cold_start_empty_db_returns_empty_results(tmp_path):
    root = make_project(tmp_path, "empty-project")  # db.connect() ran, no rows inserted
    app = server.TokenMeteringApp(root)

    assert app.agent_rollup("30d") == []
    assert app.sessions("30d") == []
    assert app.usage_limit_events("30d") == []


def test_handle_api_404s_for_unknown_session_and_call_without_crashing(tmp_path):
    root = make_project(tmp_path, "empty-project")
    app = server.TokenMeteringApp(root)

    status, body = app.handle_api("/api/session/no-such-session/trace", {})
    assert status == 404

    status, body = app.handle_api("/api/call/no-such-session/1", {})
    assert status == 404


def test_handle_api_rejects_unknown_range():
    app = server.TokenMeteringApp(Path("/nonexistent"))
    status, body = app.handle_api("/api/rollup/agent", {"range": ["bogus"]})
    assert status == 400
    assert "unknown range" in body["error"]


# --------------------------------------------------------------------------
# usage_limit_events surfaced separately from calls
# --------------------------------------------------------------------------


def test_usage_limit_events_surfaced_separately_and_not_counted_as_calls(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[make_call(request_id="r1", session_id="sess-1")],
        events=[dict(session_id="sess-1", timestamp="2026-08-28T12:30:00Z", raw_entry='{"isApiErrorMessage": true}')],
    )
    app = server.TokenMeteringApp(root)

    events = app.usage_limit_events("life")
    assert len(events) == 1
    assert events[0]["session_id"] == "sess-1"

    sessions = app.sessions("life")
    assert len(sessions) == 1
    assert sessions[0]["calls"] == 1  # the usage-limit event isn't a call
    assert sessions[0]["usage_limit_hit"] is True


def test_app_sessions_surfaces_saved_label_and_falls_back_to_empty_without_one(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[
            make_call(request_id="r1", session_id="sess-labeled"),
            make_call(request_id="r2", session_id="sess-unlabeled"),
        ],
        labels={"sess-labeled": "Add a login page to the app"},
    )
    app = server.TokenMeteringApp(root)

    sessions = {s["session_id"]: s for s in app.sessions("life")}

    assert sessions["sess-labeled"]["label"] == "Add a login page to the app"
    assert sessions["sess-unlabeled"]["label"] == ""


def test_app_session_trace_surfaces_saved_label_and_falls_back_to_empty_without_one(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[
            make_call(request_id="r1", session_id="sess-labeled"),
            make_call(request_id="r2", session_id="sess-unlabeled"),
        ],
        labels={"sess-labeled": "Add a login page to the app"},
    )
    app = server.TokenMeteringApp(root)

    assert app.session_trace("sess-labeled")["label"] == "Add a login page to the app"
    assert app.session_trace("sess-unlabeled")["label"] == ""


def test_rollup_sessions_normalizes_a_null_agent_instead_of_crashing():
    calls = [
        make_call(request_id="r1", session_id="sess-1", agent=None),
        make_call(request_id="r2", session_id="sess-1", agent="builder"),
    ]
    for row in calls:
        row["project"] = "proj"

    sessions = server.rollup_sessions(calls, [])

    assert sessions[0]["agents"] == ["builder", "unknown"]


def test_session_without_usage_limit_event_reports_false():
    events = []
    calls = [make_call(request_id="r1", session_id="sess-1")]
    for row in calls:
        row["project"] = "proj"
    sessions = server.rollup_sessions(calls, events)
    assert sessions[0]["usage_limit_hit"] is False


def test_rollup_sessions_includes_saved_label_when_present():
    calls = [make_call(request_id="r1", session_id="sess-1")]
    for row in calls:
        row["project"] = "proj"

    sessions = server.rollup_sessions(calls, [], {"sess-1": "Add a login page to the app"})

    assert sessions[0]["label"] == "Add a login page to the app"


def test_rollup_sessions_label_is_empty_when_no_saved_label():
    calls = [make_call(request_id="r1", session_id="sess-1")]
    for row in calls:
        row["project"] = "proj"

    sessions_no_labels_arg = server.rollup_sessions(calls, [])
    assert sessions_no_labels_arg[0]["label"] == ""

    sessions_unmatched_labels = server.rollup_sessions(calls, [], {"sess-other": "Some other session"})
    assert sessions_unmatched_labels[0]["label"] == ""


# --------------------------------------------------------------------------
# Transcript unavailable / available
# --------------------------------------------------------------------------


def test_encode_project_path_swaps_dots_as_well_as_slashes(tmp_path):
    # Claude Code's own encoding swaps "." for "-" too, not just "/" - a
    # project folder segment with a dot in it (e.g. "cairn-2.0") otherwise
    # encodes to the wrong folder name and its transcripts are never found.
    root = tmp_path / "cairn-2.0" / "token-metering"
    root.mkdir(parents=True)

    encoded = server.encode_project_path(root)

    assert "." not in encoded
    assert encoded == str(root.resolve()).replace("/", "-").replace(".", "-")


def test_call_detail_transcript_unavailable_still_reports_correct_tokens_and_cost(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[make_call(request_id="r1", session_id="sess-1", input_tokens=1_000_000, output_tokens=0)],
    )
    claude_projects_dir = tmp_path / "claude-home" / "projects"  # deliberately never populated
    app = server.TokenMeteringApp(root, claude_projects_dir=claude_projects_dir)

    detail = app.call_detail("sess-1", 1)

    assert detail["available"] is False
    assert detail["prompt"] is None
    assert detail["response"] is None
    assert detail["tool_calls"] == []
    assert detail["input_tokens"] == 1_000_000
    assert detail["cost"] == pytest.approx(2.00)


def test_call_detail_reads_prompt_and_response_from_transcript_when_present(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[make_call(request_id="r1", session_id="sess-1", timestamp="2026-08-28T12:00:00Z")],
    )
    claude_projects_dir = tmp_path / "claude-home" / "projects"
    encoded = server.encode_project_path(root)
    transcript_dir = claude_projects_dir / encoded
    transcript_dir.mkdir(parents=True)
    transcript_path = transcript_dir / "sess-1.jsonl"
    entries = [
        {"type": "user", "message": {"role": "user", "content": "What's the token total?"}},
        {
            "type": "assistant",
            "requestId": "r1",
            "timestamp": "2026-08-28T12:00:00Z",
            "message": {"role": "assistant", "content": [{"type": "text", "text": "It's 300 tokens."}]},
        },
    ]
    with transcript_path.open("w") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")

    app = server.TokenMeteringApp(root, claude_projects_dir=claude_projects_dir)
    detail = app.call_detail("sess-1", 1)

    assert detail["available"] is True
    assert detail["prompt"] == "What's the token total?"
    assert detail["response"] == "It's 300 tokens."
    assert detail["tool_calls"] == []


def test_extract_call_content_skips_tool_result_echo_to_find_the_real_prompt():
    entries = [
        {"type": "user", "message": {"role": "user", "content": "real question"}},
        {
            "type": "assistant",
            "requestId": "r1",
            "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "Bash", "input": {}}]},
        },
        {
            "type": "user",
            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "output"}]},
        },
        {
            "type": "assistant",
            "requestId": "r2",
            "message": {"role": "assistant", "content": [{"type": "text", "text": "the answer"}]},
        },
    ]

    assert server._extract_call_content(entries, "r2") == ("real question", "the answer", [])


def test_extract_call_content_collects_tool_calls_with_per_tool_summary():
    entries = [
        {"type": "user", "message": {"role": "user", "content": "fix the bug"}},
        {
            "type": "assistant",
            "requestId": "r1",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "/a/b.py"}},
                    {"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "pytest -q"}},
                    {"type": "tool_use", "id": "t3", "name": "Grep", "input": {"pattern": "TODO"}},
                    {"type": "tool_use", "id": "t4", "name": "WebFetch", "input": {"url": "https://example.com"}},
                    {"type": "tool_use", "id": "t5", "name": "Task", "input": {"description": "investigate"}},
                    {"type": "tool_use", "id": "t6", "name": "Skill", "input": {"skill": "cairn:shared"}},
                    {"type": "tool_use", "id": "t7", "name": "SomeUnknownTool", "input": {"x": "y"}},
                    {"type": "tool_use", "id": "t8", "name": "Write", "input": {}},
                    {"type": "text", "text": "done"},
                ],
            },
        },
    ]

    prompt, response, tool_calls = server._extract_call_content(entries, "r1")

    assert prompt == "fix the bug"
    assert response == "done"
    assert tool_calls == [
        {"name": "Read", "summary": "/a/b.py"},
        {"name": "Bash", "summary": "pytest -q"},
        {"name": "Grep", "summary": "TODO"},
        {"name": "WebFetch", "summary": "https://example.com"},
        {"name": "Task", "summary": "investigate"},
        {"name": "Skill", "summary": "cairn:shared"},
        {"name": "SomeUnknownTool", "summary": ""},
        {"name": "Write", "summary": ""},
    ]


def test_call_detail_falls_back_to_subagent_transcript(tmp_path):
    root = make_project(
        tmp_path, "proj",
        calls=[make_call(request_id="r-sub", session_id="sess-1", agent="builder")],
    )
    claude_projects_dir = tmp_path / "claude-home" / "projects"
    encoded = server.encode_project_path(root)
    subagents_dir = claude_projects_dir / encoded / "sess-1" / "subagents"
    subagents_dir.mkdir(parents=True)
    (claude_projects_dir / encoded / "sess-1.jsonl").write_text("")  # main transcript, no matching request

    entries = [
        {"type": "user", "message": {"role": "user", "content": "Do the thing."}},
        {
            "type": "assistant",
            "requestId": "r-sub",
            "timestamp": "2026-08-28T12:00:00Z",
            "message": {"role": "assistant", "content": [{"type": "text", "text": "Done."}]},
        },
    ]
    with (subagents_dir / "agent-abc123.jsonl").open("w") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")

    app = server.TokenMeteringApp(root, claude_projects_dir=claude_projects_dir)
    detail = app.call_detail("sess-1", 1)

    assert detail["available"] is True
    assert detail["response"] == "Done."


# --------------------------------------------------------------------------
# HTTP smoke tests (thin dispatch layer only - correctness is covered above)
# --------------------------------------------------------------------------


def test_http_smoke_rollup_timeseries_endpoint(tmp_path):
    root = make_project(tmp_path, "proj", calls=[make_call()])
    port = server.start(root, backfill_enabled=False)
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/rollup/timeseries?range=life") as resp:
            assert resp.status == 200
            body = json.loads(resp.read())
            assert body["data"]["range"] == "life"
            assert body["data"]["total_tokens"] == 300
    finally:
        server.stop()


def test_http_smoke_catch_all_serves_placeholder_when_static_missing(tmp_path):
    # mission-control has no static/ built yet, so TokenMeteringApp's default
    # static_dir already doesn't exist - server.start() exercises exactly the
    # placeholder-serving path this test is about, with no extra plumbing.
    root = make_project(tmp_path, "proj")
    port = server.start(root, backfill_enabled=False)
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/call/sess-1/1") as resp:
            assert resp.status == 200
            assert "text/html" in resp.headers.get("Content-Type", "")
    finally:
        server.stop()


# --------------------------------------------------------------------------
# Backfill kickoff: start() spawns backfill.run() off its own thread and
# never waits on it before returning the bound port.
# --------------------------------------------------------------------------


def test_start_returns_without_blocking_on_backfill(tmp_path, monkeypatch):
    root = make_project(tmp_path, "proj")
    release = threading.Event()
    finished = threading.Event()

    def blocking_run(known_projects, local_project, claude_projects_dir=None):
        release.wait(timeout=5)
        finished.set()

    monkeypatch.setattr(backfill, "run", blocking_run)

    port = server.start(root)
    try:
        assert port > 0
        # start() has already returned above. If it had waited on
        # backfill.run() to complete before returning, `finished` would be
        # set by now - blocking_run only sets it after `release` is set,
        # which hasn't happened yet.
        assert not finished.is_set()
    finally:
        release.set()
        finished.wait(timeout=2)
        server.stop()


def test_start_backfill_enabled_false_skips_backfill(tmp_path, monkeypatch):
    root = make_project(tmp_path, "proj")
    calls = []
    monkeypatch.setattr(backfill, "run", lambda **kwargs: calls.append(kwargs))

    port = server.start(root, backfill_enabled=False)
    try:
        assert port > 0
    finally:
        server.stop()

    assert calls == []


# --------------------------------------------------------------------------
# Discovery hardening: atomic known-projects.json writes, TTL-cached
# discovery keyed by root (never by label)
# --------------------------------------------------------------------------


def test_write_known_projects_atomic_write_never_yields_a_torn_read(tmp_path):
    # A writer thread alternates between two distinct multi-entry lists via
    # write_known_projects() while several reader threads loop reading the
    # same path - every successful read must equal one of the two complete
    # lists, exactly, never a partial/mixed/corrupt read.
    path = tmp_path / "known-projects.json"
    list_a = [tmp_path / f"a-{i}" for i in range(25)]
    list_b = [tmp_path / f"b-{i}" for i in range(25)]
    expected_a = json.dumps([str(r) for r in list_a])
    expected_b = json.dumps([str(r) for r in list_b])

    stop_event = threading.Event()
    torn_reads = []

    def writer():
        toggle = True
        while not stop_event.is_set():
            server.write_known_projects(path, list_a if toggle else list_b)
            toggle = not toggle

    def reader():
        # An empty read before the file's first write is fine and skipped.
        # But once this reader has observed real content, a later empty
        # read means the file was truncated before the replacement content
        # landed - that's the torn-read signature a non-atomic
        # truncate-then-write producer leaves behind, so it counts too.
        seen_non_empty = False
        while not stop_event.is_set():
            try:
                raw = path.read_text()
            except OSError:
                continue
            if not raw:
                if seen_non_empty:
                    torn_reads.append(raw)
                continue
            seen_non_empty = True
            if raw != expected_a and raw != expected_b:
                torn_reads.append(raw)

    writer_thread = threading.Thread(target=writer)
    reader_threads = [threading.Thread(target=reader) for _ in range(4)]
    writer_thread.start()
    for t in reader_threads:
        t.start()

    time.sleep(0.5)
    stop_event.set()
    writer_thread.join()
    for t in reader_threads:
        t.join()

    assert torn_reads == []


def test_projects_caches_discovery_within_ttl_but_recomputes_when_ttl_is_zero(tmp_path, monkeypatch):
    root = tmp_path / "proj"
    root.mkdir()
    call_count = {"n": 0}
    real_discover_projects = server.discover_projects

    def counting_discover_projects(*args, **kwargs):
        call_count["n"] += 1
        return real_discover_projects(*args, **kwargs)

    monkeypatch.setattr(server, "discover_projects", counting_discover_projects)

    cached_app = server.TokenMeteringApp(root, discovery_cache_ttl=60)
    for _ in range(5):
        cached_app.projects()
    assert call_count["n"] == 1

    call_count["n"] = 0
    uncached_app = server.TokenMeteringApp(root, discovery_cache_ttl=0)
    for _ in range(5):
        uncached_app.projects()
    assert call_count["n"] == 5


def test_projects_cache_survives_a_label_collision_after_expiry_keyed_by_root(tmp_path):
    org1 = tmp_path / "org1" / "backend"
    org2 = tmp_path / "org2" / "backend"
    org3 = tmp_path / "org3" / "backend"
    org1.mkdir(parents=True)
    org2.mkdir(parents=True)

    known_projects_path = tmp_path / "known-projects.json"
    known_projects_path.write_text(json.dumps([str(org2)]))

    app = server.TokenMeteringApp(org1, known_projects_path=known_projects_path, discovery_cache_ttl=1000)
    first_by_root = {p.root: p.label for p in app.projects()}
    assert set(first_by_root.values()) == {"org1/backend", "org2/backend"}

    # Force expiry (as if the TTL had elapsed), then add a third project
    # that collides on the same last-segment label, reassigning both
    # existing labels in the process.
    cached_at, cached_projects = app._discovery_cache
    app._discovery_cache = (cached_at - 2000, cached_projects)
    org3.mkdir(parents=True)
    known_projects_path.write_text(json.dumps([str(org2), str(org3)]))

    second_by_root = {p.root: p.label for p in app.projects()}
    assert second_by_root[org1.resolve()] == "org1/backend"
    assert second_by_root[org2.resolve()] == "org2/backend"
    assert second_by_root[org3.resolve()] == "org3/backend"
