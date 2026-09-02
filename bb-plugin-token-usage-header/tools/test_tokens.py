#!/usr/bin/env python3
"""Tests for transcript file selection, applying time boundaries, and the
counting logic itself.

Three groups: tokens.select_files (which files make it into the walk given
--session/--project/--since, on a stand-in directory tree — structured like
~/.claude/projects, without touching the real ~/.claude); parsing/applying
--since/--until (tokens._parse_time_bound, tokens.walk); and counting
tokens by model (tokens.ModelCounts, tokens.Bucket.add/cost/bucket_json,
tokens.tier, tokens.merge_buckets) — attributing a record's usage to a
bucket and a model tier, ordering and pricing in the output, merging
counters into grand totals.
"""
import json
import os
import sys
import unittest
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tokens  # noqa: E402


def touch(path, content="{}\n", mtime=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    if mtime is not None:
        os.utime(path, (mtime, mtime))


class SelectFilesTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def _p(self, *parts):
        return os.path.join(self.root, *parts)

    def test_missing_root_returns_empty(self):
        missing = os.path.join(self.root, "does-not-exist")
        self.assertEqual(tokens.select_files(missing), [])

    def test_no_filters_finds_everything(self):
        touch(self._p("projA", "sess1.jsonl"))
        touch(self._p("projB", "sess2.jsonl"))
        touch(self._p("projB", "sess2", "subagents", "agent-aaa.jsonl"))
        got = set(tokens.select_files(self.root))
        want = {
            self._p("projA", "sess1.jsonl"),
            self._p("projB", "sess2.jsonl"),
            self._p("projB", "sess2", "subagents", "agent-aaa.jsonl"),
        }
        self.assertEqual(got, want)

    def test_session_by_full_id(self):
        sess = "11111111-1111-1111-1111-111111111111"
        touch(self._p("projA", f"{sess}.jsonl"))
        touch(self._p("projA", "other-session.jsonl"))
        got = set(tokens.select_files(self.root, session=sess))
        self.assertEqual(got, {self._p("projA", f"{sess}.jsonl")})

    def test_session_by_prefix(self):
        sess = "71e96791-4523-42b7-8994-caa3330e5f9f"
        touch(self._p("projA", f"{sess}.jsonl"))
        touch(self._p("projA", "aabbccdd-0000-0000-0000-000000000000.jsonl"))
        got = set(tokens.select_files(self.root, session="71e96791"))
        self.assertEqual(got, {self._p("projA", f"{sess}.jsonl")})

    def test_session_with_subagents_and_workflow_agents(self):
        sess = "22222222-2222-2222-2222-222222222222"
        main_file = self._p("projA", f"{sess}.jsonl")
        subagent_file = self._p("projA", sess, "subagents", "agent-bbb.jsonl")
        workflow_agent_file = self._p(
            "projA", sess, "subagents", "workflows", "wf_run1", "agent-ccc.jsonl"
        )
        workflow_journal_file = self._p(
            "projA", sess, "subagents", "workflows", "wf_run1", "journal.jsonl"
        )
        touch(main_file)
        touch(subagent_file)
        touch(workflow_agent_file)
        touch(workflow_journal_file)
        # noise: a different neighboring session must not end up in the selection
        touch(self._p("projA", "99999999-0000-0000-0000-000000000000.jsonl"))

        got = set(tokens.select_files(self.root, session="22222222"))
        self.assertEqual(
            got,
            {main_file, subagent_file, workflow_agent_file, workflow_journal_file},
        )

    def test_project_substring_restricts_directories(self):
        touch(self._p("-Users-e0068-Documents-Projects-bb-plugins", "sess1.jsonl"))
        touch(self._p("-Users-e0068-Documents-Projects-other", "sess2.jsonl"))
        got = set(tokens.select_files(self.root, project="bb-plugins"))
        self.assertEqual(
            got, {self._p("-Users-e0068-Documents-Projects-bb-plugins", "sess1.jsonl")}
        )

    def test_since_drops_file_strictly_older_than_boundary(self):
        old_file = self._p("projA", "old.jsonl")
        new_file = self._p("projA", "new.jsonl")
        # mtime strictly earlier than the boundary -> file entirely outside the window, dropped
        touch(old_file, mtime=_ts("2026-08-01T00:00:00Z"))
        # mtime later than the boundary -> file may contain records within the window
        touch(new_file, mtime=_ts("2026-08-19T00:00:00Z"))
        got = set(tokens.select_files(self.root, since="2026-08-18"))
        self.assertEqual(got, {new_file})

    def test_since_keeps_file_with_mtime_exactly_on_boundary(self):
        boundary_file = self._p("projA", "boundary.jsonl")
        since = "2026-08-18T00:00:00Z"
        touch(boundary_file, mtime=_ts(since))
        got = set(tokens.select_files(self.root, since=since))
        self.assertEqual(got, {boundary_file})

    def test_combination_of_filters(self):
        sess = "33333333-3333-3333-3333-333333333333"
        keep = self._p("-Users-e0068-Documents-Projects-bb-plugins", f"{sess}.jsonl")
        wrong_project = self._p("-Users-e0068-Documents-Projects-other", f"{sess}.jsonl")
        wrong_session = self._p(
            "-Users-e0068-Documents-Projects-bb-plugins",
            "44444444-4444-4444-4444-444444444444.jsonl",
        )
        touch(keep, mtime=_ts("2026-08-19T00:00:00Z"))
        touch(wrong_project, mtime=_ts("2026-08-19T00:00:00Z"))
        touch(wrong_session, mtime=_ts("2026-08-19T00:00:00Z"))
        # an old file from the same session/project — must be dropped by since
        old_same = self._p("-Users-e0068-Documents-Projects-bb-plugins", "sess-old-noise.jsonl")
        touch(old_same, mtime=_ts("2026-08-01T00:00:00Z"))

        got = set(
            tokens.select_files(
                self.root, project="bb-plugins", session="33333333", since="2026-08-18"
            )
        )
        self.assertEqual(got, {keep})

    def test_missing_project_dir_for_session_lookup(self):
        # the project directory is entirely absent inside an empty root
        got = tokens.select_files(self.root, session="anything")
        self.assertEqual(got, [])


class ParseTimeBoundTest(unittest.TestCase):
    """tokens._parse_time_bound: parsing user-supplied --since/--until."""

    def test_strict_rejects_nonexistent_calendar_dates(self):
        # a regex-like shape check (\d{4}-\d{2}-\d{2}) lets these strings
        # through — but February 30 and month 99 don't exist on the calendar.
        for bad in ("2026-02-30", "9999-99-99", "2026-13-45"):
            with self.assertRaises(ValueError, msg=bad):
                tokens._parse_time_bound(bad, strict=True)

    def test_strict_accepts_real_calendar_date(self):
        dt = tokens._parse_time_bound("2026-08-19", strict=True)
        self.assertEqual((dt.year, dt.month, dt.day), (2026, 8, 19))

    def test_lenient_mode_still_returns_none_for_bad_input(self):
        # Parsing timestamps of the transcript records themselves (not user
        # input) stays lenient: a malformed record simply fails the filter.
        self.assertIsNone(tokens._parse_time_bound("2026-02-30"))
        self.assertIsNone(tokens._parse_time_bound("not-a-date"))

    def test_end_of_day_anchors_bare_date_to_last_microsecond(self):
        dt = tokens._parse_time_bound("2026-08-16", strict=True, end_of_day=True)
        self.assertEqual((dt.hour, dt.minute, dt.second, dt.microsecond), (23, 59, 59, 999999))

    def test_end_of_day_leaves_full_timestamp_untouched(self):
        dt = tokens._parse_time_bound("2026-08-16T05:00:00Z", strict=True, end_of_day=True)
        self.assertEqual((dt.hour, dt.minute, dt.second, dt.microsecond), (5, 0, 0, 0))

    def test_empty_input_is_not_an_error(self):
        self.assertIsNone(tokens._parse_time_bound(None, strict=True))
        self.assertIsNone(tokens._parse_time_bound("", strict=True))


def _write_transcript(path, records):
    """Writes a single jsonl transcript with assistant usage records."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for i, (ts, msg_id) in enumerate(records):
            line = {
                "type": "assistant",
                "timestamp": ts,
                "requestId": f"req-{i}",
                "message": {
                    "id": msg_id,
                    "model": "claude-sonnet-4",
                    "usage": {"input_tokens": 10, "output_tokens": 5},
                },
            }
            f.write(json.dumps(line) + "\n")


class WalkSinceUntilTest(unittest.TestCase):
    """tokens.walk: applying --since/--until to transcript records."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self._tmp.name, "projA", "sess1.jsonl")

    def tearDown(self):
        self._tmp.cleanup()

    def test_since_and_until_on_same_day_return_that_days_records(self):
        _write_transcript(self.path, [
            ("2026-08-18T23:59:59.999Z", "before"),
            ("2026-08-19T00:00:00.000Z", "start-of-day"),
            ("2026-08-19T12:00:00.000Z", "midday"),
            ("2026-08-19T23:59:59.999Z", "end-of-day"),
            ("2026-08-20T00:00:00.000Z", "after"),
        ])
        got = {rec["ts"] for rec in tokens.walk([self.path], since="2026-08-19", until="2026-08-19")}
        self.assertEqual(got, {
            "2026-08-19T00:00:00.000Z",
            "2026-08-19T12:00:00.000Z",
            "2026-08-19T23:59:59.999Z",
        })

    def test_until_includes_last_millisecond_of_named_day(self):
        # Live bug report: 2026-08-16T00:00:14.616Z must stay under
        # until=2026-08-16, not be dropped by a string comparison.
        _write_transcript(self.path, [
            ("2026-08-16T00:00:14.616Z", "just-after-midnight"),
            ("2026-08-17T00:00:00.000Z", "next-day"),
        ])
        got = {rec["ts"] for rec in tokens.walk([self.path], until="2026-08-16")}
        self.assertEqual(got, {"2026-08-16T00:00:14.616Z"})

    def test_valid_multi_day_range_still_filters_as_before(self):
        _write_transcript(self.path, [
            ("2026-08-14T12:00:00.000Z", "too-early"),
            ("2026-08-15T00:00:00.000Z", "in-range-start"),
            ("2026-08-16T12:00:00.000Z", "in-range-mid"),
            ("2026-08-17T23:59:59.999Z", "in-range-end"),
            ("2026-08-18T00:00:00.000Z", "too-late"),
        ])
        got = {rec["ts"] for rec in tokens.walk([self.path], since="2026-08-15", until="2026-08-17")}
        self.assertEqual(got, {
            "2026-08-15T00:00:00.000Z",
            "2026-08-16T12:00:00.000Z",
            "2026-08-17T23:59:59.999Z",
        })

    def test_nonexistent_calendar_date_raises_instead_of_dropping_filter(self):
        _write_transcript(self.path, [("2026-08-19T12:00:00.000Z", "only")])
        for kwargs in ({"since": "2026-02-30"}, {"until": "9999-99-99"}, {"since": "2026-13-45"}):
            with self.assertRaises(ValueError, msg=str(kwargs)):
                list(tokens.walk([self.path], **kwargs))


class CountingTest(unittest.TestCase):
    """Token counting: attributing usage to a bucket and to a model tier."""

    def test_bucket_total_equals_sum_of_model_totals(self):
        # Records on different models, with different token kinds (input,
        # cache write 5m and 1h, cache read, output) — the sum over models
        # must match the bucket's overall total, otherwise usage gets lost.
        b = tokens.Bucket()
        b.add({
            "input_tokens": 100,
            "cache_creation": {
                "ephemeral_5m_input_tokens": 20,
                "ephemeral_1h_input_tokens": 30,
            },
            "cache_read_input_tokens": 40,
            "output_tokens": 50,
        }, "claude-opus-4", None)
        b.add({
            "input_tokens": 5,
            "cache_read_input_tokens": 2,
            "output_tokens": 3,
        }, "claude-sonnet-4", None)
        self.assertEqual(sum(m.total for m in b.models.values()), b.total)
        self.assertEqual(b.models["opus"].total, 100 + 20 + 30 + 40 + 50)
        self.assertEqual(b.models["sonnet"].total, 5 + 2 + 3)

    def test_legacy_flat_cache_creation_field_reaches_model_counts(self):
        # Legacy format: cache_creation is absent, there's a flat
        # cache_creation_input_tokens field instead — Bucket.add takes the
        # "if not cc" branch and must attribute that number to both the
        # bucket and the model counter, not lose it.
        b = tokens.Bucket()
        b.add({
            "input_tokens": 1,
            "cache_creation_input_tokens": 77,
            "output_tokens": 1,
        }, "claude-opus-4", None)
        self.assertEqual(b.cw5, 77)
        self.assertEqual(b.models["opus"].cw5, 77)

    def test_bucket_json_models_sorted_by_total_desc_then_tier_name(self):
        b = tokens.Bucket()
        b.models["haiku"].add(0, 0, 0, 0, 200)   # total 200 — ahead of everyone
        b.models["opus"].add(0, 0, 0, 0, 100)    # tie-break with sonnet: 'o' < 's'
        b.models["sonnet"].add(0, 0, 0, 0, 100)
        d = tokens.bucket_json("k", b, None, None, None)
        self.assertEqual(
            d["models"],
            [
                {"tier": "haiku", "total": 200},
                {"tier": "opus", "total": 100},
                {"tier": "sonnet", "total": 100},
            ],
        )

    def test_cost_uses_model_with_highest_output_not_highest_total(self):
        # opus accounts for almost the entire bucket's usage via cache reads,
        # but produced almost no output. sonnet is the opposite: little usage,
        # more output. The tier must be taken from sonnet (output), not opus
        # (total usage).
        b = tokens.Bucket()
        b.add({"cache_read_input_tokens": 1_000_000, "output_tokens": 1}, "claude-opus-4", None)
        b.add({"cache_read_input_tokens": 0, "output_tokens": 100}, "claude-sonnet-4", None)
        self.assertGreater(b.models["opus"].total, b.models["sonnet"].total)
        self.assertGreater(b.models["sonnet"].out, b.models["opus"].out)

        pi, po = tokens.PRICES["sonnet"]
        expected = (b.cr * pi * tokens.CACHE_READ + b.out * po) / 1e6
        self.assertAlmostEqual(b.cost, expected)

        pi_opus, po_opus = tokens.PRICES["opus"]
        wrong = (b.cr * pi_opus * tokens.CACHE_READ + b.out * po_opus) / 1e6
        self.assertNotAlmostEqual(b.cost, wrong)

    def test_merge_buckets_sums_model_counts_across_buckets(self):
        b1 = tokens.Bucket()
        b1.add({"input_tokens": 10, "output_tokens": 5}, "claude-opus-4", None)
        b2 = tokens.Bucket()
        b2.add({"input_tokens": 20, "output_tokens": 7}, "claude-opus-4", None)
        b2.add({"input_tokens": 1, "output_tokens": 1}, "claude-sonnet-4", None)

        grand = tokens.merge_buckets([b1, b2])

        self.assertEqual(grand.total, b1.total + b2.total)
        self.assertEqual(grand.msgs, b1.msgs + b2.msgs)
        self.assertEqual(
            grand.models["opus"].total,
            b1.models["opus"].total + b2.models["opus"].total,
        )
        self.assertEqual(grand.models["sonnet"].total, b2.models["sonnet"].total)

    def test_tier_unknown_or_empty_model_falls_back_to_sonnet(self):
        self.assertEqual(tokens.tier(""), "sonnet")
        self.assertEqual(tokens.tier(None), "sonnet")
        self.assertEqual(tokens.tier("some-unheard-of-model-xyz"), "sonnet")

        # a record with an unknown model isn't lost — it lands in the
        # breakdown under "sonnet"
        b = tokens.Bucket()
        b.add({"input_tokens": 10, "output_tokens": 5}, "some-unheard-of-model-xyz", None)
        self.assertEqual(set(b.models.keys()), {"sonnet"})
        self.assertEqual(b.models["sonnet"].total, 15)


class CostPartsTest(unittest.TestCase):
    """Bucket.cost_parts: cost broken down by token kind (H-header-only —
    absent from bb-plugin-token-usage). src/core/parse.ts requires
    totals.costs on every report, so a sum mismatch here breaks the plugin
    just as silently as a schema drift would."""

    def test_cost_parts_sum_equals_cost(self):
        # input+cacheWrite+cacheRead+output from cost_parts must match
        # cost — otherwise the per-kind breakdown in the popup won't
        # reconcile with the row's final price. thinking is deliberately
        # excluded from this sum (see the cost_parts docstring) — it's the
        # only thing left to account for the remainder.
        b = tokens.Bucket()
        b.add({
            "input_tokens": 100,
            "cache_creation": {
                "ephemeral_5m_input_tokens": 20,
                "ephemeral_1h_input_tokens": 30,
            },
            "cache_read_input_tokens": 40,
            "output_tokens": 50,
            "output_tokens_details": {"thinking_tokens": 7},
        }, "claude-sonnet-4", None)

        parts = b.cost_parts
        without_thinking = parts["input"] + parts["cacheWrite"] + parts["cacheRead"] + parts["output"]
        self.assertAlmostEqual(without_thinking, b.cost)

    def test_cost_parts_and_cost_use_the_same_tier_price(self):
        # The tier for cost_parts comes from the same _tier_prices() as for
        # cost — if they diverged (e.g. cost_parts took the tier by total
        # usage while cost took it by output), the sum of parts would stop
        # matching cost precisely on buckets that are heterogeneous by model.
        b = tokens.Bucket()
        b.add({"cache_read_input_tokens": 1_000_000, "output_tokens": 1}, "claude-opus-4", None)
        b.add({"cache_read_input_tokens": 0, "output_tokens": 100}, "claude-sonnet-4", None)

        parts = b.cost_parts
        without_thinking = parts["input"] + parts["cacheWrite"] + parts["cacheRead"] + parts["output"]
        self.assertAlmostEqual(without_thinking, b.cost)

    def test_cost_parts_on_empty_bucket_is_zero_and_does_not_raise(self):
        # _tier_prices() falls back to "sonnet" when models is empty —
        # cost_parts must not raise on a bucket that never saw a record.
        b = tokens.Bucket()
        parts = b.cost_parts
        self.assertEqual(parts, {"input": 0.0, "cacheWrite": 0.0, "cacheRead": 0.0, "output": 0.0, "thinking": 0.0})


class JsonReportSchemaVersionTest(unittest.TestCase):
    """The --json report carries a schema version number — src/core/parse.ts
    in the plugin checks it first thing. See memory/decisions/token-usage-json-schema-version.md."""

    def _run_json(self, argv_tail, root=None):
        import contextlib
        import io

        tmp = None
        if root is None:
            tmp = tempfile.TemporaryDirectory()
            self.addCleanup(tmp.cleanup)
            root = tmp.name

        old_root, old_argv = tokens.ROOT, sys.argv
        tokens.ROOT = root
        sys.argv = ["tokens.py", *argv_tail]
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                try:
                    tokens.main()
                except SystemExit:
                    pass
        finally:
            tokens.ROOT, sys.argv = old_root, old_argv
        return buf.getvalue()

    def test_json_report_carries_expected_schema_version(self):
        out = json.loads(self._run_json(["--json", "--by", "agent"]))
        self.assertEqual(out["schemaVersion"], tokens.SCHEMA_VERSION)

    def test_json_report_totals_carry_a_costs_breakdown(self):
        # Requirement of src/core/parse.ts::validateTotals — the plugin
        # rejects a report without totals.costs as invalid_shape.
        out = json.loads(self._run_json(["--json", "--by", "session"]))
        self.assertIn("costs", out["totals"])
        for field in ("input", "cacheWrite", "cacheRead", "output", "thinking"):
            self.assertIn(field, out["totals"]["costs"])

    def test_bad_top_still_emits_a_json_error_envelope_not_empty_stdout(self):
        # A live check of the invariant that the fix in
        # src/service/tokens-runner.ts relies on: --json must print an
        # argparse error as {"error": ...}, not stay silent on stdout —
        # otherwise the plugin's process runner can't tell "empty report"
        # apart from "the script crashed without saying anything".
        out = self._run_json(["--json", "--top", "-1"])
        parsed = json.loads(out)
        self.assertIn("error", parsed)

    def test_bad_since_still_emits_a_json_error_envelope_not_empty_stdout(self):
        out = self._run_json(["--json", "--since", "2026-02-30"])
        parsed = json.loads(out)
        self.assertIn("error", parsed)

    def test_unrecognized_flag_still_emits_a_json_error_envelope(self):
        # argparse's own error() path (JsonAwareParser), not main()'s
        # try/except — a different code path to the same guarantee.
        out = self._run_json(["--json", "--not-a-real-flag"])
        parsed = json.loads(out)
        self.assertIn("error", parsed)


def _ts(iso_str):
    """ISO 8601 UTC -> unix timestamp, for setting mtime in tests."""
    from datetime import datetime, timezone
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return dt.replace(tzinfo=timezone.utc).timestamp()


def _write_raw(path, lines):
    """Writes jsonl from ready-made dict records (without substituting requestId)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for line in lines:
            f.write(json.dumps(line) + "\n")


def _assistant(msg_id, req, out, ts="2026-08-19T07:40:00.000Z", model="claude-sonnet-4"):
    return {
        "type": "assistant", "timestamp": ts, "requestId": req,
        "message": {"id": msg_id, "model": model,
                    "usage": {"input_tokens": 1, "output_tokens": out}},
    }


class DedupTest(unittest.TestCase):
    """tokens.walk: repeats of one response collapse into the last record."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self._real_root = tokens.ROOT
        tokens.ROOT = self.root

    def tearDown(self):
        tokens.ROOT = self._real_root
        self._tmp.cleanup()

    def _p(self, *parts):
        return os.path.join(self.root, *parts)

    def test_streaming_snapshots_collapse_to_final_value(self):
        # one response, written three times as it streams: 1 -> 1 -> 366
        path = self._p("projA", "sess1.jsonl")
        _write_raw(path, [_assistant("msg-1", "req-1", 1),
                          _assistant("msg-1", "req-1", 1),
                          _assistant("msg-1", "req-1", 366)])
        recs = list(tokens.walk([path]))
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["usage"]["output_tokens"], 366)

    def test_repeat_keeps_position_of_first_appearance(self):
        # output order follows the key's first appearance, the value is the last one
        path = self._p("projA", "sess1.jsonl")
        _write_raw(path, [_assistant("msg-1", "req-1", 5),
                          _assistant("msg-2", "req-2", 7),
                          _assistant("msg-1", "req-1", 50)])
        recs = list(tokens.walk([path]))
        self.assertEqual([r["usage"]["output_tokens"] for r in recs], [50, 7])

    def test_same_answer_in_two_files_counted_once_for_first_path(self):
        # one response that ended up in two sessions: counted once, credited
        # to the file that comes first in sorted path order
        a = self._p("projA", "aaa.jsonl")
        b = self._p("projA", "bbb.jsonl")
        _write_raw(a, [_assistant("msg-1", "req-1", 9)])
        _write_raw(b, [_assistant("msg-1", "req-1", 9)])
        recs = list(tokens.walk([b, a]))
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["session"], "aaa")

    def test_file_order_does_not_depend_on_input_order(self):
        a = self._p("projA", "aaa.jsonl")
        b = self._p("projA", "bbb.jsonl")
        _write_raw(a, [_assistant("msg-1", "req-1", 9)])
        _write_raw(b, [_assistant("msg-1", "req-1", 9)])
        self.assertEqual([r["session"] for r in tokens.walk([a, b])],
                         [r["session"] for r in tokens.walk([b, a])])


if __name__ == "__main__":
    unittest.main()
