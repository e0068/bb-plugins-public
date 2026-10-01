// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
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

const mount = async (held: boolean) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => finished, threadFlowChoice: () => ({ flows: [{ id: "flow-bug", name: "Bug", stages: 5 }], selected: "none", held }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
};

describe("после завершённого прогона над композером — строка выбора flow", () => {
  it("прогон завершён — «Flow не выбран»", async () => {
    await mount(false);
    expect(await screen.findByRole("button", { name: /Flow не выбран/ })).toBeTruthy();
  });

  it("сообщение придержано до выбора flow — строки нет: над ним уже форма следующего flow", async () => {
    const slot = await mount(true);
    await waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "threadFlowChoice")).toBe(true));
    expect(slot.container.textContent).toBe("");
  });
});
