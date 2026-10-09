// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_release";
const T0 = "2026-10-09T17:00:00.000Z";

const flowStage = (id: string, steps: StepId[]): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps } });
const actionStage = (id: string, steps: StepId[]): WorkStage => ({ id, kind: "action", skill: "", name: id, executors: [], automation: { source: "flow", steps } });

/** Журнал по порядку: шаги и освобождение агента пишут в него, чтобы было видно, что за чем шло. */
type Options = {
  /** Занят ли агент — читается на каждый запрос треда; бросает — тред не прочитался. */
  active: boolean | (() => boolean);
  release?: (threadId: string) => Promise<void>;
  /** Шаг, который падает, пока флаг не снят. */
  failing?: { step: StepId; until: () => boolean };
};

const setup = (stages: WorkStage[], options: Options) => {
  const log: string[] = [];
  const errors: unknown[] = [];
  const answer = (id: StepId): StepOutcome => (log.push(id), options.failing?.step === id && !options.failing.until() ? { ok: false, error: "busy" } : { ok: true, detail: null });
  const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async () => answer(id)])) as unknown as Steps;
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: typeof options.active === "function" ? options.active() : options.active, providerId: "claude-code", environmentId: null });
  const runner = createAutomationRunner({
    progress,
    store: createStore(bb.storage.kv),
    stages: () => settings,
    steps,
    external: async () => ({ ok: true, detail: null }),
    thread,
    providers: async () => [],
    kv: bb.storage.kv,
    plugins: { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined },
    now: () => T0,
    retry: () => ({ seconds: 0, attempts: 3 }),
    releaseAgent: options.release ?? (async (threadId) => void log.push(`release:${threadId}`)),
    onError: (error) => void errors.push(error),
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  const closeReview = () => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  return { runner, log, errors, closeReview };
};

const review = stage("review");
const finale = flowStage("finale", ["git.merge", "bb.archive"]);

describe("автоматизация, архивирующая тред, сперва освобождает процесс агента", () => {
  it("агент простаивает — процесс освобождается перед каждым шагом, пока архивация впереди", async () => {
    const { log, closeReview } = setup([review, finale], { active: false });
    await closeReview();
    await vi.waitFor(() => expect(log).toEqual([`release:${THREAD}`, "git.merge", `release:${THREAD}`, "bb.archive"]));
  });

  it("этап без архивации агента не трогает", async () => {
    const { log, closeReview } = setup([review, flowStage("publish", ["git.commit", "git.create-pr"])], { active: false });
    await closeReview();
    await vi.waitFor(() => expect(log).toEqual(["git.commit", "git.create-pr"]));
  });

  it("агент в ходе — ход не обрывается, шаги идут как прежде", async () => {
    const { log, closeReview } = setup([review, finale], { active: true });
    await closeReview();
    await vi.waitFor(() => expect(log).toEqual(["git.merge", "bb.archive"]));
  });

  it("сбой освобождения уходит в onError и цепочку не останавливает", async () => {
    const { log, errors, closeReview } = setup([review, finale], {
      active: false,
      release: async () => {
        throw new Error("stop refused");
      },
    });
    await closeReview();
    await vi.waitFor(() => expect(log).toEqual(["git.merge", "bb.archive"]));
    expect(errors).toEqual([new Error("stop refused"), new Error("stop refused")]);
  });

  it("шаг Action, за которым архивация, тоже идёт после освобождения", async () => {
    const { runner, log, closeReview } = setup([review, actionStage("finale", ["git.merge", "bb.archive"])], { active: false });
    await closeReview();
    await vi.waitFor(async () => expect(await runner.runActionStep(THREAD, "finale")).toBe(true));
    await vi.waitFor(() => expect(log).toEqual([`release:${THREAD}`, "git.merge"]));
  });

  it("агент в ходе на старте этапа, к остановке серверов простаивает — освобождение прямо перед ней", async () => {
    // Агент дописывает ответ на принятое демо, пока идёт мёрдж: дальше он простаивает.
    let seen: readonly string[] = [];
    const steps: StepId[] = ["git.merge", "git.pull-main", "bb.archive"];
    const { log, closeReview } = setup([review, flowStage("finale", steps)], { active: () => !seen.includes("git.merge") });
    seen = log;
    await closeReview();
    await vi.waitFor(() => expect(log).toEqual(["git.merge", `release:${THREAD}`, "git.pull-main", `release:${THREAD}`, "bb.archive"]));
  });

  it("тред не прочитался — агента не трогаем, шаги идут", async () => {
    const { log, closeReview } = setup([review, finale], {
      active: () => {
        throw new Error("thread unreadable");
      },
    });
    await closeReview();
    await vi.waitFor(() => expect(log).toEqual(["git.merge", "bb.archive"]));
  });

  it("повтор шага, стоящего за архивацией, агента не освобождает", async () => {
    let fixed = false;
    const { runner, log, closeReview } = setup([review, flowStage("finale", ["git.merge", "bb.archive", "git.pull-main"])], {
      active: false,
      failing: { step: "git.pull-main", until: () => fixed },
    });
    await closeReview();
    await vi.waitFor(() => expect(log).toEqual([`release:${THREAD}`, "git.merge", `release:${THREAD}`, "bb.archive", "git.pull-main"]));
    fixed = true;
    expect(await runner.retry(THREAD, "finale")).toEqual({ started: true });
    await vi.waitFor(() => expect(log.slice(5)).toEqual(["git.pull-main"]));
  });
});
