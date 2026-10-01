// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { threadFiles } from "./file-roots-fixture";

afterEach(cleanup);

const view = {
  current: "code",
  done: 1,
  total: 3,
  planned: null,
  flowName: "BB Plugin",
  environmentId: "env_1",
  stages: [
    { id: "questions", kind: "questions", name: "Questions", executor: "self", state: "done", results: [], minutes: 3, cost: 0.4 },
    { id: "code", kind: "skill", name: "Реализация", executor: "self", state: "now", results: [], minutes: null, cost: null },
    { id: "review", kind: "skill", name: "Ревью", executor: "self", state: "todo", results: [], minutes: null, cost: null },
  ],
};

const mount = async () => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => view, threadFiles, cancelFlow: () => ({ kind: "cancelled" }), threadFlowChoice: () => ({ flows: [{ id: "flow-plugin", name: "BB Plugin", stages: 3 }], selected: "none" }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
};

const openMenu = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  const trigger = screen.getByRole("button", { name: "Меню flow" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  return screen.findByRole("menuitem", { name: "Отменить flow" });
};

describe("«Отменить flow» в меню прогресс-бара", () => {
  it("у свёрнутого бара кнопки меню нет — она в строке имени flow раскрытого", async () => {
    await mount();
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(screen.queryByRole("button", { name: "Меню flow" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Прогресс flow/ }));
    expect(screen.getByRole("button", { name: "Меню flow" }).closest("[data-progress-flow]")).not.toBeNull();
  });

  it("пункт меню открывает подтверждение и сам flow не отменяет", async () => {
    const slot = await mount();
    fireEvent.click(await openMenu());
    expect(await screen.findByRole("dialog", { name: "Отменить flow?" })).toBeTruthy();
    expect(slot.rpcCalls.some((c) => c.method === "cancelFlow")).toBe(false);
  });

  it("«Оставить» закрывает подтверждение, flow остаётся", async () => {
    const slot = await mount();
    fireEvent.click(await openMenu());
    fireEvent.click(await screen.findByRole("button", { name: "Оставить" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(slot.rpcCalls.some((c) => c.method === "cancelFlow")).toBe(false);
    expect(slot.container.querySelector("[data-progress-count]")).not.toBeNull();
  });

  it("подтверждение отменяет flow треда, и бар сразу сменяется строкой выбора flow", async () => {
    const slot = await mount();
    fireEvent.click(await openMenu());
    const dialog = await screen.findByRole("dialog", { name: "Отменить flow?" });
    fireEvent.click(dialog.querySelector<HTMLElement>("[data-confirm]")!);
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "cancelFlow")?.input).toEqual({ threadId: "thr_1" }));
    await waitFor(() => expect(slot.container.querySelector("[data-progress-count]")).toBeNull());
    expect(await screen.findByRole("button", { name: /Flow не выбран/ })).toBeTruthy();
  });
});
