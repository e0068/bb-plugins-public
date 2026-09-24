// @vitest-environment jsdom
// Раскрытый список этапов на телефоне: прокрутка не уходит в ленту треда, а
// движение вниз от верха списка тянет баннер за пальцем и на отпускании либо
// доводит его до закрытого, либо возвращает на место.
import { cleanup, createEvent, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { PULL_CLOSE_RATIO } from "../core/pull-to-collapse";

afterEach(cleanup);

const HEIGHT = 200;

const view = {
  current: "code",
  done: 1,
  total: 3,
  planned: { minutes: 40, target: 6, max: 13 },
  environmentId: "env_1",
  stages: [
    { id: "task", kind: "skill", name: "Задача", executor: "self", state: "done", results: [], minutes: 3, cost: 0.5 },
    { id: "code", kind: "skill", name: "Реализация", executor: "self", state: "now", results: [], minutes: null, cost: null },
    { id: "review", kind: "skill", name: "Ревью", executor: "self", state: "todo", results: [], minutes: null, cost: null },
  ],
};

const openList = async () => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => view } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  const list = slot.container.querySelector<HTMLElement>("[data-progress-list]")!;
  Object.defineProperty(list, "clientHeight", { value: HEIGHT, configurable: true });
  return { slot, list };
};

const drag = (list: HTMLElement, { scrollTop, movedDown }: { scrollTop: number; movedDown: number }) => {
  Object.defineProperty(list, "scrollTop", { value: scrollTop, configurable: true });
  fireEvent.touchStart(list, { touches: [{ clientY: 300 }] });
  fireEvent.touchMove(list, { touches: [{ clientY: 300 + movedDown }] });
};

const release = (list: HTMLElement) => fireEvent.touchEnd(list, { touches: [] });

const settle = (list: HTMLElement) => fireEvent.transitionEnd(list, { propertyName: "height" });

const rows = (slot: { container: HTMLElement }) => slot.container.querySelectorAll("[data-progress-row]").length;

describe("раскрытый баннер прогресса под пальцем", () => {
  it("прокрутка списка не уходит в ленту треда", async () => {
    const { list } = await openList();
    expect(list.className).toContain("overscroll-contain");
  });

  it("список едет за пальцем ровно на пройденное им расстояние", async () => {
    const { slot, list } = await openList();
    drag(list, { scrollTop: 0, movedDown: 60 });
    expect(list.style.height).toBe(`${HEIGHT - 60}px`);
    expect(rows(slot)).toBe(3);
  });

  it("дальше своей высоты список за пальцем не уезжает", async () => {
    const { list } = await openList();
    drag(list, { scrollTop: 0, movedDown: HEIGHT * 3 });
    expect(list.style.height).toBe("0px");
  });

  it("отпущенный после четверти высоты список доезжает вниз и закрывает баннер", async () => {
    const { slot, list } = await openList();
    drag(list, { scrollTop: 0, movedDown: HEIGHT * PULL_CLOSE_RATIO });
    release(list);
    expect(list.style.height).toBe("0px");
    expect(list.style.transition).toContain("height");
    expect(rows(slot)).toBe(3);
    settle(list);
    expect(rows(slot)).toBe(0);
  });

  it("отпущенный раньше четверти список возвращается на место", async () => {
    const { slot, list } = await openList();
    drag(list, { scrollTop: 0, movedDown: HEIGHT * PULL_CLOSE_RATIO - 1 });
    release(list);
    expect(list.style.height).toBe(`${HEIGHT}px`);
    settle(list);
    expect(list.style.height).toBe("");
    expect(rows(slot)).toBe(3);
  });

  it("пока список не в самом верху, палец его листает, а баннер стоит", async () => {
    const { slot, list } = await openList();
    drag(list, { scrollTop: 120, movedDown: HEIGHT });
    expect(list.style.height).toBe("");
    release(list);
    settle(list);
    expect(rows(slot)).toBe(3);
  });

  it("тап по строке-шапке по-прежнему закрывает баннер", async () => {
    const { slot } = await openList();
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    expect(rows(slot)).toBe(0);
  });
});

describe("жест баннера не отдаётся браузеру", () => {
  // React вешает onTouchMove пассивным слушателем, и preventDefault внутри него
  // ничего не делает: браузер доводил свайп сам и уносил страницу вместе с
  // композером. Жест перехватывается своим слушателем с passive: false.
  const move = (list: HTMLElement, { scrollTop, movedDown }: { scrollTop: number; movedDown: number }) => {
    Object.defineProperty(list, "scrollTop", { value: scrollTop, configurable: true });
    fireEvent.touchStart(list, { touches: [{ clientY: 300 }] });
    const event = createEvent.touchMove(list, { touches: [{ clientY: 300 + movedDown }] });
    fireEvent(list, event);
    return event;
  };

  it("движение вниз от верха списка отменяется, и страница остаётся на месте", async () => {
    const { list } = await openList();
    expect(move(list, { scrollTop: 0, movedDown: 60 }).defaultPrevented).toBe(true);
  });

  it("пока список не в самом верху, жест остаётся браузеру — это обычная прокрутка", async () => {
    const { list } = await openList();
    expect(move(list, { scrollTop: 120, movedDown: 60 }).defaultPrevented).toBe(false);
  });
});
