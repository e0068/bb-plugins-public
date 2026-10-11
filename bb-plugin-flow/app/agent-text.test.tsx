// @vitest-environment jsdom
// Текст агента в брифе и демонстрации рисует Kasimov — тот же движок, что документ в MD Opener: таблицы, заголовки,
// код, цитаты и диаграммы видны собой, а не сырым markdown. Движок настоящий: jsdom строит его разметку, как браузер.
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(async (_id: string, _source: string) => ({ svg: "<svg data-drawn></svg>" })) }));
vi.mock("mermaid", () => ({ default: mermaid }));

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { threadFiles, workspacePreview } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const TABLE = "| Тип | Где |\n| --- | --- |\n| System | expand.ts |";

const brief: DecisionBrief = {
  id: "dec_kasimov",
  threadId: "thr_1",
  title: "Бриф с разметкой",
  createdAt: "2026-10-11T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  scope: "- база\n  - деталь",
  setup: { criteria: [{ text: "Пункт с `кодом`", add: { target: 1, max: 2, risk: 0, minutes: 5 } }] },
  questions: [
    {
      id: "form",
      kind: "fork",
      allowOwn: false,
      question: "Как **считать**?",
      context: "## Разбор\n> цитата\n```ts\nconst x = 1;\n```\nСм. [план](<docs/my plan.md>) и [код]( app/a.ts ).",
      options: [
        { id: "a", action: "Таблицей", description: TABLE, recommended: true, add: { target: 0, max: 0, risk: 0 } },
        { id: "b", action: "Строкой", description: "как сейчас", recommended: false, add: { target: 1, max: 1, risk: 0 } },
      ],
    },
  ],
};

const demo: DecisionBrief = {
  id: "dec_kasimov_demo",
  threadId: "thr_1",
  title: "Итог",
  createdAt: "2026-10-11T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: {
    stage: "demo",
    final: true,
    done: ["Сделано **главное**"],
    pending: [],
    notes: `Значения лежат в system/.\n\n${TABLE}`,
    sections: [{ title: "Схема", text: "```mermaid\nflowchart LR\n  A --> B\n```" }],
    results: [{ label: "widget.tsx", target: "app/widget.tsx" }],
  },
};

const open = (shown: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: shown.id }, source: `::decision{id="${shown.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: shown, answer: null }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

const cells = (root: Element) => [...root.querySelectorAll("table td")].map((td) => td.textContent);

describe("текст агента рисует Kasimov", () => {
  it("таблица в заметках демонстрации — таблица с колонками, а не строки с чертами", async () => {
    const slot = open(demo);
    const card = await slot.findByRole("group", { name: "Демонстрация" });
    await waitFor(() => expect(cells(card)).toEqual(["Тип", "Где", "System", "expand.ts"]));
    expect(card.textContent).not.toContain("| --- |");
  });

  it("таблица в описании варианта — таблица, клик по описанию выбирает вариант", async () => {
    const slot = open(brief);
    const option = await slot.findByRole("button", { name: /Таблицей/ });
    expect(cells(option)).toEqual(["Тип", "Где", "System", "expand.ts"]);
    fireEvent.click(option.querySelector("table td")!);
    expect(option.getAttribute("aria-pressed")).toBe("true");
  });

  it("заголовок, цитата и блок кода в пояснении вопроса — разметкой движка", async () => {
    const slot = open(brief);
    const group = await slot.findByRole("group", { name: "Как считать?" });
    for (const selector of [".mde-h2", ".mde-quote", "pre.mde-code"]) expect(group.querySelector(selector)).not.toBeNull();
  });

  it("короткие поля — вопрос, пункт критерия, строка «Сделано» — тоже рисует Kasimov", async () => {
    const briefSlot = open(brief);
    const group = await briefSlot.findByRole("group", { name: "Как считать?" });
    expect(group.querySelector(".mdt b")?.textContent).toBe("считать");
    expect(briefSlot.container.querySelector(".mdt code")?.textContent).toBe("кодом");
    cleanup();
    const demoSlot = open(demo);
    const card = await demoSlot.findByRole("group", { name: "Демонстрация" });
    expect(card.querySelector(".mdt b")?.textContent).toBe("главное");
  });

  it("строка без разметки — просто текст карточки, движок для неё не создаётся", async () => {
    const slot = open(brief);
    const option = await slot.findByRole("button", { name: /Строкой/ });
    expect(option.textContent).toContain("как сейчас");
    expect(option.querySelector(".mdt")).toBeNull();
  });

  it("блок mermaid рисует Kasimov библиотекой из бандла Flow", async () => {
    const slot = open(demo);
    await slot.findByRole("group", { name: "Демонстрация" });
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    expect(mermaid.render.mock.calls.some((call) => String(call[1]).startsWith("flowchart LR"))).toBe(true);
  });

  it("ссылка на путь в угловых скобках или с пробелами вокруг открывает сам путь", async () => {
    const slot = open(brief);
    fireEvent.click(await slot.findByRole("link", { name: "план" }));
    fireEvent.click(slot.getByRole("link", { name: "код" }));
    expect(slot.navigateCalls).toContainEqual(workspacePreview("docs/my plan.md"));
    expect(slot.navigateCalls).toContainEqual(workspacePreview("app/a.ts"));
  });

  it("смена темы bb перерисовывает диаграмму в новой теме", async () => {
    const slot = open(demo);
    await slot.findByRole("group", { name: "Демонстрация" });
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    mermaid.render.mockClear();
    document.documentElement.style.colorScheme = "dark";
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    document.documentElement.style.colorScheme = "";
  });

  it("«Что я понял» — список движка", async () => {
    const slot = open(brief);
    const scope = await slot.findByRole("group", { name: "Что я понял" });
    expect([...within(scope).getByText("деталь").closest(".mdt")!.querySelectorAll(".mde-li")].map((li) => li.textContent)).toEqual(["база", "деталь"]);
  });
});
