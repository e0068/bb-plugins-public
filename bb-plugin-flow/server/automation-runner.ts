// Исполнитель этапов-автоматизаций: как только первый незакрытый этап прогона —
// автоматизация, Flow выполняет её шаги и скрипты сам, без агента, и идёт дальше по
// подряд стоящим автоматизациям. Упавший шаг останавливает цепочку и ставит
// тред в ожидание владельца; повтор — RPC `retryAutomation`. Решения — в
// core/automation-run.ts, здесь только исполнение и запись прогресса.
import type { BbPluginApi, PluginKvStorage } from "@get-bb/plugin-sdk";

import { isStepId } from "../packages/automation-steps/catalog";
import { SELF_UPDATE_PENDING_PREFIX, type PluginsPort, type StepOutcome, type Steps } from "../packages/automation-steps/index";
import { scriptIdOf, scriptOf } from "../core/automation-scripts";
import { waitsForAnswer } from "../core/awaiting";
import {
  executorProvider,
  idleStages,
  isActionStage,
  isAgentStage,
  onIdleClose,
  onIdleOpen,
  onRunRetry,
  onRunStart,
  onStepDone,
  onStepFailed,
  onStepStarted,
  pendingAction,
  pendingAutomation,
  stageLiveIcon,
  stepsOf,
  wakeText,
  type RunStep,
} from "../core/automation-run";
import { automationRpcContract, type AutomationScript, type FlowProgress, type RunningIcon, type RunningThread, type StageSettings, type WorkStage } from "../shared/contract";
import type { AutomationsBridge } from "./automations";
import type { ProgressStore, ThreadState } from "./progress";
import type { DecisionStore } from "./store";

/** Провайдер из списка хоста; `logoUrl` — `null`, когда логотипа нет. */
export type HostProvider = { id: string; displayName: string; logoUrl: string | null };

export type ExternalStep = (automationId: string, threadId: string) => Promise<StepOutcome>;

