// Исполнитель этапов-автоматизаций: как только первый незакрытый этап прогона —
// автоматизация, Flow выполняет её шаги и скрипты сам, без агента, и идёт дальше по
// подряд стоящим автоматизациям. Упавший шаг останавливает цепочку и ставит
// тред в ожидание владельца; повтор — RPC `retryAutomation`. Решения — в
// core/automation-run.ts, здесь только исполнение и запись прогресса.
import type { BbPluginApi, PluginKvStorage } from "@get-bb/plugin-sdk";

import { isStepId } from "../packages/automation-steps/catalog";
import { SELF_UPDATE_PENDING_PREFIX, type PluginsPort, type StepOutcome, type Steps } from "../packages/automation-steps/index";
import { scriptIdOf, scriptOf } from "../core/automation-scripts";
import { onRunRetry, pendingAutomation, onRunStart, onStepDone, onStepFailed, executorProvider, stageLiveIcon, stepsOf, type RunStep } from "../core/automation-run";
import { automationRpcContract, type AutomationScript, type FlowProgress, type RunningIcon, type RunningThread, type StageSettings, type WorkStage } from "../shared/contract";
import type { AutomationsBridge } from "./automations";
import type { ProgressStore, ThreadState } from "./progress";
import type { DecisionStore } from "./store";

/** Провайдер из списка хоста; `logoUrl` — `null`, когда логотипа нет. */
export type HostProvider = { id: string; displayName: string; logoUrl: string | null };

export type ExternalStep = (automationId: string, threadId: string) => Promise<StepOutcome>;

export interface AutomationRunnerDeps {
  progress: ProgressStore;
  store: Pick<DecisionStore, "putAwaiting" | "clearAwaiting">;
  stages: (threadId: string) => StageSettings;
  steps: Steps;
  external: ExternalStep;
  /** Запуск скрипта этапа в треде; нет — шаги-скрипты падают с причиной. */
  script?: (threadId: string, script: AutomationScript) => Promise<StepOutcome>;
  /** Ход агента и провайдер треда; не прочиталось — хода нет. */
  thread: (threadId: string) => Promise<Pick<ThreadState, "active" | "providerId">>;
  /** Провайдеры хоста с логотипами. */
  providers: () => Promise<readonly HostProvider[]>;
  /** kv прогона: шаг `bb.reinstall` кладёт сюда отложенное самообновление, цепочка его снимает. */
  kv: PluginKvStorage;
  /** Плагины хоста: ими применяется отложенное самообновление, когда цепочка доиграна. */
  plugins: PluginsPort;
  now: () => string;
  /** Сбой фоновой работы — запись прогресса, ожидания; шаги сами не бросают. */
  onError: (error: unknown) => void;
}

export interface AutomationRunner {
  /** Запускает автоматизации, до которых дошёл прогон треда; идущий прогон треда не трогает. */
  advance(threadId: string): Promise<void>;
  /** Продолжает только прерванный прогон треда — при загрузке плагина; новых автоматизаций не начинает. */
  resume(threadId: string): Promise<void>;
  /** Снимает ошибку упавшего шага и в фоне продолжает с него цепочку; `false` — этап не падал или прогон уже идёт. */
  retry(threadId: string, stageId: string): Promise<boolean>;
  /** Закрывает упавший шаг без исполнения — эффект уже есть или не нужен — и в фоне продолжает цепочку. */
  skip(threadId: string, stageId: string): Promise<boolean>;
  /** Треды, где сейчас идёт работа — ход агента на этапе или прогон автоматизации, — и значок этапа; ждущие владельца не входят. */
  running(): Promise<RunningThread[]>;
}

const SKIPPED: Record<"disabled" | "conditions" | "missing", string> = {
  disabled: "is switched off in Automations",
  conditions: "did not run: its conditions do not hold on this thread",
  missing: "no longer exists in Automations",
};

/** Запуск автоматизации Automations одним шагом: всё, кроме выполненной без ошибки, — провал с причиной. */
export const externalStep =
  (run: AutomationsBridge["run"]): ExternalStep =>
  async (automationId, threadId) => {
    const result = await run(automationId, threadId);
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === "not-installed"
            ? "The Automations plugin is not installed or is switched off."
            : result.reason === "timeout"
              ? "Automations gave no answer in time; the automation may still be running."
              : `Automations did not answer (${result.reason}${result.status === undefined ? "" : ` ${result.status}`}).`,
      };
    }
    const { executed, skipped, error } = result.value;
    if (skipped !== null) return { ok: false, error: `The automation ${SKIPPED[skipped]}.` };
    if (error !== null) return { ok: false, error: `${error}${executed.length === 0 ? "" : ` (ran before the failure: ${executed.join(", ")})`}` };
    return { ok: true, detail: executed.length === 0 ? null : executed.join(", ") };
  };

