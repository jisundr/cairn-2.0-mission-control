#!/usr/bin/env python3
"""Local dashboard server for cairn mission control's token-metering slice.
stdlib only.

Design: ported from token-metering/server.py (see that repo's own
docs/features/token-metering/03-architecture.md for the Serving side's
design).

Binds localhost only, runs in the foreground, stops on Ctrl-C. Serves a
JSON API over `db.py`'s tables (rollups by day/session/agent/tool/skill/
MCP-server, a per-call feed the client buckets into its own activity
heatmap, per-session call traces, an on-demand prompt/response lookup)
plus, once a compiled `static/` frontend exists, that frontend with a
catch-all -> `index.html` fallback for its client-side `/call/<session>/<n>`
route. Prices are applied at read time via `pricing.py`; this module never
writes to `tokens.db`.

Usage:
    python3 server.py [project_root] [port]
"""
import http.server
import json
import mimetypes
import os
import re
import sqlite3
import sys
import tempfile
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
import pricing  # noqa: E402

STATIC_DIR_NAME = "static"
DEFAULT_PORT = 4317
DEFAULT_HOST = "127.0.0.1"
DEFAULT_KNOWN_PROJECTS_PATH = Path.home() / ".claude" / "cairn" / "known-projects.json"
DEFAULT_CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"

# Per-day chart range tabs. Rolling ranges are inclusive of today (e.g. "7d"
# spans today and the 6 days before it). "today" buckets by hour instead of
# by day; "month" is the current calendar month to date; "life" has no fixed
# window (it starts at the earliest captured call, or is empty if there are
# none yet).
_ROLLING_DAY_COUNTS = {"7d": 7, "30d": 30, "6m": 182}
VALID_RANGES = {"today", "7d", "30d", "month", "6m", "life"}


# --------------------------------------------------------------------------
# Projects: this project plus, when known-projects.json says so, others'.
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Project:
    label: str
    root: Path

    @property
    def db_path(self) -> Path:
        return db.db_path(self.root / ".cairn")


def _disambiguate_labels(roots: list[Path]) -> list[str]:
    """`root.name` for each root, except that two or more roots sharing the
    same name (e.g. `/org1/backend` and `/org2/backend`) get enough of
    their parent path prefixed - joined by "/" - to be unique among this
    set, rather than silently colliding on the same plain label. The
    common single-project (or no-collision) case keeps plain `root.name`.
    """
    names = [r.name for r in roots]
    counts: dict[str, int] = defaultdict(int)
    for name in names:
        counts[name] += 1
    if all(counts[name] == 1 for name in names):
        return names

    groups: dict[str, list[int]] = defaultdict(list)
    for i, name in enumerate(names):
        groups[name].append(i)

    labels = list(names)
    for name, indices in groups.items():
        if len(indices) == 1:
            continue
        depth = 2
        while True:
            candidates = ["/".join(roots[i].parts[-depth:]) for i in indices]
            exhausted = all(depth >= len(roots[i].parts) for i in indices)
            if len(set(candidates)) == len(candidates) or exhausted:
                for i, candidate in zip(indices, candidates):
                    labels[i] = candidate
                break
            depth += 1
    return labels


def discover_projects(local_root: Path, known_projects_path: Path | None = None) -> list[Project]:
    """This project, plus every other project path listed in
    `known-projects.json`, when that file exists and is non-empty. Absent
    or empty -> this project only (the common, project-scoped-install case).
    """
    local_root = Path(local_root).resolve()
    roots = [local_root]
    seen = {local_root}

    path = known_projects_path if known_projects_path is not None else DEFAULT_KNOWN_PROJECTS_PATH
    if path.exists():
        try:
            raw = path.read_text().strip()
        except OSError:
            raw = ""
        if raw:
            try:
                entries = json.loads(raw)
            except json.JSONDecodeError:
                entries = []
            if isinstance(entries, list):
                for entry in entries:
                    if not isinstance(entry, str) or not entry:
                        continue
                    other_root = Path(entry).resolve()
                    if other_root in seen:
                        continue
                    try:
                        other_root_is_dir = other_root.is_dir()
                    except OSError:
                        other_root_is_dir = False
                    if not other_root_is_dir:
                        continue
                    seen.add(other_root)
                    roots.append(other_root)

    return [Project(label=label, root=root) for label, root in zip(_disambiguate_labels(roots), roots)]


