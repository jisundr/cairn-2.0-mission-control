#!/usr/bin/env python3
"""Task-folder discovery, frontmatter parsing, `§6.2` column precedence, and
the `active` heartbeat read for mission control's kanban board. stdlib only.

Design: see `docs/tasks/2026-09-28-1345-build-kanban-board/PRD.md` §6.1-6.4,
§8 (read side only), §9 (`GET /api/tasks` response shape). Read-only against
every artifact this module touches - a `STATE.md`/`DRAFT.md` file, a
project's own `.harness/workflow.md`, and a heartbeat file under
`~/.claude/cairn/active/` are only ever read here, never written.

Callers pass in `Project`-shaped objects (a `.label: str` and a
`.root: Path`, matching `server.Project`) rather than this module importing
`server` itself, so `server.py` can import `tasks` without a cycle.
"""
import json
import re
import subprocess
import time
from collections import defaultdict
from pathlib import Path

# A live session's heartbeat file is "active" only if its mtime is within
# this many seconds of request time (§8's freshness window; 10 minutes).
HEARTBEAT_FRESHNESS_SECONDS = 600

# `~/.claude/cairn/active/<session_id>.json`, per §8 - mirrors
# `server.DEFAULT_KNOWN_PROJECTS_PATH`'s global-registry placement.
DEFAULT_HEARTBEAT_DIR = Path.home() / ".claude" / "cairn" / "active"

# `gh pr list` is a per-folder network+auth call (§14 Risk); cached
# in-process per `(project_root, folder_name)` for this long.
GH_CACHE_TTL_SECONDS = 60.0


# --------------------------------------------------------------------------
# Frontmatter: flat scalars + string lists, no PyYAML (`.harness/architecture.md`)
# --------------------------------------------------------------------------


def _frontmatter_bounds(lines: list[str]) -> tuple[int, int] | None:
    """`(start, end)` such that `lines[start:end]` is the frontmatter
    block's own lines, excluding both `---` delimiters - or `None` if the
    file doesn't open with `---`, or never closes it (degrade, not crash:
    callers treat `None` as "no frontmatter found")."""
    if not lines or lines[0].strip() != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return (1, i)
    return None


_KEY_LINE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*):(.*)$")


def _strip_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _split_flow_list(inner: str) -> list[str]:
    """Splits a `[a, b, c]` flow list's inner text on top-level commas only
    - a comma inside a quoted item (`["a, b", "c"]`) doesn't split it."""
    items: list[str] = []
    current: list[str] = []
    in_quotes = False
    quote_char = ""
    for ch in inner:
        if in_quotes:
            current.append(ch)
            if ch == quote_char:
                in_quotes = False
            continue
        if ch in "\"'":
            in_quotes = True
            quote_char = ch
            current.append(ch)
            continue
        if ch == ",":
            items.append("".join(current))
            current = []
            continue
        current.append(ch)
    items.append("".join(current))
    return items


def _parse_frontmatter_lines(lines: list[str]) -> dict[str, str | list[str]]:
    result: dict[str, str | list[str]] = {}
    current_key: str | None = None
    current_list: list[str] | None = None

    for line in lines:
        if current_list is not None:
            stripped = line.strip()
            if stripped.startswith("- "):
                current_list.append(_strip_quotes(stripped[2:]))
                continue
            result[current_key] = current_list
            current_key, current_list = None, None
            # fall through: this line may itself be the next key

        match = _KEY_LINE_RE.match(line)
        if not match:
            continue  # unparseable line: dropped, not fatal (degrade)
        key, raw_value = match.group(1), match.group(2).strip()

        if raw_value == "":
            # Either a block list follows (`flags:\n  - a`) or the scalar
            # is genuinely empty - resolved once the next line is seen.
            current_key, current_list = key, []
            continue
        if raw_value.startswith("[") and raw_value.endswith("]"):
            inner = raw_value[1:-1].strip()
            result[key] = [] if inner == "" else [_strip_quotes(item) for item in _split_flow_list(inner)]
        else:
            result[key] = _strip_quotes(raw_value)

    if current_list is not None:
        result[current_key] = current_list
    return result


