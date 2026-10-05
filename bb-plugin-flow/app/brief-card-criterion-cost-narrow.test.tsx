// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_cost_narrow",
  threadId: "thr_1",
  title: "Стоимость пункта",
  createdAt: "2026-10-03T00:00:00.000Z",
  kind: "brief",
  scope: "- Правка",
  setup: {
    criteria: [
      { text: "Длинный пункт про строку над композером", add: { target: 4, max: 8, risk: 1, minutes: 35 } },
      { text: "Порядок", before: "сверху вниз", after: "снизу вверх", add: { target: 1.5, max: 3, risk: 1, minutes: 10 } },
    ],
  },
  questions: [],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" as const }) } },
  );

/** Ряд «текст и стоимость» пункта: родитель подписи стоимости. */
const headOf = (cost: HTMLElement) => cost.parentElement!.parentElement!;

describe("стоимость пункта «Готово, когда» в узком брифе", () => {
  it("у обычного пункта и у пункта-изменения стоимость в узком брифе над текстом, в широком — справа", async () => {
    const slot = open();
    const done = within(await slot.findByRole("group", { name: "Definition of Done" }));
    for (const money of [done.getByText("+$4–8"), done.getByText("+$1.5–3")]) {
      const classes = headOf(money).className.split(" ");
      expect(classes).toContain("flex-col-reverse");
      expect(classes).toContain("@[31.5rem]:flex-row");
    }
  });
});
