// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { report, stage, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = stagedBrief(["ship", "preview", "demo", "restore"].map((id) => report(id, { recommended: true })), {
  stages: { list: [stage("ship"), stage("preview", { parent: "demo" }), stage("demo"), stage("restore", { parent: "demo" })], minButtonWidth: 170 },
});

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: (() => ({ kind: "not_found" })) as never } },
  );

type Slot = ReturnType<typeof open>;
const cells = async (slot: Slot) => {
  await slot.findByRole("group", { name: "Ответ на бриф" });
  return [...slot.container.querySelectorAll<HTMLElement>("[data-stage]")].map((el) => el.dataset.stage);
};
const expand = async (slot: Slot) => {
  await cells(slot);
  const demo = within(slot.container.querySelector<HTMLElement>('[data-stage="demo"]')!);
  fireEvent.click(demo.getByRole("button", { name: "demo", expanded: false }));
  return within(slot.getByRole("group", { name: "Под-этапы" }));
};
const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed");

describe("связка этапов в выборе этапов брифа", () => {
  it("под-этапы не стоят отдельными кнопками, у владельца есть шеврон", async () => {
    const slot = open();
    expect(await cells(slot)).toEqual(["ship", "demo"]);
  });

  it("раскрытый владелец показывает под-этапы до и после со своими галочками", async () => {
    const panel = await expand(open());
    expect(panel.getByRole("button", { name: "Под-этап preview этапа demo в прогоне" }).textContent).toContain("до");
    expect(panel.getByRole("button", { name: "Под-этап restore этапа demo в прогоне" }).textContent).toContain("после");
  });

  it("галочка владельца снимает связку", async () => {
    const slot = open();
    const panel = await expand(slot);
    fireEvent.click(slot.getByRole("button", { name: "demo: в ближайший прогон" }));
    expect(pressed(slot.getByRole("button", { name: "demo: в ближайший прогон" }))).toBe("false");
    expect(pressed(panel.getByRole("button", { name: "Под-этап preview этапа demo в прогоне" }))).toBe("false");
  });

  it("снятый под-этап не трогает владельца", async () => {
    const slot = open();
    const panel = await expand(slot);
    fireEvent.click(panel.getByRole("button", { name: "Под-этап restore этапа demo в прогоне" }));
    expect(pressed(panel.getByRole("button", { name: "Под-этап restore этапа demo в прогоне" }))).toBe("false");
    expect(pressed(slot.getByRole("button", { name: "demo: в ближайший прогон" }))).toBe("true");
  });
});
