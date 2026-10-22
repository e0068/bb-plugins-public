// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { report, stage, stagedBrief } from "../core/stages-fixtures";
import type { decisionsRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const LONG = "Смёрджить PR, Задача → done, Pull Main ← Origin, Сайт витрины, Остановить серверы, Архивировать тред";

const brief = stagedBrief([report("merge", { recommended: true }), report("commit", { state: "done" })], {
  stages: { list: [stage("merge", { name: LONG }), stage("commit", { name: LONG })], minButtonWidth: 170 },
});

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

// Раскладку jsdom не считает: тест держит само обещание — название этапа сжимается и переносится внутри своей ячейки, а не держит
// ширину текста и не уходит под колонку чекбоксов.
describe("длинное название этапа не заезжает под чекбокс", () => {
  it.each(["merge", "commit"])("название этапа %s может сжиматься и переноситься", async (id) => {
    const table = await open().findByRole("group", { name: "Этапы и бюджет" });
    const row = table.querySelector<HTMLElement>(`[data-stage="${id}"]`)!;
    const name = within(row).getByText(LONG);
    expect(name.className).toContain("min-w-0");
    expect(name.className).not.toContain("shrink-0");
    expect(name.className).toContain("break-words");
  });
});
