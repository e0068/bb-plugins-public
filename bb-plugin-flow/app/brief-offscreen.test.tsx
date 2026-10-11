// @vitest-environment jsdom
// Тред открывается внизу ленты, а брифы выше давно отвечены. Карточка брифа —
// сотни узлов, и каждый из них хост пересчитывает со стилями всех плагинов:
// лента с тремя такими карточками открывалась на полсекунды дольше. Бриф
// вдали от экрана стоит заглушкой в свою прежнюю высоту и не ходит за собой на
// сервер, пока его не докрутили.
import { act, cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionBrief } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

/** IntersectionObserver браузера: тест сам говорит, дошла ли прокрутка до наблюдаемого. */
const observers = new Set<{ callback: IntersectionObserverCallback; targets: Set<Element> }>();
const scrollTo = (near: boolean) =>
  act(() => {
    for (const observer of observers)
      observer.callback(
        [...observer.targets].map((target) => ({ target, isIntersecting: near }) as IntersectionObserverEntry),
        {} as IntersectionObserver,
      );
  });

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly entry: { callback: IntersectionObserverCallback; targets: Set<Element> };
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, targets: new Set() };
        observers.add(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.add(target);
      }
      unobserve(target: Element) {
        this.entry.targets.delete(target);
      }
      disconnect() {
        observers.delete(this.entry);
      }
    },
  );
});

afterEach(() => {
  cleanup();
  observers.clear();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const brief: DecisionBrief = {
  id: "dec_far",
  threadId: "thr_1",
  title: "Бриф далеко вверху ленты",
  createdAt: "2026-10-02T12:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "q", kind: "fork", question: "Как делать?", allowOwn: false, options: [
      { id: "a", action: "Так", recommended: true, description: "Первый путь." },
      { id: "b", action: "Иначе", recommended: false, description: "Второй путь." },
    ] },
  ],
};

const mount = (getBrief: () => unknown) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief, getRunSummary: () => null, getDispatchPlace: () => ({ place: "here" }), listProjects: () => ({ kind: "found" as const, projects: [] }) } as never, settings: { language: "Русский" } },
  );

describe("бриф вдали от экрана", () => {
  it("не ходит на сервер и не рисует карточку, пока до него не докрутили", async () => {
    const getBrief = vi.fn(() => ({ kind: "found", brief, answer: null }));
    const slot = mount(getBrief);
    await scrollTo(false);
    expect(getBrief).not.toHaveBeenCalled();
    expect(within(slot.container).queryByRole("group", { name: brief.title })).toBe(null);

    await scrollTo(true);
    await within(slot.container).findByRole("group", { name: brief.title });
    expect(getBrief).toHaveBeenCalledOnce();
  });

  it("стоит в высоту прошлого показа, чтобы лента не прыгала", async () => {
    localStorage.setItem(`decisions:height:${brief.id}`, "640");
    const slot = mount(() => ({ kind: "found", brief, answer: null }));
    await scrollTo(false);
    const heights = [...slot.container.querySelectorAll<HTMLElement>("*")].map((node) => node.style.minHeight);
    expect(heights).toContain("640px");
  });

  it("с итогом прогона стоит двумя полями — карточки и итога, каждое в свою высоту, как они лягут в ленте", async () => {
    localStorage.setItem(`decisions:height:${brief.id}`, "640");
    localStorage.setItem(`decisions:summary-height:${brief.id}`, "200");
    const getBrief = vi.fn(() => ({ kind: "found", brief, answer: null }));
    const slot = mount(getBrief);
    await scrollTo(false);
    const held = [...slot.container.querySelectorAll<HTMLElement>("[aria-hidden=true]")].map((node) => node.style.minHeight).filter(Boolean);
    expect(held).toEqual(["640px", "200px"]);
    expect(getBrief).not.toHaveBeenCalled();
  });
});
