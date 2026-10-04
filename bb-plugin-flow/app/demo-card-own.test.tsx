// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_demo_own",
  threadId: "thr_1",
  title: "Демонстрация с находкой",
  createdAt: "2026-10-04T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [
    { id: "fix", question: "Чинить находку?", kind: "fork", allowOwn: true, options: [
      { id: "yes", action: "Да", recommended: true, description: "…" },
      { id: "no", action: "Нет", recommended: false, description: "…" },
    ] },
  ],
  outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }), getDispatchPlace: () => ({ place: "here" }), listProjects: () => ({ kind: "found" as const, projects: [] }), ...({ threadFiles } as object) } },
  );

describe("Демонстрация со своим ответом в строке вопроса", () => {
  it("кнопка — «Отправить», а не «Завершить»", async () => {
    const slot = open();
    const row = within(await slot.findByRole("group", { name: "Чинить находку?" }));
    expect(await slot.findByRole("button", { name: "Завершить" })).toBeTruthy();
    fireEvent.change(row.getByRole("textbox", { name: "Свой ответ" }), { target: { value: "Что значит собрать документом системы?" } });
    expect(await slot.findByRole("button", { name: "Отправить" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Завершить" })).toBeNull();
  });
});
