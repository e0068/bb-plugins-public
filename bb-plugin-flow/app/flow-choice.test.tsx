// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const flows = [
  { id: "flow-general", name: "General", stages: 7 },
  { id: "flow-plugin", name: "BB Plugin", stages: 11 },
];

const mount = async (selected = "none") => {
  const state = { selected };
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, {
    rpc: {
      getFlowProgress: () => null,
      threadFlowChoice: () => ({ flows, selected: state.selected }),
      pickThreadFlow: ({ flowId }: { flowId: string }) => ((state.selected = flowId), { kind: "picked", selected: flowId }),
    } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
  return slot;
};

const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-flow-choice-option]")];

describe("строка выбора flow в треде без прогона", () => {
  it("свёрнутая — «Flow не выбран», список скрыт", async () => {
    const slot = await mount();
    const head = await screen.findByRole("button", { name: /Flow не выбран/ });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(rows(slot.container)).toEqual([]);
  });

  it("раскрывается на месте: «Автоматически», flow с числом этапов, «Flow не выбран»; галочка у выбранного", async () => {
    const slot = await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Flow не выбран/ }));
    const options = rows(slot.container);
    expect(options.map((o) => o.textContent)).toEqual(["Автоматически", "General7 этапов", "BB Plugin11 этапов", "Flow не выбран"]);
    expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true"]);
    expect(slot.container.querySelector('[role="menu"]')).toBeNull();
  });

  it("выбор запоминается, контейнер сворачивается, строка показывает flow без бара", async () => {
    const slot = await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Flow не выбран/ }));
    fireEvent.click(rows(slot.container)[2]!);
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "pickThreadFlow")?.input).toEqual({ threadId: "thr_1", flowId: "flow-plugin" }));
    const head = await screen.findByRole("button", { name: /Flow: BB Plugin/ });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(slot.container.querySelector("[data-progress-count]")).toBeNull();
    fireEvent.click(head);
    expect(rows(slot.container).map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "false", "true", "false"]);
  });

  it("«Автоматически» показано своим именем", async () => {
    await mount("auto");
    expect(await screen.findByRole("button", { name: /Flow: Автоматически/ })).toBeTruthy();
  });

  it("без ответа о выборе строки нет", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
    const slot = renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => null } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
    await waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "threadFlowChoice")).toBe(true));
    expect(slot.container.textContent).toBe("");
  });
});
