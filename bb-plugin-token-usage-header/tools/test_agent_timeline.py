"""Tests for the agent timeline (tools/agent_timeline.py) on synthetic .jsonl
in a temporary tree, shaped like ~/.claude/projects/<project>/<session>[.jsonl|/subagents/*].

Covers: extracting tool_use per tool (correct target), a hook from
attachment.hook_success, real message text; filtering out
tool_result/isMeta/isSidechain/local-command-stdout; chronological order by
ts; a subagent without .meta.json doesn't crash; an empty session -> events=[].
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


def assistant_text(ts, text, is_sidechain=False):
    return {
        "type": "assistant",
        "timestamp": ts,
        "isSidechain": is_sidechain,
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


def user_message(ts, text, is_sidechain=False):
    return {"type": "user", "timestamp": ts, "isSidechain": is_sidechain, "message": {"role": "user", "content": text}}


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
        # Real transcripts call the tool "Agent", not "Task" — see
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
        records = [user_message("2026-01-01T00:00:02Z", "Do the thing")]
        events = agent_timeline.extract_events(records)
        self.assertEqual(
            events,
            [
                {
                    "ts": "2026-01-01T00:00:02Z",
                    "kind": "message",
                    "role": "user",
                    "text": "Do the thing",
                    "fullText": "Do the thing",
                    "fullTextTruncated": False,
                }
            ],
        )

    def test_extracts_assistant_text_message(self):
        records = [assistant_text("2026-01-01T00:00:03Z", "Done")]
        events = agent_timeline.extract_events(records)
        self.assertEqual(
            events,
            [
                {
                    "ts": "2026-01-01T00:00:03Z",
                    "kind": "message",
                    "role": "assistant",
                    "text": "Done",
                    "fullText": "Done",
                    "fullTextTruncated": False,
                }
            ],
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
        # The real meaning of isSidechain is "this record comes from a
        # subagent branch mixed into the MAIN transcript"; own_file
        # (default False) here means exactly "we're reading the main
        # transcript" — dropping such records from it is correct.
        records = [user_message("2026-01-01T00:00:06Z", "sidechain text", is_sidechain=True)]
        self.assertEqual(agent_timeline.extract_events(records), [])

    def test_own_file_keeps_sidechain_records_a_subagent_transcript_marks_on_every_line(self):
        # Regression: in a subagent's OWN file (agent-<id>.jsonl), real
        # Claude Code transcripts set isSidechain=True on literally EVERY
        # record — this is a marker that "the whole file is a side
        # branch," not "this message is internal." Without own_file=True
        # this dropped every single text message of the agent, including
        # its own first prompt: a real agent with 194 events in its
        # timeline showed 0 message events. own_file=True is what reads
        # the agent's OWN file, not the main transcript, so the record
        # isn't mixed in from somewhere else — it genuinely belongs to
        # this conversation.
        records = [
            user_message("2026-01-01T00:00:00Z", "Do the task", is_sidechain=True),
            assistant_text("2026-01-01T00:00:01Z", "Done", is_sidechain=True),
        ]
        events = agent_timeline.extract_events(records, own_file=True)
        self.assertEqual([(e["kind"], e.get("role"), e.get("text")) for e in events], [
            ("message", "user", "Do the task"),
            ("message", "assistant", "Done"),
        ])

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

    def test_message_fullText_carries_the_whole_text_past_the_excerpt_cap(self):
        # text (preview) is truncated at EXCERPT_MAX; fullText at the far
        # more generous FULL_TEXT_MAX, so an expanded timeline row shows
        # the message in full, not a 300-character stump.
        long_text = "p" * (agent_timeline.EXCERPT_MAX + 200)
        records = [user_message("2026-01-01T00:00:00Z", long_text)]
        [event] = agent_timeline.extract_events(records)
        self.assertEqual(len(event["text"]), agent_timeline.EXCERPT_MAX)
        self.assertEqual(event["fullText"], long_text)
        self.assertFalse(event["fullTextTruncated"])

    def test_message_fullText_truncates_past_its_own_higher_cap(self):
        long_text = "o" * (agent_timeline.FULL_TEXT_MAX + 500)
        records = [assistant_text("2026-01-01T00:00:00Z", long_text)]
        [event] = agent_timeline.extract_events(records)
        self.assertEqual(len(event["fullText"]), agent_timeline.FULL_TEXT_MAX)
        self.assertTrue(event["fullTextTruncated"])


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


class FullRequestResponseTest(unittest.TestCase):
    def test_full_request_is_first_real_user_message_untruncated(self):
        long_text = "x" * (agent_timeline.EXCERPT_MAX + 50)
        records = [user_message("2026-01-01T00:00:00Z", long_text)]
        text, truncated = agent_timeline.full_request(records)
        self.assertEqual(text, long_text)
        self.assertFalse(truncated)

    def test_full_request_ignores_tool_result_and_later_user_messages(self):
        records = [
            user_message("2026-01-01T00:00:00Z", "first"),
            user_tool_result("2026-01-01T00:00:01Z"),
            user_message("2026-01-01T00:00:02Z", "second, should be ignored"),
        ]
        text, truncated = agent_timeline.full_request(records)
        self.assertEqual(text, "first")
        self.assertFalse(truncated)

    def test_full_request_none_when_no_real_user_message(self):
        records = [user_tool_result("2026-01-01T00:00:00Z")]
        self.assertEqual(agent_timeline.full_request(records), (None, False))

    def test_full_request_without_own_file_drops_sidechain_marked_message(self):
        records = [user_message("2026-01-01T00:00:00Z", "from the main transcript", is_sidechain=True)]
        self.assertEqual(agent_timeline.full_request(records), (None, False))

    def test_full_request_with_own_file_keeps_sidechain_marked_message(self):
        # Regression: a subagent's own file sets isSidechain=True on every
        # record, including its own first prompt.
        records = [user_message("2026-01-01T00:00:00Z", "agent prompt", is_sidechain=True)]
        text, truncated = agent_timeline.full_request(records, own_file=True)
        self.assertEqual(text, "agent prompt")
        self.assertFalse(truncated)

    def test_full_request_truncates_past_the_cap(self):
        long_text = "y" * (agent_timeline.FULL_TEXT_MAX + 100)
        records = [user_message("2026-01-01T00:00:00Z", long_text)]
        text, truncated = agent_timeline.full_request(records)
        self.assertEqual(len(text), agent_timeline.FULL_TEXT_MAX)
        self.assertTrue(truncated)

    def test_full_response_is_last_assistant_message_untruncated(self):
        records = [assistant_text("2026-01-01T00:00:00Z", "first"), assistant_text("2026-01-01T00:00:01Z", "last")]
        text, truncated = agent_timeline.full_response(records)
        self.assertEqual(text, "last")
        self.assertFalse(truncated)

    def test_full_response_without_own_file_drops_sidechain_marked_message(self):
        records = [assistant_text("2026-01-01T00:00:00Z", "from the main transcript", is_sidechain=True)]
        self.assertEqual(agent_timeline.full_response(records), (None, False))

    def test_full_response_with_own_file_keeps_sidechain_marked_message(self):
        records = [assistant_text("2026-01-01T00:00:00Z", "agent response", is_sidechain=True)]
        text, truncated = agent_timeline.full_response(records, own_file=True)
        self.assertEqual(text, "agent response")
        self.assertFalse(truncated)

    def test_full_response_none_when_transcript_ends_on_tool_use(self):
        records = [
            assistant_text("2026-01-01T00:00:00Z", "intermediate response"),
            assistant_tool_use("2026-01-01T00:00:01Z", "Bash", {"command": "ls"}),
        ]
        self.assertEqual(agent_timeline.full_response(records), (None, False))

    def test_full_response_none_on_empty_records(self):
        self.assertEqual(agent_timeline.full_response([]), (None, False))

    def test_full_response_truncates_past_the_cap(self):
        long_text = "z" * (agent_timeline.FULL_TEXT_MAX + 100)
        records = [assistant_text("2026-01-01T00:00:00Z", long_text)]
        text, truncated = agent_timeline.full_response(records)
        self.assertEqual(len(text), agent_timeline.FULL_TEXT_MAX)
        self.assertTrue(truncated)


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
                user_message("2026-01-01T00:00:00Z", "Hi"),
                assistant_tool_use("2026-01-01T00:00:01Z", "Bash", {"command": "ls"}),
            ],
        )

        out = agent_timeline.build_timeline(self.root, session, "main")

        self.assertEqual(out["schemaVersion"], agent_timeline.SCHEMA_VERSION)
        self.assertEqual(out["agent"]["key"], "main")
        self.assertIsNone(out["agent"]["promptExcerpt"])
        self.assertEqual(out["agent"]["requestFull"], "Hi")
        self.assertFalse(out["agent"]["requestFullTruncated"])
        # Only a tool_use assistant record exists — no text -> no response.
        self.assertIsNone(out["agent"]["responseFull"])
        self.assertFalse(out["agent"]["responseFullTruncated"])
        self.assertEqual(len(out["events"]), 2)

    def test_pr_numbers_is_empty_without_any_pr_link_record(self):
        session = "sess-no-pr"
        main_path = os.path.join(self._project(), f"{session}.jsonl")
        write_jsonl(main_path, [user_message("2026-01-01T00:00:00Z", "Hi")])

        out = agent_timeline.build_timeline(self.root, session, "main")
        self.assertEqual(out["prNumbers"], [])

    def test_pr_numbers_collects_distinct_numbers_sorted_from_main_and_subagent_files(self):
        session = "sess-pr"
        main_path = os.path.join(self._project(), f"{session}.jsonl")
        write_jsonl(
            main_path,
            [
                {
                    "type": "pr-link",
                    "sessionId": session,
                    "prNumber": 73,
                    "prUrl": "https://github.com/e0068/bb-plugins/pull/73",
                    "prRepository": "e0068/bb-plugins",
                    "timestamp": "2026-01-01T00:00:01Z",
                },
                # A duplicate mention of the same PR (re-printed later in the
                # session) must not produce a second entry.
                {
                    "type": "pr-link",
                    "sessionId": session,
                    "prNumber": 73,
                    "prUrl": "https://github.com/e0068/bb-plugins/pull/73",
                    "prRepository": "e0068/bb-plugins",
                    "timestamp": "2026-01-01T00:05:00Z",
                },
            ],
        )
        subagent_path = os.path.join(self._project(), session, "subagents", "agent-1.jsonl")
        write_jsonl(
            subagent_path,
            [
                {
                    "type": "pr-link",
                    "sessionId": session,
                    "prNumber": 10,
                    "prUrl": "https://github.com/e0068/bb-plugins/pull/10",
                    "prRepository": "e0068/bb-plugins",
                    "timestamp": "2026-01-01T00:00:02Z",
                },
            ],
        )

        out = agent_timeline.build_timeline(self.root, session, "main")
        self.assertEqual(
            out["prNumbers"],
            [
                {"number": 10, "repository": "e0068/bb-plugins"},
                {"number": 73, "repository": "e0068/bb-plugins"},
            ],
        )

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
        # requestFull comes from the AGENT's OWN transcript (its own first
        # user record), not from main_records/promptExcerpt — this fixture's
        # agent transcript has no user record at all, so it's None.
        self.assertIsNone(out["agent"]["requestFull"])
        self.assertEqual(out["agent"]["responseFull"], "Looks good")
        self.assertFalse(out["agent"]["responseFullTruncated"])
        self.assertEqual(len(out["events"]), 1)

    def test_subagent_nested_under_workflow_run_is_found(self):
        # Regression: subagents of workflow runs are written one level
        # deeper (subagents/workflows/<runId>/agent-<hash>.jsonl), not
        # directly in subagents/. build_timeline used to look only at the
        # direct path and silently got events=[] for any such agent — see
        # find_agent_file.
        session = "sess-workflow-1"
        project = self._project()
        main_path = os.path.join(project, f"{session}.jsonl")
        write_jsonl(main_path, [])

        agent_key = "agent-nested123"
        agent_path = os.path.join(project, session, "subagents", "workflows", "wf_abc-123", f"{agent_key}.jsonl")
        # is_sidechain=True on both records — that's what a subagent's file
        # actually looks like (verified on live data: every line in its own
        # .jsonl carries isSidechain=True). Without own_file=True in
        # build_timeline this would give 0 message events despite the file
        # being found.
        write_jsonl(
            agent_path,
            [
                user_message("2026-01-01T00:00:00Z", "Do the workflow task", is_sidechain=True),
                assistant_text("2026-01-01T00:00:01Z", "done", is_sidechain=True),
            ],
        )
        meta_path = os.path.join(project, session, "subagents", "workflows", "wf_abc-123", f"{agent_key}.meta.json")
        # Realistic: subagents of workflow runs have no toolUseId at all in
        # meta.json (they're launched not by a Task/Agent block in the main
        # transcript) — not "toolUseId": None, but the field is absent.
        with open(meta_path, "w") as f:
            json.dump({"agentType": "general-purpose", "spawnDepth": 1, "model": "sonnet"}, f)

        out = agent_timeline.build_timeline(self.root, session, agent_key)

        self.assertEqual(out["agent"]["key"], agent_key)
        self.assertEqual(out["agent"]["agentType"], "general-purpose")
        self.assertEqual(len(out["events"]), 2)
        self.assertEqual(out["events"][1]["text"], "done")
        # promptExcerpt fails for a workflow subagent (no toolUseId to match
        # in main_records) — requestFull succeeds anyway because it reads
        # the agent's own transcript instead. This is the actual fix for the
        # real-world symptom: "Session timeline: 0 events" plus no visible
        # input/output for exactly this kind of agent.
        self.assertIsNone(out["agent"]["promptExcerpt"])
        self.assertEqual(out["agent"]["requestFull"], "Do the workflow task")
        self.assertEqual(out["agent"]["responseFull"], "done")

    def test_subagent_direct_path_preferred_over_nested_glob(self):
        # If the file lives directly in subagents/ (a regular, non-workflow
        # subagent), find_agent_file must not fall into a recursive search
        # and find something else — the direct path takes priority.
        session = "sess-direct-1"
        project = self._project()
        write_jsonl(os.path.join(project, f"{session}.jsonl"), [])

        agent_key = "agent-direct1"
        direct_path = os.path.join(project, session, "subagents", f"{agent_key}.jsonl")
        write_jsonl(direct_path, [assistant_text("2026-01-01T00:00:00Z", "direct file")])

        found = agent_timeline.find_agent_file(project, session, agent_key)
        self.assertEqual(found, direct_path)

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
    """Cost on assistant messages (not on tool-use lines) — owner's
    decision: pricing per model call. Pricing is reused from
    tools/tokens.py (Bucket); here it's checked that the result matches."""

    def test_assistant_message_carries_tokens_and_cost(self):
        usage = {
            "input_tokens": 100,
            "cache_read_input_tokens": 40,
            "output_tokens": 50,
        }
        record = assistant_text_with_usage("2026-01-01T00:00:00Z", "Done", usage, model="claude-sonnet-4")

        events = agent_timeline.extract_events([record])

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["role"], "assistant")

        expected = tokens.Bucket()
        expected.add(usage, "claude-sonnet-4", "2026-01-01T00:00:00Z")
        self.assertEqual(event["tokens"], expected.total)
        self.assertAlmostEqual(event["cost"], round(expected.cost, 2))
        # manual cross-check against sonnet pricing, to not rely solely on Bucket
        pi, po = tokens.PRICES["sonnet"]
        manual_cost = round((100 * pi + 40 * pi * tokens.CACHE_READ + 50 * po) / 1e6, 2)
        self.assertAlmostEqual(event["cost"], manual_cost)

    def test_user_message_has_no_price(self):
        record = user_message("2026-01-01T00:00:00Z", "Do the thing")

        events = agent_timeline.extract_events([record])

        self.assertEqual(len(events), 1)
        self.assertNotIn("tokens", events[0])
        self.assertNotIn("cost", events[0])

    def test_assistant_message_without_usage_has_no_price(self):
        # assistant_text() (without message.usage) — legacy format/synthetic
        # data without a usage field must not crash, just come without a price.
        record = assistant_text("2026-01-01T00:00:00Z", "Done")

        events = agent_timeline.extract_events([record])

        self.assertEqual(len(events), 1)
        self.assertNotIn("tokens", events[0])
        self.assertNotIn("cost", events[0])

    def test_turn_message_costs_sum_to_turn_cost(self):
        # A "turn" is several assistant messages in a row (e.g. intermediate
        # text + final answer). The sum of cost over the turn's message
        # events must match the turn's cost computed from combined usage
        # with the same pricing.
        usage_a = {"input_tokens": 1_000_000, "output_tokens": 500_000}
        usage_b = {"input_tokens": 2_000_000, "cache_read_input_tokens": 900_000, "output_tokens": 300_000}
        records = [
            assistant_text_with_usage("2026-01-01T00:00:00Z", "first step", usage_a, model="claude-sonnet-4"),
            assistant_text_with_usage("2026-01-01T00:00:01Z", "second step", usage_b, model="claude-sonnet-4"),
        ]

        events = agent_timeline.extract_events(records)
        message_events = [e for e in events if e["kind"] == "message"]

        turn_bucket = tokens.Bucket()
        turn_bucket.add(usage_a, "claude-sonnet-4", records[0]["timestamp"])
        turn_bucket.add(usage_b, "claude-sonnet-4", records[1]["timestamp"])

        self.assertAlmostEqual(sum(e["cost"] for e in message_events), round(turn_bucket.cost, 2), places=2)


if __name__ == "__main__":
    unittest.main()
