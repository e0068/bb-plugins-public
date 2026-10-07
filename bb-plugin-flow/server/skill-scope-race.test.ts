// @vitest-environment node
// Сверки одного треда идут по очереди: перекрывшиеся сверки не оставляют в файле записей, которые никто не снимет.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { Flow, FlowProgress, WorkStage } from "../shared/contract";
import { createSkillScope } from "./skill-scope";

const at = "2026-10-07T10:00:00.000Z";
const stage = (id: string, skill: string): WorkStage => ({ id, name: id, skill, executors: [] });
const LIMITED: Flow = { id: "f", name: "F", stages: [stage("brief", "flow-questions"), stage("spec", "spec")], limitSkills: true };
const { limitSkills: _, ...OPEN } = LIMITED;

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("сверки одного треда", () => {
  it("перекрывшиеся сверки и выключенный переключатель оставляют файл пустым", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-scope-race-"));
    dirs.push(root);
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    let flow: Flow = LIMITED;
    // Вторая сверка читает прогресс только после того, как первая записала файл: так перекрываются сверки в жизни.
    let firstDone: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (firstDone = resolve));
    const reads: Array<() => Promise<FlowProgress | null>> = [
      async () => null,
      async () => (await gate, { stages: { brief: { startedAt: at, finishedAt: at } }, waiting: [] }),
    ];
    const scope = createSkillScope({
      kv: bb.storage.kv,
      worktree: async () => root,
      flow: () => flow,
      stages: () => flow.stages,
      progress: () => (reads.shift() ?? (async () => null))(),
      catalog: async () => ({ skills: ["flow-questions", "spec", "plan"].map((name) => ({ name, origin: { kind: "own" as const } })), executors: [] }),
      plugins: async () => [],
      workflowScripts: async () => [],
      warn: () => undefined,
    });
    const first = scope.sync("thr").then(firstDone);
    const second = scope.sync("thr");
    await Promise.race([Promise.all([first, second]), new Promise((resolve) => setTimeout(resolve, 500))]);
    firstDone();
    await Promise.all([first, second]);
    flow = OPEN;
    await scope.sync("thr");
    expect(JSON.parse(await readFile(join(root, ".claude", "settings.local.json"), "utf8"))).toEqual({});
  });
});
