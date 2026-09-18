// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const link = { label: "prototype.html", target: "memory/assets/x/prototype.html" };

const view = {
  current: "demo",
  done: 5,
  total: 7,
  planned: { minutes: 200, target: 48, max: 96 },
  environmentId: "env_1",
  stages: [
    { id: "questions", kind: "questions", name: "Questions", executor: "self", state: "done", results: [], minutes: 3, cost: 0.4 },
    { id: "select", kind: "select", name: "Stage selection", executor: "self", state: "done", results: [], minutes: 1, cost: 0.2 },
    { id: "task", kind: "skill", name: "Задача", executor: "self", state: "done", results: [{ label: "task.md", target: "memory/tasks/task.md" }], minutes: 6, cost: 1.8 },
    { id: "prototype", kind: "skill", name: "HTML-прототип", executor: "agent", state: "done", results: [link, { label: "screenshots", target: "memory/assets/x/screenshots" }], minutes: 34, cost: 11.2 },
    { id: "plan", kind: "skill", name: "План", executor: "workflow", state: "skip", results: [], minutes: null, cost: null },
    { id: "demo", kind: "demo", name: "Demonstration", executor: "self", state: "now", results: [], minutes: null, cost: null },
    { id: "code", kind: "skill", name: "Реализация", executor: "self", state: "todo", results: [], minutes: null, cost: null },
  ],
};

const mount = async (progress: unknown = view) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => progress } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
};

describe("баннер прогресса flow", () => {
  it("встроенный этап с именем по умолчанию подписан по языку интерфейса", async () => {
    const slot = await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    const rows = [...slot.container.querySelectorAll<HTMLElement>("[data-progress-row]")];
    expect(rows[1]!.textContent).toContain("Выбор этапов");
    expect(rows[5]!.textContent).toContain("Демонстрация");
    expect(screen.getByRole("button", { name: /Прогресс flow: Демонстрация/ })).toBeTruthy();
  });

  it("баннер зарегистрирован над композером треда без карточки", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const customization = app.composerCustomizations.find((c) => c.id === "flow-progress");
    expect(customization?.scopes).toEqual(["thread"]);
    expect(customization?.banners?.[0]?.chrome).toBe("bare");
  });

  it("у треда без прогресса баннера нет", async () => {
    const slot = await mount(null);
    await waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "getFlowProgress")).toBe(true));
    expect(slot.container.textContent).toBe("");
  });

  it("раскрытый — строки этапов: иконка слева, ссылка текстом, минуты и доллары, отметка справа", async () => {
    const slot = await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    const rows = [...slot.container.querySelectorAll<HTMLElement>("[data-progress-row]")];
    expect(rows).toHaveLength(7);
    const prototype = within(rows[3]!);
    expect(rows[3]!.querySelector('[data-icon="Bot"]')).not.toBeNull();
    expect(rows[2]!.querySelector('[data-icon="Diamond"]')).not.toBeNull();
    expect(rows[4]!.querySelector('[data-icon="Workflow"]')).not.toBeNull();
    expect(prototype.getByText("34 м")).toBeTruthy();
    expect(prototype.getByText("$11.2")).toBeTruthy();
    expect(prototype.getByText("+1")).toBeTruthy();
    expect(prototype.getByRole("button", { name: "Открыть prototype.html" })).toBeTruthy();
    expect(within(rows[5]!).getByText("ждёт ответа")).toBeTruthy();
    expect(within(rows[4]!).getByText("не в прогоне")).toBeTruthy();
  });

  it("ссылка на результат открывает файл дерева", async () => {
    const slot = await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    fireEvent.click(within(slot.container.querySelectorAll<HTMLElement>("[data-progress-row]")[3]!).getByRole("button", { name: "Открыть prototype.html" }));
    await waitFor(() => expect(slot.navigateCalls).toContainEqual({ method: "experimental_openFilePreview", options: { target: { kind: "workspace", environmentId: "env_1", path: link.target }, location: null } }));
  });
});