export interface AutomationRunnerDeps {
  progress: ProgressStore;
  store: Pick<DecisionStore, "putAwaiting" | "clearAwaiting" | "listAwaiting">;
  stages: (threadId: string) => StageSettings;
  steps: Steps;
  external: ExternalStep;
  /** Запуск скрипта этапа в треде; нет — шаги-скрипты падают с причиной. */
  script?: (threadId: string, script: AutomationScript) => Promise<StepOutcome>;
  /** Ход агента и провайдер треда; не прочиталось — хода нет. */
  thread: (threadId: string) => Promise<Pick<ThreadState, "active" | "providerId">>;
  /** Провайдеры хоста с логотипами. */
  providers: () => Promise<readonly HostProvider[]>;
  /** Реплика агенту готовым текстом: доигранный прогон Flow пускает работу дальше. Нет — тред просто стоит на следующем этапе. */
  wake?: (threadId: string, text: string) => Promise<void>;
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
  /** Нажатие владельца на шаг этапа Action: `false` — этап не ждёт нажатия или шаг уже идёт. */
  runActionStep(threadId: string, stageId: string): Promise<boolean>;
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

/** Ожидание владельца на этапе Action — своё: его снимает нажатие, а не повтор упавшей автоматизации. */
const actionAwaitingId = (stageId: string) => `action:${stageId}`;

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
        // Упавший шаг ждёт владельца: с этой минуты этап простаивает, а не работает.
        await deps.progress.update(threadId, (p) => onIdleOpen(onStepFailed(p, stage.id, outcome.error, deps.now()), stage.id, deps.now()));
        await deps.store.putAwaiting(threadId, { briefId: awaitingId(stage.id), kind: "automation" });
        return false;
      }
      await deps.progress.update(threadId, (p) => onStepDone(p, stage.id, deps.now(), outcome.detail));
    }
    return true;
  };

  /**
   * Этап Action, до которого дошёл прогон: шаги записываются снимком, тред встаёт в ожидание владельца.
   * Уже начатый этап не трогается — снимок и ожидание у него есть.
   */
  const awaitAction = async (threadId: string): Promise<boolean> => {
    const record = await deps.progress.get(threadId);
    const pending = record === null ? null : pendingAction(deps.stages(threadId).stages, record);
    if (pending === null) return false;
    if (record?.stages[pending.stage.id]?.run === undefined) {
      const steps = stepsOf(pending.stage);
      await deps.progress.update(threadId, (p) => onRunStart(p, pending.stage.id, steps, deps.now()));
      // Этап без шагов закрывается сразу — как пустая автоматизация; ждать владельца тогда нечего.
      if (steps.length === 0) return await chain(threadId);
    }
    // Ожидание нажатия — простой этапа: работой оно не считается ни в минутах, ни в отчёте. Запись — мимо `update`: она не двигает работу.
    await deps.progress.annotate(threadId, (p) => onIdleOpen(p, pending.stage.id, deps.now()));
    await deps.store.putAwaiting(threadId, { briefId: actionAwaitingId(pending.stage.id), kind: "action" });
    return false;
  };

  /**
   * Цепочка: следующая автоматизация за следующей, пока они стоят подряд и ни одна не упала; `resumeOnly` — только прерванная.
   * Ответ — доиграна ли хоть одна автоматизация: по нему Flow решает, будить ли агента.
   */
  const chain = async (threadId: string, resumeOnly = false): Promise<boolean> => {
    let ran = false;
    for (;;) {
      const record = await deps.progress.get(threadId);
      const pending = record === null ? null : pendingAutomation(deps.stages(threadId).stages, record);
      if (pending === null || (resumeOnly && pending.from === null)) return (await awaitAction(threadId)) || ran;
      const { stage, from } = pending;
      // Прерванный прогон идёт по своему снимку шагов, новый — по шагам этапа сейчас.
      const steps = from === null ? stepsOf(stage) : (record?.stages[stage.id]?.run?.steps ?? []);
      if (from === null) await deps.progress.update(threadId, (p) => onRunStart(p, stage.id, steps, deps.now()));
      if (!(await runSteps(threadId, stage, steps, from ?? 0))) return ran;
      ran = true;
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

  // Работа Flow над тредом, которую можно дождаться: нажатие на шаг Action не отказывает, пока цепочка доводит своё.
  const settling = new Map<string, Promise<void>>();

  const release = (threadId: string, work: Promise<void>): Promise<void> => {
    const done = (async () => {
      await work.catch(deps.onError);
      while (woken.delete(threadId)) await drive(threadId).catch(deps.onError);
      active.delete(threadId);
      await settleSelfUpdate().catch(deps.onError);
    })();
    const settled = done.catch(() => undefined);
    settling.set(threadId, settled);
    void settled.then(() => {
      if (settling.get(threadId) === settled) settling.delete(threadId);
    });
    return done;
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
      if (!(await runSteps(threadId, failed.stage, failed.run.steps, from(failed.run.at)))) return;
      await chain(threadId);
      await wakeIfAgentNext(threadId, isActionStage(failed.stage) ? "action" : "automation");
    };
    void release(threadId, work());
    return true;
  };

  /** Ждёт ли тред ответа владельца на бриф: тогда работа продолжится с ответа, и будить агента нечем. */
  const holdsOwner = async (threadId: string): Promise<boolean> =>
    (await deps.store.listAwaiting()).some((entry) => entry.threadId === threadId && waitsForAnswer(entry.kind));

  /** Этап за доигранным прогоном ведёт агент — его надо разбудить; автоматизацию и этап Action Flow тянет сам. Реплика несёт простой по этапам. */
  const wakeIfAgentNext = async (threadId: string, kind: "automation" | "action"): Promise<void> => {
    const record = await deps.progress.get(threadId);
    if (record === null) return;
    const stages = deps.stages(threadId).stages;
    const next = stages.find((stage) => record.stages[stage.id]?.finishedAt === undefined && record.stages[stage.id]?.skipped !== true);
    if (next === undefined || !isAgentStage(next)) return;
    // Бриф этого этапа уже у владельца — Демонстрация ждёт кнопки: реплика
    // разбудила бы агента там, где его работа сделана и решает владелец.
    if (await holdsOwner(threadId)) return;
    await deps.wake?.(threadId, wakeText(kind, idleStages(record, stages)));
  };

  /** Цепочка и реплика за ней: агент будится, только когда Flow действительно доиграл автоматизацию. */
  const drive = async (threadId: string, resumeOnly = false): Promise<void> => {
    if (await chain(threadId, resumeOnly)) await wakeIfAgentNext(threadId, "automation");
  };

  return {
    advance: async (threadId) => {
      if (claim(threadId)) await release(threadId, drive(threadId));
      else woken.add(threadId);
    },
    resume: async (threadId) => {
      if (claim(threadId)) await release(threadId, drive(threadId, true));
    },
    // Повтор снимает ошибку и закрывает простой: этап снова пошёл.
    retry: (threadId, stageId) => unblock(threadId, stageId, (p) => onRunRetry(onIdleClose(p, stageId, deps.now()), stageId), (at) => at),
    runActionStep: async (threadId, stageId) => {
      // Идущий шаг не перезапускается: второе нажатие отказывает сразу, не дожидаясь первого.
      if ((await deps.progress.get(threadId).catch(() => null))?.stages[stageId]?.run?.busy === true) return false;
      // Нажатие пришло, пока Flow доводит цепочку до этапа Action: ждём её, а не отказываем владельцу.
      await settling.get(threadId);
      if (!claim(threadId)) return false;
      const record = await deps.progress.get(threadId).catch(() => null);
      const pending = record === null ? null : pendingAction(deps.stages(threadId).stages, record);
      // Нажатие принимается только на ждущем шаге ждущего этапа.
      if (pending === null || pending.stage.id !== stageId || record?.stages[stageId]?.run?.busy === true) {
        active.delete(threadId);
        return false;
      }
      const { stage, at } = pending;
      const step = (record?.stages[stageId]?.run?.steps ?? stepsOf(stage))[at];
      if (step === undefined) {
        active.delete(threadId);
        return false;
      }
      const work = async () => {
        // Нажатие закрывает простой ожидания: с этой минуты этап работает.
        await deps.progress.update(threadId, (p) => onStepStarted(onIdleClose(p, stageId, deps.now()), stageId));
        const outcome = await execute(stage, step, threadId);
        if (!outcome.ok) return void (await deps.progress.update(threadId, (p) => onIdleOpen(onStepFailed(p, stageId, outcome.error, deps.now()), stageId, deps.now())));
        await deps.progress.update(threadId, (p) => onStepDone(p, stageId, deps.now(), outcome.detail));
        const closed = (await deps.progress.get(threadId))?.stages[stageId]?.finishedAt !== undefined;
        // Этап не закрылся — он снова ждёт нажатия, и это снова простой.
        if (!closed) return void (await deps.progress.annotate(threadId, (p) => onIdleOpen(p, stageId, deps.now())));
        await deps.store.clearAwaiting(threadId, actionAwaitingId(stageId));
        await chain(threadId);
        await wakeIfAgentNext(threadId, "action");
      };
      void release(threadId, work());
      return true;
    },
    // Пропуск тоже снимает этап с простоя: владелец ответил, ждать больше нечего.
    skip: (threadId, stageId) => unblock(threadId, stageId, (p) => onStepDone(onIdleClose(p, stageId, deps.now()), stageId, deps.now()), (at) => at + 1),
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
    // Шаг Action идёт в фоне: ответ приходит сразу, а кнопка держит лоадер до записи прогресса.
    runActionStep: async ({ threadId, stage }) => ({ started: await runner.runActionStep(threadId, stage) }),
    runningThreads: () => runner.running(),
  });
};
