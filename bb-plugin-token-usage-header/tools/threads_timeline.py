#!/usr/bin/env python3
"""Thread feed: the last N Claude Code sessions, laid out into time bins.

Reuses tools/tokens.py (walk(), Bucket, _session_files, _file_mtime,
JsonAwareParser) for the actual token counting — this module only handles
selecting the "last N sessions" and laying their usage records out into
fixed-size bins, and within a bin, by agent (main agent gets key "main",
subagents get their agentId, same as tokens.py --by agent).
"""
import json, os, sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tokens  # noqa: E402
import git_events  # noqa: E402

# Version of this script's --json report format. Separate from
# tokens.SCHEMA_VERSION — different contracts, different consumers
# (src/core/threads-timeline.ts checks this exact version). Bump on any
# breaking format change.
# 1 -> 2: added the top-level agentLabels field (human-readable agent names
# keyed by their key from bins) — the report shape expanded.
# 2 -> 3: a thread gained totalCost (usage cost in USD, priced per
# tokens.py) and workflowCount (number of distinct workflow runs in the
# session).
# 3 -> 4: a bin's workflow segment (agents[].key == "workflow:<run>", only
# under --group-workflows) gained members — a sorted list of the real
# agentIds merged into this segment; a regular (non-workflow) agent has no
# such field.
#
# 4 -> 5: a thread gained cwd/gitBranch (its working directory and git
# branch, for the chart's commit-marker enrichment on the TS side — see
# git_events.scan_session) and events (pr/push facts mined from its own
# transcript by the same function; commit events are appended later, by
# src/service/threads-timeline-service.ts, not by this script).
SCHEMA_VERSION = 5

# Truncation threshold for meta.description in agentLabels — the legend and
# labels in the UI aren't elastic, a long task description would break the
# chip/tooltip layout.
LABEL_DESCRIPTION_LIMIT = 60


def _session_main_files(root, project=None, session=None):
    """Main session .jsonl files (no subagents) across project directories.

    Returns a list of (sessionId, project, path, mtime) — one record per
    session, so "the last N by activity" can be selected BEFORE reading
    file contents. mtime is an approximation of "the transcript's last
    activity" (the same assumption as in tokens.py::_filter_by_since).
    """
    if not os.path.isdir(root):
        return []
    try:
        entries = os.listdir(root)
    except OSError:
        return []
    project_dirs = [os.path.join(root, d) for d in entries if os.path.isdir(os.path.join(root, d))]
    if project:
        project_dirs = [d for d in project_dirs if project in os.path.basename(d)]

    out = []
    for pd in project_dirs:
        try:
            names = os.listdir(pd)
        except OSError:
            continue
        for name in names:
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(pd, name)
            if not os.path.isfile(path):
                continue
            sid = name[: -len(".jsonl")]
            if session is not None and sid != session:
                continue
            mtime = tokens._file_mtime(path)
            out.append((sid, os.path.basename(pd), path, mtime.timestamp() if mtime else 0))
    return out


