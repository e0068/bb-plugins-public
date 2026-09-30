// @vitest-environment jsdom
// Хост перемонтирует карточки ленты, когда перерисовывает её. Карточка, которая
// встаёт скелетоном ниже себя прежней, сжимает ленту: прокрутка упирается в низ,
// хост снова прижимает ленту к низу и докручивает её туда при следующем росте —
// владельца откидывает к последнему сообщению. Смонтированная заново карточка,
// пока бриф в пути, стоит в высоту прошлого показа.
import { cleanup, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DecisionBrief } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const brief: DecisionBrief = {
  id: "dec_remount",
  threadId: "thr_1",
  title: "Бриф, который перемонтирует хост",
  createdAt: "2026-09-29T12:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "q", kind: "fork", question: "Как делать?", allowOwn: false, options: [
      { id: "a", action: "Так", recommended: true, description: "Первый путь." },
      { id: "b", action: "Иначе", recommended: false, description: "Второй путь." },
    ] },
  ],
};

const HEIGHT_KEY = `decisions:height:${brief.id}`;

/** Ответ, который не приходит никогда: сервер ещё думает. */
const pending = () => new Promise<never>(() => undefined);

const found = () => ({ kind: "found", brief, answer: null });

const mount = (getBrief: () => unknown) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief, getRunSummary: () => null, getDispatchPlace: () => ({ place: "here" }), listProjects: () => ({ kind: "found" as const, projects: [] }) } as never, settings: { language: "Русский" } },
  );

const skeleton = (slot: { container: HTMLElement }) => slot.container.querySelector<HTMLElement>("[aria-busy=true]");

/** Карточки на экране такой высоты, и хост сообщает о каждой смене размера сразу. */
const layOut = (height: number) => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ height } as DOMRect);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly report: ResizeObserverCallback) {}
      observe(target: Element) {
        this.report([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  );
};

describe("карточка брифа, смонтированная заново", () => {
  it("пока бриф грузится, скелетон стоит в высоту прошлого показа", () => {
    window.localStorage.setItem(HEIGHT_KEY, "900");
    const slot = mount(pending);
    expect(skeleton(slot)?.style.minHeight).toBe("900px");
  });

  it("впервые показанная карточка грузится обычным скелетоном", () => {
    const slot = mount(pending);
    expect(skeleton(slot)?.style.minHeight).toBe("");
  });

  it("строка ошибки загрузки не ниже прошлого показа", async () => {
    window.localStorage.setItem(HEIGHT_KEY, "900");
    const slot = mount(() => Promise.reject(new Error("offline")));
    const line = (await slot.findByText("Не удалось загрузить бриф")).parentElement!;
    expect(line.style.minHeight).toBe("900px");
  });

  it("вставшая карточка запоминает свою высоту", async () => {
    layOut(640.4);
    const slot = mount(found);
    await slot.findByRole("group", { name: brief.title });
    await waitFor(() => expect(window.localStorage.getItem(HEIGHT_KEY)).toBe("640"));
  });

  it("высота скелетона не запоминается", () => {
    window.localStorage.setItem(HEIGHT_KEY, "900");
    layOut(278);
    mount(pending);
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBe("900");
  });
});
