"""Тесты хронологии агента (tools/agent_timeline.py) на синтетических .jsonl
во временном дереве, по форме ~/.claude/projects/<project>/<session>[.jsonl|/subagents/*].

Покрывает: извлечение tool_use по каждому инструменту (правильный target),
хук из attachment.hook_success, текст настоящего сообщения; отсев
tool_result/isMeta/isSidechain/local-command-stdout; хронологический порядок
по ts; субагент без .meta.json не падает; пустая сессия -> events=[].
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agent_timeline  # noqa: E402
import tokens  # noqa: E402


def write_jsonl(path, records):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")


def assistant_tool_use(ts, name, input_, tool_id="toolu_1"):
    return {
        "type": "assistant",
        "timestamp": ts,
        "message": {
            "role": "assistant",
            "content": [{"type": "tool_use", "id": tool_id, "name": name, "input": input_}],
        },
    }


def assistant_text(ts, text):
    return {
        "type": "assistant",
        "timestamp": ts,
        "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
    }


def assistant_text_with_usage(ts, text, usage, model="claude-sonnet-4"):
    return {
        "type": "assistant",
        "timestamp": ts,
        "message": {
            "role": "assistant",
            "model": model,
            "content": [{"type": "text", "text": text}],
            "usage": usage,
        },
    }


def user_message(ts, text):
    return {"type": "user", "timestamp": ts, "isSidechain": False, "message": {"role": "user", "content": text}}


def user_tool_result(ts, tool_id="toolu_1"):
    return {
        "type": "user",
        "timestamp": ts,
        "isSidechain": False,
        "message": {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": tool_id, "content": "ok"}],
        },
    }


def hook_success(ts, hook_name, hook_event):
    return {
        "type": "attachment",
        "timestamp": ts,
        "attachment": {"type": "hook_success", "hookName": hook_name, "hookEvent": hook_event, "toolUseID": "x"},
    }


class ToolTargetTest(unittest.TestCase):
    def test_read_edit_write_use_file_path(self):
        for name in ("Read", "Edit", "Write"):
            self.assertEqual(agent_timeline.tool_target(name, {"file_path": "/a/b.ts"}), "/a/b.ts")

    def test_glob_grep_use_pattern(self):
        for name in ("Glob", "Grep"):
            self.assertEqual(agent_timeline.tool_target(name, {"pattern": "*.ts"}), "*.ts")

    def test_bash_uses_command(self):
        self.assertEqual(agent_timeline.tool_target("Bash", {"command": "ls -la"}), "ls -la")

    def test_skill_uses_skill_field(self):
        self.assertEqual(agent_timeline.tool_target("Skill", {"skill": "git-hygiene"}), "git-hygiene")

    def test_task_uses_description_over_subagent_type(self):
        self.assertEqual(
            agent_timeline.tool_target("Task", {"description": "Review", "subagent_type": "general-purpose"}),
            "Review",
        )

    def test_task_falls_back_to_subagent_type(self):
        self.assertEqual(agent_timeline.tool_target("Task", {"subagent_type": "general-purpose"}), "general-purpose")

    def test_agent_alias_gets_same_treatment_as_task(self):
        # Реальные транскрипты называют инструмент "Agent", не "Task" — см.
        # AGENT_LAUNCH_TOOL_NAMES.
        self.assertEqual(agent_timeline.tool_target("Agent", {"description": "Review"}), "Review")

    def test_unknown_tool_has_no_target_without_a_matching_field(self):
        self.assertIsNone(agent_timeline.tool_target("SomeCustomTool", {"other": "x"}))

    def test_unknown_tool_falls_back_to_common_fields(self):
        self.assertEqual(agent_timeline.tool_target("SomeCustomTool", {"url": "https://x"}), "https://x")


class ExtractEventsTest(unittest.TestCase):
    def test_extracts_tool_event(self):
        records = [assistant_tool_use("2026-01-01T00:00:00Z", "Read", {"file_path": "/f.ts"})]
        events = agent_timeline.extract_events(records)
        self.assertEqual(events, [{"ts": "2026-01-01T00:00:00Z", "kind": "tool", "name": "Read", "target": "/f.ts"}])

    def test_extracts_hook_event(self):
        records = [hook_success("2026-01-01T00:00:01Z", "SessionStart:startup", "SessionStart")]
        events = agent_timeline.extract_events(records)
        self.assertEqual(
            events,
            [
                {
                    "ts": "2026-01-01T00:00:01Z",
                    "kind": "hook",
                    "hookName": "SessionStart:startup",
                    "hookEvent": "SessionStart",
                }
            ],
        )

    def test_extracts_real_user_message(self):
        records = [user_message("2026-01-01T00:00:02Z", "Сделай штуку")]
        events = agent_timeline.extract_events(records)
        self.assertEqual(
            events, [{"ts": "2026-01-01T00:00:02Z", "kind": "message", "role": "user", "text": "Сделай штуку"}]
        )

    def test_extracts_assistant_text_message(self):
        records = [assistant_text("2026-01-01T00:00:03Z", "Готово")]
        events = agent_timeline.extract_events(records)
        self.assertEqual(
            events, [{"ts": "2026-01-01T00:00:03Z", "kind": "message", "role": "assistant", "text": "Готово"}]
        )

    def test_drops_tool_result_records(self):
        records = [user_tool_result("2026-01-01T00:00:04Z")]
        self.assertEqual(agent_timeline.extract_events(records), [])

    def test_drops_is_meta_records(self):
        records = [
            {
                "type": "user",
                "timestamp": "2026-01-01T00:00:05Z",
                "isMeta": True,
                "message": {"role": "user", "content": "system-injected text"},
            }
        ]
        self.assertEqual(agent_timeline.extract_events(records), [])

    def test_drops_is_sidechain_records(self):
        records = [
            {
                "type": "user",
                "timestamp": "2026-01-01T00:00:06Z",
                "isSidechain": True,
                "message": {"role": "user", "content": "sidechain text"},
            }
        ]
        self.assertEqual(agent_timeline.extract_events(records), [])

    def test_drops_local_command_stdout(self):
        records = [user_message("2026-01-01T00:00:07Z", "<local-command-stdout>Set model</local-command-stdout>")]
        self.assertEqual(agent_timeline.extract_events(records), [])

    def test_sorts_events_by_ts(self):
        records = [
            assistant_text("2026-01-01T00:00:03Z", "third"),
            user_message("2026-01-01T00:00:01Z", "first"),
            hook_success("2026-01-01T00:00:02Z", "H", "E"),
        ]
        events = agent_timeline.extract_events(records)
        self.assertEqual([e["ts"] for e in events], [
            "2026-01-01T00:00:01Z",
            "2026-01-01T00:00:02Z",
            "2026-01-01T00:00:03Z",
        ])

    def test_empty_records_give_empty_events(self):
        self.assertEqual(agent_timeline.extract_events([]), [])


class ExcerptTest(unittest.TestCase):
    def test_short_text_unchanged(self):
        self.assertEqual(agent_timeline.excerpt("hi"), "hi")

    def test_long_text_truncated_with_ellipsis(self):
        long_text = "x" * (agent_timeline.EXCERPT_MAX + 50)
        out = agent_timeline.excerpt(long_text)
        self.assertEqual(len(out), agent_timeline.EXCERPT_MAX)
        self.assertTrue(out.endswith("…"))

    def test_non_string_returns_empty(self):
        self.assertEqual(agent_timeline.excerpt(None), "")


class BuildTimelineTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def _project(self, name="proj"):
        return os.path.join(self.root, name)

    def test_main_agent_timeline(self):
        session = "sess-main-1"
        main_path = os.path.join(self._project(), f"{session}.jsonl")
        write_jsonl(
            main_path,
            [
                user_message("2026-01-01T00:00:00Z", "Привет"),
                assistant_tool_use("2026-01-01T00:00:01Z", "Bash", {"command": "ls"}),
            ],
        )

        out = agent_timeline.build_timeline(self.root, session, "main")

        self.assertEqual(out["schemaVersion"], agent_timeline.SCHEMA_VERSION)
        self.assertEqual(out["agent"]["key"], "main")
        self.assertIsNone(out["agent"]["promptExcerpt"])
        self.assertEqual(len(out["events"]), 2)

    def test_session_prefix_resolves_to_full_id(self):
        session = "sess-prefix-abcdef"
        main_path = os.path.join(self._project(), f"{session}.jsonl")
        write_jsonl(main_path, [user_message("2026-01-01T00:00:00Z", "hi")])

        out = agent_timeline.build_timeline(self.root, "sess-prefix", "main")
        self.assertEqual(len(out["events"]), 1)

    def test_missing_session_raises(self):
        with self.assertRaises(RuntimeError):
            agent_timeline.build_timeline(self.root, "no-such-session", "main")

    def test_empty_session_gives_empty_events(self):
        session = "sess-empty"
        main_path = os.path.join(self._project(), f"{session}.jsonl")
        write_jsonl(main_path, [])

        out = agent_timeline.build_timeline(self.root, session, "main")
        self.assertEqual(out["events"], [])

    def test_subagent_with_meta_and_matching_task_prompt(self):
        session = "sess-agent-1"
        project = self._project()
        tool_id = "toolu_task_1"
        main_path = os.path.join(project, f"{session}.jsonl")
        write_jsonl(
            main_path,
            [assistant_tool_use("2026-01-01T00:00:00Z", "Task", {
                "description": "Review the diff",
                "subagent_type": "general-purpose",
                "prompt": "Please review the diff carefully",
            }, tool_id=tool_id)],
        )

        agent_key = "agent-abc123"
        agent_path = os.path.join(project, session, "subagents", f"{agent_key}.jsonl")
        write_jsonl(
            agent_path,
            [assistant_text("2026-01-01T00:00:05Z", "Looks good")],
        )
        meta_path = os.path.join(project, session, "subagents", f"{agent_key}.meta.json")
        with open(meta_path, "w") as f:
            json.dump(
                {
                    "agentType": "general-purpose",
                    "description": "Review the diff",
                    "toolUseId": tool_id,
                    "spawnDepth": 1,
                    "model": "sonnet",
                },
                f,
            )

        out = agent_timeline.build_timeline(self.root, session, agent_key)

        self.assertEqual(out["agent"]["key"], agent_key)
        self.assertEqual(out["agent"]["agentType"], "general-purpose")
        self.assertEqual(out["agent"]["description"], "Review the diff")
        self.assertEqual(out["agent"]["model"], "sonnet")
        self.assertEqual(out["agent"]["spawnDepth"], 1)
        self.assertEqual(out["agent"]["promptExcerpt"], "Please review the diff carefully")
        self.assertEqual(len(out["events"]), 1)

    def test_subagent_without_meta_does_not_crash(self):
        session = "sess-agent-2"
        project = self._project()
        main_path = os.path.join(project, f"{session}.jsonl")
        write_jsonl(main_path, [])

        agent_key = "agent-nometa"
        agent_path = os.path.join(project, session, "subagents", f"{agent_key}.jsonl")
        write_jsonl(agent_path, [assistant_text("2026-01-01T00:00:00Z", "hi")])
        # no .meta.json written on purpose

        out = agent_timeline.build_timeline(self.root, session, agent_key)

        self.assertEqual(out["agent"]["key"], agent_key)
        self.assertIsNone(out["agent"]["agentType"])
        self.assertIsNone(out["agent"]["description"])
        self.assertIsNone(out["agent"]["model"])
        self.assertIsNone(out["agent"]["spawnDepth"])
        self.assertIsNone(out["agent"]["promptExcerpt"])
        self.assertEqual(len(out["events"]), 1)


class MessageCostTest(unittest.TestCase):
    """Стоимость на assistant-сообщениях (не на строках-инструментах) —
    решение владельца: тарификация на вызов модели. Тариф реюзается из
    tools/tokens.py (Bucket), здесь сверяется, что результат совпадает."""

    def test_assistant_message_carries_tokens_and_cost(self):
        usage = {
            "input_tokens": 100,
            "cache_read_input_tokens": 40,
            "output_tokens": 50,
        }
        record = assistant_text_with_usage("2026-01-01T00:00:00Z", "Готово", usage, model="claude-sonnet-4")

        events = agent_timeline.extract_events([record])

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["role"], "assistant")

        expected = tokens.Bucket()
        expected.add(usage, "claude-sonnet-4", "2026-01-01T00:00:00Z")
        self.assertEqual(event["tokens"], expected.total)
        self.assertAlmostEqual(event["cost"], round(expected.cost, 2))
        # ручная сверка с тарифом sonnet, чтобы не полагаться только на Bucket
        pi, po = tokens.PRICES["sonnet"]
        manual_cost = round((100 * pi + 40 * pi * tokens.CACHE_READ + 50 * po) / 1e6, 2)
        self.assertAlmostEqual(event["cost"], manual_cost)

    def test_user_message_has_no_price(self):
        record = user_message("2026-01-01T00:00:00Z", "Сделай штуку")

        events = agent_timeline.extract_events([record])

        self.assertEqual(len(events), 1)
        self.assertNotIn("tokens", events[0])
        self.assertNotIn("cost", events[0])

    def test_assistant_message_without_usage_has_no_price(self):
        # assistant_text() (без message.usage) — старый формат/синтетика без
        # usage-поля не должна падать, просто без цены.
        record = assistant_text("2026-01-01T00:00:00Z", "Готово")

        events = agent_timeline.extract_events([record])

        self.assertEqual(len(events), 1)
        self.assertNotIn("tokens", events[0])
        self.assertNotIn("cost", events[0])

    def test_turn_message_costs_sum_to_turn_cost(self):
        # "Ход" — несколько assistant-сообщений подряд (напр. промежуточный
        # текст + финальный ответ). Сумма cost по message-событиям хода
        # обязана совпасть со стоимостью хода, посчитанной по объединённому
        # usage тем же тарифом.
        usage_a = {"input_tokens": 1_000_000, "output_tokens": 500_000}
        usage_b = {"input_tokens": 2_000_000, "cache_read_input_tokens": 900_000, "output_tokens": 300_000}
        records = [
            assistant_text_with_usage("2026-01-01T00:00:00Z", "первый шаг", usage_a, model="claude-sonnet-4"),
            assistant_text_with_usage("2026-01-01T00:00:01Z", "второй шаг", usage_b, model="claude-sonnet-4"),
        ]

        events = agent_timeline.extract_events(records)
        message_events = [e for e in events if e["kind"] == "message"]

        turn_bucket = tokens.Bucket()
        turn_bucket.add(usage_a, "claude-sonnet-4", records[0]["timestamp"])
        turn_bucket.add(usage_b, "claude-sonnet-4", records[1]["timestamp"])

        self.assertAlmostEqual(sum(e["cost"] for e in message_events), round(turn_bucket.cost, 2), places=2)


if __name__ == "__main__":
    unittest.main()
