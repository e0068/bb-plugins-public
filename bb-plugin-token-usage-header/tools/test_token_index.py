#!/usr/bin/env python3
"""Tests for the incremental index (token_index).

The main one is the equivalence gate: walking through the index must yield
exactly what the direct read yields, record for record. Everything else
checks the cases where what the index stored cannot be trusted: the file
was appended to, truncated, rewritten, replaced, deleted, or its last line
was still being written.
"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tokens  # noqa: E402
import token_index  # noqa: E402


def assistant(msg_id, req, out, ts="2026-08-19T07:40:00.000Z", model="claude-sonnet-4",
              inp=1, cr=0, cw=0, effort=None, **usage):
    record = {
        "type": "assistant", "timestamp": ts, "requestId": req,
        "message": {"id": msg_id, "model": model, "usage": {
            "input_tokens": inp, "output_tokens": out,
            "cache_read_input_tokens": cr, "cache_creation_input_tokens": cw, **usage,
        }},
    }
    if effort:
        record["effort"] = effort
    return record


def line(record):
    return json.dumps(record) + "\n"


def write(path, records, mode="w"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, mode) as f:
        f.writelines(line(r) for r in records)


class IndexTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self._real_root = tokens.ROOT
        tokens.ROOT = self.root
        self.index_path = os.path.join(self.root, "index.json")
        # every walk(use_index=True) here goes through the index, whatever its size
        for patch in (mock.patch.object(token_index, "DIRECT_READ_LIMIT_BYTES", -1),
                      mock.patch.dict(os.environ, {"TOKEN_USAGE_INDEX": self.index_path})):
            patch.start()
            self.addCleanup(patch.stop)

    def tearDown(self):
        tokens.ROOT = self._real_root
        self._tmp.cleanup()

    def p(self, *parts):
        return os.path.join(self.root, *parts)

    def indexed(self, files, **kw):
        return list(tokens.walk(files, use_index=True, **kw))

    def direct(self, files, **kw):
        return list(tokens.walk(files, **kw))

    def stored(self):
        return token_index.load(self.index_path)["files"]


class EquivalenceTest(IndexTestBase):
    """The gate: the index and the direct read give the same records."""

    def _tree(self):
        """A tree covering every special case at once."""
        main = self.p("projA", "sess1.jsonl")
        agent = self.p("projA", "sess1", "subagents", "agent-aaa.jsonl")
        wf = self.p("projA", "sess1", "subagents", "workflows", "wf-1", "agent-bbb.jsonl")
        other = self.p("projB", "sess2.jsonl")
        write(main, [
            assistant("m1", "r1", 5, cr=100, effort="high"),
            assistant("m2", "r2", 1),           # a streaming snapshot...
            assistant("m2", "r2", 40),          # ...and its final value
            assistant("m3", "r3", 7, ts="2026-08-20T10:00:00.000Z", model="claude-opus-5",
                      speed="fast", api_context_input_tokens=300_000,
                      cache_creation={"ephemeral_1h_input_tokens": 9},
                      output_tokens_details={"thinking_tokens": 4}),
        ])
        write(agent, [assistant("a1", "ra1", 12, model="claude-haiku-4-5-20251001")])
        with open(self.p("projA", "sess1", "subagents", "agent-aaa.meta.json"), "w") as f:
            json.dump({"agentType": "general-purpose", "model": "haiku"}, f)
        write(wf, [assistant("w1", "rw1", 3)])
        # the same response as in the main transcript: counted once
        write(other, [assistant("m1", "r1", 5, cr=100)])
        return [main, agent, wf, other]

    def test_index_matches_direct_read(self):
        files = self._tree()
        self.assertEqual(self.indexed(files), self.direct(files))

    def test_index_matches_direct_read_on_second_run(self):
        files = self._tree()
        self.indexed(files)  # the first run builds the index
        self.assertTrue(self.stored())
        self.assertEqual(self.indexed(files), self.direct(files))

    def test_index_matches_after_append(self):
        files = self._tree()
        self.indexed(files)
        write(files[0], [assistant("m9", "r9", 21)], mode="a")
        self.assertEqual(self.indexed(files), self.direct(files))

    def test_index_matches_with_time_bounds(self):
        files = self._tree()
        self.indexed(files)
        for since, until in ((None, "2026-08-19"), ("2026-08-20", None), (None, None)):
            self.assertEqual(self.indexed(files, since=since, until=until),
                             self.direct(files, since=since, until=until))

    def test_order_independent_of_input_order(self):
        files = self._tree()
        self.assertEqual(self.indexed(files), self.indexed(list(reversed(files))))

    def test_json_report_is_the_same_with_and_without_index(self):
        self._tree()
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tokens.py")
        for by in ("session", "project", "agent", "workflow", "model", "day"):
            with self.subTest(by=by):
                with mock.patch.object(sys, "argv", [script, "--json", "--by", by]):
                    via_index = self._capture()
                with mock.patch.object(sys, "argv", [script, "--json", "--by", by, "--no-index"]):
                    direct = self._capture()
                self.assertEqual(via_index, direct)

    def _capture(self):
        from io import StringIO
        with mock.patch("sys.stdout", new_callable=StringIO) as out:
            tokens.main()
        return json.loads(out.getvalue())


class StaleEntryTest(IndexTestBase):
    """When what the index stored cannot be trusted."""

    def test_appended_record_supersedes_its_own_snapshot(self):
        # the record was saved into the index unfinished; its final value came later
        path = self.p("projA", "sess1.jsonl")
        write(path, [assistant("m1", "r1", 1)])
        self.assertEqual(self.indexed([path])[0]["usage"]["output_tokens"], 1)
        write(path, [assistant("m1", "r1", 366)], mode="a")
        got = self.indexed([path])
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["usage"]["output_tokens"], 366)

    def test_line_still_being_written_is_not_lost(self):
        path = self.p("projA", "sess1.jsonl")
        whole, half = line(assistant("m1", "r1", 5)), line(assistant("m2", "r2", 8))
        os.makedirs(os.path.dirname(path))
        with open(path, "w") as f:
            f.write(whole + half[:20])  # the second line is cut mid-write
        self.assertEqual(len(self.indexed([path])), 1)
        with open(path, "a") as f:
            f.write(half[20:])
        self.assertEqual([r["usage"]["output_tokens"] for r in self.indexed([path])], [5, 8])

    def test_last_line_without_newline_is_counted_and_read_again(self):
        path = self.p("projA", "sess1.jsonl")
        os.makedirs(os.path.dirname(path))
        with open(path, "w") as f:
            f.write(line(assistant("m1", "r1", 5)) + json.dumps(assistant("m2", "r2", 1)))
        self.assertEqual(self.indexed([path]), self.direct([path]))
        with open(path, "a") as f:
            f.write("\n" + line(assistant("m2", "r2", 30)))
        self.assertEqual([r["usage"]["output_tokens"] for r in self.indexed([path])], [5, 30])
        self.assertEqual(self.indexed([path]), self.direct([path]))

    def test_truncated_file_is_reread_whole(self):
        path = self.p("projA", "sess1.jsonl")
        write(path, [assistant("m1", "r1", 5), assistant("m2", "r2", 6)])
        self.indexed([path])
        write(path, [assistant("m3", "r3", 9)])  # rewritten, the file got shorter
        self.assertEqual([r["usage"]["output_tokens"] for r in self.indexed([path])], [9])

    def test_rewritten_file_of_same_size_is_reread(self):
        path = self.p("projA", "sess1.jsonl")
        write(path, [assistant("m1", "r1", 5)])
        self.indexed([path])
        size_before = os.path.getsize(path)
        write(path, [assistant("m2", "r2", 5)])  # same size, other content
        self.assertEqual(os.path.getsize(path), size_before)
        os.utime(path, (os.path.getmtime(path) + 10, os.path.getmtime(path) + 10))
        self.assertEqual(self.indexed([path]), self.direct([path]))

    def test_file_replaced_by_a_longer_one_is_reread_whole(self):
        # how the Codex and Kimi projections are written: a temp file renamed over
        path = self.p("projA", "sess1.jsonl")
        write(path, [assistant("m1", "r1", 5)])
        self.indexed([path])
        replacement = self.p("projA", "tmp")
        write(replacement, [assistant("m1", "r1", 50), assistant("m2", "r2", 6)])
        os.replace(replacement, path)
        self.assertEqual([r["usage"]["output_tokens"] for r in self.indexed([path])], [50, 6])

    def test_deleted_file_drops_out_of_results_and_index(self):
        a, b = self.p("projA", "a.jsonl"), self.p("projA", "b.jsonl")
        write(a, [assistant("m1", "r1", 5)])
        write(b, [assistant("m2", "r2", 6)])
        self.indexed([a, b])
        os.unlink(b)
        self.assertEqual(len(self.indexed([a, b])), 1)
        # and its entry is dropped from the index rather than left hanging
        index = token_index.load(self.index_path)
        token_index.refresh(index, [a, b], tokens.file_records)
        self.assertNotIn(b, index["files"])

    def test_save_forgets_files_that_are_gone_even_if_not_queried(self):
        a, b = self.p("projA", "a.jsonl"), self.p("projB", "b.jsonl")
        write(a, [assistant("m1", "r1", 5)])
        write(b, [assistant("m2", "r2", 6)])
        self.indexed([a, b])
        os.unlink(b)
        os.utime(self.index_path, (0, 0))  # the index is old: the next query saves it
        write(a, [assistant("m3", "r3", 7)], mode="a")
        self.indexed([a])  # a narrow query never names b
        self.assertEqual(set(self.stored()), {a})

    def test_broken_index_file_is_ignored(self):
        path = self.p("projA", "sess1.jsonl")
        write(path, [assistant("m1", "r1", 5)])
        with open(self.index_path, "w") as f:
            f.write("{ not json")
        self.assertEqual(self.indexed([path]), self.direct([path]))

    def test_index_of_foreign_version_is_ignored(self):
        with open(self.index_path, "w") as f:
            json.dump({"version": token_index.VERSION + 1, "files": {"x": {}}}, f)
        self.assertEqual(token_index.load(self.index_path), {"version": token_index.VERSION, "files": {}})


class SavePolicyTest(IndexTestBase):
    """When the index is rewritten and when it is not."""

    def test_nothing_new_means_no_save(self):
        self.assertFalse(token_index.should_save(self.index_path, 0))

    def test_missing_index_is_always_saved(self):
        self.assertTrue(token_index.should_save(self.index_path, 1))

    def test_large_delta_saves_even_if_index_is_fresh(self):
        with open(self.index_path, "w") as f:
            f.write("{}")
        self.assertTrue(token_index.should_save(self.index_path, token_index.SAVE_DELTA_BYTES + 1))

    def test_small_delta_on_fresh_index_is_not_saved(self):
        with open(self.index_path, "w") as f:
            f.write("{}")
        self.assertFalse(token_index.should_save(self.index_path, 10))

    def test_small_delta_on_stale_index_is_saved(self):
        with open(self.index_path, "w") as f:
            f.write("{}")
        old = os.path.getmtime(self.index_path) - token_index.SAVE_INTERVAL_S - 1
        os.utime(self.index_path, (old, old))
        self.assertTrue(token_index.should_save(self.index_path, 10))

    def test_unwritable_index_path_does_not_break_counting(self):
        path = self.p("projA", "sess1.jsonl")
        write(path, [assistant("m1", "r1", 5)])
        blocked = os.path.join(path, "cannot", "index.json")  # a directory inside a file
        with mock.patch.dict(os.environ, {"TOKEN_USAGE_INDEX": blocked}):
            self.assertEqual(len(self.indexed([path])), 1)


class RouteChoiceTest(unittest.TestCase):
    """The threshold below which the direct read is cheaper than the index."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

    def test_small_slice_reads_directly(self):
        path = os.path.join(self._tmp.name, "sess1.jsonl")
        write(path, [assistant("m1", "r1", 5)])
        self.assertFalse(token_index.should_use_index([path]))

    def test_large_slice_uses_index(self):
        path = os.path.join(self._tmp.name, "big.jsonl")
        with open(path, "w") as f:
            f.truncate(token_index.DIRECT_READ_LIMIT_BYTES + 1)
        self.assertTrue(token_index.should_use_index([path]))

    def test_missing_files_do_not_count_toward_threshold(self):
        self.assertEqual(token_index.total_bytes([os.path.join(self._tmp.name, "nope.jsonl")]), 0)


if __name__ == "__main__":
    unittest.main()
