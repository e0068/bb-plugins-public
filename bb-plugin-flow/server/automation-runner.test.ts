// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "../packages/automation-steps/index";
import { STEP_IDS } from "../packages/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import { automationStage } from "../lib/stage-constants";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner, externalStep, registerAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_auto";
const T0 = "2026-09-17T10:00:00.000Z";

const flowStage = (id: string, steps: StepId[]): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps } });

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

/** Шаги-фейки: пишут вызовы по порядку и отвечают по сценарию; по умолчанию — успех. */
const fakeSteps = (answer: (id: StepId, call: number) => StepOutcome = () => ({ ok: true, detail: null })) => {
  const calls: StepId[] = [];
  const steps = Object.fromEntries(
    STEP_IDS.map((id) => [
      id,
      async () => {
        calls.push(id);
        return answer(id, calls.length);
      },
    ]),
  ) as unknown as Steps;
  return { steps, calls };
};

type Provider = { id: string; displayName: string; logoUrl: string | null };

const CLAUDE: Provider = { id: "claude-code", displayName: "Claude Code", logoUrl: "/api/v1/system/providers/claude-code/logo" };
const CODEX: Provider = { id: "codex", displayName: "Codex", logoUrl: "/api/v1/system/providers/codex/logo" };

const setup = (
  stages: WorkStage[],
  steps: Steps,
  external: (automationId: string, threadId: string) => Promise<StepOutcome> = async () => ({ ok: true, detail: null }),
  agentActive: (threadId: string) => Promise<boolean> = async () => true,
  hosted: { providerId?: string | null; providers?: Provider[] } = {},
) => {
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async (threadId: string) => ({ active: await agentActive(threadId), providerId: hosted.providerId === undefined ? "claude-code" : hosted.providerId, environmentId: null });
  const providers = async () => hosted.providers ?? [];
  const plugins = {
    list: async () => ({ plugins: [] }),
    applyUpdate: async () => undefined,
    install: async () => undefined,
    remove: async () => undefined,
  };
  const runner = createAutomationRunner({ progress, store, stages: () => settings, steps, external, thread, providers, kv: bb.storage.kv, plugins, now: () => T0, onError: (error) => { throw error; } });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  registerAutomationRunner(bb, runner);
  const view = () => harness.callRpc("getFlowProgress", { threadId: THREAD }) as Promise<{ stages: Array<{ id: string; state: string; live?: boolean; provider?: string; automation?: { steps: Array<{ state: string; error: string | null }> } }> } | null>;
  const stateOf = async (id: string) => (await view())?.stages.find((s) => s.id === id)?.state;
  return { harness, store, runner, progress, view, stateOf, kv: bb.storage.kv };
};

const review = stage("review");

