import { describe, expect, it } from "vitest";

import { isTaskAddress, readTaskLookup, taskLookupRequest } from "./task-lookup";

const task = { key: "BBPL-7", title: "Задача", description: "## Проблема", status: "in_progress", priority: "high", extra: 1 };

describe("задача Tasks+ для карточки демонстрации", () => {
  it("адрес — ключ или слаг; пустой и с пробелом не адресуют задачу", () => {
    expect(isTaskAddress("BBPL-7")).toBe(true);
    expect(isTaskAddress("tasks-token-bazy-zhivet")).toBe(true);
    expect(isTaskAddress("BBPL 7")).toBe(false);
    expect(isTaskAddress("  ")).toBe(false);
  });

  it("запрос идёт в RPC Tasks+ с тредом брифа", () => {
    const request = taskLookupRequest(" BBPL-7 ", "thr_1");
    expect(request.url).toBe("/api/v1/plugins/tasks-plus/rpc/getTaskByKey");
    expect(JSON.parse(request.body)).toEqual({ taskKey: "BBPL-7", callerThreadId: "thr_1" });
  });

  it("найденная задача — её ключ, заголовок, описание, статус и приоритет", () => {
    expect(readTaskLookup(200, { ok: true, result: { task } })).toEqual({
      kind: "found",
      task: { key: "BBPL-7", title: "Задача", description: "## Проблема", status: "in_progress", priority: "high" },
    });
  });

  it("задачи нет — not_found", () => {
    expect(readTaskLookup(200, { ok: true, result: { task: null } })).toEqual({ kind: "not_found" });
  });

  it("отказ, чужой формат или нет Tasks+ — error", () => {
    expect(readTaskLookup(404, { ok: false, error: "plugin not found" })).toEqual({ kind: "error" });
    expect(readTaskLookup(200, { ok: false })).toEqual({ kind: "error" });
    expect(readTaskLookup(200, { ok: true, result: { task: { ...task, status: "weird" } } })).toEqual({ kind: "error" });
    expect(readTaskLookup(200, null)).toEqual({ kind: "error" });
  });
});