def write_known_projects(path: Path, roots: list[Path]) -> None:
    """Atomically writes `known-projects.json`: a temp file in `path`'s own
    parent directory, then `os.replace()` into `path`. `os.replace()` is a
    single filesystem rename, so a concurrent `discover_projects()` read
    always observes either the prior complete file or the new complete
    file - never a torn, partially-written read. First called in production
    by `hooks/stop-mc.sh`, wired in by this feature's cutover phase.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps([str(r) for r in roots])
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(payload)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _filter_projects(projects: list[Project], project_filter: str | None) -> list[Project]:
    if not project_filter or project_filter == "all":
        return projects
    return [p for p in projects if p.label == project_filter]


# --------------------------------------------------------------------------
# Small pure helpers
# --------------------------------------------------------------------------


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _total_tokens(row: dict) -> int:
    return (
        row.get("input_tokens", 0)
        + row.get("output_tokens", 0)
        + row.get("cache_read_tokens", 0)
        + row.get("cache_write_5m_tokens", 0)
        + row.get("cache_write_1h_tokens", 0)
    )


def _seconds_between(ts1: str, ts2: str) -> float:
    return (datetime.fromisoformat(ts2) - datetime.fromisoformat(ts1)).total_seconds()


def resolve_range(range_key: str, now: datetime | None = None) -> tuple[str, str, str]:
    """(since, until, bucket) for a fixed-window range. `since`/`until` are
    ISO8601 UTC strings, a half-open [since, until) window. Raises
    ValueError for "life" (no fixed window - see `range_bounds`) or an
    unrecognized range key.
    """
    if range_key not in VALID_RANGES:
        raise ValueError(f"unknown range: {range_key}")
    if range_key == "life":
        raise ValueError('"life" has no fixed window; use range_bounds()')

    now = now or datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    until = _iso(now)

    if range_key == "today":
        return _iso(today_start), until, "hour"
    if range_key == "month":
        return _iso(today_start.replace(day=1)), until, "day"

    days = _ROLLING_DAY_COUNTS[range_key]
    since = _iso(today_start - timedelta(days=days - 1))
    return since, until, "day"


def range_bounds(range_key: str, now: datetime | None = None) -> tuple[str | None, str]:
    """(since, until) for any range, including "life" (since=None -> no
    lower bound; callers query for everything).
    """
    if range_key == "life":
        return None, _iso(now or datetime.now(timezone.utc))
    since, until, _bucket = resolve_range(range_key, now=now)
    return since, until


def _bucket_key(timestamp: str, bucket: str) -> str:
    return timestamp[:13] if bucket == "hour" else timestamp[:10]


def _bucket_range(since_iso: str, until_iso: str, bucket: str) -> list[str]:
    if bucket == "hour":
        start = datetime.strptime(since_iso[:13], "%Y-%m-%dT%H")
        end = datetime.strptime(until_iso[:13], "%Y-%m-%dT%H")
        step = timedelta(hours=1)
        fmt = "%Y-%m-%dT%H"
    else:
        start = datetime.strptime(since_iso[:10], "%Y-%m-%d")
        end = datetime.strptime(until_iso[:10], "%Y-%m-%d")
        step = timedelta(days=1)
        fmt = "%Y-%m-%d"

    keys = []
    cur = start
    while cur <= end:
        keys.append(cur.strftime(fmt))
        cur += step
    return keys


# --------------------------------------------------------------------------
# Rollups over already-fetched rows (pure - no I/O, directly testable)
# --------------------------------------------------------------------------


def rollup_group(rows: list[dict], key_fn) -> list[dict]:
    """Groups `calls`-shaped rows by `key_fn(row)`. Each group reports
    `cost: None` (never a silently partial sum) if any of its rows has an
    unpriced model.
    """
    groups = defaultdict(list)
    for row in rows:
        groups[key_fn(row)].append(row)

    result = [
        {
            "key": key,
            "calls": len(group_rows),
            "tokens": sum(_total_tokens(r) for r in group_rows),
            "cost": pricing.group_cost(group_rows),
        }
        for key, group_rows in groups.items()
    ]
    result.sort(key=lambda g: g["tokens"], reverse=True)
    return result


def rollup_tool_group(rows: list[dict], key_fn) -> list[dict]:
    """Groups `tool_uses`-shaped rows by `key_fn(row)` into counts. Rows for
    which `key_fn` returns None are excluded (e.g. skill/MCP rollups filter
    to their own tool_name family).
    """
    counts = defaultdict(int)
    for row in rows:
        key = key_fn(row)
        if key is None:
            continue
        counts[key] += 1

    result = [{"key": key, "count": count} for key, count in counts.items()]
    result.sort(key=lambda g: g["count"], reverse=True)
    return result


def _tool_key(row: dict):
    name = row["tool_name"]
    if name == "Skill" or name.startswith("mcp__"):
        return None
    return name


def _skill_key(row: dict):
    if row["tool_name"] != "Skill":
        return None
    # A genuine Skill row can still have detail=None (parser.py writes this
    # when the tool input lacks a "skill" key); bucket it explicitly rather
    # than returning None, which rollup_tool_group treats as "exclude".
    return row["detail"] if row["detail"] is not None else "unknown"


def _mcp_key(row: dict):
    name = row["tool_name"]
    if not name.startswith("mcp__"):
        return None
    parts = name.split("__", 2)
    return parts[1] if len(parts) >= 2 else name


def rollup_timeseries(rows: list[dict], since: str, until: str, bucket: str) -> list[dict]:
    """One point per bucket between `since` (inclusive) and `until`
    (inclusive of its own bucket), zero-filled for buckets with no calls -
    a continuous chart, never gappy.
    """
    grouped = defaultdict(list)
    for row in rows:
        grouped[_bucket_key(row["timestamp"], bucket)].append(row)

    points = []
    for key in _bucket_range(since, until, bucket):
        group_rows = grouped.get(key, [])
        points.append(
            {
                "bucket": key,
                "calls": len(group_rows),
                "tokens": sum(_total_tokens(r) for r in group_rows),
                "cost": pricing.group_cost(group_rows),
            }
        )
    return points


def rollup_sessions(calls: list[dict], events: list[dict], labels: dict[str, str] | None = None) -> list[dict]:
    """One row per (project, session_id), most recently started first.
    `usage_limit_hit` cross-references `usage_limit_events` distinctly -
    it is never folded into the token/cost totals here. `labels` (keyed by
    session_id, from `db.py`'s `session_labels` table) is optional and may
    omit a session entirely - such a session's `label` just comes through
    empty rather than erroring.
    """
    labels = labels or {}
    limited = {(e["project"], e["session_id"]) for e in events}
    sessions = defaultdict(list)
    for row in calls:
        sessions[(row["project"], row["session_id"])].append(row)

    result = []
    for (project_label, session_id), group_rows in sessions.items():
        timestamps = [r["timestamp"] for r in group_rows]
        result.append(
            {
                "session_id": session_id,
                "project": project_label,
                "started": min(timestamps),
                "ended": max(timestamps),
                "agents": sorted({r["agent"] if r["agent"] is not None else "unknown" for r in group_rows}),
                "calls": len(group_rows),
                "tokens": sum(_total_tokens(r) for r in group_rows),
                "cost": pricing.group_cost(group_rows),
                "usage_limit_hit": (project_label, session_id) in limited,
                "label": labels.get(session_id, ""),
            }
        )
    result.sort(key=lambda s: s["started"], reverse=True)
    return result


def build_session_trace(session_id: str, calls: list[dict], label: str | None = None) -> dict | None:
    """Agent groups (ordered by each agent's first call), each with its
    calls in chronological order. A call's `duration_seconds` is the gap
    to the next call by the *same agent* in this session (there being no
    captured call duration) - the last call in each agent's sequence has
    no next call, so it's None. Returns None if the session has no calls.
    `label` (from `db.py`'s `session_labels` table) is optional and comes
    through empty when the session has no saved label yet.
    """
    if not calls:
        return None

    calls = sorted(calls, key=lambda r: (r["timestamp"], r["request_id"]))
    global_position = {row["request_id"]: i + 1 for i, row in enumerate(calls)}

    by_agent = defaultdict(list)
    for row in calls:
        by_agent[row["agent"]].append(row)

    ordered_agents = sorted(by_agent.items(), key=lambda kv: kv[1][0]["timestamp"])
    agents_out = []
    for agent, agent_calls in ordered_agents:
        trace = []
        for i, row in enumerate(agent_calls):
            next_row = agent_calls[i + 1] if i + 1 < len(agent_calls) else None
            duration = _seconds_between(row["timestamp"], next_row["timestamp"]) if next_row else None
            trace.append(
                {
                    "position": i + 1,
                    "global_position": global_position[row["request_id"]],
                    "request_id": row["request_id"],
                    "timestamp": row["timestamp"],
                    "model": row["model"],
                    "input_tokens": row["input_tokens"],
                    "output_tokens": row["output_tokens"],
                    "cache_read_tokens": row["cache_read_tokens"],
                    "cache_write_5m_tokens": row["cache_write_5m_tokens"],
                    "cache_write_1h_tokens": row["cache_write_1h_tokens"],
                    "cost": pricing.call_cost(row),
                    "duration_seconds": duration,
                }
            )
        agents_out.append(
            {
                "agent": agent,
                "calls": len(agent_calls),
                "tokens": sum(_total_tokens(r) for r in agent_calls),
                "cost": pricing.group_cost(agent_calls),
                "trace": trace,
            }
        )

    return {
        "session_id": session_id,
        "started": calls[0]["timestamp"],
        "ended": calls[-1]["timestamp"],
        "agents": agents_out,
        "label": label or "",
    }


# --------------------------------------------------------------------------
# Transcript lookup: on-demand prompt/response for one call
# --------------------------------------------------------------------------


def encode_project_path(root: Path) -> str:
    # Claude Code swaps both "/" and "." for "-" when deriving a project's
    # folder name under ~/.claude/projects/ - a path segment with a dot in it
    # (e.g. this repo's own "cairn-2.0") otherwise encodes to the wrong
    # folder name, so its transcripts are never found.
    return str(Path(root).resolve()).replace("/", "-").replace(".", "-")


def transcript_path_for(claude_projects_dir: Path, project_root: Path, session_id: str) -> Path:
    """Where a session's main transcript lives, following Claude Code's own
    layout (`~/.claude/projects/<dashed-project-path>/<session_id>.jsonl`) -
    the same convention `parser.py`'s caller already resolved once at
    capture time, inverted here since `tokens.db` doesn't persist it.
    """
    return Path(claude_projects_dir) / encode_project_path(project_root) / f"{session_id}.jsonl"


def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    entries = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return entries


def _tool_result_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        return "\n".join(parts)
    return ""


def _is_tool_result_only(content) -> bool:
    """True for a role="user" message whose content is exclusively
    tool_result blocks (the standard shape tool results are delivered in) -
    i.e. it carries no actual human-authored prompt text.
    """
    if not isinstance(content, list) or not content:
        return False
    return all(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)


# Per-tool-name field to pull a short human-readable summary from a
# tool_use block's `input`, mirroring parser.py's `detail = input.get("skill")
# if name == "Skill"` pattern. Falls back to "" for unmapped tools or a
# missing/non-string field.
_TOOL_SUMMARY_FIELD = {
    "Read": "file_path",
    "Write": "file_path",
    "Edit": "file_path",
    "NotebookEdit": "file_path",
    "Bash": "command",
    "Grep": "pattern",
    "Glob": "pattern",
    "WebFetch": "url",
    "Task": "description",
    "Skill": "skill",
}


def _tool_use_summary(name, tool_input) -> str:
    field = _TOOL_SUMMARY_FIELD.get(name)
    if field is None or not isinstance(tool_input, dict):
        return ""
    value = tool_input.get(field)
    return value if isinstance(value, str) else ""


def _extract_call_content(entries: list[dict], request_id: str) -> tuple[str, str, list[dict]] | None:
    """(prompt, response, tool_calls) for the entries sharing `request_id`,
    or None if that request_id isn't present. `response` concatenates every
    text block across all entries sharing the id (one call can span several
    entries - see `parser.py`); `prompt` is the nearest preceding user-role
    entry; `tool_calls` is one `{name, summary}` object per `tool_use` block,
    in encounter order.
    """
    response_parts = []
    tool_calls = []
    first_index = None
    for i, entry in enumerate(entries):
        if entry.get("requestId") != request_id:
            continue
        message = entry.get("message")
        if not isinstance(message, dict):
            continue
        if first_index is None:
            first_index = i
        content = message.get("content")
        if isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text":
                    response_parts.append(block.get("text", ""))
                elif block.get("type") == "tool_use":
                    name = block.get("name")
                    tool_calls.append({"name": name, "summary": _tool_use_summary(name, block.get("input"))})

    if first_index is None:
        return None

    prompt_text = ""
    for i in range(first_index - 1, -1, -1):
        message = entries[i].get("message")
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = message.get("content")
        if _is_tool_result_only(content):
            # A tool_result echo, not a real prompt - keep walking backward.
            continue
        prompt_text = _tool_result_text(content)
        break

    return prompt_text, "\n".join(response_parts), tool_calls


def lookup_transcript_content(
    claude_projects_dir: Path, project_root: Path, session_id: str, request_id: str
) -> tuple[str | None, str | None, list[dict], bool]:
    """(prompt, response, tool_calls, available). available=False
    (prompt/response None, tool_calls []) if the transcript file is missing
    or doesn't contain this request_id - never raises.
    """
    transcript_path = transcript_path_for(claude_projects_dir, project_root, session_id)
    found = _extract_call_content(_load_jsonl(transcript_path), request_id)
    if found is not None:
        return found[0], found[1], found[2], True

    subagents_dir = transcript_path.parent / transcript_path.stem / "subagents"
    if subagents_dir.is_dir():
        for subagent_path in sorted(subagents_dir.glob("agent-*.jsonl")):
            found = _extract_call_content(_load_jsonl(subagent_path), request_id)
            if found is not None:
                return found[0], found[1], found[2], True

    return None, None, [], False


# --------------------------------------------------------------------------
# App: wires the pure rollups above to sqlite reads across known projects
# --------------------------------------------------------------------------


def _open_readonly(db_path: Path, table: str) -> sqlite3.Connection | None:
    """A read-only connection to `db_path`, or None if it's missing or
    doesn't yet have `table` (cold start: no `Stop` event has fired yet).
    """
    if not db_path.exists():
        return None
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute(f"SELECT 1 FROM {table} LIMIT 1")
    except sqlite3.OperationalError:
        conn.close()
        return None
    return conn


# Discovery-cache TTL (Goal 3): `discover_projects()` does filesystem I/O
# (stat-ing every known root) and JSON parsing, so a single incoming
# request cycle that calls `TokenMeteringApp.projects()` more than once
# (several rollup routes touched by one page load, say) shouldn't repeat
# that work each time. 5s keeps a stale scope (a project added mid-session)
# from lingering long, while still collapsing same-cycle redundant calls.
_DISCOVERY_CACHE_TTL_SECONDS = 5


class TokenMeteringApp:
    """Query layer, independent of HTTP. `handle_api` is the thin dispatch
    layer `Handler` (the socket-facing class below) delegates to.
    """

    def __init__(
        self,
        project_root: Path,
        *,
        known_projects_path: Path | None = None,
        claude_projects_dir: Path | None = None,
        static_dir: Path | None = None,
        discovery_cache_ttl: float = _DISCOVERY_CACHE_TTL_SECONDS,
    ):
        self.project_root = Path(project_root).resolve()
        self.known_projects_path = known_projects_path
        self.claude_projects_dir = Path(claude_projects_dir) if claude_projects_dir else DEFAULT_CLAUDE_PROJECTS_DIR
        self.static_dir = Path(static_dir) if static_dir else Path(__file__).resolve().parent / STATIC_DIR_NAME
        self.discovery_cache_ttl = discovery_cache_ttl
        # One slot, scoped to this app instance's own `project_root`/
        # `known_projects_path` by construction - an app instance never
        # serves more than one root, so this can never become a second
        # structure indexed by `Project.label` (which a label collision or
        # rename between calls could invalidate or fragment).
        self._discovery_cache: tuple[float, list["Project"]] | None = None

    def projects(self) -> list[Project]:
        if self._discovery_cache is not None:
            cached_at, cached_projects = self._discovery_cache
            if time.monotonic() - cached_at < self.discovery_cache_ttl:
                return cached_projects
        fresh = discover_projects(self.project_root, self.known_projects_path)
        self._discovery_cache = (time.monotonic(), fresh)
        return fresh

    # -- fetch (I/O) --------------------------------------------------

    def _fetch_table(self, projects: list[Project], table: str, since=None, until=None) -> list[dict]:
        rows = []
        for project in projects:
            conn = _open_readonly(project.db_path, table)
            if conn is None:
                continue
            try:
                query = f"SELECT * FROM {table}"
                clauses, params = [], []
                # Compare only whole-second precision on both sides: captured
                # timestamps commonly carry sub-second fractions (e.g.
                # "...:00.500Z"), and lexicographic comparison against a
                # whole-second `since`/`until` bound (e.g. "...:00Z") fails
                # at the boundary because "." sorts before "Z"/digits.
                # Truncating both to "YYYY-MM-DDTHH:MM:SS" avoids that.
                if since is not None:
                    clauses.append("substr(timestamp, 1, 19) >= ?")
                    params.append(since[:19])
                if until is not None:
                    clauses.append("substr(timestamp, 1, 19) < ?")
                    params.append(until[:19])
                if clauses:
                    query += " WHERE " + " AND ".join(clauses)
                for row in conn.execute(query, params):
                    record = dict(row)
                    record["project"] = project.label
                    rows.append(record)
            finally:
                conn.close()
        return rows

    def _fetch_calls(self, projects, since=None, until=None) -> list[dict]:
        return self._fetch_table(projects, "calls", since=since, until=until)

    def _fetch_session_calls(self, projects: list[Project], session_id: str) -> list[dict]:
        """Every call for `session_id` across `projects`, without scanning the
        full `calls` table. `calls.session_id` has no cross-project uniqueness
        guarantee ruled out elsewhere in this class, so this still filters in
        Python after fetching - the win is querying SQL by `session_id`
        directly (indexed, per `db.py`) instead of by unbounded time range.
        """
        rows = []
        for project in projects:
            conn = _open_readonly(project.db_path, "calls")
            if conn is None:
                continue
            try:
                for row in conn.execute("SELECT * FROM calls WHERE session_id = ?", (session_id,)):
                    record = dict(row)
                    record["project"] = project.label
                    rows.append(record)
            finally:
                conn.close()
        return rows

    def _fetch_tool_uses(self, projects, since=None, until=None) -> list[dict]:
        return self._fetch_table(projects, "tool_uses", since=since, until=until)

    def _fetch_usage_limit_events(self, projects, since=None, until=None) -> list[dict]:
        return self._fetch_table(projects, "usage_limit_events", since=since, until=until)

    def _fetch_session_labels(self, projects: list[Project]) -> dict[str, str]:
        """Every saved label across `projects`, keyed by session_id. A
        project whose db predates `session_labels` (or has none saved yet)
        just contributes nothing here, per `_open_readonly`'s cold-start
        handling - never an error.
        """
        labels: dict[str, str] = {}
        for project in projects:
            conn = _open_readonly(project.db_path, "session_labels")
            if conn is None:
                continue
            try:
                for row in conn.execute("SELECT session_id, label FROM session_labels"):
                    labels[row["session_id"]] = row["label"]
            finally:
                conn.close()
        return labels

    def _ranged_calls(self, range_key: str, project_filter: str | None) -> list[dict]:
        projects = _filter_projects(self.projects(), project_filter)
        since, until = range_bounds(range_key)
        return self._fetch_calls(projects, since=since, until=until)

    def _ranged_tool_uses(self, range_key: str, project_filter: str | None) -> list[dict]:
        projects = _filter_projects(self.projects(), project_filter)
        since, until = range_bounds(range_key)
        return self._fetch_tool_uses(projects, since=since, until=until)

    # -- rollup endpoints ----------------------------------------------

    def timeseries(self, range_key: str, project_filter: str | None = None, now: datetime | None = None) -> dict:
        if range_key not in VALID_RANGES:
            raise ValueError(f"unknown range: {range_key}")
        projects = _filter_projects(self.projects(), project_filter)
        now = now or datetime.now(timezone.utc)
        since, until = range_bounds(range_key, now=now)
        bucket = "hour" if range_key == "today" else "day"

        rows = self._fetch_calls(projects, since=since, until=until)
        if range_key == "life":
            points = [] if not rows else rollup_timeseries(rows, min(r["timestamp"] for r in rows)[:10] + "T00:00:00Z", until, bucket)
            if points:
                since = min(r["timestamp"] for r in rows)[:10] + "T00:00:00Z"
        else:
            points = rollup_timeseries(rows, since, until, bucket)

        total_tokens = sum(p["tokens"] for p in points)
        if points and any(p["cost"] is None for p in points):
            total_cost = None
        else:
            total_cost = round(sum(p["cost"] for p in points), 6) if points else 0.0

        return {
            "range": range_key,
            "bucket": bucket,
            "since": since,
            "until": until,
            "points": points,
            "total_tokens": total_tokens,
            "total_cost": total_cost,
        }

    def day_detail(self, date_str: str, project_filter: str | None = None) -> dict:
        projects = _filter_projects(self.projects(), project_filter)
        day_start = datetime.strptime(date_str, "%Y-%m-%d")
        since = _iso(day_start)
        until = _iso(day_start + timedelta(days=1))
        rows = self._fetch_calls(projects, since=since, until=until)
        by_model = rollup_group(rows, key_fn=lambda r: r["model"])
        any_unknown = any(g["cost"] is None for g in by_model)
        return {
            "date": date_str,
            "total_tokens": sum(g["tokens"] for g in by_model),
            "total_cost": None if any_unknown else round(sum(g["cost"] for g in by_model), 6),
            "by_model": by_model,
        }

    def agent_rollup(self, range_key: str, project_filter: str | None = None) -> list[dict]:
        return rollup_group(self._ranged_calls(range_key, project_filter), key_fn=lambda r: r["agent"])

    def model_rollup(self, range_key: str, project_filter: str | None = None) -> list[dict]:
        return rollup_group(self._ranged_calls(range_key, project_filter), key_fn=lambda r: r["model"])

    def tool_rollup(self, range_key: str, project_filter: str | None = None) -> list[dict]:
        return rollup_tool_group(self._ranged_tool_uses(range_key, project_filter), key_fn=_tool_key)

    def skill_rollup(self, range_key: str, project_filter: str | None = None) -> list[dict]:
        return rollup_tool_group(self._ranged_tool_uses(range_key, project_filter), key_fn=_skill_key)

    def mcp_rollup(self, range_key: str, project_filter: str | None = None) -> list[dict]:
        return rollup_tool_group(self._ranged_tool_uses(range_key, project_filter), key_fn=_mcp_key)

    def heatmap(self, range_key: str, project_filter: str | None = None) -> list[dict]:
        """Raw per-call `{timestamp, tokens}` rows for the range, unaggregated
        - the client buckets these into day-of-week/hour cells itself, in its
        own local time zone (`ActivityHeatmap.tsx`), which a server-side UTC
        bucketing can't be re-localized into after the fact.
        """
        return [
            {"timestamp": row["timestamp"], "tokens": _total_tokens(row)}
            for row in self._ranged_calls(range_key, project_filter)
        ]

    def usage_limit_events(self, range_key: str, project_filter: str | None = None) -> list[dict]:
        projects = _filter_projects(self.projects(), project_filter)
        since, until = range_bounds(range_key)
        return self._fetch_usage_limit_events(projects, since=since, until=until)

    def sessions(self, range_key: str, project_filter: str | None = None) -> list[dict]:
        projects = _filter_projects(self.projects(), project_filter)
        since, until = range_bounds(range_key)
        calls = self._fetch_calls(projects, since=since, until=until)
        events = self._fetch_usage_limit_events(projects, since=since, until=until)
        labels = self._fetch_session_labels(projects)
        return rollup_sessions(calls, events, labels)

    def session_trace(self, session_id: str, project_filter: str | None = None) -> dict | None:
        projects = _filter_projects(self.projects(), project_filter)
        calls = self._fetch_session_calls(projects, session_id)
        labels = self._fetch_session_labels(projects)
        return build_session_trace(session_id, calls, labels.get(session_id))

    def call_detail(self, session_id: str, n: int, project_filter: str | None = None) -> dict | None:
        projects = _filter_projects(self.projects(), project_filter)
        calls = self._fetch_session_calls(projects, session_id)
        if not calls:
            return None
        calls.sort(key=lambda r: (r["timestamp"], r["request_id"]))
        if n < 1 or n > len(calls):
            return None

        call = calls[n - 1]
        project = next((p for p in projects if p.label == call["project"]), None)
        prompt = response = None
        tool_calls: list[dict] = []
        available = False
        if project is not None:
            prompt, response, tool_calls, available = lookup_transcript_content(
                self.claude_projects_dir, project.root, session_id, call["request_id"]
            )

        return {
            "position": n,
            "total": len(calls),
            "session_id": session_id,
            "project": call["project"],
            "agent": call["agent"],
            "request_id": call["request_id"],
            "timestamp": call["timestamp"],
            "model": call["model"],
            "input_tokens": call["input_tokens"],
            "output_tokens": call["output_tokens"],
            "cache_read_tokens": call["cache_read_tokens"],
            "cache_write_5m_tokens": call["cache_write_5m_tokens"],
            "cache_write_1h_tokens": call["cache_write_1h_tokens"],
            "cost": pricing.call_cost(call),
            "available": available,
            "prompt": prompt,
            "response": response,
            "tool_calls": tool_calls,
        }

    # -- HTTP dispatch (thin layer over everything above) ----------------

    _SESSION_TRACE_RE = re.compile(r"^/api/session/(?P<session_id>[^/]+)/trace$")
    _CALL_DETAIL_RE = re.compile(r"^/api/call/(?P<session_id>[^/]+)/(?P<n>\d+)$")

    def _envelope(self, data) -> dict:
        return {"data": data, "meta": {"generated_at": _iso(datetime.now(timezone.utc))}}

    def handle_api(self, path: str, query: dict) -> tuple[int, dict]:
        def first(key, default=None):
            values = query.get(key)
            return values[0] if values else default

        if path == "/api/projects":
            return 200, self._envelope([{"label": p.label} for p in self.projects()])

        range_key = first("range", "7d")
        project_filter = first("project")

        if range_key not in VALID_RANGES:
            return 400, {"error": "unknown range", "valid_ranges": sorted(VALID_RANGES)}

        try:
            if path == "/api/rollup/timeseries":
                return 200, self._envelope(self.timeseries(range_key, project_filter=project_filter))
            if path == "/api/rollup/day-detail":
                date_str = first("date")
                if not date_str:
                    return 400, {"error": "date query parameter is required"}
                return 200, self._envelope(self.day_detail(date_str, project_filter=project_filter))
            if path == "/api/rollup/session":
                return 200, self._envelope(self.sessions(range_key, project_filter=project_filter))
            if path == "/api/rollup/agent":
                return 200, self._envelope(self.agent_rollup(range_key, project_filter=project_filter))
            if path == "/api/rollup/model":
                return 200, self._envelope(self.model_rollup(range_key, project_filter=project_filter))
            if path == "/api/rollup/tool":
                return 200, self._envelope(self.tool_rollup(range_key, project_filter=project_filter))
            if path == "/api/rollup/skill":
                return 200, self._envelope(self.skill_rollup(range_key, project_filter=project_filter))
            if path == "/api/rollup/mcp-server":
                return 200, self._envelope(self.mcp_rollup(range_key, project_filter=project_filter))
            if path == "/api/heatmap":
                return 200, self._envelope(self.heatmap(range_key, project_filter=project_filter))
            if path == "/api/usage-limit-events":
                return 200, self._envelope(self.usage_limit_events(range_key, project_filter=project_filter))
        except ValueError as exc:
            return 400, {"error": str(exc)}

        match = self._SESSION_TRACE_RE.match(path)
        if match:
            data = self.session_trace(match.group("session_id"), project_filter=project_filter)
            if data is None:
                return 404, {"error": "session not found"}
            return 200, self._envelope(data)

        match = self._CALL_DETAIL_RE.match(path)
        if match:
            data = self.call_detail(match.group("session_id"), int(match.group("n")), project_filter=project_filter)
            if data is None:
                return 404, {"error": "call not found"}
            return 200, self._envelope(data)

        return 404, {"error": "unknown route"}


# --------------------------------------------------------------------------
# HTTP: thin stdlib socket layer over TokenMeteringApp
# --------------------------------------------------------------------------


def _safe_static_path(static_dir: Path, request_path: str) -> Path | None:
    rel = request_path.lstrip("/")
    if not rel:
        return None
    candidate = (static_dir / rel).resolve()
    try:
        candidate.relative_to(static_dir.resolve())
    except ValueError:
        return None
    return candidate


_PLACEHOLDER_HTML = (
    "<!doctype html><html><body>"
    "<p>token-metering dashboard: static frontend not built yet.</p>"
    "<p>Run token-metering/frontend's build step to generate static/.</p>"
    "</body></html>"
).encode("utf-8")


class Handler(http.server.BaseHTTPRequestHandler):
    app: "TokenMeteringApp" = None

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            status, body = self.app.handle_api(parsed.path, parse_qs(parsed.query))
            self._write_json(status, body)
            return
        self._serve_static_or_fallback(parsed.path)

    def _serve_static_or_fallback(self, path: str):
        static_dir = self.app.static_dir
        candidate = _safe_static_path(static_dir, path) if static_dir.is_dir() else None
        if candidate is not None and candidate.is_file():
            self._write_file(candidate)
            return

        index = static_dir / "index.html"
        if index.is_file():
            self._write_file(index)
            return

        self._write_html(200, _PLACEHOLDER_HTML)

    def _write_json(self, status: int, body: dict):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _write_html(self, status: int, payload: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _write_file(self, path: Path):
        content = path.read_bytes()
        content_type, _ = mimetypes.guess_type(str(path))
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *args):
        pass


def make_handler(app: TokenMeteringApp) -> type:
    return type("BoundHandler", (Handler,), {"app": app})


# --------------------------------------------------------------------------
# ServerInterface: start()/stop() (free functions, same structural-match
# precedent as db.py/pricing.py/parser.py's own interfaces.py conformance).
# `run`/`main` are thin foreground wrappers over these two.
# --------------------------------------------------------------------------

_server_lock = threading.Lock()
_server_state: dict = {}


def start(
    cairn_dir: Path,
    host: str = DEFAULT_HOST,
    port: int = 0,
    *,
    backfill_enabled: bool = True,
) -> int:
    """Start serving `cairn_dir` (used here as the project root - see
    `interfaces.ServerInterface`, whose param name predates this module) in
    a background daemon thread, and return the bound port. A server already
    running under this module is stopped first.

    Once the HTTP server is bound, kicks off `backfill.run()` on its own
    daemon thread for every known project plus `cairn_dir` itself - the
    bound port is returned immediately after, never waiting on however
    long backfill takes. `backfill` is imported here, function-scoped,
    rather than at this module's top - `backfill.py` imports `server` at
    its own module level, and keeping that the only direction avoids an
    import cycle. `backfill_enabled=False` lets a caller (tests
    indifferent to backfill) opt out entirely.
    """
    stop()
    app = TokenMeteringApp(cairn_dir)
    handler_cls = make_handler(app)
    httpd = http.server.ThreadingHTTPServer((host, port), handler_cls)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    with _server_lock:
        _server_state["httpd"] = httpd
        _server_state["thread"] = thread
    if backfill_enabled:
        import backfill  # noqa: E402

        known_projects = [project.root for project in app.projects()]
        threading.Thread(
            target=backfill.run,
            kwargs={"known_projects": known_projects, "local_project": cairn_dir},
            daemon=True,
        ).start()
    return httpd.server_address[1]


def stop() -> None:
    """Stop a server previously started by `start`. A no-op if none is
    currently running.
    """
    with _server_lock:
        httpd = _server_state.pop("httpd", None)
        thread = _server_state.pop("thread", None)
    if httpd is None:
        return
    httpd.shutdown()
    httpd.server_close()
    if thread is not None:
        thread.join(timeout=2)


def run(project_root: Path, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT):
    bound_port = start(project_root, host=host, port=port)
    print(f"token-metering dashboard: http://{host}:{bound_port}")
    with _server_lock:
        thread = _server_state.get("thread")
    try:
        if thread is not None:
            thread.join()
    except KeyboardInterrupt:
        pass
    finally:
        stop()


def main(argv: list[str] | None = None):
    argv = sys.argv[1:] if argv is None else argv
    project_root = Path(argv[0]) if argv else Path.cwd()
    port = int(argv[1]) if len(argv) > 1 else DEFAULT_PORT
    run(project_root, port=port)


if __name__ == "__main__":
    main()
