import { describe, expect, it } from "vitest";
import { backgroundBusyThreadIds, type SidebarThreadWork } from "./thread-activity.js";

const idle = { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 };
const thread = (id: string, activity: Partial<typeof idle> = {}, hasPendingInteraction = false, isArchived = false): SidebarThreadWork => ({
  id,
  isArchived,
  hasPendingInteraction,
  activity: { ...idle, ...activity },
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
