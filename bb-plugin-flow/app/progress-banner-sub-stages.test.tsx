// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { threadFiles } from "./file-roots-fixture";

afterEach(cleanup);

const row = (id: string, state: string, patch: Record<string, unknown> = {}) => ({ id, kind: "skill", name: id, executor: "self", state, results: [], minutes: null, cost: null, ...patch });

// Демонстрация со связкой: Preview до неё, Restore после.
const view = (preview = "todo") => ({
  current: preview === "now" ? "preview" : "ship",
  done: 0,
  total: 3,
  planned: null,
  environmentId: "env_1",
  stages: [
    row("ship", preview === "now" ? "done" : "now", { number: 1 }),
    row("preview", preview, { number: null, parent: "demo" }),
    row("demo", "todo", { number: 2 }),
    row("restore", "todo", { number: null, parent: "demo" }),
    row("merge", "todo", { number: 3 }),
  ],
});

const mount = async (progress: unknown = view()) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => progress, threadFiles, setStageInRun: () => ({ kind: "set" }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  return slot;
};
const labels = (slot: Awaited<ReturnType<typeof mount>>) => [...slot.container.querySelectorAll<HTMLElement>("[data-progress-row]")].map((r) => r.querySelector("[data-progress-label]")!.textContent);

describe("под-этапы в раскрытой полосе прогресса", () => {
  it("свёрнуты под строкой владельца, пока её не раскрыть", async () => {
    const slot = await mount();
    expect(labels(slot)).toEqual(["ship", "demo", "merge"]);
    fireEvent.click(slot.getByRole("button", { name: /demo/, expanded: false }));
    expect(labels(slot)).toEqual(["ship", "demo", "preview", "restore", "merge"]);
    expect(slot.getByRole("checkbox", { name: "Под-этап preview этапа demo в прогоне" }).getAttribute("aria-checked")).toBe("true");
  });

  it("идущий под-этап раскрывает владельца сам", async () => {
    const slot = await mount(view("now"));
    expect(labels(slot)).toEqual(["ship", "demo", "preview", "restore", "merge"]);
  });

  it("снятый владелец сразу гасит под-этапы, а сервер зовётся один раз", async () => {
    const slot = await mount();
    fireEvent.click(slot.getByRole("checkbox", { name: "Этап в прогоне: demo" }));
    fireEvent.click(slot.getByRole("button", { name: /demo/, expanded: false }));
    expect(slot.getByRole("checkbox", { name: "Под-этап restore этапа demo в прогоне" }).getAttribute("aria-checked")).toBe("false");
    await waitFor(() => expect(slot.rpcCalls.filter((c) => c.method === "setStageInRun").map((c) => c.input)).toEqual([{ threadId: "thr_1", stageId: "demo", run: false }]));
    expect(within(slot.container).getByRole("checkbox", { name: "Этап в прогоне: demo" }).getAttribute("aria-checked")).toBe("false");
  });
});
