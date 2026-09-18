// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, decisionsRpcContract, dispatchRpcContract, outcomeRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const demo: DecisionBrief = {
  id: "dec_rework",
  threadId: "thr_1",
  title: "Демонстрация починки",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  launched: true,
  questions: [],
  outcome: {
    stage: "demo",
    final: false,
    next: "Ревью",
    done: ["Сделано"],
    pending: [],
    results: [
      { label: "страница", target: "http://localhost:5173/" },
      { label: "Приложение", command: "open -a Calculator" },
    ],
  },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract & typeof outcomeRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: demo.id }, source: `::decision{id="${demo.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: demo, answer: null }), answerBrief: () => ({ kind: "not_found" }), getDispatchPlace: () => ({ place: "here" }), runOutcomeCommand: () => ({ kind: "sent", created: false }) } },
  );

describe("Демонстрация после доработки", () => {
  it("набранный комментарий переживает уход во вкладку и возвращение", async () => {
    const first = open();
    fireEvent.change(await first.findByRole("textbox", { name: "Комментарий к демонстрации" }), { target: { value: "Поправь подпись" } });
    first.unmount();
    const again = open();
    expect(((await again.findByRole("textbox", { name: "Комментарий к демонстрации" })) as HTMLTextAreaElement).value).toBe("Поправь подпись");
  });

  it("в пустом поле видна подпись «Комментарий»", async () => {
    const slot = open();
    expect((await slot.findByRole("textbox", { name: "Комментарий к демонстрации" })).getAttribute("placeholder")).toBe("Комментарий");
  });
});
