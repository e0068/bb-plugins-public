// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief, DispatchPlace, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_places",
  threadId: "thr_1",
  title: "Где исполнять",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Тесты зелёные"] },
  questions: [],
};

const open = (remembered: DispatchPlace) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => { throw new Error("не отправляется"); }, getDispatchPlace: () => ({ place: remembered }) } },
  );

describe("места исполнения — два", () => {
  it("запомненный в проекте новый worktree открывается как «Новый тред»", async () => {
    const slot = open("worktree");
    const place = await slot.findByRole("button", { name: /^Исполнять/ });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(place.textContent).toContain("Новый тред");
    expect(place.textContent).not.toMatch(/worktree/);
  });
});
