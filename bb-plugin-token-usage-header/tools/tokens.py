#!/usr/bin/env python3
"""Token counter over Claude Code transcripts (~/.claude/projects).

Breakdowns: session, subagent, workflow run, model, time window.
Source of truth — the message.usage field in each assistant record.
"""
import json, os, re, sys, glob, argparse
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/.claude/projects")

# Version of the --json report format. Bump on ANY breaking format change
# (a new required field, a changed type/name of an existing one) — src/core/parse.ts
# checks it first and on mismatch tells the user to rebuild the plugin instead
# of complaining about a data field. See memory/decisions/token-usage-json-schema-version.md.
SCHEMA_VERSION = 2

# A bare calendar date without time, as accepted by --since/--until.
_DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# base price per 1M tokens, USD: input / output (Anthropic API pricing)
PRICES = {
    "fable":  (10.00, 50.00),
    "opus":   ( 5.00, 25.00),
    "sonnet": ( 3.00, 15.00),
    "haiku":  ( 1.00,  5.00),
}
# multipliers on the input price: 5-minute cache write, 1-hour cache write, cache read
CACHE_5M, CACHE_1H, CACHE_READ = 1.25, 2.00, 0.10

def tier(model):
    m = (model or "").lower()
    for k in PRICES:
        if k in m:
            return k
    return "sonnet"

FIELDS = ("inp", "cw5", "cw1h", "cr", "out")


class ModelCounts:
    """Counters for one model within a bucket: how many tokens it accounted for."""
    def __init__(self):
        self.inp = self.cw5 = self.cw1h = self.cr = self.out = 0

    @property
    def total(self):
        return self.inp + self.cw5 + self.cw1h + self.cr + self.out

    def add(self, inp, cw5, cw1h, cr, out):
        self.inp  += inp
        self.cw5  += cw5
        self.cw1h += cw1h
        self.cr   += cr
        self.out  += out

    def merge(self, other):
        for f in FIELDS:
            setattr(self, f, getattr(self, f) + getattr(other, f))


def models_json(models):
    """Breakdown of usage by model tier for JSON output.

    Descending by usage, not alphabetical: the row label is read left to
    right, and the model with the highest usage should come first. On a
    tie, sort by tier name for a deterministic order.
    """
    return [
        {"tier": t, "total": c.total}
        for t, c in sorted(models.items(), key=lambda kv: (-kv[1].total, kv[0]))
    ]


class Bucket:
    def __init__(self):
        self.inp = self.cw5 = self.cw1h = self.cr = self.out = self.think = 0
        self.msgs = 0
        # Breakdown of the same usage by model tier. A bucket is almost never
        # homogeneous: the main agent gets to work with several models within
        # a session, and a single name in the label would pick a winner arbitrarily.
        self.models = defaultdict(ModelCounts)
        self.t0 = self.t1 = None

    def add(self, u, model, ts):
        cc = u.get("cache_creation") or {}
        inp   = u.get("input_tokens", 0)
        cw5   = cc.get("ephemeral_5m_input_tokens", 0)
        cw1h  = cc.get("ephemeral_1h_input_tokens", 0)
        if not cc:
            cw5 += u.get("cache_creation_input_tokens", 0)
        cr    = u.get("cache_read_input_tokens", 0)
        out   = u.get("output_tokens", 0)

        self.inp   += inp
        self.cw5   += cw5
        self.cw1h  += cw1h
        self.cr    += cr
        self.out   += out
        self.think += (u.get("output_tokens_details") or {}).get("thinking_tokens", 0)
        self.msgs  += 1

        self.models[tier(model)].add(inp, cw5, cw1h, cr, out)

        if ts:
            self.t0 = min(self.t0, ts) if self.t0 else ts
            self.t1 = max(self.t1, ts) if self.t1 else ts

    @property
    def total(self):
        return self.inp + self.cw + self.cr + self.out

    @property
    def cw(self):
        return self.cw5 + self.cw1h

    def _tier_prices(self):
        # take the tier from the model that produced the most output in this
        # bucket — this is NOT the same ordering as in "models" (there the
        # order is by total usage, which is dominated by cache reads). The
        # model listed first in "models" and the model whose price we use
        # for cost can differ.
        t = max(self.models, key=lambda k: self.models[k].out) if self.models else "sonnet"
        return PRICES[t]

    @property
    def cost(self):
        pi, po = self._tier_prices()
        return (self.inp*pi + self.cw5*pi*CACHE_5M + self.cw1h*pi*CACHE_1H
                + self.cr*pi*CACHE_READ + self.out*po) / 1e6

    @property
    def cost_parts(self):
        """Cost broken down by token kind, using the same tier pricing as cost.

        input+cacheWrite+cacheRead+output sum up to cost; thinking is part
        of output (priced as output) and is not part of that sum — it's added on top.
        """
        pi, po = self._tier_prices()
        return {
            "input":      self.inp * pi / 1e6,
            "cacheWrite": (self.cw5 * CACHE_5M + self.cw1h * CACHE_1H) * pi / 1e6,
            "cacheRead":  self.cr * pi * CACHE_READ / 1e6,
            "output":     self.out * po / 1e6,
            "thinking":   self.think * po / 1e6,
        }


