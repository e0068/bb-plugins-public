// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

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

/**
 * Плагин целиком на фейковом хосте: шаг задачи выполняется без сети. Ожидания держатся на событиях, а не на таймере:
 * `replied` — сама отправка реплики агенту, `until` — запись в kv плагина, после которой условие на прогрессе верно.
 */
const loaded = async (settings: FlowSettings) => {
  const sent: Array<{ threadId: string }> = [];
  let reply: (args: { threadId: string }) => void = () => undefined;
  const replied = new Promise<{ threadId: string }>((resolve) => (reply = resolve));
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async () => ({ id: THREAD, projectId: "proj_1", environmentId: null, status: "idle", providerId: "claude-code", title: "Тред" }),
        send: async (args: { threadId: string }) => {
          sent.push(args);
          reply(args);
          return { delivery: "started" as const };
        },
      },
    },
  });
  const checks = new Set<() => Promise<void>>();
  const { kv } = bb.storage;
  const write = kv.set.bind(kv);
  kv.set = async (key, value) => {
    await write(key, value);
    checks.forEach((check) => void check());
  };
  const until = (holds: () => Promise<boolean>): Promise<void> =>
    new Promise((resolve) => {
      const check = async () => {
        if (checks.has(check) && (await holds())) {
          checks.delete(check);
          resolve();
        }
      };
      checks.add(check);
      void check();
    });
  await plugin(bb);
  await harness.callRpc("saveFlowSettings", settings);
  const publishIs = (state: string) => async () => ((await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Array<{ id: string; state: string }> } | null)?.stages.find((s) => s.id === "publish")?.state === state;
  return { harness, sent, replied, until, publishIs };
};

const press = async ({ harness, until, publishIs }: Awaited<ReturnType<typeof loaded>>) => {
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  await until(publishIs("now"));
  return harness.callRpc("runActionStep", { threadId: THREAD, stage: "publish" });
};

/** Повторное нажатие на закрытый этап ждёт, пока Flow доведёт начатую работу вместе с пробуждением, и отказывает. */
const settled = ({ harness }: Awaited<ReturnType<typeof loaded>>) => harness.callRpc("runActionStep", { threadId: THREAD, stage: "publish" });

describe("закрытый этап Action будит агента", () => {
  it("за последним шагом Action идёт этап навыка — агенту уходит одна реплика", async () => {
    const host = await loaded(flow("skill"));
    expect(await press(host)).toEqual({ started: true });
    expect(await host.replied).toMatchObject({ threadId: THREAD });
    expect(await settled(host)).toEqual({ started: false });
    expect(host.sent).toHaveLength(1);
  });

  it("этап Action последним в flow агента не будит", async () => {
    const host = await loaded(flow("action"));
    expect(await press(host)).toEqual({ started: true });
    await host.until(host.publishIs("done"));
    expect(await settled(host)).toEqual({ started: false });
    expect(host.sent).toEqual([]);
  });
});