def _bin_start_epoch(epoch, unit):
    return (int(epoch) // unit) * unit


def _epoch(ts):
    """A record's timestamp (see tokens.walk) -> unix seconds, or None.

    Lenient parsing (as in walk() itself): a malformed/missing timestamp is
    not a user error, the record simply doesn't land in any bin.
    """
    dt = tokens._parse_time_bound(ts)
    return dt.timestamp() if dt else None


def _iso_from_epoch(epoch):
    """unix seconds -> ISO 8601 UTC with milliseconds. Same format as tokens.iso()."""
    dt = datetime.fromtimestamp(epoch, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _truncate(s, limit=LABEL_DESCRIPTION_LIMIT):
    s = s.strip()
    if len(s) <= limit:
        return s
    return s[:limit].rstrip() + "…"


def _agent_label(agent_key, meta):
    """Human-readable agent label for agentLabels.

    "main" -> the fixed label "Main agent", not tied to meta (the main
    agent's meta is always None, see tokens.walk). For a subagent —
    meta.description (truncated), else meta.agentType, else the key itself
    as a fallback — the same priority ladder as agent_timeline.py::_header.
    """
    if agent_key == "main":
        return "Main agent"
    if meta:
        desc = meta.get("description")
        if desc:
            return _truncate(desc)
        atype = meta.get("agentType")
        if atype:
            return atype
    return agent_key


def _workflow_name(root, project, session, run_id):
    """Human-readable workflow name for its run_id.

    The run's script lives in `<project>/<session>/workflows/scripts/` and
    is named `<name>-<run_id>.js` (see the actual transcript layout) — the
    name is obtained by stripping the `-<run_id>.js` suffix. If the script
    is missing/the directory is unavailable — the run_id itself as a
    fallback (better to show the id than nothing).
    """
    scripts_dir = os.path.join(root, project, session, "workflows", "scripts")
    suffix = "-" + run_id + ".js"
    try:
        for name in os.listdir(scripts_dir):
            if name.endswith(suffix):
                return name[: -len(suffix)]
    except OSError:
        pass
    return run_id


def _bin_key(rec, group_workflows):
    """Bin segment key for a record.

    By default — the subagent's agentId ("main" for the main agent). Under
    group_workflows, all agents of one workflow run merge into a single
    `workflow:<run>` segment — so on the session page, a group of agents
    raised by one Workflow renders as a single segment (see agentLabels:
    there the key carries the workflow's name).
    """
    wf = rec["workflowRunId"]
    if group_workflows and wf:
        return "workflow:" + wf
    return rec["agentId"] or "main"


def build_timeline(root, limit=20, unit=300, project=None, session=None, group_workflows=False):
    """Builds the feed of the last `limit` sessions, laid out into `unit`-second bins.

    Doesn't redefine the usage-counting logic — every usage record from
    tokens.walk() is counted exactly once (dedup is already done in
    walk()), so the sum of total over a session's bins equals its full
    usage.

    Returns {"threads": [...], "agentLabels": {...}} — agentLabels is
    top-level (not per-thread): the same agentId across different threads
    (e.g. a repeated call to the same workflow agent) gets a single label.
    """
    sessions = _session_main_files(root, project=project, session=session)
    # the last N sessions by the transcript's last activity, freshest first
    sessions.sort(key=lambda row: row[3], reverse=True)
    sessions = sessions[: max(limit, 0)]

    project_dirs = {}
    # session id -> project dir basename (under `root`). Needed for
    # _workflow_name: rec["project"] from walk() is a relpath from the
    # global tokens.ROOT, not from the passed-in root, and it's wrong when
    # root != ROOT (tests).
    sid_to_proj = {}
    for _sid, proj, _path, _mtime in sessions:
        project_dirs.setdefault(proj, os.path.join(root, proj))
        sid_to_proj[_sid] = proj

    files = []
    # Kept per-session (not just flattened into `files`) so git_events.scan_session
    # can be run once per session below — it needs exactly one session's own
    # files, not the whole slice's.
    session_files = {}
    for sid, proj, _path, _mtime in sessions:
        sfiles = tokens._session_files(project_dirs[proj], sid)
        session_files[sid] = sfiles
        files.extend(sfiles)

    records_by_session = defaultdict(list)
    # agent_key -> label, populated from the meta of the FIRST record seen for
    # that key (across all sessions in this slice) — meta is the same for
    # every record of a given agent-<id>.jsonl file (one meta.json per agent
    # invocation), so which record "wins" doesn't change the label.
    agent_labels = {}
    for rec in tokens.walk(files):
        records_by_session[rec["session"]].append(rec)
        key = _bin_key(rec, group_workflows)
        if key not in agent_labels:
            if group_workflows and rec["workflowRunId"]:
                proj = sid_to_proj.get(rec["session"], rec["project"])
                agent_labels[key] = _workflow_name(root, proj, rec["session"], rec["workflowRunId"])
            else:
                agent_labels[key] = _agent_label(key, rec["meta"])

    threads = []
    for sid, proj, _path, _mtime in sessions:
        recs = records_by_session.get(sid, [])

        # bin_epoch -> agent_key -> Bucket. Bucket is reused from tokens.py,
        # so the total formula (inp+cacheWrite+cacheRead+out) isn't
        # duplicated and doesn't drift from the one tokens.py already applies.
        bin_buckets = defaultdict(lambda: defaultdict(tokens.Bucket))
        # bin_epoch -> workflow agent_key -> a set of the real agentIds
        # merged into this segment (see _bin_key: under group_workflows all
        # agents of one run collapse into "workflow:<run>," and the real
        # membership would otherwise be lost entirely — the frontend
        # couldn't tell whether a selected agent participated in this
        # segment, for highlighting/dimming on the session chart).
        # Populated only for workflow keys — for a regular agent, key is
        # already its real id, nothing to duplicate.
        bin_members = defaultdict(lambda: defaultdict(set))
        epochs = []
        for rec in recs:
            epoch = _epoch(rec["ts"])
            if epoch is None:
                continue
            epochs.append(epoch)
            bin_epoch = _bin_start_epoch(epoch, unit)
            agent_key = _bin_key(rec, group_workflows)
            bin_buckets[bin_epoch][agent_key].add(rec["usage"], rec["model"], rec["ts"])
            if agent_key.startswith("workflow:"):
                bin_members[bin_epoch][agent_key].add(rec["agentId"] or "main")

        if not epochs:
            # A session without a single valid usage record carries no data
            # for the feed (nothing to compute start/end/duration from) —
            # it's skipped, rather than emitted with fake zeros.
            continue

        start_epoch = min(epochs)
        end_epoch = max(epochs)

        # Continuous feed: one bin per EVERY time unit of the [start, end]
        # interval, including empty ones (no activity). Otherwise the number
        # of columns would depend on activity density rather than duration,
        # and a thread that ran longer but with sparse bursts would look
        # narrower than a dense short one. The frontend renders empty bins
        # with a "no activity" label.
        start_bin = _bin_start_epoch(start_epoch, unit)
        end_bin = _bin_start_epoch(end_epoch, unit)
        bins_out = []
        for bin_epoch in range(start_bin, end_bin + unit, unit):
            agents = bin_buckets.get(bin_epoch)
            members_by_key = bin_members.get(bin_epoch, {})
            agents_out = []
            if agents:
                for k, b in agents.items():
                    entry = {"key": k, "total": b.total}
                    members = members_by_key.get(k)
                    if members:
                        entry["members"] = sorted(members)
                    agents_out.append(entry)
                agents_out.sort(key=lambda a: (-a["total"], a["key"]))
            bins_out.append({"t": _iso_from_epoch(bin_epoch), "agents": agents_out})

        total_tokens = sum(a["total"] for bo in bins_out for a in bo["agents"])
        # Cost is computed from the same Buckets as tokens (one tier, one
        # formula) — the sum over buckets equals the thread's full cost,
        # just as total_tokens equals the sum of b.total.
        total_cost = round(sum(b.cost for agents in bin_buckets.values() for b in agents.values()), 2)
        # Distinct workflow runs in the session: the agentId of a subagent
        # launched within a workflow carries workflowRunId (see
        # tokens.walk); a regular thread without a workflow gives an empty
        # set -> 0.
        workflow_count = len({r["workflowRunId"] for r in recs if r["workflowRunId"]})

        git_info = git_events.scan_session(session_files.get(sid, []))

        threads.append(
            {
                "session": sid,
                "project": proj,
                # a human-readable name will be filled in by the service (src/service) later
                "title": sid,
                "start": _iso_from_epoch(start_epoch),
                "end": _iso_from_epoch(end_epoch),
                "durationSec": end_epoch - start_epoch,
                "totalTokens": total_tokens,
                "totalCost": total_cost,
                "workflowCount": workflow_count,
                "bins": bins_out,
                "cwd": git_info["cwd"],
                "gitBranch": git_info["gitBranch"],
                "events": git_info["events"],
            }
        )

    return {"threads": threads, "agentLabels": agent_labels}


def main():
    ap = tokens.JsonAwareParser()
    ap.add_argument("--json", action="store_true", help="print a single JSON object instead of a table")
    ap.add_argument("--limit", type=int, default=20, help="how many of the most recent sessions to take")
    ap.add_argument("--unit", type=int, required=True, help="bin size in seconds")
    ap.add_argument("--project", help="substring of the project path")
    ap.add_argument("--session", help="exact session id (single-session page); overrides recency selection")
    ap.add_argument("--group-workflows", action="store_true", help="merge agents of one workflow run into a single segment")
    a = ap.parse_args()

    if a.limit < 0:
        ap.error("--limit cannot be negative")
    if a.unit <= 0:
        ap.error("--unit must be a positive number of seconds")

    result = build_timeline(
        tokens.ROOT, limit=a.limit, unit=a.unit, project=a.project, session=a.session, group_workflows=a.group_workflows
    )
    out = {"schemaVersion": SCHEMA_VERSION, "unit": a.unit, **result}

    if a.json:
        print(json.dumps(out, ensure_ascii=False))
        return

    print(f"{'session':<10} {'project':<40} {'tokens':>10} {'sec':>8}")
    print("-" * 70)
    for t in result["threads"]:
        print(f"{t['session'][:8]:<10} {t['project'][:40]:<40} {t['totalTokens']:>10} {t['durationSec']:>8.0f}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if "--json" in sys.argv:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            sys.exit(1)
        raise
