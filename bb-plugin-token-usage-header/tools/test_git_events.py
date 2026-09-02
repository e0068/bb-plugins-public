"""Tests for tools/git_events.py on synthetic .jsonl records.

Covers: pr-link -> a "pr" event; a Bash `git push` paired with a clean
tool_result -> a "push" event; a Bash `git push` blocked by a PreToolUse
hook -> no event; cwd/gitBranch picked from the latest record carrying both;
malformed/unrelated records don't crash or leak into events; events come
back sorted by ts.
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import git_events  # noqa: E402


def write_jsonl(path, records):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")


def assistant_bash(ts, command, tool_id="toolu_1", cwd="/repo", git_branch="main"):
    return {
        "type": "assistant",
        "timestamp": ts,
        "cwd": cwd,
        "gitBranch": git_branch,
        "message": {
            "role": "assistant",
            "content": [{"type": "tool_use", "id": tool_id, "name": "Bash", "input": {"command": command}}],
        },
    }


def user_tool_result(ts, tool_id, text, cwd="/repo", git_branch="main"):
    return {
        "type": "user",
        "timestamp": ts,
        "cwd": cwd,
        "gitBranch": git_branch,
        "message": {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": tool_id, "content": text}],
        },
    }


def pr_link(ts, number=73, url="https://github.com/e0068/bb-plugins/pull/73", repository="e0068/bb-plugins"):
    return {
        "type": "pr-link",
        "sessionId": "s1",
        "prNumber": number,
        "prUrl": url,
        "prRepository": repository,
        "timestamp": ts,
    }


class ScanSessionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "session.jsonl")

    def test_empty_file_gives_no_context_and_no_events(self):
        write_jsonl(self.path, [])
        result = git_events.scan_session([self.path])
        self.assertEqual(result, {"cwd": None, "gitBranch": None, "events": []})

    def test_pr_link_becomes_a_pr_event(self):
        write_jsonl(self.path, [pr_link("2026-08-26T23:28:07.969Z")])
        result = git_events.scan_session([self.path])
        self.assertEqual(
            result["events"],
            [
                {
                    "type": "pr",
                    "ts": "2026-08-26T23:28:07.969Z",
                    "number": 73,
                    "url": "https://github.com/e0068/bb-plugins/pull/73",
                    "repository": "e0068/bb-plugins",
                }
            ],
        )

    def test_successful_git_push_becomes_a_push_event(self):
        write_jsonl(
            self.path,
            [
                assistant_bash("2026-08-26T23:00:00.000Z", "git push -u origin bb/thr_x", git_branch="bb/thr_x"),
                user_tool_result("2026-08-26T23:00:01.000Z", "toolu_1", "Branch 'bb/thr_x' set up to track 'origin/bb/thr_x'."),
            ],
        )
        result = git_events.scan_session([self.path])
        self.assertEqual(
            result["events"],
            [{"type": "push", "ts": "2026-08-26T23:00:00.000Z", "branch": "bb/thr_x", "url": None}],
        )

    def test_blocked_git_push_produces_no_event(self):
        write_jsonl(
            self.path,
            [
                assistant_bash("2026-08-26T23:00:00.000Z", "git push -u origin bb/thr_x"),
                user_tool_result(
                    "2026-08-26T23:00:01.000Z",
                    "toolu_1",
                    "PreToolUse:Bash hook error: [.../block-dangerous-git.sh]: BLOCKED: matches dangerous pattern 'git push'.",
                ),
            ],
        )
        result = git_events.scan_session([self.path])
        self.assertEqual(result["events"], [])

    def test_bash_command_without_push_is_ignored(self):
        write_jsonl(
            self.path,
            [
                assistant_bash("2026-08-26T23:00:00.000Z", "git status"),
                user_tool_result("2026-08-26T23:00:01.000Z", "toolu_1", "nothing to commit"),
            ],
        )
        result = git_events.scan_session([self.path])
        self.assertEqual(result["events"], [])

    def test_push_with_no_matching_tool_result_produces_no_event(self):
        write_jsonl(self.path, [assistant_bash("2026-08-26T23:00:00.000Z", "git push")])
        result = git_events.scan_session([self.path])
        self.assertEqual(result["events"], [])

    def test_cwd_and_branch_come_from_the_latest_record_carrying_both(self):
        write_jsonl(
            self.path,
            [
                assistant_bash("2026-08-26T23:00:00.000Z", "git status", cwd="/old", git_branch="old-branch"),
                user_tool_result("2026-08-26T23:00:01.000Z", "toolu_1", "ok", cwd="/new", git_branch="new-branch"),
            ],
        )
        result = git_events.scan_session([self.path])
        self.assertEqual(result["cwd"], "/new")
        self.assertEqual(result["gitBranch"], "new-branch")

    def test_events_from_multiple_files_are_merged_and_sorted_by_ts(self):
        path_a = os.path.join(self.tmp.name, "a.jsonl")
        path_b = os.path.join(self.tmp.name, "b.jsonl")
        write_jsonl(path_a, [pr_link("2026-08-26T23:30:00.000Z")])
        write_jsonl(
            path_b,
            [
                assistant_bash("2026-08-26T23:00:00.000Z", "git push", tool_id="toolu_2"),
                user_tool_result("2026-08-26T23:00:01.000Z", "toolu_2", "ok"),
            ],
        )
        result = git_events.scan_session([path_a, path_b])
        self.assertEqual([e["type"] for e in result["events"]], ["push", "pr"])

    def test_malformed_lines_are_skipped_without_crashing(self):
        with open(self.path, "w") as f:
            f.write("not json\n")
            f.write(json.dumps(pr_link("2026-08-26T23:28:07.969Z")) + "\n")
            f.write("{\n")  # truncated JSON
        result = git_events.scan_session([self.path])
        self.assertEqual(len(result["events"]), 1)
        self.assertEqual(result["events"][0]["type"], "pr")

    def test_unreadable_file_is_skipped_without_crashing(self):
        result = git_events.scan_session([os.path.join(self.tmp.name, "missing.jsonl")])
        self.assertEqual(result, {"cwd": None, "gitBranch": None, "events": []})


if __name__ == "__main__":
    unittest.main()
