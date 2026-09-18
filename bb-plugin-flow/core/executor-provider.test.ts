// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { WorkStage } from "../shared/contract";
import { builtinAutomationStage, executorProvider } from "./automation-run";
import { EMPTY_PROGRESS, onMark, progressView } from "./progress";
import { dev2, planner, stage } from "./stages-fixtures";

const T0 = "2026-09-17T10:00:00.000Z";
const plan = stage("plan", { executors: [planner, dev2] });
const codex = { id: "agent:coder", kind: "agent", name: "coder", provider: "codex" } as const;
const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", automation: { source: "flow", steps: ["git.create-pr"] } };

describe("провайдер исполнителя этапа", () => {
  it("этап ведёт сам агент — провайдер треда", () => {
    expect(executorProvider(plan, { startedAt: T0 }, "codex")).toBe("codex");
    expect(executorProvider(plan, { startedAt: T0 }, null)).toBeNull();
  });

  it("этап отдан субагенту — провайдер субагента, а не треда", () => {
    expect(executorProvider(plan, { executor: planner.id }, "codex")).toBe("claude-code");
    expect(executorProvider(stage("code", { executors: [codex] }), { executor: codex.id }, "claude-code")).toBe("codex");
  });

  it("субагента нет среди исполнителей этапа, workflow, автоматизация и встроенный этап — провайдера нет", () => {
    expect(executorProvider(plan, { executor: "agent:gone" }, "claude-code")).toBeNull();
    expect(executorProvider(plan, { executor: dev2.id }, "claude-code")).toBeNull();
    expect(executorProvider(publish, { startedAt: T0 }, "claude-code")).toBeNull();
    expect(executorProvider(builtinStage("demo", []), {}, "claude-code")).toBeNull();
  });

  it("вид прогресса несёт провайдера этапа навыка, без провайдера треда — только у субагента", () => {
    const started = onMark(EMPTY_PROGRESS, "plan", "started", T0);
    expect(progressView(started, [plan], true, "codex").stages[0]).toMatchObject({ provider: "codex" });
    expect(progressView(started, [plan]).stages[0]!.provider).toBeUndefined();
  });
});