describe("прогон автоматизаций без агента", () => {
  it("отметка этапа перед двумя автоматизациями выполняет обе по порядку", async () => {
    const { steps, calls } = fakeSteps();
    const { harness, stateOf } = setup([review, flowStage("publish", ["git.create-pr", "bb.tasks-in-review"]), flowStage("land", ["git.merge", "bb.archive"])], steps);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls).toEqual(["git.create-pr", "bb.tasks-in-review", "git.merge", "bb.archive"]);
  });

  it("отметка этапа перед автоматизацией говорит агенту закончить ход", async () => {
    const { steps } = fakeSteps();
    const { harness } = setup([review, flowStage("publish", ["git.create-pr"])], steps);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    expect(textOf(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD }))).toMatch(/end your turn/);
  });

  it("отметить этап-автоматизацию агенту нельзя: его ведёт Flow", async () => {
    const { steps } = fakeSteps();
    const { harness } = setup([review, flowStage("publish", ["git.create-pr"])], steps);
    expect(textOf(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "publish", state: "started" }, { threadId: THREAD }))).toMatch(/Flow runs/);
  });

  it("упавший шаг останавливает цепочку и ставит тред в ожидание", async () => {
    const { steps, calls } = fakeSteps((id) => (id === "git.merge" ? { ok: false, error: "not mergeable" } : { ok: true, detail: null }));
    const { harness, store, view, stateOf } = setup([review, flowStage("land", ["git.merge", "bb.archive"]), flowStage("after", ["git.pull-main"])], steps);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("fail"));
    expect(calls).toEqual(["git.merge"]);
    expect((await view())?.stages.find((s) => s.id === "land")?.automation?.steps[0]).toMatchObject({ state: "fail", error: "not mergeable" });
    expect(await store.listAwaiting()).toEqual([{ threadId: THREAD, briefId: "automation:land", kind: "automation" }]);
  });

  it("повтор продолжает с упавшего шага и снимает ожидание", async () => {
    let refuse = true;
    const { steps, calls } = fakeSteps((id) => (id === "git.merge" && refuse ? { ok: false, error: "busy" } : { ok: true, detail: null }));
    const { harness, store, stateOf } = setup([review, flowStage("land", ["git.fast-forward", "git.merge", "bb.archive"])], steps);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("fail"));
    refuse = false;
    expect(await harness.callRpc("retryAutomation", { threadId: THREAD, stage: "land" })).toEqual({ started: true });
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls).toEqual(["git.fast-forward", "git.merge", "git.merge", "bb.archive"]);
    expect(await store.listAwaiting()).toEqual([]);
  });

  it("повтор этапа, который не падал, ничего не запускает", async () => {
    const { steps } = fakeSteps();
    const { harness } = setup([review, flowStage("land", ["git.merge"])], steps);
    expect(await harness.callRpc("retryAutomation", { threadId: THREAD, stage: "land" })).toEqual({ started: false });
  });

  it("второй advance во время прогона ничего не запускает", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const slow = Object.fromEntries(STEP_IDS.map((id) => [id, async () => (calls.push(id), await gate, { ok: true as const, detail: null })])) as unknown as Steps;
    const { harness, runner, stateOf } = setup([review, flowStage("publish", ["git.create-pr"])], slow);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(() => expect(calls).toEqual(["git.create-pr"]));
    await runner.advance(THREAD);
    release();
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("done"));
    expect(calls).toEqual(["git.create-pr"]);
  });

  it("автоматизация Automations исполняется одним шагом через мост", async () => {
    const { steps } = fakeSteps();
    const external = vi.fn(async () => ({ ok: true as const, detail: "git.create-pr" }));
    const { harness, stateOf } = setup([review, automationStage({ id: "click-pr", name: "Pull Request" })], steps, external);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("automation-click-pr")).toBe("done"));
    expect(external).toHaveBeenCalledWith("click-pr", THREAD);
  });

  it("идущий этап виден в списке идущих тредов, ждущий автоматизацией — нет", async () => {
    const { steps } = fakeSteps((id) => (id === "git.merge" ? { ok: false, error: "x" } : { ok: true, detail: null }));
    const { harness, stateOf } = setup([review, flowStage("land", ["git.merge"])], steps);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    expect(await harness.callRpc("runningThreads", {})).toEqual([{ threadId: THREAD, icon: "self" }]);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("fail"));
    expect(await harness.callRpc("runningThreads", {})).toEqual([]);
  });
});

describe("шаг автоматизации Automations", () => {
  it("нет плагина Automations — шаг падает с причиной", async () => {
    const run = externalStep(async () => ({ ok: false, reason: "not-installed", status: 404 }));
    expect(await run("click-pr", THREAD)).toMatchObject({ ok: false, error: expect.stringMatching(/not installed/) });
  });

  it("пропущенная по условиям автоматизация — провал с причиной, выполненная — перечень действий", async () => {
    expect(await externalStep(async () => ({ ok: true, value: { executed: [], skipped: "conditions", error: null } }))("a", THREAD)).toMatchObject({ ok: false, error: expect.stringMatching(/conditions/) });
    expect(await externalStep(async () => ({ ok: true, value: { executed: ["git.merge"], skipped: null, error: null } }))("a", THREAD)).toEqual({ ok: true, detail: "git.merge" });
    expect(await externalStep(async () => ({ ok: true, value: { executed: ["git.create-pr"], skipped: null, error: "boom" } }))("a", THREAD)).toMatchObject({ ok: false, error: expect.stringMatching(/boom/) });
  });
});

describe("прогон после перезапуска сервера", () => {
  it("прерванный на середине этап продолжается со своего шага при следующем advance", async () => {
    const { steps, calls } = fakeSteps();
    const stages = [review, flowStage("land", ["git.merge", "git.pull-main", "bb.archive"])];
    const { progress, runner, stateOf } = setup(stages, steps);
    await progress.update(THREAD, (p) => ({ ...p, stages: { review: { finishedAt: T0 }, land: { startedAt: T0, run: { steps: [{ id: "git.merge", label: "m" }, { id: "git.pull-main", label: "p" }, { id: "bb.archive", label: "a" }], at: 1, error: null } } } }));
    await runner.advance(THREAD);
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls).toEqual(["git.pull-main", "bb.archive"]);
  });
});

