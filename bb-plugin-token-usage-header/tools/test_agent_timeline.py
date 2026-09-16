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
    """Cost on assistant messages — owner's decision: pricing per model call.
    Pricing is reused from tools/tokens.py (Bucket); here it's checked that
    the result matches. How one call is priced exactly once — CallPricingTest."""

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


def assistant_call_record(ts, content, usage, msg_id, request_id="req_1", model="claude-opus-4-5"):
    """One transcript line of a model call: Claude Code writes a response as
    several lines sharing (message.id, requestId), one content block each."""
    return {
        "type": "assistant",
        "timestamp": ts,
        "requestId": request_id,
        "message": {"id": msg_id, "role": "assistant", "model": model, "content": content, "usage": usage},
    }


def priced(events):
    return [e for e in events if "cost" in e]


class CallPricingTest(unittest.TestCase):
    """Every model call is priced exactly once, from its last transcript line
    — the same dedup tools/tokens.py applies — so a turn's events add up to
    the totals panel."""

    def _cost(self, usage, model="claude-opus-4-5"):
        b = tokens.Bucket()
        b.add(usage, model, "2026-01-01T00:00:00Z")
        return b

    def test_call_split_into_lines_is_priced_once_on_its_text_with_the_last_usage(self):
        partial = {"input_tokens": 10, "cache_read_input_tokens": 5000, "output_tokens": 3}
        final = {"input_tokens": 10, "cache_read_input_tokens": 5000, "output_tokens": 900}
        records = [
            assistant_call_record("2026-01-01T00:00:00Z", [{"type": "thinking", "thinking": "hm"}], partial, "msg_1"),
            assistant_call_record("2026-01-01T00:00:01Z", [{"type": "text", "text": "Reading"}], partial, "msg_1"),
            assistant_call_record(
                "2026-01-01T00:00:02Z",
                [{"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "a"}}],
                final,
                "msg_1",
            ),
        ]

        events = agent_timeline.extract_events(records)

        self.assertEqual([(e["kind"], e.get("role")) for e in priced(events)], [("message", "assistant")])
        self.assertEqual(priced(events)[0]["tokens"], self._cost(final).total)
        self.assertAlmostEqual(priced(events)[0]["cost"], self._cost(final).cost, places=9)

    def test_call_with_only_tool_use_is_priced_on_its_first_tool_event(self):
        usage = {"input_tokens": 4, "cache_read_input_tokens": 80_000, "output_tokens": 200}
        records = [
            assistant_call_record(
                "2026-01-01T00:00:00Z",
                [{"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "a"}}],
                usage,
                "msg_1",
            ),
            assistant_call_record(
                "2026-01-01T00:00:00Z",
                [{"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "ls"}}],
                usage,
                "msg_1",
            ),
        ]

        events = agent_timeline.extract_events(records)

        self.assertEqual([e["kind"] for e in events], ["tool", "tool"])
        self.assertEqual(priced(events), [events[0]])
        self.assertEqual(events[0]["name"], "Read")
        self.assertAlmostEqual(events[0]["cost"], self._cost(usage).cost, places=9)

    def test_call_with_two_text_lines_is_priced_once(self):
        usage = {"input_tokens": 4, "cache_read_input_tokens": 80_000, "output_tokens": 200}
        records = [
            assistant_call_record("2026-01-01T00:00:00Z", [{"type": "text", "text": "one"}], usage, "msg_1"),
            assistant_call_record("2026-01-01T00:00:01Z", [{"type": "text", "text": "two"}], usage, "msg_1"),
        ]

        events = agent_timeline.extract_events(records)

        self.assertEqual(len(priced(events)), 1)
        self.assertEqual(priced(events)[0]["text"], "one")

    def test_cost_keeps_fractions_of_a_cent(self):
        usage = {"input_tokens": 100, "cache_read_input_tokens": 40, "output_tokens": 50}
        record = assistant_call_record("2026-01-01T00:00:00Z", [{"type": "text", "text": "ok"}], usage, "msg_1")

        (event,) = agent_timeline.extract_events([record])

        self.assertAlmostEqual(event["cost"], self._cost(usage).cost, places=9)
        self.assertNotEqual(event["cost"], round(event["cost"], 2))

    def test_event_costs_of_a_session_add_up_to_the_totals_counter(self):
        read = [{"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "a"}}]
        records = [
            user_message("2026-01-01T00:00:00Z", "go"),
            assistant_call_record("2026-01-01T00:00:01Z", [{"type": "thinking", "thinking": "x"}],
                                  {"input_tokens": 3, "cache_creation_input_tokens": 9000, "output_tokens": 1}, "m1", "r1"),
            assistant_call_record("2026-01-01T00:00:01Z", read,
                                  {"input_tokens": 3, "cache_creation_input_tokens": 9000, "output_tokens": 70}, "m1", "r1"),
            user_tool_result("2026-01-01T00:00:02Z", "t1"),
            assistant_call_record("2026-01-01T00:00:03Z", [{"type": "text", "text": "half"}],
                                  {"input_tokens": 1, "cache_read_input_tokens": 9000, "output_tokens": 5}, "m2", "r2"),
            assistant_call_record("2026-01-01T00:00:03Z", [{"type": "text", "text": "done"}],
                                  {"input_tokens": 1, "cache_read_input_tokens": 9000, "output_tokens": 400}, "m2", "r2"),
        ]
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "proj", "sess.jsonl")
            write_jsonl(path, records)
            totals = tokens.Bucket()
            for rec in tokens.walk([path]):
                totals.add(rec["usage"], rec["model"], rec["ts"])

        events = agent_timeline.extract_events(records)

        self.assertEqual(len(priced(events)), 2)
        self.assertAlmostEqual(sum(e["cost"] for e in events if "cost" in e), totals.cost, places=9)
        self.assertEqual(sum(e["tokens"] for e in events if "tokens" in e), totals.total)


    def test_call_with_neither_text_nor_tools_is_still_priced_once(self):
        # A response interrupted mid-thinking: no text to show, no tool to
        # hang the price on — it still costs money and must reach the turn.
        usage = {"input_tokens": 2, "cache_read_input_tokens": 120_000, "output_tokens": 800}
        records = [
            user_message("2026-01-01T00:00:00Z", "go"),
            assistant_call_record("2026-01-01T00:00:01Z", [{"type": "thinking", "thinking": "a"}], usage, "m1"),
            assistant_call_record("2026-01-01T00:00:02Z", [{"type": "thinking", "thinking": "b"}], usage, "m1"),
        ]

        events = agent_timeline.extract_events(records)

        self.assertEqual(len(priced(events)), 1)
        self.assertEqual((priced(events)[0]["kind"], priced(events)[0]["role"]), ("message", "assistant"))
        self.assertAlmostEqual(priced(events)[0]["cost"], self._cost(usage).cost, places=9)

    def test_event_costs_of_a_mixed_model_session_add_up_to_the_totals_counter(self):
        records = [
            user_message("2026-01-01T00:00:00Z", "go"),
            assistant_call_record("2026-01-01T00:00:01Z", [{"type": "text", "text": "opus"}],
                                  {"input_tokens": 3, "cache_read_input_tokens": 900_000, "output_tokens": 5}, "m1", "r1",
                                  model="claude-opus-4-5"),
            assistant_call_record("2026-01-01T00:00:02Z", [{"type": "text", "text": "sonnet"}],
                                  {"input_tokens": 3, "cache_creation_input_tokens": 9000, "output_tokens": 4000}, "m2", "r2",
                                  model="claude-sonnet-4-5"),
        ]
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "proj", "sess.jsonl")
            write_jsonl(path, records)
            totals = tokens.Bucket()
            for rec in tokens.walk([path]):
                totals.add(rec["usage"], rec["model"], rec["ts"])

        events = agent_timeline.extract_events(records)

        self.assertAlmostEqual(sum(e["cost"] for e in priced(events)), totals.cost, places=9)

class WorkflowFlowTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.project = os.path.join(self.root, "proj")
        self.session = "sess-wf"
        self.run_id = "wf_run-1"
        # Empty main transcript — a workflow run's members are launched by the
        # engine, not by Task blocks in the main file.
        write_jsonl(os.path.join(self.project, f"{self.session}.jsonl"), [])

    def tearDown(self):
        self._tmp.cleanup()

    def _member_dir(self):
        return os.path.join(self.project, self.session, "subagents", "workflows", self.run_id)

    def _write_member(self, agent_key, records, meta=None):
        write_jsonl(os.path.join(self._member_dir(), f"{agent_key}.jsonl"), records)
        if meta is not None:
            with open(os.path.join(self._member_dir(), f"{agent_key}.meta.json"), "w") as f:
                json.dump(meta, f)

    def _write_script(self, name):
        scripts_dir = os.path.join(self.project, self.session, "workflows", "scripts")
        os.makedirs(scripts_dir, exist_ok=True)
        open(os.path.join(scripts_dir, f"{name}-{self.run_id}.js"), "w").close()

    def test_flow_has_a_section_per_member_ordered_by_first_event_time(self):
        # agent-b starts LATER than agent-a — despite sorting after nothing in
        # particular by hash, the section order is launch (first-event) order.
        self._write_member(
            "agent-b",
            [assistant_text("2026-01-01T00:00:05Z", "b done", is_sidechain=True)],
            meta={"agentType": "reviewer", "spawnDepth": 1},
        )
        self._write_member(
            "agent-a",
            [assistant_text("2026-01-01T00:00:01Z", "a done", is_sidechain=True)],
            meta={"agentType": "implementer", "spawnDepth": 1},
        )

        out = agent_timeline.build_timeline(self.root, self.session, f"workflow:{self.run_id}")

        self.assertEqual([s["agent"]["key"] for s in out["flow"]], ["agent-a", "agent-b"])
        self.assertEqual(out["flow"][0]["agent"]["agentType"], "implementer")
        self.assertEqual(out["flow"][0]["events"][0]["text"], "a done")
        self.assertEqual(out["flow"][1]["events"][0]["text"], "b done")

    def test_top_level_events_concatenate_member_events_in_flow_order(self):
        self._write_member("agent-a", [assistant_text("2026-01-01T00:00:01Z", "a1", is_sidechain=True)])
        self._write_member("agent-b", [assistant_text("2026-01-01T00:00:05Z", "b1", is_sidechain=True)])

        out = agent_timeline.build_timeline(self.root, self.session, f"workflow:{self.run_id}")

        self.assertEqual([e["text"] for e in out["events"]], ["a1", "b1"])
        self.assertEqual(out["agent"]["key"], f"workflow:{self.run_id}")

    def test_agent_description_is_the_workflow_name_from_its_script(self):
        self._write_member("agent-a", [assistant_text("2026-01-01T00:00:01Z", "a", is_sidechain=True)])
        self._write_script("review-changes")

        out = agent_timeline.build_timeline(self.root, self.session, f"workflow:{self.run_id}")

        self.assertEqual(out["agent"]["description"], "review-changes")

    def test_workflow_name_falls_back_to_run_id_without_a_script(self):
        self._write_member("agent-a", [assistant_text("2026-01-01T00:00:01Z", "a", is_sidechain=True)])

        out = agent_timeline.build_timeline(self.root, self.session, f"workflow:{self.run_id}")

        self.assertEqual(out["agent"]["description"], self.run_id)

    def test_workflow_with_no_members_gives_an_empty_flow(self):
        out = agent_timeline.build_timeline(self.root, self.session, f"workflow:{self.run_id}")

        self.assertEqual(out["flow"], [])
        self.assertEqual(out["events"], [])

    def test_regular_agent_has_no_flow_field(self):
        write_jsonl(
            os.path.join(self.project, f"{self.session}.jsonl"),
            [user_message("2026-01-01T00:00:00Z", "hi")],
        )

        out = agent_timeline.build_timeline(self.root, self.session, "main")

        self.assertNotIn("flow", out)


if __name__ == "__main__":
    unittest.main()