def merge_buckets(buckets):
    """Merges several buckets into one — for the totals row ("TOTAL").

    Sums both the bucket's plain counters (inp/cw5/.../msgs) and the
    breakdown by model within models — otherwise the totals row would lose
    which tiers the total usage went to.
    """
    grand = Bucket()
    for b in buckets:
        for attr in FIELDS + ("think", "msgs"):
            setattr(grand, attr, getattr(grand, attr) + getattr(b, attr))
        for t, c in b.models.items():
            grand.models[t].merge(c)
    return grand

def _parse_time_bound(s, *, strict=False, end_of_day=False):
    """A boundary string (date or full ISO timestamp) -> aware datetime UTC.

    Empty string/None -> always None: "no boundary set" is a legitimate
    case in both modes.

    By default (strict=False) an unparseable non-empty string also
    silently gives None. This mode is for timestamps on the transcript
    records themselves: a malformed string there is a rare data defect,
    not a user error, and the record simply fails the filter (see walk()).

    strict=True is for user-supplied --since/--until (RPC and manual
    runs). Here a silent None is not acceptable: `datetime.fromisoformat`
    rejects not only "2026-13-45" (parse error) but also calendar dates
    that don't exist, like "2026-02-30" (days-in-month) — but that
    exception used to be swallowed, and the filter would silently
    disappear entirely instead of just skipping one record. strict=True
    raises ValueError instead.

    end_of_day=True anchors a bare calendar date (with no time part) to
    the last microsecond of the day, rather than to its midnight.
    Midnight is earlier than any real record from that day, so
    "--until: the whole such-and-such day" without this adjustment would
    drop the named day entirely (comparison is a strict "later than").
    Full ISO timestamps (not bare dates) don't need this adjustment and
    don't get it.
    """
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError) as e:
        if strict:
            raise ValueError(
                f"Invalid date/time {s!r}: {e}. Expected YYYY-MM-DD or a full ISO timestamp."
            ) from e
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if end_of_day and _DATE_ONLY_RE.match(s):
        dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return dt

def _file_mtime(path):
    """File mtime as an aware datetime UTC, or None if unavailable."""
    try:
        return datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc)
    except OSError:
        return None

def _filter_by_since(files, since):
    """Drops files whose mtime is strictly earlier than the `since` boundary.

    Records within a transcript are in increasing time order, so a file's
    mtime is an upper bound on the times inside it: mtime < since guarantees
    that all records in the file are also earlier than since, and the file
    can be skipped without opening it. mtime >= since guarantees nothing
    (the file could have been touched after its last record) — such a file
    stays in the list.

    `since` has already gone through user input (RPC or console) — parsing
    is strict: a nonexistent calendar date raises ValueError instead of
    silently disabling the filter (see _parse_time_bound).
    """
    since_dt = _parse_time_bound(since, strict=True)
    if since_dt is None:
        return files
    kept = []
    for f in files:
        mtime = _file_mtime(f)
        if mtime is not None and mtime < since_dt:
            continue
        kept.append(f)
    return kept

