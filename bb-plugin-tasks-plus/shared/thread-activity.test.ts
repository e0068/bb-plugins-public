import { describe, expect, it } from "vitest";
import { backgroundBusyThreadIds, type SidebarThreadWork } from "./thread-activity.js";

const idle = { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 };
const thread = (id: string, activity: Partial<typeof idle> = {}, hasPendingInteraction = false, isArchived = false): SidebarThreadWork => ({
  id,
  isArchived,
  hasPendingInteraction,
  activity: { ...idle, ...activity },
  parentThreadId: null,
  originKind: null,
  indicator: "none",
});
const child = (base: SidebarThreadWork, parentThreadId: string, indicator: SidebarThreadWork["indicator"] = "none"): SidebarThreadWork => ({
  ...base,
  parentThreadId,
  indicator,
});

describe("треды, занятые фоновой работой", () => {
  it("workflow и фоновые агенты — работа", () => {
    expect(backgroundBusyThreadIds([thread("a", { workflows: 1 }), thread("b", { backgroundAgents: 2 }), thread("c")])).toEqual(["a", "b"]);
  });

  it("фоновая команда — dev-сервер, watcher — не работа: агент закончил, процесс остался", () => {
    expect(backgroundBusyThreadIds([thread("a", { backgroundCommands: 1 })])).toEqual([]);
  });

  it("тред, где агент спросил владельца, ждёт его, даже если workflow идёт", () => {
    expect(backgroundBusyThreadIds([thread("a", { workflows: 1 }, true)])).toEqual([]);
  });

  it("архивный тред не занят, что бы под ним ни шло", () => {
    expect(backgroundBusyThreadIds([thread("a", { workflows: 1 }, false, true)])).toEqual([]);
  });

  it("порядок не зависит от порядка сайдбара", () => {
    expect(backgroundBusyThreadIds([thread("b", { workflows: 1 }), thread("a", { workflows: 1 })])).toEqual(["a", "b"]);
  });
});

describe("тред, чей дочерний тред работает, занят и сам", () => {
  it("родитель занят, пока ребёнок ждёт свой workflow", () => {
    expect(backgroundBusyThreadIds([thread("epic"), child(thread("run", { workflows: 1 }), "epic")])).toEqual(["epic", "run"]);
  });

  it("родитель занят, пока у ребёнка идёт ход", () => {
    expect(backgroundBusyThreadIds([thread("epic"), child(thread("run"), "epic", "runtime")])).toEqual(["epic"]);
  });

  it("занятость поднимается на любую глубину", () => {
    expect(
      backgroundBusyThreadIds([thread("root"), child(thread("epic"), "root"), child(thread("run"), "epic", "runtime")]),
    ).toEqual(["epic", "root"]);
  });

  it("простаивающий ребёнок родителя не занимает", () => {
    expect(backgroundBusyThreadIds([thread("epic"), child(thread("run"), "epic", "unread-success")])).toEqual([]);
  });

  it("родитель, ждущий владельца, не занят, и выше занятость не идёт", () => {
    expect(
      backgroundBusyThreadIds([thread("root"), child(thread("epic", {}, true), "root"), child(thread("run"), "epic", "runtime")]),
    ).toEqual([]);
  });

  it("архивный родитель не занят", () => {
    expect(backgroundBusyThreadIds([thread("epic", {}, false, true), child(thread("run"), "epic", "runtime")])).toEqual([]);
  });

  it("архивный ребёнок родителя не занимает", () => {
    expect(backgroundBusyThreadIds([thread("epic"), child(thread("run", {}, false, true), "epic", "runtime")])).toEqual([]);
  });

  it("родитель вне списка не ломает подсчёт", () => {
    expect(backgroundBusyThreadIds([child(thread("c"), "gone", "runtime")])).toEqual([]);
  });

  it("петля в родстве не зацикливает подъём и не делает работающий тред занятым через самого себя", () => {
    expect(backgroundBusyThreadIds([child(thread("a"), "b", "runtime"), child(thread("b"), "a")])).toEqual(["b"]);
  });

  it("ход в режиме плана или с целью — тоже ход ребёнка", () => {
    expect(
      backgroundBusyThreadIds([thread("p"), child(thread("plan"), "p", "plan-mode"), thread("q"), child(thread("goal"), "q", "goal")]),
    ).toEqual(["p", "q"]);
  });

  it("ребёнок, ждущий владельца, родителя не занимает, даже если его workflow идёт", () => {
    expect(backgroundBusyThreadIds([thread("epic"), child(thread("run", { workflows: 1 }, true), "epic", "waiting-for-input")])).toEqual([]);
  });

  it("форк исходный тред не занимает: тот его не ждёт", () => {
    expect(backgroundBusyThreadIds([thread("source"), { ...child(thread("fork"), "source", "runtime"), originKind: "fork" }])).toEqual([]);
  });

  it("родитель может стоять в списке после ребёнка", () => {
    expect(backgroundBusyThreadIds([child(thread("run"), "epic", "runtime"), thread("epic")])).toEqual(["epic"]);
  });
});
