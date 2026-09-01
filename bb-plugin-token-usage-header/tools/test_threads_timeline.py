#!/usr/bin/env python3
"""Тесты на ленту тредов: раскладку usage-записей сессий по бинам времени.

build_timeline() — точка входа под тест; сам подсчёт расхода (tokens.walk(),
tokens.Bucket) не дублируется и не переопределяется — здесь проверяется
только раскладка по бинам, агрегация по агентам внутри бина, отбор "последних
N сессий", фильтр по проекту и построение agentLabels. Отдельная группа — на
CLI/--json обвязку.

build_timeline() возвращает {"threads": [...], "agentLabels": {...}} —
большинство тестов интересует только "threads", поэтому распаковывают его
сразу в локальную переменную `threads`.
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tokens  # noqa: E402
import threads_timeline  # noqa: E402
import tokens  # noqa: E402


def _assistant(msg_id, req, out_tokens, ts, model="claude-sonnet-4", inp=0):
    """Assistant-запись с usage. inp=0 по умолчанию, чтобы total бакета
    совпадал ровно с out_tokens — упрощает арифметику ожиданий в тестах."""
    return {
        "type": "assistant",
        "timestamp": ts,
        "requestId": req,
        "message": {"id": msg_id, "model": model, "usage": {"input_tokens": inp, "output_tokens": out_tokens}},
    }


def _write_raw(path, lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for line in lines:
            f.write(json.dumps(line) + "\n")


def _write_meta(agent_jsonl_path, meta):
    meta_path = agent_jsonl_path[: -len(".jsonl")] + ".meta.json"
    with open(meta_path, "w") as f:
        json.dump(meta, f)


class BuildTimelineTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def _p(self, *parts):
        return os.path.join(self.root, *parts)

    def _threads(self, **kwargs):
        return threads_timeline.build_timeline(self.root, **kwargs)["threads"]

    def test_empty_root_returns_no_threads(self):
        threads = self._threads(limit=20, unit=300)
        self.assertEqual(threads, [])

    def test_missing_root_returns_no_threads(self):
        missing = os.path.join(self.root, "does-not-exist")
        threads = threads_timeline.build_timeline(missing, limit=20, unit=300)["threads"]
        self.assertEqual(threads, [])

    def test_session_with_no_usage_records_is_skipped(self):
        _write_raw(self._p("projA", "empty.jsonl"), [])
        threads = self._threads(limit=20, unit=300)
        self.assertEqual(threads, [])

    def test_records_within_same_unit_merge_into_one_bin(self):
        path = self._p("projA", "sess1.jsonl")
        _write_raw(
            path,
            [
                _assistant("m1", "r1", 5, "2026-08-19T10:00:01.000Z"),
                _assistant("m2", "r2", 7, "2026-08-19T10:00:04.000Z"),  # тот же 10-секундный бин
            ],
        )
        threads = self._threads(limit=20, unit=10)
        self.assertEqual(len(threads), 1)
        bins = threads[0]["bins"]
        self.assertEqual(len(bins), 1)
        self.assertEqual(bins[0]["agents"], [{"key": "main", "total": 12}])

    def test_records_crossing_unit_boundary_split_into_separate_bins(self):
        path = self._p("projA", "sess1.jsonl")
        _write_raw(
            path,
            [
                _assistant("m1", "r1", 5, "2026-08-19T10:00:09.000Z"),
                _assistant("m2", "r2", 7, "2026-08-19T10:00:10.000Z"),  # следующий 10-секундный бин
            ],
        )
        threads = self._threads(limit=20, unit=10)
        self.assertEqual(len(threads), 1)
        bins = threads[0]["bins"]
        self.assertEqual(len(bins), 2)
        self.assertEqual(bins[0]["agents"], [{"key": "main", "total": 5}])
        self.assertEqual(bins[1]["agents"], [{"key": "main", "total": 7}])

    def test_bin_start_is_a_multiple_of_unit(self):
        path = self._p("projA", "sess1.jsonl")
        _write_raw(path, [_assistant("m1", "r1", 5, "2026-08-19T10:00:37.000Z")])
        threads = self._threads(limit=20, unit=15)
        bin_t = threads[0]["bins"][0]["t"]
        from datetime import datetime, timezone

        dt = datetime.fromisoformat(bin_t.replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
        self.assertEqual(int(dt.timestamp()) % 15, 0)

    def test_sum_of_bin_totals_equals_session_total(self):
        path = self._p("projA", "sess1.jsonl")
        _write_raw(
            path,
            [
                _assistant("m1", "r1", 5, "2026-08-19T10:00:01.000Z"),
                _assistant("m2", "r2", 7, "2026-08-19T10:00:04.000Z"),
                _assistant("m3", "r3", 3, "2026-08-19T10:05:00.000Z"),
            ],
        )
        threads = self._threads(limit=20, unit=10)
        thread = threads[0]
        bin_sum = sum(a["total"] for b in thread["bins"] for a in b["agents"])
        self.assertEqual(bin_sum, thread["totalTokens"])
        self.assertEqual(thread["totalTokens"], 15)

    def test_thread_carries_total_cost_matching_tokens_pricing(self):
        # totalCost считается тем же tokens.Bucket, что и total — тест сверяет
        # её с ценой, посчитанной напрямую по тому же usage/model, чтобы форма
        # не разошлась с тарифом tokens.py.
        ts = "2026-08-19T10:00:01.000Z"
        _write_raw(self._p("projA", "sess1.jsonl"), [_assistant("m1", "r1", 1000, ts)])
        thread = self._threads(limit=20, unit=300)[0]
        expected = tokens.Bucket()
        expected.add({"input_tokens": 0, "output_tokens": 1000}, "claude-sonnet-4", ts)
        self.assertEqual(thread["totalCost"], round(expected.cost, 2))
        self.assertGreater(thread["totalCost"], 0)

    def test_workflow_count_counts_distinct_workflow_runs(self):
        sess = "sess-wf"
        _write_raw(self._p("projA", sess + ".jsonl"), [_assistant("m0", "r0", 5, "2026-08-19T10:00:00.000Z")])
        # Два прогона workflow, по одному агенту в каждом — workflowRunId берётся
        # из сегмента пути после "workflows" (см. tokens.walk).
        _write_raw(
            self._p("projA", sess, "subagents", "workflows", "run1", "agent-w1.jsonl"),
            [_assistant("m1", "r1", 3, "2026-08-19T10:00:01.000Z")],
        )
        _write_raw(
            self._p("projA", sess, "subagents", "workflows", "run2", "agent-w2.jsonl"),
            [_assistant("m2", "r2", 4, "2026-08-19T10:00:02.000Z")],
        )
        thread = self._threads(limit=20, unit=300)[0]
        self.assertEqual(thread["workflowCount"], 2)

    def test_workflow_count_is_zero_without_workflow_runs(self):
        _write_raw(self._p("projA", "sess-plain.jsonl"), [_assistant("m1", "r1", 5, "2026-08-19T10:00:00.000Z")])
        thread = self._threads(limit=20, unit=300)[0]
        self.assertEqual(thread["workflowCount"], 0)

    def test_session_filter_restricts_to_the_named_session(self):
        _write_raw(self._p("projA", "sess-a.jsonl"), [_assistant("m1", "r1", 5, "2026-08-19T10:00:00.000Z")])
        _write_raw(self._p("projA", "sess-b.jsonl"), [_assistant("m2", "r2", 7, "2026-08-19T10:01:00.000Z")])
        threads = threads_timeline.build_timeline(self.root, limit=20, unit=300, session="sess-a")["threads"]
        self.assertEqual([t["session"] for t in threads], ["sess-a"])

    def test_group_workflows_merges_run_agents_and_labels_by_workflow_name(self):
        sess = "sess-wf"
        _write_raw(self._p("projA", sess + ".jsonl"), [_assistant("m0", "r0", 5, "2026-08-19T10:00:00.000Z")])
        # Два агента одного прогона wf_run1 — в один сегмент; main отдельно.
        _write_raw(
            self._p("projA", sess, "subagents", "workflows", "wf_run1", "agent-x.jsonl"),
            [_assistant("m1", "r1", 3, "2026-08-19T10:00:01.000Z")],
        )
        _write_raw(
            self._p("projA", sess, "subagents", "workflows", "wf_run1", "agent-y.jsonl"),
            [_assistant("m2", "r2", 4, "2026-08-19T10:00:02.000Z")],
        )
        # Человеческое имя workflow — из workflows/scripts/<имя>-<runId>.js.
        scripts = self._p("projA", sess, "workflows", "scripts")
        os.makedirs(scripts, exist_ok=True)
        open(os.path.join(scripts, "my-review-wf_run1.js"), "w").close()

        result = threads_timeline.build_timeline(self.root, limit=20, unit=300, group_workflows=True)
        thread = result["threads"][0]
        agents = {a["key"]: a["total"] for b in thread["bins"] for a in b["agents"]}
        self.assertEqual(agents.get("workflow:wf_run1"), 7)
        self.assertEqual(agents.get("main"), 5)
        self.assertEqual(result["agentLabels"]["workflow:wf_run1"], "my-review")

        # Реальная принадлежность агента внутри слитого сегмента не теряется:
        # members несёт обоих реальных agentId, отсортированных.
        bin_agents = {a["key"]: a for b in thread["bins"] for a in b["agents"]}
        self.assertEqual(bin_agents["workflow:wf_run1"]["members"], ["agent-x", "agent-y"])
        # У обычного (не-workflow) сегмента members нет вовсе — key уже и есть
        # его real id, дублировать нечего.
        self.assertNotIn("members", bin_agents["main"])

    def test_group_workflows_off_has_no_members_field_on_any_segment(self):
        sess = "sess-wf-nogroup"
        _write_raw(self._p("projA", sess + ".jsonl"), [_assistant("m0", "r0", 5, "2026-08-19T10:00:00.000Z")])
        _write_raw(
            self._p("projA", sess, "subagents", "workflows", "wf_run3", "agent-x.jsonl"),
            [_assistant("m1", "r1", 3, "2026-08-19T10:00:01.000Z")],
        )
        result = threads_timeline.build_timeline(self.root, limit=20, unit=300, group_workflows=False)
        thread = result["threads"][0]
        for b in thread["bins"]:
            for a in b["agents"]:
                self.assertNotIn("members", a)

    def test_group_workflows_off_keeps_run_agents_separate(self):
        sess = "sess-wf2"
        _write_raw(self._p("projA", sess + ".jsonl"), [_assistant("m0", "r0", 5, "2026-08-19T10:00:00.000Z")])
        _write_raw(
            self._p("projA", sess, "subagents", "workflows", "wf_run2", "agent-x.jsonl"),
            [_assistant("m1", "r1", 3, "2026-08-19T10:00:01.000Z")],
        )
        keys = {
            a["key"]
            for b in threads_timeline.build_timeline(self.root, limit=20, unit=300, group_workflows=False)["threads"][0]["bins"]
            for a in b["agents"]
        }
        self.assertIn("agent-x", keys)
        self.assertNotIn("workflow:wf_run2", keys)

    def test_multiple_agents_in_same_bin_are_broken_out_by_agent_key(self):
        sess = "11111111-1111-1111-1111-111111111111"
        main_path = self._p("projA", f"{sess}.jsonl")
        sub_path = self._p("projA", sess, "subagents", "agent-aaa.jsonl")
        _write_raw(main_path, [_assistant("m1", "r1", 5, "2026-08-19T10:00:01.000Z")])
        _write_raw(sub_path, [_assistant("m2", "r2", 9, "2026-08-19T10:00:02.000Z")])

        threads = self._threads(limit=20, unit=10)
        self.assertEqual(len(threads), 1)
        bins = threads[0]["bins"]
        self.assertEqual(len(bins), 1)
        agents = {a["key"]: a["total"] for a in bins[0]["agents"]}
        self.assertEqual(agents, {"main": 5, "agent-aaa": 9})
        # Ни одна запись не потеряна и не задвоена между главным агентом и субагентом.
        self.assertEqual(threads[0]["totalTokens"], 14)

    def test_agents_within_a_bin_are_sorted_by_total_desc(self):
        sess = "22222222-2222-2222-2222-222222222222"
        main_path = self._p("projA", f"{sess}.jsonl")
        sub_path = self._p("projA", sess, "subagents", "agent-bbb.jsonl")
        _write_raw(main_path, [_assistant("m1", "r1", 3, "2026-08-19T10:00:01.000Z")])
        _write_raw(sub_path, [_assistant("m2", "r2", 20, "2026-08-19T10:00:02.000Z")])

        threads = self._threads(limit=20, unit=10)
        agents = threads[0]["bins"][0]["agents"]
        self.assertEqual([a["key"] for a in agents], ["agent-bbb", "main"])

    def test_limit_caps_number_of_sessions_by_latest_activity(self):
        for i in range(5):
            path = self._p("projA", f"sess{i}.jsonl")
            _write_raw(path, [_assistant(f"m{i}", f"r{i}", 1, "2026-08-19T10:00:00.000Z")])
            os.utime(path, (1000 + i, 1000 + i))  # растущий mtime -> sess4 самый свежий

        threads = self._threads(limit=2, unit=300)
        self.assertEqual(len(threads), 2)
        got_sessions = [t["session"] for t in threads]
        self.assertEqual(got_sessions, ["sess4", "sess3"])

    def test_limit_zero_returns_no_threads(self):
        _write_raw(self._p("projA", "sess1.jsonl"), [_assistant("m1", "r1", 1, "2026-08-19T10:00:00.000Z")])
        threads = self._threads(limit=0, unit=300)
        self.assertEqual(threads, [])

    def test_project_filters_by_substring(self):
        _write_raw(
            self._p("-Users-e0068-Documents-Projects-bb-plugins", "sessA.jsonl"),
            [_assistant("m1", "r1", 1, "2026-08-19T10:00:00.000Z")],
        )
        _write_raw(
            self._p("-Users-e0068-Documents-Projects-other", "sessB.jsonl"),
            [_assistant("m2", "r2", 1, "2026-08-19T10:00:00.000Z")],
        )
        threads = self._threads(limit=20, unit=300, project="bb-plugins")
        self.assertEqual([t["session"] for t in threads], ["sessA"])

    def test_title_defaults_to_session_id(self):
        _write_raw(self._p("projA", "sess1.jsonl"), [_assistant("m1", "r1", 1, "2026-08-19T10:00:00.000Z")])
        threads = self._threads(limit=20, unit=300)
        self.assertEqual(threads[0]["title"], "sess1")


class AgentLabelsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def _p(self, *parts):
        return os.path.join(self.root, *parts)

    def test_empty_slice_has_empty_agent_labels(self):
        result = threads_timeline.build_timeline(self.root, limit=20, unit=300)
        self.assertEqual(result["agentLabels"], {})

    def test_main_agent_is_labelled_regardless_of_meta(self):
        _write_raw(self._p("projA", "sess1.jsonl"), [_assistant("m1", "r1", 1, "2026-08-19T10:00:00.000Z")])
        result = threads_timeline.build_timeline(self.root, limit=20, unit=300)
        self.assertEqual(result["agentLabels"]["main"], "Главный агент")

    def test_subagent_without_meta_falls_back_to_its_key(self):
        sess = "33333333-3333-3333-3333-333333333333"
        main_path = self._p("projA", f"{sess}.jsonl")
        sub_path = self._p("projA", sess, "subagents", "agent-nometa.jsonl")
        _write_raw(main_path, [_assistant("m1", "r1", 1, "2026-08-19T10:00:00.000Z")])
        _write_raw(sub_path, [_assistant("m2", "r2", 1, "2026-08-19T10:00:01.000Z")])
        # Нет agent-nometa.meta.json рядом — старый транскрипт без meta-файла.

        result = threads_timeline.build_timeline(self.root, limit=20, unit=300)
        self.assertEqual(result["agentLabels"]["agent-nometa"], "agent-nometa")

    def test_subagent_uses_meta_description_when_present(self):
        sess = "44444444-4444-4444-4444-444444444444"
        main_path = self._p("projA", f"{sess}.jsonl")
        sub_path = self._p("projA", sess, "subagents", "agent-desc.jsonl")
        _write_raw(main_path, [_assistant("m1", "r1", 1, "2026-08-19T10:00:00.000Z")])
        _write_raw(sub_path, [_assistant("m2", "r2", 1, "2026-08-19T10:00:01.000Z")])
        _write_meta(sub_path, {"agentType": "general-purpose", "description": "Ревью PR #42", "model": "sonnet"})

        result = threads_timeline.build_timeline(self.root, limit=20, unit=300)
        self.assertEqual(result["agentLabels"]["agent-desc"], "Ревью PR #42")

    def test_subagent_without_description_falls_back_to_agent_type(self):
        sess = "55555555-5555-5555-5555-555555555555"
        main_path = self._p("projA", f"{sess}.jsonl")
        sub_path = self._p("projA", sess, "subagents", "agent-type.jsonl")
        _write_raw(main_path, [_assistant("m1", "r1", 1, "2026-08-19T10:00:00.000Z")])
        _write_raw(sub_path, [_assistant("m2", "r2", 1, "2026-08-19T10:00:01.000Z")])
        _write_meta(sub_path, {"agentType": "code-reviewer", "description": None, "model": "sonnet"})

        result = threads_timeline.build_timeline(self.root, limit=20, unit=300)
        self.assertEqual(result["agentLabels"]["agent-type"], "code-reviewer")

    def test_long_description_is_truncated_to_about_60_chars(self):
        sess = "66666666-6666-6666-6666-666666666666"
        main_path = self._p("projA", f"{sess}.jsonl")
        sub_path = self._p("projA", sess, "subagents", "agent-long.jsonl")
        _write_raw(main_path, [_assistant("m1", "r1", 1, "2026-08-19T10:00:00.000Z")])
        _write_raw(sub_path, [_assistant("m2", "r2", 1, "2026-08-19T10:00:01.000Z")])
        long_desc = "A" * 120
        _write_meta(sub_path, {"agentType": "general-purpose", "description": long_desc, "model": "sonnet"})

        result = threads_timeline.build_timeline(self.root, limit=20, unit=300)
        label = result["agentLabels"]["agent-long"]
        self.assertLessEqual(len(label), 61)  # 60 символов + многоточие
        self.assertTrue(label.startswith("A" * 60))
        self.assertTrue(label.endswith("…"))

    def test_agent_key_matches_the_key_used_in_bins(self):
        sess = "77777777-7777-7777-7777-777777777777"
        main_path = self._p("projA", f"{sess}.jsonl")
        sub_path = self._p("projA", sess, "subagents", "agent-match.jsonl")
        _write_raw(main_path, [_assistant("m1", "r1", 1, "2026-08-19T10:00:00.000Z")])
        _write_raw(sub_path, [_assistant("m2", "r2", 1, "2026-08-19T10:00:01.000Z")])
        _write_meta(sub_path, {"agentType": "general-purpose", "description": "Ищет баги", "model": "sonnet"})

        result = threads_timeline.build_timeline(self.root, limit=20, unit=300)
        bin_keys = {a["key"] for t in result["threads"] for b in t["bins"] for a in b["agents"]}
        self.assertEqual(bin_keys, set(result["agentLabels"].keys()))


class MainCliTest(unittest.TestCase):
    """CLI/--json обвязка threads_timeline.main() (JsonAwareParser, --limit/--unit валидация)."""

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
        sys.argv = ["threads_timeline.py", *argv_tail]
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                try:
                    threads_timeline.main()
                except SystemExit:
                    pass
        finally:
            tokens.ROOT, sys.argv = old_root, old_argv
        return buf.getvalue()

    def test_json_output_carries_schema_version_and_unit(self):
        out = json.loads(self._run_json(["--json", "--unit", "60"]))
        self.assertEqual(out["schemaVersion"], threads_timeline.SCHEMA_VERSION)
        self.assertEqual(out["unit"], 60)
        self.assertEqual(out["threads"], [])
        self.assertEqual(out["agentLabels"], {})

    def test_missing_unit_emits_json_error_envelope_not_empty_stdout(self):
        out = self._run_json(["--json"])
        parsed = json.loads(out)
        self.assertIn("error", parsed)

    def test_negative_limit_emits_json_error_envelope(self):
        out = self._run_json(["--json", "--unit", "60", "--limit", "-1"])
        parsed = json.loads(out)
        self.assertIn("error", parsed)

    def test_zero_unit_emits_json_error_envelope(self):
        out = self._run_json(["--json", "--unit", "0"])
        parsed = json.loads(out)
        self.assertIn("error", parsed)

    def test_limit_not_passed_uses_default_without_parser_error(self):
        # --limit не передан -> должен уйти дефолт 20, без ошибки парсера.
        out = json.loads(self._run_json(["--json", "--unit", "60"]))
        self.assertEqual(out["threads"], [])


if __name__ == "__main__":
    unittest.main()