def parse_frontmatter(text: str) -> dict[str, str | list[str]]:
    """A `STATE.md`'s frontmatter block (flat scalars + string lists,
    `goal`/`paths`/`done_when`/`out_of_scope`/`source`/`path`/`key_info`/
    `flags`) as a dict. `text` is the whole file's content. `{}` if there's
    no well-formed opening+closing `---` pair - never raises on malformed
    content."""
    bounds = _frontmatter_bounds(text.splitlines())
    if bounds is None:
        return {}
    lines = text.splitlines()
    return _parse_frontmatter_lines(lines[bounds[0] : bounds[1]])


_LOG_DATE_RE = re.compile(r"^- (\d{4}-\d{2}-\d{2})", re.MULTILINE)


def _last_log_date(text: str) -> str | None:
    """The last `YYYY-MM-DD` date starting a `^- ` line in `text`'s body
    (after the frontmatter's closing `---`, or the whole text if there's no
    frontmatter) - `None` if no such line is found."""
    lines = text.splitlines()
    bounds = _frontmatter_bounds(lines)
    body_lines = lines[bounds[1] + 1 :] if bounds is not None else lines
    dates = _LOG_DATE_RE.findall("\n".join(body_lines))
    return dates[-1] if dates else None


def _draft_summary(text: str) -> tuple[str, str]:
    """A `review` folder's `DRAFT.md` has no frontmatter - `/cairn-triage`
    step 1's own treatment ("one trailing line") is mirrored here for both
    ends: the first non-empty line (the draft's own title) stands in for
    `goal`, the last non-empty line stands in for `key_info`."""
    non_empty = [line.strip() for line in text.splitlines() if line.strip()]
    if not non_empty:
        return "", ""
    goal = non_empty[0].lstrip("#").strip()
    return goal, non_empty[-1]


_FOLDER_DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def _folder_name_date(folder_dir: Path, tasks_root: Path) -> str:
    """Walks from `folder_dir` up to (excluding) `tasks_root` looking for
    the nearest ancestor whose name is date-prefixed - a sub-task folder
    (`0N-<kind>-slug`) has no date of its own, so this finds its parent's.
    `""` if nothing in the chain is dated."""
    current = folder_dir
    while current != tasks_root:
        match = _FOLDER_DATE_RE.match(current.name)
        if match:
            return match.group(1)
        current = current.parent
    return ""


# --------------------------------------------------------------------------
# Discovery (§6.1)
# --------------------------------------------------------------------------

_KIND_RE = re.compile(r"^(?:\d{4}-\d{2}-\d{2}-\d{4}|\d{2})-(build|research|review)-")


def _folder_kind(folder_name: str) -> str:
    """`build`/`research`/`review` parsed from a `YYYY-MM-DD-HHMM-<kind>-
    slug` or `0N-<kind>-slug` folder name; `build` for anything else
    (folders predating the `<kind>` naming convention) - a reasonable
    default rather than an error, per this module's degrade-not-crash
    posture."""
    match = _KIND_RE.match(folder_name)
    return match.group(1) if match else "build"


def _parent_relpath(folder_dir: Path, project_root: Path) -> str | None:
    """The immediate parent folder's project-root-relative path, if that
    parent itself holds a `STATE.md`/`DRAFT.md` (§6.1's sub-task test) -
    `None` for a top-level folder (whose parent is `docs/tasks` itself)."""
    parent = folder_dir.parent
    if parent == project_root or not parent.is_relative_to(project_root):
        return None
    if (parent / "STATE.md").is_file() or (parent / "DRAFT.md").is_file():
        return parent.relative_to(project_root).as_posix()
    return None


def _iter_task_dirs(project_root: Path):
    """Yields `(folder_dir, source_path)` for every task folder under
    `project_root/docs/tasks/` - `source_path` is that folder's own
    `STATE.md`, or (only when no `STATE.md` exists there) its `DRAFT.md`,
    per §6.1. Any path with a `_template` segment is excluded. Nothing is
    yielded, without error, when `docs/tasks/` doesn't exist at all (§11)."""
    tasks_root = project_root / "docs" / "tasks"
    if not tasks_root.is_dir():
        return
    seen_dirs: set[Path] = set()
    for state_path in sorted(tasks_root.glob("**/STATE.md")):
        if "_template" in state_path.parts:
            continue
        seen_dirs.add(state_path.parent)
        yield state_path.parent, state_path
    for draft_path in sorted(tasks_root.glob("**/DRAFT.md")):
        if "_template" in draft_path.parts or draft_path.parent in seen_dirs:
            continue
        yield draft_path.parent, draft_path


