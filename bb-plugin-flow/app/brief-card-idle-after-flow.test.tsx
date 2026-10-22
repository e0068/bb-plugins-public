// @vitest-environment jsdom
// Утверждение, после которого агенту делать нечего, с рекомендованным агентом
// flow: решает не черновик, а ответ, который уйдёт. Рекомендован текущий flow —
// перехода нет, ответ не будит агента, и компактации нет. Рекомендован другой
// flow — работа уезжает в него, и сжатие перед ней снова имеет смысл.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract, widgetAgentRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const opus = { providerId: "claude-code", model: "opus", reasoningLevel: "high" as const };
const catalog = {
  current: opus,
  currentFlowId: "flow-fix",
  providers: [{ id: "claude-code", name: "Claude Code", models: [{ model: "opus", name: "Opus", efforts: ["high" as const], defaultEffort: "high" as const }] }],
  flows: [
    { id: "flow-fix", name: "Fix" },
    { id: "flow-code", name: "Code" },
  ],
};

/** Утверждение перед мёрджем, за которым агенту делать нечего, с рекомендацией flow `nextFlow`; тред в зоне предвыбора компактации. */
const open = (nextFlow: string, sent: DecisionAnswer[]) => {
  const approval: DecisionBrief = {
    id: `dec_idleflow_${nextFlow}`,
    threadId: "thr_1",
    title: "Утверждение перед мёрджем",
    createdAt: "2026-10-22T06:00:00.000Z",
    kind: "brief",
    launched: true,
    questions: [],
    outcome: { stage: "approve", final: false, done: ["Сделано"], pending: [], results: [{ label: "x", target: "x.md" }], nextFlow },
    stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 },
  };
  return renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract & typeof widgetAgentRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: approval.id },
      source: `::decision{id="${approval.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: approval, answer: null, idleAfter: true as const }),
        answerBrief: ({ answer }) => {
          sent.push(answer);
          return { kind: "not_found" };
        },
        getDispatchPlace: () => ({ place: "here" as const, compact: true }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        widgetAgent: () => catalog,
        ...({ threadFiles } as object),
      },
    },
  );
};

type Slot = ReturnType<typeof open>;

const placeCell = (slot: Slot) => slot.findByRole("button", { name: /^Исполнять/ });

const send = async (slot: Slot, sent: DecisionAnswer[], button: RegExp) => {
  fireEvent.click(await slot.findByRole("button", { name: button }));
  await waitFor(() => expect(sent).toHaveLength(1));
  return sent[0]!;
};

describe("утверждение без работы агента впереди и рекомендованный flow", () => {
  it("рекомендован текущий flow — компактации нет, «Продолжить» уходит без неё", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open("flow-fix", sent);
    await slot.findByRole("button", { name: "Flow: Fix" });
    expect((await placeCell(slot)).textContent).not.toContain("компактировать");
    expect((await send(slot, sent, /^Продолжить/)).compact).toBeUndefined();
  });

  it("рекомендован другой flow — работа уезжает в него, и компактация предлагается по зоне контекста", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open("flow-code", sent);
    await slot.findByRole("button", { name: "Flow: Code" });
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    expect(await send(slot, sent, /^Отправить/)).toMatchObject({ place: "here", compact: true });
  });
});
