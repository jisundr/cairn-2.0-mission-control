import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tasks  # noqa: E402

CAIRN_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class _Project:
    """A minimal `server.Project`-shaped stand-in (`.label`/`.root`) - kept
    local so this module has no import-time dependency on `server`."""

    label: str
    root: Path


@pytest.fixture(autouse=True)
def _no_real_gh(monkeypatch):
    """Every fixture project in this file lacks a `.harness/workflow.md`
    saying direct-commit, so `_done_fact` would otherwise shell out to the
    real `gh` binary on whatever machine runs this suite. Default to
    "gh not available" (mirrors §11's missing/unauthenticated fallback);
    a test that wants to exercise the real `gh`-parsing path overrides this
    locally with its own `monkeypatch.setattr(tasks.subprocess, "run", ...)`.
    """
    def _no_gh(*args, **kwargs):
        raise FileNotFoundError("gh not installed")

    monkeypatch.setattr(tasks.subprocess, "run", _no_gh)


def write_state(folder: Path, *, goal="a goal", key_info="in progress", flags="[]", extra_frontmatter="", body="- 2026-09-01: started.\n"):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "STATE.md").write_text(
        f"---\n"
        f"goal: {goal}\n"
        f"paths: [a.py]\n"
        f"done_when: it works\n"
        f"out_of_scope: []\n"
        f"source: \n"
        f"path: escalated\n"
        f"key_info: {key_info}\n"
        f"flags: {flags}\n"
        f"{extra_frontmatter}"
        f"---\n"
        f"> The frontmatter above is the state read on resume.\n\n"
        f"{body}"
    )


# --------------------------------------------------------------------------
# Frontmatter parsing
# --------------------------------------------------------------------------


def test_parse_frontmatter_reads_flat_scalars_and_flow_lists():
    text = (
        "---\n"
        "goal: Ship the thing\n"
        "paths: [a.py, b.py]\n"
        "key_info: awaiting requirements approval\n"
        "flags: []\n"
        "---\n"
        "body text\n"
    )
    fm = tasks.parse_frontmatter(text)
    assert fm["goal"] == "Ship the thing"
    assert fm["paths"] == ["a.py", "b.py"]
    assert fm["key_info"] == "awaiting requirements approval"
    assert fm["flags"] == []


def test_parse_frontmatter_reads_block_style_lists_and_quoted_flow_items_with_commas():
    text = (
        "---\n"
        "goal: g\n"
        "flags:\n"
        "  - first flag, with a comma\n"
        "  - second flag\n"
        'paths: ["a, b", "c"]\n'
        "---\n"
    )
    fm = tasks.parse_frontmatter(text)
    assert fm["flags"] == ["first flag, with a comma", "second flag"]
    assert fm["paths"] == ["a, b", "c"]


def test_parse_frontmatter_degrades_on_malformed_lines_instead_of_raising():
    text = (
        "---\n"
        "goal: g\n"
        "this line has no colon at all\n"
        "key_info: still readable\n"
        "---\n"
    )
    fm = tasks.parse_frontmatter(text)
    assert fm["goal"] == "g"
    assert fm["key_info"] == "still readable"


def test_parse_frontmatter_returns_empty_dict_when_no_frontmatter_block_exists():
    assert tasks.parse_frontmatter("just a plain markdown file\nno frontmatter here\n") == {}
    assert tasks.parse_frontmatter("---\nopens but never closes\n") == {}


def test_last_log_date_picks_the_last_dashed_date_line_and_ignores_the_blockquote():
    text = (
        "---\ngoal: g\n---\n"
        "> The frontmatter above is the state read on resume.\n\n"
        "- 2026-09-01: first entry.\n"
        "- 2026-09-15: second entry, latest.\n"
    )
    assert tasks._last_log_date(text) == "2026-09-15"


def test_last_log_date_is_none_when_no_dated_log_line_is_present():
    text = "---\ngoal: g\n---\nsome hand-edited body with no dated lines\n"
    assert tasks._last_log_date(text) is None


# --------------------------------------------------------------------------
# Discovery (§6.1)
# --------------------------------------------------------------------------


def test_iter_task_dirs_finds_state_and_draft_excludes_template(tmp_path):
    write_state(tmp_path / "docs/tasks/2026-01-01-0000-build-a")
    (tmp_path / "docs/tasks/2026-01-02-0000-review-b").mkdir(parents=True)
    (tmp_path / "docs/tasks/2026-01-02-0000-review-b/DRAFT.md").write_text("# Review\nStatus: pending\n")
    write_state(tmp_path / "docs/tasks/_template")

    found = {d.name: p.name for d, p in tasks._iter_task_dirs(tmp_path)}
    assert found == {"2026-01-01-0000-build-a": "STATE.md", "2026-01-02-0000-review-b": "DRAFT.md"}