def _session_files(project_dir, session_prefix):
    """Files for one session (and its subagents/workflow runs) in a project directory.

    The path is predictable: `<project_dir>/<sessionId>.jsonl` — the main transcript,
    `<project_dir>/<sessionId>/subagents/**/*.jsonl` — subagents and helper
    files of workflow runs (agent-*.jsonl, journal.jsonl). session_prefix can
    be a partial id — matched against the start of the name.
    """
    try:
        entries = os.listdir(project_dir)
    except OSError:
        return []

    matched_ids = set()
    files = []
    for name in entries:
        if name.endswith(".jsonl"):
            sid = name[:-len(".jsonl")]
            if sid.startswith(session_prefix):
                files.append(os.path.join(project_dir, name))
                matched_ids.add(sid)
        elif name.startswith(session_prefix):
            full = os.path.join(project_dir, name)
            if os.path.isdir(full):
                matched_ids.add(name)

    for sid in matched_ids:
        subagents_dir = os.path.join(project_dir, sid, "subagents")
        if os.path.isdir(subagents_dir):
            files.extend(glob.glob(f"{subagents_dir}/**/*.jsonl", recursive=True))

    return files

def select_files(root, project=None, session=None, since=None):
    """Narrows the set of transcript files BEFORE reading, by slice filters.

    Doesn't change the counting logic — only which files reach walk().
    The filters combine as an intersection (project narrows directories,
    session narrows files within them, since drops by mtime on top of the result).
    """
    if not os.path.isdir(root):
        return []

    try:
        entries = os.listdir(root)
    except OSError:
        return []
    project_dirs = [os.path.join(root, d) for d in entries
                    if os.path.isdir(os.path.join(root, d))]
    if project:
        project_dirs = [d for d in project_dirs if project in os.path.basename(d)]

    files = []
    if session:
        for pd in project_dirs:
            files.extend(_session_files(pd, session))
    else:
        for pd in project_dirs:
            files.extend(glob.glob(f"{pd}/**/*.jsonl", recursive=True))

    if since:
        files = _filter_by_since(files, since)

    return files

def load_meta(jsonl_path):
    """Reads <agent-...>.meta.json next to an agent's transcript.

    None if the file is missing or corrupt — this is not an error, but a
    normal case (older transcripts were written without a meta file).
    """
    meta_path = jsonl_path[:-len(".jsonl")] + ".meta.json"
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path) as f:
            return json.load(f)
    except Exception:
        return None

def walk(paths, since=None, until=None):
    """Yields one record per usage object found in the transcripts.

    Each record is a dict with fields:
      project        — a snapshot of the project path (directory name under ~/.claude/projects)
      session        — Claude Code session id
      agentId        — a stable id of the form "agent-<hash>" for subagent
                        calls (including agents of workflow runs),
                        None for the session's main-agent records
      workflowRunId  — the run's directory name, if agentId belongs to a
                        workflow run, otherwise None
      meta           — parsed agent-<id>.meta.json (agentType,
                        description, model, ...), or None
      usage, model, ts — as in the original assistant record

    since/until — user-supplied slice boundaries, parsed right here
    strictly (see _parse_time_bound): a nonexistent calendar date raises
    ValueError instead of silently dropping the filter. until, when given
    as a bare date, is anchored to the end of the day rather than its
    midnight — otherwise the whole named day would be dropped entirely.
    Comparison against a record's timestamp is done on parsed datetimes,
    not raw strings: the string "2026-08-16T00:00:14.616Z" > "2026-08-16"
    is true simply because the first string is longer, and that used to
    drop the whole day.
    """
    since_dt = _parse_time_bound(since, strict=True)
    until_dt = _parse_time_bound(until, strict=True, end_of_day=True)
    seen = set()
    # Fix file order by sorting: a dedup key can appear in two files at
    # once (threads moved between environments), and the order decides
    # which file — and therefore which session — the usage gets attributed to.
    # os.listdir/glob don't guarantee that order.
    for f in sorted(paths):
        rel = os.path.relpath(f, ROOT)
        parts = rel.split(os.sep)
        project = parts[0]
        stem = os.path.basename(f)[:-len(".jsonl")]
        in_subagents = "subagents" in parts
        is_agent_file = in_subagents and stem.startswith("agent-")

        if in_subagents:
            session = parts[parts.index("subagents") - 1]
        else:
            session = stem

        workflow_run_id = parts[parts.index("workflows") + 1] if "workflows" in parts else None

        if is_agent_file:
            agent_id = stem
            meta = load_meta(f)
        else:
            # either the main session, or a run's helper file
            # (e.g. journal.jsonl) — not a separate agent invocation
            agent_id = None
            meta = None

        # Collapse the file's records by dedup key: the last one wins.
        # While a response is streaming, the transcript writes it several
        # times with the same (message.id, requestId) pair, growing
        # output_tokens; the final value is in the last record, earlier ones
        # are incomplete snapshots. This used to keep the first record —
        # output was undercounted. See decisions/token-usage-dedup-last-wins.md.
        records = {}
        with open(f, errors="ignore") as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                msg = d.get("message") or {}
                u = msg.get("usage")
                if not u or d.get("type") != "assistant":
                    continue
                records[(msg.get("id"), d.get("requestId"))] = {
                    "usage": u,
                    "model": msg.get("model"),
                    "ts": d.get("timestamp"),
                }

        for dedup, rec in records.items():
            if dedup in seen:
                continue
            seen.add(dedup)
            ts = rec["ts"]
            if since_dt or until_dt:
                ts_dt = _parse_time_bound(ts)
                if since_dt and (ts_dt is None or ts_dt < since_dt):  continue
                if until_dt and (ts_dt is None or ts_dt > until_dt):  continue
            yield {
                "project": project,
                "session": session,
                "agentId": agent_id,
                "workflowRunId": workflow_run_id,
                "meta": meta,
                "usage": rec["usage"],
                "model": rec["model"],
                "ts": ts,
            }

