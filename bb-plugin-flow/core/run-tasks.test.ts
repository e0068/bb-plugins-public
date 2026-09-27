// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ProgressStage } from "../shared/contract";
import { isTaskFile, runTasks, taskRoute, taskTitle } from "./run-tasks";

const stage = (id: string, results: ProgressStage["results"]): ProgressStage => ({ id, kind: "skill", name: id, executor: "self", state: "done", results, minutes: 1, cost: 0 });

describe("задачи прогона из результатов этапов", () => {
  it("ключ доски в подписи — задача, даже если цель не файл задачи", () => {
    expect(runTasks([stage("task", [{ label: "BBPL-300", target: "https://example.com/x" }])])).toEqual([{ address: "BBPL-300" }]);
  });

  it("файл в docs/tasks без ключа — задача по слагу файла, с названием, если этап его запомнил", () => {
    const results = [{ label: "flow-itog", target: "docs/tasks/in_progress/flow-itog.md", title: "Flow — итог" }];
    expect(runTasks([stage("task", results)])).toEqual([{ address: "flow-itog", title: "Flow — итог" }]);
  });

  it("спецификация, план и прочие файлы задачами не считаются", () => {
    const results = [
      { label: "spec.md", target: "docs/specs/BBPL-1-x.md" },
      { label: "run-summary.tsx", target: "bb-plugin-flow/app/run-summary.tsx" },
    ];
    expect(runTasks([stage("spec", results)])).toEqual([]);
  });

  it("одна задача в результатах нескольких этапов показывается один раз, по первому упоминанию", () => {
    const first = stage("task", [{ label: "BBPL-7", target: "docs/tasks/todo/a.md", title: "А" }]);
    const again = stage("demo", [{ label: "BBPL-7", target: "docs/tasks/done/a.md" }, { label: "BBPL-8", target: "docs/tasks/done/b.md" }]);
    expect(runTasks([first, again])).toEqual([{ address: "BBPL-7", title: "А" }, { address: "BBPL-8" }]);
  });

  it("файл задачи, названный на одном этапе ключом, а на другом слагом, — одна задача под ключом", () => {
    const bySlug = stage("task", [{ label: "flow-itog.md", target: "docs/tasks/in_progress/flow-itog.md", title: "Итог" }]);
    const byKey = stage("review", [{ label: "BBPL-7", target: "docs/tasks/in_review/flow-itog.md" }]);
    expect(runTasks([bySlug, byKey])).toEqual([{ address: "BBPL-7", title: "Итог" }]);
  });

  it("задач не больше, чем результатов, и адреса не повторяются", () => {
    const result = fc.record({ label: fc.constantFrom("BBPL-1", "BBPL-2", "spec.md", "x"), target: fc.constantFrom("docs/tasks/todo/a.md", "docs/specs/s.md", "src/a.ts") });
    fc.assert(
      fc.property(fc.array(fc.array(result, { maxLength: 4 }), { maxLength: 4 }), (lists) => {
        const tasks = runTasks(lists.map((results, i) => stage(`s${i}`, results)));
        expect(tasks.length).toBeLessThanOrEqual(lists.flat().length);
        expect(new Set(tasks.map((task) => task.address)).size).toBe(tasks.length);
      }),
    );
  });
});

describe("файл задачи", () => {
  it("узнаётся по папке статуса под docs/tasks — относительный и абсолютный путь", () => {
    expect(isTaskFile("docs/tasks/backlog/a.md")).toBe(true);
    expect(isTaskFile("/Users/me/repo/docs/tasks/done/a.md")).toBe(true);
    expect(isTaskFile("docs/tasks/a.md")).toBe(false);
    expect(isTaskFile("docs/specs/a.md")).toBe(false);
  });

  it("название берётся из шапки, кавычки снимаются", () => {
    expect(taskTitle("---\ntitle: Flow — итог прогона\nslug: x\n---\n\nтело")).toBe("Flow — итог прогона");
    expect(taskTitle('---\nslug: x\ntitle: "В кавычках"\n---\n')).toBe("В кавычках");
  });

  it("длинное название в кавычках, перенесённое на вторую строку, читается целиком", () => {
    expect(taskTitle('---\ntitle: "Flow — ссылки у этапа: инструкция против\n  проверки отчёта"\nslug: x\n---\n')).toBe("Flow — ссылки у этапа: инструкция против проверки отчёта");
  });

  it("без шапки или без названия в ней названия нет", () => {
    expect(taskTitle("# title: не шапка\n")).toBeUndefined();
    expect(taskTitle("---\nslug: x\n---\ntitle: в теле\n")).toBeUndefined();
  });
});

describe("маршрут карточки задачи", () => {
  it("ведёт на карточку Tasks+ и экранирует адрес", () => {
    expect(taskRoute("BBPL-300")).toBe("/plugins/tasks-plus/tasks/task/BBPL-300");
    expect(taskRoute("a b")).toBe("/plugins/tasks-plus/tasks/task/a%20b");
  });
});
