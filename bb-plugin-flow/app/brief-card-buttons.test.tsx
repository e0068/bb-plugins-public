// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETUP_ROW } from "../core/rows";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_buttons",
  threadId: "thr_1",
  title: "Кнопки первой части",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "memory/tasks/todo/sl-1.md" } },
      { id: "prototype", name: "HTML-прототип", state: "ready", recommended: true, link: { label: "p.html", target: "memory/assets/p.html" } },
      { id: "spec", name: "Спецификация", state: "stale", recommended: true, link: { label: "spec.md", target: "memory/specs/spec.md" } },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
    executor: { recommended: "subagents" },
    checker: { recommended: "agent", models: [{ name: "Opus 5", recommended: true }] },
  },
  questions: [{ id: "read", question: "Так?", kind: "confirm", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] }],
};

const open = (openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"] = () => true) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile,
    },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

type Slot = ReturnType<typeof open>;
const button = async (slot: Slot, name: RegExp) => slot.findByRole("button", { name });

describe("кнопки первой части", () => {
  it("нажатие раскрывает варианты строкой ниже, выбор меняет кнопку и сворачивает строку", async () => {
    const slot = open();
    const executor = await button(slot, /^Исполняет/);
    expect(slot.queryByRole("group", { name: "Исполняет" })).toBeNull();
    fireEvent.click(executor);
    expect(executor.getAttribute("aria-expanded")).toBe("true");
    const options = within(slot.getByRole("group", { name: "Исполняет" }));
    expect(options.getAllByRole("button").map((b) => b.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Сам"), expect.stringContaining("Workflow с фанаутом")]),
    );
    fireEvent.click(options.getByRole("button", { name: /Workflow с фанаутом/ }));
    expect(slot.queryByRole("group", { name: "Исполняет" })).toBeNull();
    expect((await button(slot, /^Исполняет/)).textContent).toContain("Workflow с фанаутом");
  });

});

describe("кнопки артефактов", () => {
  const artifacts = async (slot: Slot) => within(await slot.findByRole("group", { name: "Артефакты" }));

  it("галочка стоит у утверждённого и рекомендованного и снимается у утверждённого тоже", async () => {
    const slot = open();
    const group = await artifacts(slot);
    const task = group.getByRole("button", { name: "Задача: оставить утверждённым" });
    expect(task.getAttribute("aria-pressed")).toBe("true");
    expect(group.getByRole("button", { name: "HTML-прототип: утвердить" }).getAttribute("aria-pressed")).toBe("true");
    expect(group.getByRole("button", { name: "План: сделать" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(task);
    expect(task.getAttribute("aria-pressed")).toBe("false");
  });

  it("клик по имени документа открывает его и не трогает галочку", async () => {
    const openFile = vi.fn(() => true);
    const slot = open(openFile);
    const group = await artifacts(slot);
    fireEvent.click(group.getByRole("button", { name: "p.html" }));
    expect(openFile).toHaveBeenCalledWith("memory/assets/p.html");
    expect(group.getByRole("button", { name: "HTML-прототип: утвердить" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("у отсутствующего — «Сделать», неактуальный документ зачёркнут без пометки в подписи", async () => {
    const group = await artifacts(open());
    expect(group.getByText("Сделать")).toBeTruthy();
    expect(group.getByRole("button", { name: "spec.md" }).className).toContain("line-through");
    expect(group.queryByText(/Не актуально/)).toBeNull();
  });
});

