// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const finished = {
  current: null,
  done: 1,
  total: 1,
  planned: null,
  finished: true,
  summary: null,
  summaryBriefId: null,
  stages: [{ id: "questions", kind: "questions", name: "Questions", executor: "self", state: "done", results: [], minutes: 3, cost: 0.4 }],
};

describe("после завершённого прогона контейнер состояния Flow — строка выбора flow", () => {
  it("прогон завершён — строка стоит на «Автоматически», и других форм над композером нет", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
    expect(customization.banners!.map((banner) => banner.id)).toEqual(["progress", "notices"]);
    renderSlot(customization.banners![0]!, {}, {
      rpc: { getFlowProgress: () => finished, threadFlowChoice: () => ({ flows: [{ id: "flow-bug", name: "Bug", stages: 5 }], selected: "auto" }) } as never,
      composer: { scope: { kind: "thread", threadId: "thr_1" } },
      settings: { language: "Русский" },
    });
    expect(await screen.findByRole("button", { name: /Автоматически/ })).toBeTruthy();
  });
});
