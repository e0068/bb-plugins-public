import { describe, expect, it } from "vitest";

import type { FlowProgress, WorkStage } from "../shared/contract";
import { approvalIssues, unsentDemos } from "./approval-guard";

const stage = (id: string, kind: WorkStage["kind"] = "skill"): WorkStage => ({ id, kind, skill: "", name: id.toUpperCase(), executors: [] });

const FLOW: WorkStage[] = [stage("criteria", "criteria"), stage("approve-1", "approve"), stage("code"), stage("demo-1", "demo"), stage("demo-2", "demo"), stage("approve-2", "approve")];

const progress = (stages: FlowProgress["stages"]): FlowProgress => ({ stages, waiting: [] });
const sent = { finishedAt: "2026-10-12T10:00:00.000Z" };

describe("утверждение над присланными демонстрациями", () => {
  it("демонстрация между прошлым утверждением и этим не присылалась — она названа", () => {
    expect(unsentDemos(FLOW, progress({ "demo-1": sent }), "approve-2").map((s) => s.id)).toEqual(["demo-2"]);
  });

  it("все демонстрации присланы — называть нечего", () => {
    expect(unsentDemos(FLOW, progress({ "demo-1": sent, "demo-2": sent }), "approve-2")).toEqual([]);
  });

  it("прогресса нет — демонстрации не присылались", () => {
    expect(unsentDemos(FLOW, null, "approve-2").map((s) => s.id)).toEqual(["demo-1", "demo-2"]);
  });

  it("демонстрация вне прогона не требуется", () => {
    expect(unsentDemos(FLOW, progress({ "demo-1": sent, "demo-2": { skipped: true } }), "approve-2")).toEqual([]);
  });

  it("демонстрации до прошлого утверждения не считаются", () => {
    const flow = [stage("demo-0", "demo"), ...FLOW];
    expect(unsentDemos(flow, progress({ "demo-1": sent, "demo-2": sent }), "approve-2")).toEqual([]);
  });

  it("первое утверждение без демонстраций перед ним — свободно", () => {
    expect(unsentDemos(FLOW, null, "approve-1")).toEqual([]);
  });

  it("этапа-утверждения нет в flow — называть нечего", () => {
    expect(unsentDemos(FLOW, null, "nope")).toEqual([]);
  });
});

describe("отказ утверждению", () => {
  it("называет неприсланные демонстрации и говорит, что прислать сначала", () => {
    const [issue] = approvalIssues(FLOW, progress({}), "approve-2");
    expect(issue).toContain('demo-1 "DEMO-1", demo-2 "DEMO-2"');
    expect(issue).toContain("send");
  });

  it("при присланных демонстрациях отказа нет", () => {
    expect(approvalIssues(FLOW, progress({ "demo-1": sent, "demo-2": sent }), "approve-2")).toEqual([]);
  });

  it("прогресс не подключён — проверять нечем, отказа нет", () => {
    expect(approvalIssues(FLOW, undefined, "approve-2")).toEqual([]);
  });
});