const awaitingId = (stageId: string) => `automation:${stageId}`;

export const createAutomationRunner = (deps: AutomationRunnerDeps): AutomationRunner => {
  // Один прогон на тред: отметка, ответ и запись самого исполнителя зовут advance, пока шаги ещё идут.
  const active = new Set<string>();

  const execute = (stage: WorkStage, step: RunStep, threadId: string): Promise<StepOutcome> => {
    const automation = stage.automation;
    if (automation !== undefined && !("source" in automation)) return deps.external(automation.id, threadId);
    if (automation !== undefined && scriptIdOf(step.id) !== null) {
      // Скрипт берётся из этапа сейчас: прерванный прогон хранит только id и подпись шага.
      const script = scriptOf(automation, step.id);
      if (script === null) return Promise.resolve({ ok: false, error: "The script of this step is no longer in the stage." });
      return deps.script === undefined ? Promise.resolve({ ok: false, error: "Scripts cannot run here." }) : deps.script(threadId, script);
    }
    return isStepId(step.id) ? deps.steps[step.id](threadId) : Promise.resolve({ ok: false, error: `Unknown step ${step.id}.` });
  };

  /** Шаги этапа с места `from`; `false` — шаг упал, цепочка стоит. */
  const runSteps = async (threadId: string, stage: WorkStage, steps: readonly RunStep[], from: number): Promise<boolean> => {
    for (const step of steps.slice(from)) {
      const outcome = await execute(stage, step, threadId);
      if (!outcome.ok) {
        await deps.progress.update(threadId, (p) => onStepFailed(p, stage.id, outcome.error));
        await deps.store.putAwaiting(threadId, { briefId: awaitingId(stage.id), kind: "automation" });
        return false;
      }
      await deps.progress.update(threadId, (p) => onStepDone(p, stage.id, deps.now()));
    }
    return true;
  };

  /** Цепочка: следующая автоматизация за следующей, пока они стоят подряд и ни одна не упала; `resumeOnly` — только прерванная. */
  const chain = async (threadId: string, resumeOnly = false): Promise<void> => {
    for (;;) {
      const record = await deps.progress.get(threadId);
      const pending = record === null ? null : pendingAutomation(deps.stages(threadId).stages, record);
      if (pending === null || (resumeOnly && pending.from === null)) return;
      const { stage, from } = pending;
      // Прерванный прогон идёт по своему снимку шагов, новый — по шагам этапа сейчас.
      const steps = from === null ? stepsOf(stage) : (record?.stages[stage.id]?.run?.steps ?? []);
      if (from === null) await deps.progress.update(threadId, (p) => onRunStart(p, stage.id, steps, deps.now()));
      if (!(await runSteps(threadId, stage, steps, from ?? 0))) return;
    }
  };

  // Пробуждение, пришедшее в занятый тред, не теряется: после текущей работы цепочка проверяется ещё раз.
  const woken = new Set<string>();

  /** Работа над тредом, пока другой не идёт; место занимается сразу, до первого await. */
  const claim = (threadId: string): boolean => {
    if (active.has(threadId)) return false;
    active.add(threadId);
    return true;
  };
  /**
   * Обновление плагина, ведущего прогон, гасит его API-хэндл: bb выгружает
   * плагин целиком, а не отдельный тред. Поэтому шаг `bb.reinstall` себя не
   * обновляет, а оставляет id в kv, и обновление применяется здесь — когда в
   * процессе не осталось ни одной идущей цепочки: иначе выгрузка оборвала бы
   * чужой прогон посреди шага, и его строка не получила бы ни ошибки, ни
   * причины.
   *
   * Порядок важен: сначала проверка, что работы больше нет, потом снятие
   * ключей, и только потом вызов. Снять ключ раньше проверки — значит
   * потерять отложенное обновление, когда сосед ещё занят; вызвать раньше
   * снятия — значит обновиться второй раз после того, как плагин поднимется
   * заново.
   *
   * Снимаются ключи всех тредов, а не только своего: тред, чей `release`
   * ушёл раньше соседа, отложил обновление и больше сюда не вернётся, —
   * доигрывает его тот, кто закончил последним. Один и тот же плагин
   * обновляется один раз, сколько бы тредов его ни отложили.
   */
  const settleSelfUpdate = async (): Promise<void> => {
    if (active.size > 0) return;
    const keys = (await deps.kv.list(SELF_UPDATE_PENDING_PREFIX)).filter((key) => key.startsWith(SELF_UPDATE_PENDING_PREFIX));
    const pluginIds = new Set<string>();
    for (const key of keys) {
      const pluginId = await deps.kv.get<string>(key);
      await deps.kv.delete(key);
      if (typeof pluginId === "string" && pluginId.length > 0) pluginIds.add(pluginId);
    }
    for (const pluginId of pluginIds) await deps.plugins.applyUpdate({ pluginId });
  };

  const release = async (threadId: string, work: Promise<void>): Promise<void> => {
    await work.catch(deps.onError);
    while (woken.delete(threadId)) await chain(threadId).catch(deps.onError);
    active.delete(threadId);
    await settleSelfUpdate().catch(deps.onError);
  };

  /** Упавший шаг этапа, если он есть; нет — ожидание этого этапа снимается, чтобы не висело. */
  const failedRun = async (threadId: string, stageId: string) => {
    const record = await deps.progress.get(threadId).catch(() => null);
    const run = record?.stages[stageId]?.run;
    const stage = deps.stages(threadId).stages.find((s) => s.id === stageId);
    if (run !== undefined && typeof run.error === "string" && stage !== undefined) return { run, stage };
    await deps.store.clearAwaiting(threadId, awaitingId(stageId)).catch(deps.onError);
    return null;
  };

  /** Выход из упавшего шага: правка записи, снятие ожидания и цепочка с шага `from` в фоне. */
  const unblock = async (threadId: string, stageId: string, change: (p: FlowProgress) => FlowProgress, from: (at: number) => number): Promise<boolean> => {
    if (!claim(threadId)) return false;
    const failed = await failedRun(threadId, stageId);
    if (failed === null) {
      active.delete(threadId);
      return false;
    }
    const work = async () => {
      await deps.progress.update(threadId, change);
      await deps.store.clearAwaiting(threadId, awaitingId(stageId));
      if (await runSteps(threadId, failed.stage, failed.run.steps, from(failed.run.at))) await chain(threadId);
    };
    void release(threadId, work());
    return true;
  };

  return {
    advance: async (threadId) => {
      if (claim(threadId)) await release(threadId, chain(threadId));
      else woken.add(threadId);
    },
    resume: async (threadId) => {
      if (claim(threadId)) await release(threadId, chain(threadId, true));
    },
    retry: (threadId, stageId) => unblock(threadId, stageId, (p) => onRunRetry(p, stageId), (at) => at),
    skip: (threadId, stageId) => unblock(threadId, stageId, (p) => onStepDone(p, stageId, deps.now()), (at) => at + 1),
    running: async () => {
      // Список провайдеров один на опрос и только когда он нужен.
      let brands: Promise<readonly HostProvider[]> | undefined;
      const brandOf = async (providerId: string | null): Promise<RunningThread["provider"]> => {
        if (providerId === null) return undefined;
        brands ??= deps.providers().catch(() => []);
        const found = (await brands).find((p) => p.id === providerId);
        return found?.logoUrl == null ? undefined : { name: found.displayName, logoUrl: found.logoUrl };
      };
      const threads = await deps.progress.threads();
      const entries = await Promise.all(
        threads.map(async (threadId): Promise<RunningThread | null> => {
          const record = await deps.progress.get(threadId);
          if (record === null) return null;
          const stages = deps.stages(threadId).stages;
          const firstLive = (agentActive: boolean) =>
            stages.map((stage) => ({ stage, icon: stageLiveIcon(record, stage, agentActive) })).find((live): live is { stage: WorkStage; icon: RunningIcon } => live.icon !== null);
          // Опрос идёт по всем тредам с прогрессом: тред читается, только когда первый живой при ходе агента этап — этап навыка.
          const withAgent = firstLive(true);
          if (withAgent === undefined || withAgent.icon === "automation") return withAgent === undefined ? null : { threadId, icon: withAgent.icon };
          const thread = await deps.thread(threadId).catch(() => ({ active: false, providerId: null }));
          const live = thread.active ? withAgent : firstLive(false);
          if (live === undefined) return null;
          const { stage, icon } = live;
          const provider = await brandOf(executorProvider(stage, record.stages[stage.id] ?? {}, thread.providerId));
          return { threadId, icon, ...(provider === undefined ? {} : { provider }) };
        }),
      );
      return entries.filter((entry): entry is RunningThread => entry !== null);
    },
  };
};

export const registerAutomationRunner = (bb: Pick<BbPluginApi, "rpc">, runner: AutomationRunner): void => {
  bb.rpc.register(automationRpcContract, {
    // Повтор отвечает сразу, шаги идут в фоне: мёрдж ждёт GitHub минутами.
    retryAutomation: async ({ threadId, stage }) => ({ started: await runner.retry(threadId, stage) }),
    skipAutomationStep: async ({ threadId, stage }) => ({ started: await runner.skip(threadId, stage) }),
    runningThreads: () => runner.running(),
  });
};
