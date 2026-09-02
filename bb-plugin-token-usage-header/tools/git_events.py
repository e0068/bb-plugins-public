#!/usr/bin/env python3
"""Git-related facts mined from raw Claude Code transcript records.

Isolated from tools/tokens.py's usage-counting concern on purpose:
tokens.walk() only ever yields assistant records that carry token usage —
it never looks at pr-link records or Bash tool_use blocks, and shouldn't
have to just to support this unrelated overlay. This module reads the SAME
files (the caller passes the same list tokens._session_files already
builds) for a completely different set of record types.

Commits themselves are NOT extracted here: a commit's hash only shows up in
a transcript when the agent happened to print it afterwards (e.g. a follow-up
`git log -1 --oneline`) — not guaranteed on every commit. The service layer
(src/service/threads-timeline-service.ts) gets commits from a live `git log`
instead, using the cwd/gitBranch this module returns.
"""
import json

# Substring match, not a strict command parse: transcripts write real shell
# scripts (heredocs, `cd ... && git push ...`, piped through `tail`), and a
# tool call's `command` is never something a user types by hand — a plain
# substring is precise enough for this codebase's own command style, and a
# stray false positive here only adds a bonus marker, never removes one.
PUSH_COMMAND_MARKER = "git push"

# The dangerous-git hook's own wording (see ~/.claude/hooks/block-dangerous-git.sh
# in this user's setup) marks a blocked attempt with "BLOCKED" in the tool
# result text — matched loosely (not tied to that one hook's exact message)
# so any PreToolUse hook that blocks the command is recognized the same way.
BLOCKED_MARKER = "BLOCKED"


def _tool_use_blocks(record):
    if record.get("type") != "assistant":
        return []
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, list):
        return []
    return [b for b in content if isinstance(b, dict) and b.get("type") == "tool_use"]


def _tool_result_blocks(record):
    if record.get("type") != "user":
        return []
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, list):
        return []
    return [b for b in content if isinstance(b, dict) and b.get("type") == "tool_result"]


def _result_text(tool_result_block):
    """A tool_result block's content, flattened to plain text for a substring check."""
    content = tool_result_block.get("content")
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict))
    if isinstance(content, str):
        return content
    return ""


def _pr_event(record):
    if record.get("type") != "pr-link":
        return None
    ts = record.get("timestamp")
    number = record.get("prNumber")
    url = record.get("prUrl")
    repository = record.get("prRepository")
    if not (isinstance(ts, str) and isinstance(number, int) and isinstance(url, str) and isinstance(repository, str)):
        return None
    return {"type": "pr", "ts": ts, "number": number, "url": url, "repository": repository}


def scan_session(paths):
    """Scans one session's raw transcript files for git-relevant facts.

    `paths` is the same file list tokens._session_files(project_dir, session)
    already builds (main transcript + subagents/workflow helpers) — this
    function doesn't discover files on its own, it only reads what it's given.

    Returns {"cwd": str|None, "gitBranch": str|None, "events": [...]}:
    - cwd/gitBranch come from whichever scanned record carries both fields
      and has the latest timestamp (ISO 8601 strings sort chronologically as
      plain strings) — a session's working directory/branch rarely changes,
      but "most recent" is the closest thing to "current" if it ever does.
    - events is pr + push facts, sorted by ts. A "pr" event comes straight
      from a pr-link record. A "push" event comes from a Bash tool_use whose
      command contains PUSH_COMMAND_MARKER, paired with its own tool_result —
      only kept when that result does NOT report the attempt as blocked (a
      blocked push never happened, showing it as an event would be a lie).

    Malformed lines/records are skipped silently, mirroring tokens.py's own
    leniency (see tokens.walk) — this is a bonus overlay on the chart, not
    something a single corrupt line should ever crash.
    """
    cwd = None
    git_branch = None
    latest_context_ts = None
    # tool_use id -> {"ts", "branch"} for a Bash `git push` call whose
    # tool_result hasn't been seen yet. Always resolved within the SAME file
    # (a tool call and its result live in the same agent's transcript), so
    # this only needs to survive across lines of one file at a time.
    pending_push = {}
    events = []

    for path in sorted(paths):
        try:
            with open(path, errors="ignore") as fh:
                lines = fh.readlines()
        except OSError:
            continue

        pending_push.clear()
        for line in lines:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if not isinstance(rec, dict):
                continue

            ts = rec.get("timestamp")
            rec_cwd = rec.get("cwd")
            rec_branch = rec.get("gitBranch")
            if isinstance(ts, str) and isinstance(rec_cwd, str) and isinstance(rec_branch, str):
                if latest_context_ts is None or ts >= latest_context_ts:
                    latest_context_ts = ts
                    cwd = rec_cwd
                    git_branch = rec_branch

            pr_event = _pr_event(rec)
            if pr_event is not None:
                events.append(pr_event)
                continue

            for block in _tool_use_blocks(rec):
                if block.get("name") != "Bash":
                    continue
                command = (block.get("input") or {}).get("command")
                tool_id = block.get("id")
                if isinstance(command, str) and PUSH_COMMAND_MARKER in command and tool_id:
                    pending_push[tool_id] = {
                        "ts": ts if isinstance(ts, str) else None,
                        "branch": rec_branch if isinstance(rec_branch, str) else None,
                    }

            if pending_push:
                for block in _tool_result_blocks(rec):
                    tool_id = block.get("tool_use_id")
                    candidate = pending_push.pop(tool_id, None) if tool_id else None
                    if candidate is None or candidate["ts"] is None:
                        continue
                    if BLOCKED_MARKER in _result_text(block):
                        continue
                    # url starts null: this module never knows the GitHub
                    # repo slug for a plain push (there's no pr-link-style
                    # record for it) — src/service/threads-timeline-service.ts
                    # fills it in once it resolves the thread's repo slug
                    # for its commit links, same slug, same tree.
                    events.append({"type": "push", "ts": candidate["ts"], "branch": candidate["branch"], "url": None})

    events.sort(key=lambda e: e["ts"])
    return {"cwd": cwd, "gitBranch": git_branch, "events": events}
