// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { onRunStart, onStepDone, stepsOf } from "../core/automation-run";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createProgress } from "./progress";
import { createStore } from "./store";
import { priced } from "./priced-fixture";

const THREAD = "thr_1";
const T0 = "2026-10-01T10:00:00.000Z";
const PR = { label: "PR #570", target: "https://github.com/e0068/bb-plugins/pull/570" };

const publish: WorkStage = { id: "publish", kind: "skill", skill: "", name: "Publish", executors: [], automation: { source: "flow", steps: ["git.commit", "git.create-pr"] } };
const settings: StageSettings = { stages: [stage("review"), publish, stage("after")], minButtonWidth: 170 };

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  await progress.update(THREAD, (p) => onStepDone(onStepDone(onRunStart(p, "publish", stepsOf(publish), T0), "publish", T0), "publish", T0, PR.target, [PR]));
  let n = 0;
  registerAskTool(bb, store, { newId: () => `L${++n}`, now: () => T0, stages: () => settings, progress });
  const idOf = (result: unknown) => /id="(dec_[^"]+)"/.exec(typeof result === "string" ? result : "")?.[1] ?? "";
  return { harness, store, idOf };
};

const reports = [
  { id: "review", state: "done", results: [{ label: "review.md", target: "docs/review.md" }] },
  { id: "publish", state: "done" },
  { id: "after", state: "todo", recommended: true },
];

describe("ссылки сделанной автоматизации в брифе", () => {
  it("бриф без ссылок у сделанной автоматизации принимается, и ссылки ставит Flow из её шагов", async () => {
    const { harness, store, idOf } = await host();
    const id = idOf(await harness.callAgentTool(ASK_TOOL_NAME, priced({ title: "Бриф", setup: { stages: reports } }), { threadId: THREAD }));
    const brief = await store.getBrief(id);
    expect(brief?.setup?.stages?.find((s) => s.id === "publish")?.results).toEqual([PR]);
  });
});
