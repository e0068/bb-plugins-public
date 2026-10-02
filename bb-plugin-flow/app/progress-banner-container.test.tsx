// @vitest-environment jsdom
// Контейнер состояния Flow: минуты и доллары своими колонками, план этапов впереди, итог потраченного
// и строки-аккордеоны — с результатами этапа и шагами автоматизации внутри.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const results = ["spec.md", "plan.md", "notes.md"].map((label) => ({ label, target: `docs/${label}` }));

const view = {
  current: "execution",
  done: 3,
  step: 4,
  total: 5,
  planned: null,
  environmentId: null,
  stages: [
    { id: "questions", kind: "questions", name: "Вопросы", executor: "self", state: "done", results: [], minutes: 1, cost: null },
    { id: "spec", kind: "skill", name: "Spec", executor: "self", state: "done", results, minutes: 9, cost: 5 },
    {
      id: "ship",
      kind: "skill",
      name: "Commit, PR",
      executor: "self",
      state: "done",
      results: [],
      minutes: 2,
      cost: 0,
      automation: { steps: [{ id: "git.commit", label: "Commit", state: "done", error: null, detail: "nothing to commit" }] },
    },
    { id: "execution", kind: "skill", name: "Execution", executor: "self", state: "now", results: [], minutes: null, cost: null, plan: { minutes: 15, target: 3 } },
    { id: "review", kind: "skill", name: "Review", executor: "agent", state: "todo", results: [], minutes: null, cost: null, plan: { minutes: 5, target: 1.5 } },
  ],
};

const open = async () => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => view } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  return slot;
};

const rowOf = (container: HTMLElement, name: string) => [...container.querySelectorAll<HTMLElement>("[data-progress-row]")].find((row) => row.textContent?.includes(name))!;
const cell = (row: HTMLElement, column: "minutes" | "cost") => row.querySelector<HTMLElement>(`[data-progress-${column}]`)?.textContent ?? null;

describe("контейнер состояния Flow", () => {
  it("минуты и доллары стоят каждый в своей колонке, даже когда долларов у этапа нет", async () => {
    const slot = await open();
    const questions = rowOf(slot.container, "Вопросы");
    expect([cell(questions, "minutes"), cell(questions, "cost")]).toEqual(["1 м", ""]);
    expect([cell(rowOf(slot.container, "Spec"), "minutes"), cell(rowOf(slot.container, "Spec"), "cost")]).toEqual(["9 м", "$5"]);
  });

  it("этап впереди и идущий показывают план с тильдой", async () => {
    const slot = await open();
    const review = rowOf(slot.container, "Review");
    expect([cell(review, "minutes"), cell(review, "cost")]).toEqual(["~5 м", "~$1.5"]);
    expect(cell(rowOf(slot.container, "Execution"), "minutes")).toBe("~15 м");
  });

  it("последняя строка — сколько потрачено всего, в тех же колонках", async () => {
    const slot = await open();
    const total = slot.container.querySelector<HTMLElement>("[data-progress-total]")!;
    expect(total.textContent).toContain("Потрачено");
    expect([cell(total, "minutes"), cell(total, "cost")]).toEqual(["12 м", "$5"]);
  });

  it("свёрнутая строка показывает первый результат и счёт остальных, развёрнутая — все результаты", async () => {
    const slot = await open();
    expect(screen.queryByText("notes.md")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Spec: подробности" }));
    expect(screen.getByText("plan.md")).toBeTruthy();
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(slot.container.querySelectorAll("[data-progress-row]")).toHaveLength(5);
  });

  it("пройденная автоматизация свёрнута одной строкой, а развёрнутая показывает свои шаги внутри", async () => {
    const slot = await open();
    expect(slot.container.querySelectorAll("[data-progress-step]")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Commit, PR: подробности" }));
    expect(slot.container.querySelector("[data-progress-step]")?.textContent).toContain("nothing to commit");
    fireEvent.click(screen.getByRole("button", { name: "Commit, PR: подробности" }));
    expect(slot.container.querySelectorAll("[data-progress-step]")).toHaveLength(0);
  });

  it("развёрнутая автоматизация показывает, что сделал её шаг, текстом", async () => {
    const slot = await open();
    fireEvent.click(screen.getByRole("button", { name: "Commit, PR: подробности" }));
    expect(slot.container.querySelector("[data-step-detail]")?.textContent).toBe("nothing to commit");
    expect(slot.container.querySelector("[data-step-detail-link]")).toBeNull();
  });
});