def test_iter_task_dirs_prefers_state_over_draft_when_both_exist(tmp_path):
    folder = tmp_path / "docs/tasks/2026-01-01-0000-build-a"
    write_state(folder)
    (folder / "DRAFT.md").write_text("stray draft\n")

    found = list(tasks._iter_task_dirs(tmp_path))
    assert len(found) == 1
    assert found[0][1].name == "STATE.md"


def test_iter_task_dirs_yields_nothing_when_docs_tasks_is_absent(tmp_path):
    assert list(tasks._iter_task_dirs(tmp_path)) == []


def test_folder_kind_defaults_to_build_for_unrecognized_names():
    assert tasks._folder_kind("2026-01-01-0000-research-x") == "research"
    assert tasks._folder_kind("01-review-x") == "review"
    assert tasks._folder_kind("01-backend-tasks-api") == "build"
    assert tasks._folder_kind("2026-09-11-0759-portfolio-interview-docs") == "build"


def test_parent_relpath_detects_a_sub_task_one_level_up(tmp_path):
    parent = tmp_path / "docs/tasks/2026-01-01-0000-build-parent"
    write_state(parent)
    child = parent / "01-backend-tasks-api"
    write_state(child)

    assert tasks._parent_relpath(child, tmp_path) == "docs/tasks/2026-01-01-0000-build-parent"
    assert tasks._parent_relpath(parent, tmp_path) is None


# --------------------------------------------------------------------------
# §6.2 raw facts + precedence
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key_info,expected",
    [
        ("needs-human: which db to use?", True),
        ("stalled after 3 attempts", True),
        ("awaiting requirements approval", True),
        ("awaiting plan approval", True),
        ("Done. Reviewed PASS.", False),
        ("", False),
    ],
)
def test_needs_attention_fact_matches_cairn_triage_markers(key_info, expected):
    assert tasks._needs_attention_fact(key_info) is expected


def test_is_direct_commit_project_reads_this_repos_own_workflow_md():
    assert tasks._is_direct_commit_project(CAIRN_ROOT / ".harness" / "workflow.md") is True


def test_is_direct_commit_project_false_when_branching_section_or_file_is_absent(tmp_path):
    assert tasks._is_direct_commit_project(tmp_path / "no-such-file.md") is False

    workflow = tmp_path / "workflow.md"
    workflow.write_text("## Gates\n- pytest\n")
    assert tasks._is_direct_commit_project(workflow) is False


