// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const row = (id: string, state: string) => ({ id, kind: "skill", name: id, executor: "self", state, results: [], minutes: null, cost: null });

const land = {
  ...row("land", "fail"),
  automation: { steps: [{ id: "git.merge", label: "Merge the PR", state: "fail", error: "GitHub: not mergeable" }] },
};

const carried = (title: string | null, patch: Record<string, unknown> = {}) => ({
  current: "land",
  done: 1,
  step: 2,
  total: 2,
  planned: null,
  environmentId: "env_new",
  stages: [row("review", "done"), land],
  carrier: { threadId: "thr_new", title },
  ...patch,
});

const mount = async (progress: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => progress, threadStorage: () => ({ kind: "found", hostId: "local", storageRootPath: "/storage/thr_new" }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_src" } },
    settings: { language: "Русский" },
  });
};

describe("баннер треда, который отдал работу", () => {
  it("называет тред, в котором идёт работа, его именем", async () => {
    await mount(carried("Пороги — ошибка на вводе"));
    expect(await screen.findByText("Работа идёт в треде Пороги — ошибка на вводе")).toBeTruthy();
  });

  it("без имени называет тред его id", async () => {
    await mount(carried(null));
    expect(await screen.findByText("Работа идёт в треде thr_new")).toBeTruthy();
  });

  it("завершённый прогон баннер не снимает: итог в ленте носителя, а здесь его больше негде увидеть", async () => {
    await mount(carried("Пороги", { current: null, done: 2, finished: true, stages: [row("review", "done"), row("land", "done")] }));
    expect(await screen.findByRole("button", { name: /Прогресс flow/ })).toBeTruthy();
    expect(screen.getByText("Работа идёт в треде Пороги")).toBeTruthy();
  });

  it("шагов автоматизации отсюда не повторить и не пропустить: их ведёт носитель", async () => {
    await mount(carried("Пороги"));
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    expect(screen.queryByRole("button", { name: /Повторить/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Пропустить/ })).toBeNull();
  });

  it("результат этапа в хранилище треда ищется у носителя: туда его и положил агент", async () => {
    const note = { ...row("review", "done"), results: [{ label: "notes.md", target: "/storage/thr_new/notes.md" }] };
    const slot = await mount(carried("Пороги", { stages: [note, land] }));
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: /notes\.md/ }))[0]!);
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "threadStorage")?.input).toEqual({ threadId: "thr_new" }));
  });
});