def human(n):
    for unit, div in (("M", 1e6), ("k", 1e3)):
        if n >= div:
            return f"{n/div:.1f}{unit}"
    return str(n)

def iso(ts):
    """Transcript timestamp -> ISO 8601 UTC, or None."""
    if not ts:
        return None
    try:
        s = ts.replace("Z", "+00:00") if isinstance(ts, str) else ts
        dt = datetime.fromisoformat(s) if isinstance(s, str) else None
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    except Exception:
        return ts if isinstance(ts, str) else None

def bucket_json(key, b, session_id, project, agent):
    d = {
        "key": key,
        "sessionId": session_id,
        "project": project,
        "agent": agent,
        "total": b.total,
        "input": b.inp,
        "cacheWrite5m": b.cw5,
        "cacheWrite1h": b.cw1h,
        "cacheRead": b.cr,
        "output": b.out,
        "thinking": b.think,
        "messages": b.msgs,
        "cost": round(b.cost, 2),
        "models": models_json(b.models),
    }
    d["firstAt"] = iso(b.t0)
    d["lastAt"] = iso(b.t1)
    return d

class JsonAwareParser(argparse.ArgumentParser):
    """In machine mode, an argument-parsing error is also JSON on stdout.

    argparse exits via SystemExit, bypassing exception handling in
    __main__, and prints usage to stderr: the consumer would get empty stdout.
    """

    def error(self, message):
        if "--json" in sys.argv:
            print(json.dumps({"error": message}, ensure_ascii=False))
            raise SystemExit(1)
        super().error(message)


