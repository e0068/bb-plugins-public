// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { FlowProgress, WorkStage } from "../shared/contract";
import { progressView } from "./progress";

const AT = "2026-10-02T10:00:00.000Z";
const stage = (id: string, parent?: string): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...(parent === undefined ? {} : { parent }) });
const STAGES = [stage("ship"), stage("preview", "demo"), stage("demo"), stage("restore", "demo"), stage("merge")];
const closed = { startedAt: AT, finishedAt: AT };

describe("счёт полосы при связке", () => {
  it("«сделано» считает только этапы верхнего уровня и не больше «всего»", () => {
    const view = progressView({ stages: { ship: closed, preview: closed, demo: closed, restore: closed }, waiting: [] }, STAGES);
    expect([view.done, view.total]).toEqual([2, 3]);
  });

  it("идущий под-этап снятого владельца держит счётчик на своём месте, а не на последнем номере", () => {
    const progress: FlowProgress = { stages: { ship: closed, preview: { startedAt: AT }, demo: { skipped: true } }, waiting: [] };
    const view = progressView(progress, STAGES);
    expect([view.step, view.total]).toEqual([1, 2]);
  });
});
