// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { FlowProgress, WorkStage } from "../shared/contract";
import { approvalIssues } from "./approval-guard";

const stage = (id: string, kind: WorkStage["kind"]): WorkStage => ({ id, kind, skill: "", name: id.toUpperCase(), executors: [] });
const FLOW: WorkStage[] = [stage("demo-1", "demo"), stage("approve-1", "approve")];
const sent: FlowProgress = { stages: { "demo-1": { finishedAt: "2026-10-12T10:00:00.000Z" } }, waiting: [] };

describe("утверждение вслед за свёрнутым утверждением", () => {
  it("без доработанных виджетов отбивается: сказано, что прислать сначала и что утверждение — потом", () => {
    const [issue] = approvalIssues(FLOW, sent, "approve-1", true);
    expect(issue).toContain("reworked widgets");
    expect(issue).toContain("then this approval");
  });

  it("отказ стоит и тогда, когда прогресс не подключён: проверять демонстрации нечем, а свёртка известна", () => {
    expect(approvalIssues(FLOW, undefined, "approve-1", true)).toHaveLength(1);
  });

  it("неприсланная демонстрация и свёртка называются обе", () => {
    expect(approvalIssues(FLOW, { stages: {}, waiting: [] }, "approve-1", true)).toHaveLength(2);
  });

  it("без свёртки отказа нет, как и раньше", () => {
    expect(approvalIssues(FLOW, sent, "approve-1", false)).toEqual([]);
    expect(approvalIssues(FLOW, sent, "approve-1")).toEqual([]);
  });
});