def main():
    ap = JsonAwareParser()
    ap.add_argument("--by", default="session",
                    choices=["session", "project", "agent", "workflow", "model", "day"])
    ap.add_argument("--project", help="substring of the project path")
    ap.add_argument("--session", help="session id (a prefix is allowed)")
    ap.add_argument("--since", help="ISO date, e.g. 2026-08-01")
    ap.add_argument("--until")
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--json", action="store_true", help="print a single JSON object instead of a table")
    a = ap.parse_args()
    # a slice with a negative --top would drop the largest buckets instead of limiting output
    if a.top < 0:
        ap.error("--top cannot be negative")
    # An invalid or nonexistent calendar date (--since/--until) must not
    # silently drop the filter — ap.error gives the same uniform behavior
    # (usage text or {"error": ...} in --json) as the --top check above;
    # the actual parsing logic lives in _parse_time_bound(strict=True),
    # which select_files()/walk() below will call again.
    try:
        _parse_time_bound(a.since, strict=True)
        _parse_time_bound(a.until, strict=True, end_of_day=True)
    except ValueError as e:
        ap.error(str(e))

    files = select_files(ROOT, project=a.project, session=a.session, since=a.since)

    buckets = defaultdict(Bucket)
    bucket_sessions = defaultdict(set)   # key -> {sessionId, ...}
    bucket_projects = defaultdict(set)   # key -> {project, ...}
    bucket_agent = {}                    # key -> agent object or None (only for --by agent)
    bucket_label = {}                    # key -> human-readable label for the table

    for rec in walk(files, a.since, a.until):
        session, project = rec["session"], rec["project"]
        if a.session and not session.startswith(a.session):
            continue
        agent_id, workflow_run_id, meta = rec["agentId"], rec["workflowRunId"], rec["meta"]
        model, ts = rec["model"], rec["ts"]

        if a.by == "session":
            key = f"{session[:8]}  {project}"
            label = key
        elif a.by == "project":
            key = project
            label = key
        elif a.by == "agent":
            if agent_id:
                key = agent_id
                desc = (meta or {}).get("description")
                if desc:
                    label = desc
                else:
                    atype = (meta or {}).get("agentType") or "?"
                    amodel = (meta or {}).get("model") or "?"
                    label = f"{agent_id} [{atype}/{amodel}]"
            else:
                key = "main"
                label = "(main agent)"
        elif a.by == "workflow":
            if not workflow_run_id:
                continue
            key = workflow_run_id
            label = key
        elif a.by == "model":
            key = model or "?"
            label = key
        else:
            key = (ts or "")[:10]
            label = key

        buckets[key].add(rec["usage"], model, ts)
        bucket_sessions[key].add(session)
        bucket_projects[key].add(project)
        bucket_label[key] = label

        if a.by == "agent" and key not in bucket_agent:
            if agent_id:
                bare_id = agent_id[len("agent-"):] if agent_id.startswith("agent-") else agent_id
                bucket_agent[key] = {
                    "id": bare_id,
                    "description": (meta or {}).get("description") if meta else None,
                    "agentType": (meta or {}).get("agentType") if meta else None,
                    "model": (meta or {}).get("model") if meta else None,
                    "workflowRunId": workflow_run_id,
                }
            else:
                bucket_agent[key] = None

    rows = sorted(buckets.items(), key=lambda kv: -kv[1].total)[:a.top]

    grand = merge_buckets(buckets.values())
    total_cost = float(sum(b.cost for b in buckets.values()))
    # Per-phase total cost is the sum over buckets (each with its own tier),
    # not cost_parts of a merged bucket: only this way do input+cacheWrite+
    # cacheRead+output match total_cost, which is also a sum over buckets.
    total_costs = {"input": 0.0, "cacheWrite": 0.0, "cacheRead": 0.0, "output": 0.0, "thinking": 0.0}
    for b in buckets.values():
        for phase, value in b.cost_parts.items():
            total_costs[phase] += value

    if a.json:
        def one(k, b):
            sess = bucket_sessions[k]
            proj = bucket_projects[k]
            session_id = next(iter(sess)) if len(sess) == 1 else None
            project = next(iter(proj)) if len(proj) == 1 else None
            agent = bucket_agent.get(k)
            return bucket_json(k, b, session_id, project, agent)

        out = {
            "schemaVersion": SCHEMA_VERSION,
            "by": a.by,
            "buckets": [one(k, b) for k, b in rows],
            "totals": {
                "total": grand.total,
                "input": grand.inp,
                "cacheWrite5m": grand.cw5,
                "cacheWrite1h": grand.cw1h,
                "cacheRead": grand.cr,
                "output": grand.out,
                "thinking": grand.think,
                "messages": grand.msgs,
                "cost": round(total_cost, 2),
                "costs": {phase: round(value, 2) for phase, value in total_costs.items()},
                "models": models_json(grand.models),
                "buckets": len(buckets),
            },
            "truncated": len(buckets) > len(rows),
        }
        print(json.dumps(out, ensure_ascii=False))
        return

    print(f"{'key':<46} {'total':>8} {'input':>7} {'cache-w':>7} {'cache-r':>7} {'output':>7} {'think':>7} {'$':>7}")
    print("-" * 100)
    for k, b in rows:
        label = bucket_label[k]
        print(f"{label[:45]:<46} {human(b.total):>8} {human(b.inp):>7} {human(b.cw):>7} "
              f"{human(b.cr):>7} {human(b.out):>7} {human(b.think):>7} {b.cost:>7.2f}")
    print("-" * 100)
    print(f"{'TOTAL (' + str(len(buckets)) + ' items, ' + str(grand.msgs) + ' replies)':<46} "
          f"{human(grand.total):>8} {human(grand.inp):>7} {human(grand.cw):>7} "
          f"{human(grand.cr):>7} {human(grand.out):>7} {human(grand.think):>7} {total_cost:>7.2f}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        args_has_json = "--json" in sys.argv
        if args_has_json:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            sys.exit(1)
        raise