# --------------------------------------------------------------------------
# §6.2 raw facts + precedence
# --------------------------------------------------------------------------

_NEEDS_ATTENTION_SUBSTRINGS = ("needs-human", "stalled")
_APPROVAL_SUBSTRINGS = ("awaiting requirements approval", "awaiting plan approval")


def _needs_attention_fact(key_info: str) -> bool:
    """Case-sensitive substring match, verbatim from `/cairn-triage` step 3
    - `needs-human`/`stalled` (an unattended-mode marker) or either
    approval-gate string (`cairn:shared`'s own convention)."""
    if not key_info:
        return False
    return any(s in key_info for s in _NEEDS_ATTENTION_SUBSTRINGS) or any(
        s in key_info for s in _APPROVAL_SUBSTRINGS
    )


_DONE_WORD_RE = re.compile(r"\b(done|close|closed|complete)\b", re.IGNORECASE)

_BRANCHING_HEADING_RE = re.compile(r"^##\s+Branching\s*$", re.MULTILINE)
_NEXT_HEADING_RE = re.compile(r"^##\s+", re.MULTILINE)


def _is_direct_commit_project(workflow_path: Path) -> bool:
    """True when `workflow_path`'s `## Branching` section says commits go
    straight to main or that there are no feature branches
    (`/cairn-triage` step 2's own check) - `False` if the file is missing,
    unreadable, or has no `## Branching` section at all."""
    try:
        text = workflow_path.read_text()
    except OSError:
        return False
    heading = _BRANCHING_HEADING_RE.search(text)
    if not heading:
        return False
    rest = text[heading.end() :]
    next_heading = _NEXT_HEADING_RE.search(rest)
    section = rest[: next_heading.start()] if next_heading else rest
    section_lower = section.lower()
    return "direct commit" in section_lower or "no feature branch" in section_lower