describe("после ревью исполнителя", () => {
  it("загрузка плагина только продолжает прерванные прогоны и не начинает новых", async () => {
    const { steps, calls } = fakeSteps();
    const { runner, kv, stateOf } = setup([review, flowStage("land", ["git.merge", "bb.archive"])], steps);
    // Старый тред: этап перед автоматизацией закрыт давно, автоматизация не начиналась — запись без правки через исполнителя.
    await kv.set("flow-progress:thr_old", { stages: { review: { finishedAt: T0 } }, waiting: [] });
    await runner.resume("thr_old");
    expect(calls).toEqual([]);
    // Прерванный на шаге прогон продолжается.
    await kv.set(`flow-progress:${THREAD}`, { stages: { review: { finishedAt: T0 }, land: { startedAt: T0, run: { steps: [{ id: "git.merge", label: "m" }, { id: "bb.archive", label: "a" }], at: 1, error: null } } }, waiting: [] });
    await runner.resume(THREAD);
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls).toEqual(["bb.archive"]);
  });

  it("«Пропустить» закрывает упавший шаг, снимает ожидание и продолжает цепочку", async () => {
    const { steps, calls } = fakeSteps((id) => (id === "git.create-pr" ? { ok: false, error: "Can't open a PR right now (pr-exists)." } : { ok: true, detail: null }));
    const { harness, store, stateOf } = setup([review, flowStage("publish", ["git.create-pr", "bb.tasks-in-review"])], steps);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("fail"));
    expect(await harness.callRpc("skipAutomationStep", { threadId: THREAD, stage: "publish" })).toEqual({ started: true });
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("done"));
    expect(calls).toEqual(["git.create-pr", "bb.tasks-in-review"]);
    expect(await store.listAwaiting()).toEqual([]);
  });

  it("правка прогресса во время конца прогона не теряется: автоматизация за ней всё равно запускается", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const slow = Object.fromEntries(STEP_IDS.map((id) => [id, async () => (calls.push(id), id === "git.create-pr" ? await gate : undefined, { ok: true as const, detail: null })])) as unknown as Steps;
    const stages = [review, flowStage("publish", ["git.create-pr"]), stage("docs"), flowStage("land", ["git.merge"])];
    const { harness, stateOf } = setup(stages, slow);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(() => expect(calls).toEqual(["git.create-pr"]));
    // Пока прогон занят, агент закрывает следующий этап: пробуждение приходит в занятый исполнитель.
    const marked = harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "docs", state: "done" }, { threadId: THREAD });
    release();
    await marked;
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls).toEqual(["git.create-pr", "git.merge"]);
  });

  it("ожидание упавшего этапа, которого больше нет во flow, снимается повтором", async () => {
    const { steps } = fakeSteps();
    const { harness, store } = setup([review], steps);
    await store.putAwaiting(THREAD, { briefId: "automation:gone", kind: "automation" });
    expect(await harness.callRpc("retryAutomation", { threadId: THREAD, stage: "gone" })).toEqual({ started: false });
    expect(await store.listAwaiting()).toEqual([]);
  });
});

