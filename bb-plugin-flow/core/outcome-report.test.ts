// @vitest-environment node
import { describe, expect, it } from "vitest";

import { reportOnlyIssues } from "./outcome";

describe("Демонстрация — отчёт: без вопросов и без перехода", () => {
  it("чистый отчёт принимается", () => {
    expect(reportOnlyIssues({}, 0)).toEqual([]);
  });

  it("вопросы отбиваются: уточнение идёт отдельным виджетом, переход — утверждением", () => {
    const issues = reportOnlyIssues({}, 1);
    expect(issues).toEqual(["a demo is a report: questions go as a clarify, a flow switch as outcome.nextFlow on an approval"]);
  });

  it("рекомендованный flow отбивается: переводит работу кнопка утверждения", () => {
    expect(reportOnlyIssues({ nextFlow: "flow-bug" }, 0)).toEqual(["outcome.nextFlow goes on an approval: the owner moves the work with its button"]);
  });

  it("вопросы и flow вместе — оба отказа, вопросы первыми", () => {
    const issues = reportOnlyIssues({ nextFlow: "flow-bug" }, 2);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain("questions go as a clarify");
    expect(issues[1]).toContain("outcome.nextFlow goes on an approval");
  });
});
