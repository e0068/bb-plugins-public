// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { FlowSettings } from "../shared/contract";
import plugin from "../server";
import { FLOW_STAGE_TOOL } from "./progress";

const THREAD = "thr_wake";

const flow = (last: "skill" | "action"): FlowSettings => ({
  flows: [
    {
      id: "default",
      name: "Default",
      stages: [
        { id: "review", kind: "skill", skill: "code-review", name: "Review", executors: [] },
        { id: "publish", kind: "action", skill: "", name: "Publish", executors: [], automation: { source: "flow", steps: ["bb.tasks-in-review"] } },
        ...(last === "skill" ? [{ id: "implement", kind: "skill" as const, skill: "code-standards-fp", name: "Implementation", executors: [] }] : []),
      ],
    },
  ],
  minButtonWidth: 170,
});

/** Плагин целиком на фейковом хосте: шаг задачи выполняется без сети, реплика агенту записывается. */
const loaded = async (settings: FlowSettings) => {
  const sent: Array<{ threadId: string }> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async () => ({ id: THREAD, projectId: "proj_1", environmentId: null, status: "idle", providerId: "claude-code", title: "Тред" }),
        send: async (args: { threadId: string }) => {
          sent.push(args);
          return { delivery: "started" as const };
        },
      },
    },
  });
  await plugin(bb);
  await harness.callRpc("saveFlowSettings", settings);
  return { harness, sent };
};

const press = async (harness: Awaited<ReturnType<typeof loaded>>["harness"]) => {
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  await vi.waitFor(async () => expect(((await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Array<{ id: string; state: string }> }).stages.find((s) => s.id === "publish")?.state).toBe("now"));
  return harness.callRpc("runActionStep", { threadId: THREAD, stage: "publish" });
};

describe("закрытый этап Action будит агента", () => {
  it("за последним шагом Action идёт этап навыка — агенту уходит реплика", async () => {
    const { harness, sent } = await loaded(flow("skill"));
    expect(await press(harness)).toEqual({ started: true });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ threadId: THREAD });
  });

  it("этап Action последним в flow агента не будит", async () => {
    const { harness, sent } = await loaded(flow("action"));
    expect(await press(harness)).toEqual({ started: true });
    await vi.waitFor(async () => expect(((await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Array<{ id: string; state: string }> }).stages.find((s) => s.id === "publish")?.state).toBe("done"));
    expect(sent).toEqual([]);
  });
});