describe("значок идущего этапа — только при живой работе", () => {
  const idle = async () => false;
  const gated = () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async () => (await gate, { ok: true as const, detail: null })])) as unknown as Steps;
    return { steps, release };
  };

  it("этап навыка начат, а ход агента закончился — треда нет в идущих, этап не живой", async () => {
    const { steps } = fakeSteps();
    const { harness, view } = setup([review], steps, undefined, idle);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    expect(await harness.callRpc("runningThreads", {})).toEqual([]);
    expect((await view())?.stages.find((s) => s.id === "review")).toMatchObject({ state: "now", live: false });
  });

  it("этап навыка начат и агент работает — этап живой", async () => {
    const { steps } = fakeSteps();
    const { harness, view } = setup([review], steps);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    expect((await view())?.stages.find((s) => s.id === "review")).toMatchObject({ state: "now", live: true });
  });

  it("идущая автоматизация видна молнией и живая, даже когда агент не работает", async () => {
    const { steps, release } = gated();
    const { harness, view, stateOf } = setup([review, flowStage("publish", ["git.create-pr"])], steps, undefined, idle);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("now"));
    expect(await harness.callRpc("runningThreads", {})).toEqual([{ threadId: THREAD, icon: "automation" }]);
    expect((await view())?.stages.find((s) => s.id === "publish")).toMatchObject({ live: true });
    release();
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("done"));
    expect(await harness.callRpc("runningThreads", {})).toEqual([]);
  });

  it("упавшая автоматизация не живая, даже когда агент работает", async () => {
    const { steps } = fakeSteps(() => ({ ok: false, error: "x" }));
    const { harness, view, stateOf } = setup([review, flowStage("land", ["git.merge"])], steps);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("fail"));
    expect((await view())?.stages.find((s) => s.id === "land")).toMatchObject({ live: false });
  });

  it("статус треда не прочитался — этап навыка не живой", async () => {
    const { steps } = fakeSteps();
    const { harness, view } = setup([review], steps, undefined, async () => {
      throw new Error("no thread");
    });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    expect(await harness.callRpc("runningThreads", {})).toEqual([]);
    expect((await view())?.stages.find((s) => s.id === "review")).toMatchObject({ live: false });
  });

  it("статус треда не спрашивается, когда начатого этапа навыка нет: идёт только автоматизация", async () => {
    const { steps, release } = gated();
    const agentActive = vi.fn(async () => true);
    const { harness, stateOf } = setup([review, flowStage("publish", ["git.create-pr"])], steps, undefined, agentActive);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("now"));
    agentActive.mockClear();
    expect(await harness.callRpc("runningThreads", {})).toEqual([{ threadId: THREAD, icon: "automation" }]);
    expect(agentActive).not.toHaveBeenCalled();
    release();
  });

  it("при работающем агенте значок — первого по порядку живого этапа", async () => {
    const { steps, release } = gated();
    const stages = [review, flowStage("publish", ["git.create-pr"])];
    const { harness, progress, stateOf } = setup(stages, steps);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("now"));
    await progress.update(THREAD, (p) => ({ ...p, stages: { ...p.stages, review: { startedAt: T0 } } }));
    expect(await harness.callRpc("runningThreads", {})).toEqual([{ threadId: THREAD, icon: "self" }]);
    release();
  });
});

describe("провайдер идущего этапа", () => {
  const coder = { id: "agent:coder", kind: "agent", name: "coder", provider: "codex" } as const;

  it("этап самого агента — провайдер треда с именем и логотипом", async () => {
    const { steps } = fakeSteps();
    const { harness, view } = setup([review], steps, undefined, undefined, { providerId: "codex", providers: [CLAUDE, CODEX] });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    expect(await harness.callRpc("runningThreads", {})).toEqual([{ threadId: THREAD, icon: "self", provider: { name: "Codex", logoUrl: CODEX.logoUrl } }]);
    expect((await view())?.stages.find((s) => s.id === "review")).toMatchObject({ provider: "codex" });
  });

  it("этап субагента — провайдер субагента, а не треда", async () => {
    const { steps } = fakeSteps();
    const { harness, progress, view } = setup([stage("code", { executors: [coder] })], steps, undefined, undefined, { providerId: "claude-code", providers: [CLAUDE, CODEX] });
    await progress.update(THREAD, (p) => ({ ...p, stages: { code: { startedAt: T0, executor: coder.id } } }));
    expect(await harness.callRpc("runningThreads", {})).toEqual([{ threadId: THREAD, icon: "agent", provider: { name: "Codex", logoUrl: CODEX.logoUrl } }]);
    expect((await view())?.stages[0]).toMatchObject({ provider: "codex" });
  });

  it("у провайдера нет логотипа или его нет в списке хоста — значок без провайдера", async () => {
    const { steps } = fakeSteps();
    const { harness } = setup([review], steps, undefined, undefined, { providerId: "codex", providers: [{ ...CODEX, logoUrl: null }] });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    expect(await harness.callRpc("runningThreads", {})).toEqual([{ threadId: THREAD, icon: "self" }]);
    const other = setup([review], steps, undefined, undefined, { providerId: "codex", providers: [CLAUDE] });
    await other.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    expect(await other.harness.callRpc("runningThreads", {})).toEqual([{ threadId: THREAD, icon: "self" }]);
  });

  it("идущая автоматизация — без провайдера", async () => {
    const { steps, release } = (() => {
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (open = resolve));
      return { steps: Object.fromEntries(STEP_IDS.map((id) => [id, async () => (await gate, { ok: true as const, detail: null })])) as unknown as Steps, release: () => open() };
    })();
    const { harness, stateOf } = setup([review, flowStage("publish", ["git.create-pr"])], steps, undefined, async () => false, { providers: [CLAUDE] });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("now"));
    expect(await harness.callRpc("runningThreads", {})).toEqual([{ threadId: THREAD, icon: "automation" }]);
    release();
  });
});

