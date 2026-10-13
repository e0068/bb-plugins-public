// @vitest-environment node
// PR #697: на утверждении работу увели в другой flow, прогон со слиянием снялся, и PR остался висеть незамеченным.
// Переход называет открытый PR прежнего прогона в реплике — её видят и владелец в ленте, и агент нового flow.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const approval: DecisionBrief = {
  stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 },
  id: "dec_approve",
  threadId: "thr_src",
  title: "Утверждение",
  createdAt: "2026-10-05T12:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "approve", final: false, done: ["Сторож тестов"], pending: [], results: [{ label: "a.md", target: "a.md" }], nextFlow: "flow-research" },
};

const toResearch = (place: DecisionAnswer["place"]): DecisionAnswer => ({
  briefId: approval.id,
  answers: [],
  outcome: { accepted: false, flow: { id: "flow-research", name: "Research" } },
  place,
});

type OpenPr = { number: number; url: string } | null;

const setup = async (open: OpenPr) => {
  const sent: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        send: async (args: { input: Array<{ type: string; text?: string }> }) => {
          sent.push(args.input.map((part) => part.text ?? "").join("\n"));
          return { delivery: "started" };
        },
        get: async () => ({ projectId: "proj_1", environmentId: "env_1" }),
      },
      environments: { get: async () => ({ hostId: "host_1", path: "/tree", branchName: "bb/thr_src" }) },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(approval);
  registerApi(bb, store, {
    now: () => "2026-10-05T12:03:00.000Z",
    switchFlow: async () => undefined,
    releaseFlow: async () => undefined,
    handoffFlow: () => undefined,
    flowIds: () => ["flow-research"],
    openPullRequest: async () => open,
  });
  const call = (answer: DecisionAnswer) => harness.callRpc("answerBrief", { id: approval.id, answer, messageId: "m", locale: "ru" });
  return { sent, call };
};

describe("переход в другой flow при открытом PR прежнего прогона", () => {
  it("реплика в треде называет открытый и не слитый PR со ссылкой", async () => {
    const t = await setup({ number: 697, url: "https://github.com/e0068/bb-plugins/pull/697" });
    await t.call(toResearch("here"));
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatch(/PR #697/);
    expect(t.sent[0]).toMatch(/не слит/);
    expect(t.sent[0]).toContain("https://github.com/e0068/bb-plugins/pull/697");
  });

  it("без открытого PR реплика о нём молчит", async () => {
    const t = await setup(null);
    await t.call(toResearch("here"));
    expect(t.sent[0]).not.toMatch(/PR #/);
  });
});