def _gh_pr_merged(folder_name: str, project_root: Path, cache: dict, ttl: float) -> bool | None:
    """Whether a PR named after `folder_name` (the task folder's own leaf
    name, used as its branch name by convention) shows as merged, per
    `/cairn-triage` step 3's own `gh pr list` check - cached per
    `(project_root, folder_name)` for `ttl` seconds (§14 Risk sizes this).
    `None` (go by `key_info` instead) for anything but a clean `0`/`1`
    result: non-zero exit, unparseable output, or `gh` missing/unauthenticated
    entirely (§11 - never lets a `gh` problem error the whole board)."""
    key = (str(project_root), folder_name)
    now = time.monotonic()
    cached = cache.get(key)
    if cached is not None and now - cached[0] < ttl:
        return cached[1]

    try:
        result = subprocess.run(
            ["gh", "pr", "list", "--head", folder_name, "--state", "merged", "--json", "number", "-q", "length"],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        cache[key] = (now, None)
        return None

    if result.returncode != 0:
        cache[key] = (now, None)
        return None
    output = result.stdout.strip()
    value = {"0": False, "1": True}.get(output)
    cache[key] = (now, value)
    return value


def _done_fact(kind: str, key_info: str, folder_name: str, project_root: Path, gh_cache: dict, gh_ttl: float) -> bool:
    """A merged PR, or `key_info` (or a `review` folder's trailing-line
    equivalent) saying `done`/`close(d)`/`complete` as a whole word - §6.2
    point 2. A `research`-kind folder never checks `gh` (`cairn:shared`);
    neither does a direct-commit project (`/cairn-triage` step 2) - both
    fall back to the `key_info` check alone."""
    key_info_says_done = bool(_DONE_WORD_RE.search(key_info or ""))
    if kind == "research":
        return key_info_says_done
    if _is_direct_commit_project(project_root / ".harness" / "workflow.md"):
        return key_info_says_done
    merged = _gh_pr_merged(folder_name, project_root, gh_cache, gh_ttl)
    return bool(merged) or key_info_says_done


def _column(needs_attention: bool, done: bool, active: bool) -> str:
    """First-match-wins, per §6.2: Needs Attention -> Done -> Ongoing ->
    Ready."""
    if needs_attention:
        return "needs_attention"
    if done:
        return "done"
    if active:
        return "ongoing"
    return "ready"


# --------------------------------------------------------------------------
# §8: the `active` heartbeat read (read-only)
# --------------------------------------------------------------------------


def _active_heartbeats(heartbeat_dir: Path, now: float) -> set[tuple[str, str]]:
    """`(project, task)` pairs (as written by a heartbeat file's own JSON,
    §8) with at least one heartbeat file under `heartbeat_dir` whose mtime
    is within `HEARTBEAT_FRESHNESS_SECONDS` of `now`. A missing directory,
    or a stale/corrupt/non-dict/wrong-shaped file, just contributes
    nothing - read-only and never raises."""
    live: set[tuple[str, str]] = set()
    if not heartbeat_dir.is_dir():
        return live
    for path in heartbeat_dir.glob("*.json"):
        try:
            if now - path.stat().st_mtime > HEARTBEAT_FRESHNESS_SECONDS:
                continue
            payload = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if not isinstance(payload, dict):
            continue
        project, task = payload.get("project"), payload.get("task")
        if isinstance(project, str) and isinstance(task, str):
            live.add((project, task))
    return live


# --------------------------------------------------------------------------
# Card assembly (§6.1-6.4, §9)
# --------------------------------------------------------------------------


def build_cards(
    projects: list,
    *,
    heartbeat_dir: Path | None = None,
    now: float | None = None,
    gh_cache: dict | None = None,
    gh_ttl: float = GH_CACHE_TTL_SECONDS,
) -> list[dict]:
    """One card per `docs/tasks/**/STATE.md`/`DRAFT.md` folder across every
    `project` in `projects` (each a `.label`/`.root`-bearing object, e.g.
    `server.Project`), shaped per `PRD.md` §9's `GET /api/tasks` schema.
    `heartbeat_dir` (default `DEFAULT_HEARTBEAT_DIR`) and `now` (default
    wall-clock) parameterize the `active` read for testability; `gh_cache`
    should be a dict the caller holds across requests so the `gh pr list`
    TTL cache (§14) actually persists between calls."""
    heartbeat_dir = heartbeat_dir if heartbeat_dir is not None else DEFAULT_HEARTBEAT_DIR
    gh_cache = gh_cache if gh_cache is not None else {}
    request_time = now if now is not None else time.time()
    live_heartbeats = _active_heartbeats(heartbeat_dir, request_time)

    cards: list[dict] = []
    for project in projects:
        tasks_root = project.root / "docs" / "tasks"
        for folder_dir, source_path in _iter_task_dirs(project.root):
            try:
                text = source_path.read_text()
            except OSError:
                continue

            relative_folder = folder_dir.relative_to(project.root).as_posix()
            kind = _folder_kind(folder_dir.name)
            parent = _parent_relpath(folder_dir, project.root)

            if source_path.name == "DRAFT.md":
                goal, key_info = _draft_summary(text)
                last_log_date = _folder_name_date(folder_dir, tasks_root)
            else:
                frontmatter = parse_frontmatter(text)
                goal = frontmatter.get("goal", "")
                key_info = frontmatter.get("key_info", "")
                goal = goal if isinstance(goal, str) else ""
                key_info = key_info if isinstance(key_info, str) else ""
                last_log_date = _last_log_date(text) or _folder_name_date(folder_dir, tasks_root)

            needs_attention = _needs_attention_fact(key_info)
            done = _done_fact(kind, key_info, folder_dir.name, project.root, gh_cache, gh_ttl)
            active = (str(project.root), relative_folder) in live_heartbeats

            cards.append(
                {
                    "project": project.label,
                    "folder": relative_folder,
                    "parent": parent,
                    "kind": kind,
                    "goal": goal,
                    "key_info": key_info,
                    "last_log_date": last_log_date,
                    "column": _column(needs_attention, done, active),
                    "active": active,
                    "needs_attention": needs_attention,
                    "done": done,
                }
            )

    # §6.4: direct-child count per parent, one level, done = children whose
    # own column is Done - scoped by project so two projects' folders that
    # happen to share a relative path never mix.
    children_by_parent: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for card in cards:
        if card["parent"] is not None:
            children_by_parent[(card["project"], card["parent"])].append(card)

    for card in cards:
        children = children_by_parent.get((card["project"], card["folder"]))
        if children:
            card["sub_tasks"] = {"done": sum(1 for c in children if c["column"] == "done"), "total": len(children)}
        else:
            card["sub_tasks"] = None

    return cards