def test_done_fact_research_kind_never_shells_out_to_gh(tmp_path, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("gh should never be invoked for a research-kind folder")

    monkeypatch.setattr(tasks.subprocess, "run", _boom)
    assert tasks._done_fact("research", "Done.", "folder", tmp_path, {}, 60.0) is True
    assert tasks._done_fact("research", "still going", "folder", tmp_path, {}, 60.0) is False


def test_done_fact_direct_commit_project_skips_gh_and_reads_key_info(tmp_path, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("gh should never be invoked for a direct-commit project")

    monkeypatch.setattr(tasks.subprocess, "run", _boom)
    (tmp_path / ".harness").mkdir()
    (tmp_path / ".harness" / "workflow.md").write_text("## Branching\n- Direct commits to main, no feature branches\n")

    assert tasks._done_fact("build", "Done, closed out.", "folder", tmp_path, {}, 60.0) is True
    assert tasks._done_fact("build", "still going", "folder", tmp_path, {}, 60.0) is False


def _fake_gh_result(returncode=0, stdout="0"):
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr="")


def test_gh_pr_merged_parses_0_and_1_and_caches_within_ttl(tmp_path, monkeypatch):
    calls = []

    def _fake_run(args, **kwargs):
        calls.append(args)
        return _fake_gh_result(stdout="1")

    monkeypatch.setattr(tasks.subprocess, "run", _fake_run)
    cache = {}
    assert tasks._gh_pr_merged("my-folder", tmp_path, cache, 60.0) is True
    assert tasks._gh_pr_merged("my-folder", tmp_path, cache, 60.0) is True
    assert len(calls) == 1  # second call served from cache, no second subprocess

    calls.clear()
    assert tasks._gh_pr_merged("other-folder", tmp_path, cache, 60.0) is True
    assert len(calls) == 1  # different cache key, not served from "my-folder"'s entry


def test_gh_pr_merged_falls_back_to_none_on_non_0_1_output_or_nonzero_exit(tmp_path, monkeypatch):
    monkeypatch.setattr(tasks.subprocess, "run", lambda *a, **k: _fake_gh_result(stdout="not-a-number"))
    assert tasks._gh_pr_merged("f", tmp_path, {}, 60.0) is None

    monkeypatch.setattr(tasks.subprocess, "run", lambda *a, **k: _fake_gh_result(returncode=1, stdout=""))
    assert tasks._gh_pr_merged("f", tmp_path, {}, 60.0) is None


def test_gh_pr_merged_falls_back_to_none_when_gh_is_missing(tmp_path, monkeypatch):
    def _missing(*args, **kwargs):
        raise FileNotFoundError("no gh")

    monkeypatch.setattr(tasks.subprocess, "run", _missing)
    assert tasks._gh_pr_merged("f", tmp_path, {}, 60.0) is None


def test_column_precedence_needs_attention_beats_done_beats_ongoing():
    assert tasks._column(needs_attention=True, done=True, active=True) == "needs_attention"
    assert tasks._column(needs_attention=False, done=True, active=True) == "done"
    assert tasks._column(needs_attention=False, done=False, active=True) == "ongoing"
    assert tasks._column(needs_attention=False, done=False, active=False) == "ready"


# --------------------------------------------------------------------------
# §8: the `active` heartbeat read
# --------------------------------------------------------------------------


def test_active_heartbeats_includes_only_fresh_files_matching_project_and_task(tmp_path):
    heartbeat_dir = tmp_path / "active"
    heartbeat_dir.mkdir()
    now = time.time()

    fresh = heartbeat_dir / "sess-fresh.json"
    fresh.write_text('{"project": "/repo", "task": "docs/tasks/x"}')
    stale = heartbeat_dir / "sess-stale.json"
    stale.write_text('{"project": "/repo", "task": "docs/tasks/y"}')
    os.utime(stale, (now - 3600, now - 3600))

    live = tasks._active_heartbeats(heartbeat_dir, now=now)
    assert ("/repo", "docs/tasks/x") in live
    assert ("/repo", "docs/tasks/y") not in live


def test_active_heartbeats_ignores_corrupt_and_missing_directory(tmp_path):
    assert tasks._active_heartbeats(tmp_path / "nonexistent", now=time.time()) == set()

    heartbeat_dir = tmp_path / "active"
    heartbeat_dir.mkdir()
    (heartbeat_dir / "bad.json").write_text("not json at all")
    (heartbeat_dir / "wrong-shape.json").write_text('["not", "a", "dict"]')

    assert tasks._active_heartbeats(heartbeat_dir, now=time.time()) == set()


# --------------------------------------------------------------------------
# `build_cards` (§6.1-6.4, §9)
# --------------------------------------------------------------------------


def test_build_cards_columns_a_ready_a_needs_attention_and_an_active_card(tmp_path):
    # `Project.root` is contractually already-resolved (`server.discover_projects`
    # always does so) - resolving it here too, rather than relying on `tmp_path`
    # happening to already be canonical, keeps the heartbeat-match test honest.
    root = (tmp_path / "proj").resolve()
    write_state(root / "docs/tasks/2026-01-01-0000-build-ready", key_info="nothing blocking")
    write_state(root / "docs/tasks/2026-01-02-0000-build-stuck", key_info="needs-human: pick a name")
    write_state(root / "docs/tasks/2026-01-03-0000-build-live", key_info="in progress")

    heartbeat_dir = tmp_path / "active"
    heartbeat_dir.mkdir()
    (heartbeat_dir / "s1.json").write_text(
        '{"project": "%s", "task": "docs/tasks/2026-01-03-0000-build-live"}' % str(root)
    )

    cards = tasks.build_cards([_Project("proj", root)], heartbeat_dir=heartbeat_dir)
    by_folder = {c["folder"]: c for c in cards}

    assert by_folder["docs/tasks/2026-01-01-0000-build-ready"]["column"] == "ready"
    assert by_folder["docs/tasks/2026-01-02-0000-build-stuck"]["column"] == "needs_attention"
    assert by_folder["docs/tasks/2026-01-03-0000-build-live"]["column"] == "ongoing"
    assert by_folder["docs/tasks/2026-01-03-0000-build-live"]["active"] is True
    assert all(c["sub_tasks"] is None for c in cards)


def test_build_cards_two_sibling_sub_tasks_report_independent_columns_and_parent_progress(tmp_path):
    root = tmp_path / "proj"
    parent = root / "docs/tasks/2026-01-01-0000-build-parent"
    write_state(parent, key_info="in progress")
    write_state(parent / "01-first", key_info="Done, closed.")
    write_state(parent / "02-second", key_info="needs-human: which approach?")

    (root / ".harness").mkdir(parents=True)
    (root / ".harness" / "workflow.md").write_text("## Branching\n- Direct commits to main, no feature branches\n")

    cards = tasks.build_cards([_Project("proj", root)])
    by_folder = {c["folder"]: c for c in cards}

    first = by_folder["docs/tasks/2026-01-01-0000-build-parent/01-first"]
    second = by_folder["docs/tasks/2026-01-01-0000-build-parent/02-second"]
    assert first["column"] == "done"
    assert second["column"] == "needs_attention"
    assert first["parent"] == "docs/tasks/2026-01-01-0000-build-parent"
    assert second["parent"] == "docs/tasks/2026-01-01-0000-build-parent"

    parent_card = by_folder["docs/tasks/2026-01-01-0000-build-parent"]
    assert parent_card["sub_tasks"] == {"done": 1, "total": 2}
    assert parent_card["column"] == "ready"  # parent's own facts, independent of its children


def test_build_cards_omits_sub_tasks_field_for_a_folder_with_no_children(tmp_path):
    root = tmp_path / "proj"
    write_state(root / "docs/tasks/2026-01-01-0000-build-solo")

    cards = tasks.build_cards([_Project("proj", root)])
    assert cards[0]["sub_tasks"] is None


def test_build_cards_handles_a_review_folder_with_only_a_draft_md(tmp_path):
    root = tmp_path / "proj"
    folder = root / "docs/tasks/2026-01-05-0000-review-org-repo-pr-9"
    folder.mkdir(parents=True)
    (folder / "DRAFT.md").write_text("# PR #9 — Fix the thing (org/repo)\n\nStatus: pending user review\n")

    cards = tasks.build_cards([_Project("proj", root)])
    assert len(cards) == 1
    card = cards[0]
    assert card["kind"] == "review"
    assert card["goal"] == "PR #9 — Fix the thing (org/repo)"
    assert card["key_info"] == "Status: pending user review"
    assert card["last_log_date"] == "2026-01-05"


def test_build_cards_project_with_no_docs_tasks_and_only_template_never_errors(tmp_path):
    empty_root = tmp_path / "empty-proj"
    empty_root.mkdir()

    template_root = tmp_path / "template-only-proj"
    write_state(template_root / "docs/tasks/_template")

    cards = tasks.build_cards([_Project("empty", empty_root), _Project("templated", template_root)])
    assert cards == []


def test_build_cards_against_this_repos_own_real_task_folder(tmp_path):
    """`docs/tasks/2026-09-11-0759-portfolio-interview-docs/` (per
    requirements.md's own real-fixture constraint) is a long-closed-out
    folder whose retroactively-added `STATE.md` never changes: `key_info`
    reads "Done. ..." (whole-word `done`, precedence's second bucket), its
    name predates the `<kind>` convention (falls back to `build`), and its
    one log line isn't `^- `-prefixed, so `last_log_date` degrades to the
    folder's own date prefix rather than erroring."""
    heartbeat_dir = tmp_path / "active"  # empty: nothing in this repo is "live" for this test

    cards = tasks.build_cards([_Project("cairn-2.0", CAIRN_ROOT)], heartbeat_dir=heartbeat_dir)
    by_folder = {c["folder"]: c for c in cards}

    folder = "docs/tasks/2026-09-11-0759-portfolio-interview-docs"
    assert folder in by_folder
    card = by_folder[folder]
    assert card["kind"] == "build"
    assert card["parent"] is None
    assert card["done"] is True
    assert card["needs_attention"] is False
    assert card["column"] == "done"
    assert card["last_log_date"] == "2026-09-11"


def test_build_cards_two_real_sibling_sub_tasks_report_different_columns(tmp_path):
    """`docs/tasks/2026-09-25-0615-research-aihero-skills-comparison/`'s two
    real, long-closed sub-tasks (both `key_info: Done. ...`) independently
    verify §6.2's precedence against real fixture data, per
    requirements.md's Success criteria and `../PRD.md` §13."""
    heartbeat_dir = tmp_path / "active"

    cards = tasks.build_cards([_Project("cairn-2.0", CAIRN_ROOT)], heartbeat_dir=heartbeat_dir)
    by_folder = {c["folder"]: c for c in cards}

    parent = "docs/tasks/2026-09-25-0615-research-aihero-skills-comparison"
    first = by_folder[f"{parent}/01-build-add-triage-skill"]
    second = by_folder[f"{parent}/02-build-fold-tdd-into-builder"]
    assert first["column"] == "done"
    assert second["column"] == "done"
    assert first["parent"] == parent
    assert second["parent"] == parent
    assert by_folder[parent]["sub_tasks"] == {"done": 2, "total": 2}
