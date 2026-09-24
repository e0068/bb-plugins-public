import { describe, expect, it } from "vitest";

import { forHandoff } from "./progress";
import type { FlowProgress } from "../shared/contract";

const done = (at: string) => ({ startedAt: at, finishedAt: at, results: [{ label: "spec.md", target: "docs/specs/spec.md" }], cost: 4, activeMinutes: 2 });

const progress: FlowProgress = {
  stages: {
    questions: done("2026-09-18T09:00:00.000Z"),
    spec: { skipped: true },
    practice: done("2026-09-18T09:30:00.000Z"),
    publish: { ...done("2026-09-18T09:45:00.000Z"), run: { steps: [{ id: "git.commit", label: "Commit" }], at: 4, error: null } },
    demo: done("2026-09-18T10:00:00.000Z"),
  },
  waiting: ["demo"],
  planned: { minutes: 65, target: 46, max: 92 },
};

const run = [
  { id: "practice", run: true, executor: "self" },
  { id: "publish", run: true, executor: "self" },
  { id: "demo", run: true, executor: "self" },
  { id: "spec", run: false, executor: "self" },
];

describe("передача работы в новый тред", () => {
  it("этап, взятый в прогон, начинается заново — след предшественника с него снят", () => {
    const moved = forHandoff(progress, run);
    expect(moved.stages.practice).toEqual({ executor: "self" });
    expect(moved.stages.demo).toEqual({ executor: "self" });
  });

  it("прогон автоматизации снимается вместе с этапом: её шаги пойдут заново", () => {
    expect(forHandoff(progress, run).stages.publish?.run).toBeUndefined();
  });

  it("этап вне прогона свой след сохраняет", () => {
    const moved = forHandoff(progress, run);
    expect(moved.stages.questions).toEqual(progress.stages.questions);
    expect(moved.stages.spec).toEqual({ skipped: true });
  });

  it("этап, ждавший владельца в прежнем треде, больше не ждёт в новом", () => {
    expect(forHandoff(progress, run).waiting).toEqual([]);
  });

  it("план ответа, которым работу передали, остаётся", () => {
    expect(forHandoff(progress, run).planned).toEqual(progress.planned);
  });

  it("ответ без этапов ничего не сбрасывает", () => {
    expect(forHandoff(progress, [])).toEqual(progress);
  });
});
