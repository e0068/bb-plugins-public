// @vitest-environment jsdom
// Запасной список тредов: простой перечень по `experimental_useSidebarThreads`, когда встроенный список bb не подключился или упал.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const app = await loadPluginApp(() => import("../app"));
const { FallbackThreadList } = await import("./fallback-thread-list");
afterEach(cleanup);

const thread = (patch: Partial<PluginSidebarThread> & { id: string }): PluginSidebarThread =>
  ({ projectId: "p", title: patch.id, titleFallback: null, parentThreadId: null, isArchived: false, updatedAt: 1, ...patch }) as PluginSidebarThread;

const render = (threads: PluginSidebarThread[], props: Partial<PluginThreadListProps> = {}, status: "ready" | "loading" | "error" = "ready") => {
  const onNavigate = vi.fn();
  const slotProps = { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate, searchQuery: "", ...props } as PluginThreadListProps;
  const registration = { ...app.threadLists[0]!, component: FallbackThreadList } as never;
  const slot = renderSlot<PluginThreadListProps, never>(registration, slotProps, { sidebarThreads: { status, threads }, settings: { language: "Русский" } });
  return { slot, onNavigate };
};

describe("запасной список тредов", () => {
  it("показывает корневые не заархивированные треды, свежие выше", () => {
    const { slot } = render([
      thread({ id: "old", updatedAt: 1 }),
      thread({ id: "new", updatedAt: 3 }),
      thread({ id: "child", updatedAt: 9, parentThreadId: "new" }),
      thread({ id: "gone", updatedAt: 8, isArchived: true }),
    ]);
    const names = slot.getAllByRole("button").map((button) => button.textContent);
    expect(names).toEqual(["new", "old"]);
  });

  it("безымянный тред подписан запасным названием, а без него — «Тред без названия»", () => {
    const { slot } = render([thread({ id: "a", title: null, titleFallback: "из первой реплики", updatedAt: 2 }), thread({ id: "b", title: null, updatedAt: 1 })]);
    expect(slot.getByRole("button", { name: "из первой реплики" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Тред без названия" })).toBeTruthy();
  });

  it("открытый тред подсвечен, клик открывает тред и закрывает шторку", () => {
    const { slot, onNavigate } = render([thread({ id: "a" }), thread({ id: "b", updatedAt: 0 })], { activeThreadId: "b" });
    expect(slot.getByRole("button", { name: "b" }).getAttribute("aria-current")).toBe("page");
    expect(slot.getByRole("button", { name: "a" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "a" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "a" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("тредов нет — подсказка, а не пустое место", () => {
    const { slot } = render([]);
    expect(slot.getByText("Тредов пока нет")).toBeTruthy();
  });

  it("треды ещё грузятся — подсказки нет", () => {
    const { slot } = render([], {}, "loading");
    expect(slot.queryByText("Тредов пока нет")).toBeNull();
  });

  it("треды не загрузились — сообщение об ошибке", () => {
    const { slot } = render([], {}, "error");
    expect(slot.getByText("Не удалось загрузить треды")).toBeTruthy();
    expect(slot.queryByText("Тредов пока нет")).toBeNull();
  });
});
