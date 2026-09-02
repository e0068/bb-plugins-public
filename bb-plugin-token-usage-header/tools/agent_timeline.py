#!/usr/bin/env python3
"""Timeline of a single agent invocation (main agent or subagent) from
Claude Code transcripts (~/.claude/projects).

Source — the same ROOT as tools/tokens.py: `sys.path.insert` on our own
directory plus `import tokens` reuse its ROOT/JsonAwareParser/load_meta
instead of duplicating them here.
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tokens import ROOT, Bucket, JsonAwareParser, load_meta, _session_files  # noqa: E402
import git_events  # noqa: E402

# Version of the --json report format. Bump on ANY breaking format change —
# src/core/agent-timeline.ts checks it first, the same way parse.ts does for
# tools/tokens.py (see memory/decisions/token-usage-json-schema-version.md,
# the same approach applied here for the new script).
#
# 1 -> 2: assistant messages carry tokens/cost (owner's decision: cost is
# accounted per model call, not per tool-use line) — see
# memory/decisions/token-usage-cost-on-messages.md.
#
# 2 -> 3: agent carries requestFull/requestFullTruncated/responseFull/
# responseFullTruncated — the untruncated (up to FULL_TEXT_MAX) text of the
# agent's request and response, to show in full in the UI on top of the
# short preview fragments in events[].text.
#
# 3 -> 4: every message event carries fullText/fullTextTruncated — the full
# text of THAT message (not just the first/last one), so expanding any
# timeline row shows it in full, not a 300-character preview.
#
# 4 -> 5: the report gained a top-level prNumbers field — {"number",
# "repository"} pairs for every PR referenced anywhere in the session's own
# transcript (main + subagents), from git_events.scan_session. The service
# layer (src/service/agent-timeline-service.ts) uses it to look up each PR's
# live merge status via `gh pr view` — see the "merge" marker on the session
# page's chart, which (unlike commit/push/pr) is only ever fetched here, not
# in the feed/popup.
SCHEMA_VERSION = 5

# The tools that launch a subagent have appeared under two names across
# different Claude Code versions ("Task" in the docs/spec, "Agent" — what
# current transcripts actually write). Check both, to not depend on a
# specific version.
AGENT_LAUNCH_TOOL_NAMES = ("Task", "Agent")

# Length of the message/prompt text excerpt in an event. The full message
# text can be arbitrarily long (subagent reports run to tens of thousands
# of characters) — the timeline shows a preview, not an archive.
EXCERPT_MAX = 300


def excerpt(text):
    """Truncates text to EXCERPT_MAX characters, appending an ellipsis."""
    if not isinstance(text, str):
        return ""
    s = text.strip()
    if len(s) <= EXCERPT_MAX:
        return s
    return s[: EXCERPT_MAX - 1] + "…"


def tool_target(name, inp):
    """One meaningful argument of a tool call, or None.

    The field list is per specific tool, where it's known which argument is
    meaningful; for tools outside the list — a generic parse over a few
    common field names, so target isn't left empty for no reason.
    """
    if not isinstance(inp, dict):
        return None
    if name in ("Read", "Edit", "Write"):
        v = inp.get("file_path")
        return v if isinstance(v, str) and v else None
    if name in ("Glob", "Grep"):
        v = inp.get("pattern")
        return v if isinstance(v, str) and v else None
    if name == "Bash":
        v = inp.get("command")
        return v if isinstance(v, str) and v else None
    if name == "Skill":
        v = inp.get("skill") or inp.get("command") or inp.get("name")
        return v if isinstance(v, str) and v else None
    if name in AGENT_LAUNCH_TOOL_NAMES:
        v = inp.get("description") or inp.get("subagent_type")
        return v if isinstance(v, str) and v else None
    for key in ("file_path", "pattern", "command", "description", "url", "path"):
        v = inp.get(key)
        if isinstance(v, str) and v:
            return v
    return None


def tool_events(record):
    """tool_use blocks of one assistant record -> a list of kind="tool" events."""
    if record.get("type") != "assistant":
        return []
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, list):
        return []
    ts = record.get("timestamp")
    out = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        name = block.get("name")
        if not name:
            continue
        out.append({"ts": ts, "kind": "tool", "name": name, "target": tool_target(name, block.get("input"))})
    return out


def hook_event(record):
    """attachment.type=="hook_success" -> a kind="hook" event, otherwise None."""
    if record.get("type") != "attachment":
        return None
    attachment = record.get("attachment")
    if not isinstance(attachment, dict) or attachment.get("type") != "hook_success":
        return None
    return {
        "ts": record.get("timestamp"),
        "kind": "hook",
        "hookName": attachment.get("hookName"),
        "hookEvent": attachment.get("hookEvent"),
    }


def _is_real_user_message(record, own_file=False):
    """A real human message, not a tool_result/meta record/slash command.

    Most type=="user" records in a transcript are tool_result (a tool's
    reply fed back to the model): their message.content is a LIST of
    blocks. A real user message has a content STRING. isMeta filters out
    system-injected records everywhere; "<local-command-stdout>" is
    slash-command output, which the transcript also wraps in a user record
    with string content, but isMeta isn't set there, so it's checked
    separately, by text.

    isSidechain filters out subagent records MIXED INTO the main
    transcript (the session sees the whole side branch) — but only there:
    `own_file=True` says that `record` came from the subagent's OWN file
    (`<session>/subagents/**/agent-<id>.jsonl`), where isSidechain is set
    to `True` on literally every line (it's a marker that "the whole file
    is a sidechain," not "this message is internal"). Without own_file,
    the filter there would drop every agent message, including the very
    first prompt it was launched with — the real case that caught this: a
    workflow-run agent showed 0 text events despite 194 events in the
    timeline.
    """
    if record.get("type") != "user":
        return False
    if record.get("isMeta"):
        return False
    if record.get("isSidechain") and not own_file:
        return False
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, str):
        return False
    if content.lstrip().startswith("<local-command-stdout>"):
        return False
    return True


def _assistant_text(record, own_file=False):
    """Text of an assistant record (text blocks joined), or None.

    own_file — see _is_real_user_message: same meaning, same reason.
    """
    if record.get("type") != "assistant":
        return None
    if record.get("isMeta"):
        return None
    if record.get("isSidechain") and not own_file:
        return None
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, list):
        return None
    text = "".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    text = text.strip()
    return text or None


def _message_usage(record):
    """A Bucket with a single assistant message's usage record, or None.

    Pricing uses the same tokens.Bucket.add/.total/.cost that tools/tokens.py
    uses to count whole sessions/buckets; here it's just called on a single
    usage record instead of many, rather than being reinvented.
    """
    message = record.get("message") or {}
    usage = message.get("usage")
    if not isinstance(usage, dict):
        return None
    b = Bucket()
    b.add(usage, message.get("model"), record.get("timestamp"))
    return b


def message_event(record, own_file=False):
    """A real message (human or assistant) -> a kind="message" event.

    Owner's decision: cost is accounted per model call (the whole
    assistant record), not spread across its individual tool_use blocks —
    that's why tokens/cost appear here, not in tool_events. User messages
    have no price: they're not a model call, but input to one.

    own_file — see _is_real_user_message: True when `record` came from the
    subagent's own file, not from the session's main transcript.

    Carries both a preview (`text`, truncated to EXCERPT_MAX — for the row
    in the list) and the full text (`fullText`, truncated to the far more
    generous FULL_TEXT_MAX — to expand a specific record and read it in
    full, not just the agent's first request/last response like
    agent.requestFull/responseFull).
    """
    ts = record.get("timestamp")
    if _is_real_user_message(record, own_file=own_file):
        raw = ((record.get("message") or {}).get("content") or "").strip()
        full_text, full_truncated = truncate_full(raw)
        return {
            "ts": ts,
            "kind": "message",
            "role": "user",
            "text": excerpt(raw),
            "fullText": full_text,
            "fullTextTruncated": full_truncated,
        }
    text = _assistant_text(record, own_file=own_file)
    if text is not None:
        full_text, full_truncated = truncate_full(text)
        event = {
            "ts": ts,
            "kind": "message",
            "role": "assistant",
            "text": excerpt(text),
            "fullText": full_text,
            "fullTextTruncated": full_truncated,
        }
        bucket = _message_usage(record)
        if bucket is not None:
            event["tokens"] = bucket.total
            event["cost"] = round(bucket.cost, 2)
        return event
    return None


# Length of the full (not a preview, like EXCERPT_MAX) text of the agent's
# request/response — enough to read the real prompt/response in full, but
# with a ceiling so a huge transcript doesn't bloat the RPC's JSON response
# without a bound.
FULL_TEXT_MAX = 20_000


def truncate_full(text):
    """Truncates text to FULL_TEXT_MAX characters -> (text, was it truncated)."""
    if len(text) <= FULL_TEXT_MAX:
        return text, False
    return text[:FULL_TEXT_MAX], True


def full_request(records, own_file=False):
    """Full text of the first real user message -> (text, truncated) or (None, False).

    Same condition as message_event/_is_real_user_message (own_file has the
    same meaning, see there), but without excerpt() truncation — this is the
    input the agent was launched with, in full.
    """
    for record in records:
        if _is_real_user_message(record, own_file=own_file):
            text = ((record.get("message") or {}).get("content") or "").strip()
            return truncate_full(text) if text else (None, False)
    return None, False


def full_response(records, own_file=False):
    """Full text of the last assistant message -> (text, truncated) or (None, False).

    The last assistant record wins, including an empty one: a transcript
    that cuts off on a bare tool_use (no text block) gives None, not a
    stale earlier response — the same approach message_event/
    _assistant_text already use for the preview, here applied to the full
    text. own_file has the same meaning as in _assistant_text.
    """
    response = None
    for record in records:
        if record.get("type") != "assistant":
            continue
        if record.get("isMeta"):
            continue
        if record.get("isSidechain") and not own_file:
            continue
        response = _assistant_text(record, own_file=own_file)
    return truncate_full(response) if response else (None, False)


def read_records(path):
    """Reads .jsonl line by line, dropping unreadable lines. [] on I/O error."""
    records = []
    try:
        with open(path, errors="ignore") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if isinstance(d, dict):
                    records.append(d)
    except OSError:
        return []
    return records


def extract_events(records, own_file=False):
    """All transcript events, chronologically by ts (records without ts go last).

    own_file — see _is_real_user_message: True for records from a
    subagent's own file, where isSidechain is set on every record and must
    not drop its text.
    """
    events = []
    for record in records:
        events.extend(tool_events(record))
        hook = hook_event(record)
        if hook:
            events.append(hook)
        message = message_event(record, own_file=own_file)
        if message:
            events.append(message)
    events.sort(key=lambda e: e["ts"] or "")
    return events


def find_task_prompt(main_records, tool_use_id):
    """Prompt excerpt from the tool_use block (Task/Agent) that launched a subagent.

    Matched by the block's id, not by the tool's name ("Task" in the spec,
    "Agent" in real transcripts — see AGENT_LAUNCH_TOOL_NAMES) — the id is
    unambiguous regardless of what the tool is called in this version.
    """
    if not tool_use_id:
        return None
    for record in main_records:
        if record.get("type") != "assistant":
            continue
        content = (record.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            if block.get("id") != tool_use_id:
                continue
            prompt = (block.get("input") or {}).get("prompt")
            return excerpt(prompt) if isinstance(prompt, str) else None
    return None


def find_session(root, session):
    """Project directory and full session id for a (possibly partial) session.

    Matched against the start of the `<id>.jsonl` filename, like
    _session_files in tools/tokens.py. On multiple matches, the first one
    in sorted order wins — deterministic, without consulting mtime.
    """
    if not os.path.isdir(root):
        return None, None
    try:
        project_names = sorted(os.listdir(root))
    except OSError:
        return None, None

    for name in project_names:
        project_dir = os.path.join(root, name)
        if not os.path.isdir(project_dir):
            continue
        try:
            entries = sorted(os.listdir(project_dir))
        except OSError:
            continue
        for entry in entries:
            if entry.endswith(".jsonl") and entry[: -len(".jsonl")].startswith(session):
                return project_dir, entry[: -len(".jsonl")]
    return None, None


def find_agent_file(project_dir, full_session, agent):
    """Path to a subagent's transcript under `<session>/subagents/`.

    Doesn't always live directly in that directory: subagents of workflow
    runs are written one level deeper, in
    `subagents/workflows/<runId>/agent-<hash>.jsonl` (see `_session_files`
    in tools/tokens.py — same case, same approach: recursive glob). The
    direct check comes first — the common case, without walking the tree;
    `sorted()` gives a deterministic pick if there happen to be more than
    one match (shouldn't happen: an agent hash is unique).
    """
    subagents_dir = os.path.join(project_dir, full_session, "subagents")
    direct = os.path.join(subagents_dir, f"{agent}.jsonl")
    if os.path.exists(direct):
        return direct
    matches = sorted(glob.glob(os.path.join(subagents_dir, "**", f"{agent}.jsonl"), recursive=True))
    return matches[0] if matches else direct


def build_timeline(root, session, agent):
    """Builds {schemaVersion, agent, events} for one (session, agent)."""
    project_dir, full_session = find_session(root, session)
    if project_dir is None:
        raise RuntimeError(f"Session not found: {session!r}")

    main_path = os.path.join(project_dir, f"{full_session}.jsonl")
    main_records = read_records(main_path)

    if agent == "main":
        events = extract_events(main_records)
        request, request_truncated = full_request(main_records)
        response, response_truncated = full_response(main_records)
        agent_info = {
            "key": "main",
            "agentType": None,
            "description": None,
            "model": None,
            "spawnDepth": None,
            "promptExcerpt": None,
            "requestFull": request,
            "requestFullTruncated": request_truncated,
            "responseFull": response,
            "responseFullTruncated": response_truncated,
        }
    else:
        agent_path = find_agent_file(project_dir, full_session, agent)
        agent_records = read_records(agent_path)
        # own_file=True: in a subagent's own file, isSidechain is set on
        # EVERY record (it's a marker that "the whole file is a side
        # branch," not "this message is internal") — without own_file,
        # _is_real_user_message/_assistant_text would drop the agent's
        # entire text, including its own prompt. See the discussion in
        # _is_real_user_message.
        events = extract_events(agent_records, own_file=True)
        meta = load_meta(agent_path) or {}
        # From the agent's OWN transcript (agent_records), not from
        # main_records like promptExcerpt/find_task_prompt: subagents of
        # workflow runs have no toolUseId in meta.json (they're launched
        # not by a Task/Agent block in the main transcript, but by the
        # workflow engine itself) — find_task_prompt always gives None for
        # them. The first real user record in the agent's own transcript,
        # however, is always present (it's the agent's assignment), so
        # requestFull works even where promptExcerpt can't.
        request, request_truncated = full_request(agent_records, own_file=True)
        response, response_truncated = full_response(agent_records, own_file=True)
        agent_info = {
            "key": agent,
            "agentType": meta.get("agentType"),
            "description": meta.get("description"),
            "model": meta.get("model"),
            "spawnDepth": meta.get("spawnDepth"),
            "promptExcerpt": find_task_prompt(main_records, meta.get("toolUseId")),
            "requestFull": request,
            "requestFullTruncated": request_truncated,
            "responseFull": response,
            "responseFullTruncated": response_truncated,
        }

    # Session-wide (not per-agent): a PR referenced by ANY agent in this
    # session — main or a subagent that ran `gh pr create` — is relevant to
    # the session chart's merge marker regardless of which agent's own
    # timeline is being viewed. _session_files gives the same main+subagents
    # file set threads_timeline.py scans (see its own git_events.scan_session
    # call) — a distinct call here because that script's per-thread pass
    # isn't reachable from this one.
    session_files = _session_files(project_dir, full_session)
    git_info = git_events.scan_session(session_files)
    seen_numbers = set()
    pr_numbers = []
    for event in git_info["events"]:
        if event["type"] != "pr" or event["number"] in seen_numbers:
            continue
        seen_numbers.add(event["number"])
        pr_numbers.append({"number": event["number"], "repository": event["repository"]})
    pr_numbers.sort(key=lambda p: p["number"])

    return {"schemaVersion": SCHEMA_VERSION, "agent": agent_info, "events": events, "prNumbers": pr_numbers}


def main():
    ap = JsonAwareParser()
    ap.add_argument("--session", required=True, help="session id (a prefix is allowed)")
    ap.add_argument("--agent", default="main", help='"main" or "agent-<hash>"')
    ap.add_argument("--json", action="store_true", help="print JSON instead of text")
    a = ap.parse_args()

    out = build_timeline(ROOT, a.session, a.agent)

    if a.json:
        print(json.dumps(out, ensure_ascii=False))
        return

    agent_info = out["agent"]
    header = agent_info["key"]
    if agent_info["description"]:
        header += f" — {agent_info['description']}"
    print(header)
    print("-" * min(len(header), 100))
    for event in out["events"]:
        if event["kind"] == "tool":
            line = f"[{event['ts']}] tool  {event['name']}"
            if event["target"]:
                line += f": {event['target']}"
        elif event["kind"] == "hook":
            line = f"[{event['ts']}] hook  {event['hookName']} ({event['hookEvent']})"
        else:
            line = f"[{event['ts']}] {event['role']:<9} {event['text']}"
        print(line)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        args_has_json = "--json" in sys.argv
        if args_has_json:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            sys.exit(1)
        raise
