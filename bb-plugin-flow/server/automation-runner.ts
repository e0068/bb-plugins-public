// Исполнитель этапов-автоматизаций: как только автоматизация наступила — закрыт
// ближайший этап прогона перед ней, — Flow выполняет её шаги и скрипты сам, без
// агента, и идёт дальше по следующим наступившим. Упавший шаг останавливает цепочку и ставит
// тред в ожидание владельца; повтор — RPC `retryAutomation` или сам Flow по
// настройке автоповтора, через таймер. Решения — в
// core/automation-run.ts, здесь только исполнение и запись прогресса.
import type { BbPluginApi, PluginKvStorage } from "@get-bb/plugin-sdk";

import { isStepId } from "@bb-plugins/automation-steps/catalog";
import { SELF_UPDATE_PENDING_PREFIX, type PluginsPort, type StepOutcome, type Steps } from "@bb-plugins/automation-steps/index";
import { scriptIdOf, scriptOf } from "../core/automation-scripts";
import { waitsForAnswer } from "../core/awaiting";
import {
  DEFAULT_RETRY,
  executorProvider,
  idleStages,
  isActionStage,
  isAgentStage,
  onIdleClose,
  onIdleOpen,
  onRetryDropped,
  onRunRetry,
  onRunStart,
  onSkipQueued,
  onStepDone,
  onStepFailed,
  onStepStarted,
  openAfter,
  actionAt,
  dueActions,
  interruptedAutomation,
  pendingAutomation,
  queuedSkips,
  skipQueueable,
  retryDelay,
  retryDueIn,
  stageLiveIcon,
  stepsOf,
  undoStepsOf,
  wakeText,
  type RetryPolicy,
  type RunStep,
} from "../core/automation-run";
import { automationRpcContract, type AutomationScript, type FlowProgress, type RunningIcon, type RunningThread, type StageSettings, type StepAnswer, type WorkStage } from "../shared/contract";
import type { AutomationsBridge } from "./automations";
import type { ProgressStore, ThreadState } from "./progress";
import type { DecisionStore } from "./store";

/** Провайдер из списка хоста; `logoUrl` — `null`, когда логотипа нет. */
export type HostProvider = { id: string; displayName: string; logoUrl: string | null };

export type ExternalStep = (automationId: string, threadId: string) => Promise<StepOutcome>;

/** Итог этапа-автоматизации для уведомления владельца: этап доигран или его шаг упал. */
export type RunnerNotice =
  | { kind: "done"; threadId: string; stage: WorkStage }
  | { kind: "failed"; threadId: string; stage: WorkStage; stepId: string; error: string };

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
  /** Автоповтор упавшего шага — читается в момент падения и в момент повтора; нет — не повторять. */
  retry?: () => RetryPolicy;
  /** Таймер автоповтора; ответ снимает его. Нет — таймер процесса. */
  schedule?: (run: () => void, ms: number) => () => void;
  /** Итог этапа-автоматизации — владельцу тостом; этапы Action не сообщают: их шаги жмёт сам владелец. Нет — молчать. */
  notify?: (notice: RunnerNotice) => void | Promise<void>;
  /** Сбой фоновой работы — запись прогресса, ожидания, уведомления; шаги сами не бросают. */
  onError: (error: unknown) => void;
}

export interface AutomationRunner {
  /** Запускает автоматизации, до которых дошёл прогон треда; идущий прогон треда не трогает. */
  advance(threadId: string): Promise<void>;
  /** Продолжает только прерванный прогон треда — при загрузке плагина; новых автоматизаций не начинает. */
  resume(threadId: string): Promise<void>;
  /** Снимает ошибку упавшего шага и в фоне продолжает с него цепочку; отказ — этап не падал, `busy` — прогон треда уже идёт. Назначенный автоповтор снимается. */
  retry(threadId: string, stageId: string): Promise<StepAnswer>;
  /**
   * Закрывает упавший шаг без исполнения — эффект уже есть или не нужен — и в фоне продолжает цепочку.
   * Тред занят, а шаг упал или идёт попытка его автоповтора, — пропуск запоминается и применяется, когда попытка упадёт.
   */
  skip(threadId: string, stageId: string): Promise<StepAnswer>;
  /** Нажатие владельца на шаг этапа Action: `false` — этап не ждёт нажатия или шаг уже идёт. */
  runActionStep(threadId: string, stageId: string): Promise<boolean>;
  /** Треды, где сейчас идёт работа — ход агента на этапе или прогон автоматизации, — и значок этапа; ждущие владельца не входят. */
  running(): Promise<RunningThread[]>;
  /**
   * Исполняет шаги отката этапов по порядку — доработка сняла с них готовность — и отвечает итогом строкой на шаг.
   * Упавший шаг не останавливает остальные и в прогресс не пишется: у этапа нет готовности, которую он мог бы испортить.
   */
  undo(threadId: string, stages: readonly WorkStage[]): Promise<string[]>;
  /** Владелец отменил flow треда: назначенные автоповторы гаснут, а идущий шаг, закончившись, ничего не пишет и цепочку не продолжает. */
  cancel(threadId: string): void;
  /** Снимает таймеры автоповтора процесса — при выгрузке плагина; сроки в записях прогонов остаются, `resume` ставит их заново. */
  dispose(): void;
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

const processTimer = (run: () => void, ms: number): (() => void) => {
  const handle = setTimeout(run, ms);
  // Ждущий повтор процесс не держит: остановку сервера он не задерживает.
  handle.unref?.();
  return () => clearTimeout(handle);
};

/** Повтор, пришедший в занятый тред, ждёт столько и пробует снова. */
const BUSY_RETRY_MS = 1000;

export const createAutomationRunner = (deps: AutomationRunnerDeps): AutomationRunner => {
  // Один прогон на тред: отметка, ответ и запись самого исполнителя зовут advance, пока шаги ещё идут.
  const active = new Set<string>();
  const policy = (): RetryPolicy => deps.retry?.() ?? DEFAULT_RETRY;
  const schedule = deps.schedule ?? processTimer;

  // Назначенные автоповторы по треду и этапу: повтор и пропуск владельца снимают свой.
  const timers = new Map<string, () => void>();
  const timerKey = (threadId: string, stageId: string) => `${threadId}\u0000${stageId}`;
  const disarm = (threadId: string, stageId: string) => {
    timers.get(timerKey(threadId, stageId))?.();
    timers.delete(timerKey(threadId, stageId));
  };
  // Отмены flow по треду: шаги, начатые до отмены, видят другой счёт и молча выходят — иначе их запись завела бы прогон заново.
  const cancels = new Map<string, number>();
  const epochOf = (threadId: string) => cancels.get(threadId) ?? 0;
  // Выгруженный исполнитель новых таймеров не ставит: шаг, упавший уже после выгрузки, повторит следующая загрузка по сроку в записи.
  let disposed = false;
  const arm = (threadId: string, stageId: string, ms: number) => {
    if (disposed) return;
    disarm(threadId, stageId);
    const key = timerKey(threadId, stageId);
    timers.set(
      key,
      schedule(() => {
        timers.delete(key);
        void autoRetry(threadId, stageId).catch(deps.onError);
      }, ms),
    );
  };

  /** Уведомление не держит цепочку: его сбой — в `onError`, шаги идут дальше. */
  const notify = (notice: RunnerNotice): void => {
    if (isActionStage(notice.stage) || deps.notify === undefined) return;
    try {
      void Promise.resolve(deps.notify(notice)).catch(deps.onError);
    } catch (error) {
      deps.onError(error);
    }
  };

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
    const epoch = epochOf(threadId);
    const stale = () => epochOf(threadId) !== epoch;
    for (const step of steps.slice(from)) {
      const outcome = await execute(stage, step, threadId);
      if (stale()) return false;
      if (!outcome.ok) {
        const track = (await deps.progress.get(threadId))?.stages[stage.id];
        if (stale()) return false;
        // Пропуск, запомненный во время этой попытки, закроет шаг сразу за ней: ни ожидания владельца, ни тоста «шаг упал».
        if (track?.run?.skipQueued === true) {
          await deps.progress.update(threadId, (p) => onStepFailed(p, stage.id, outcome.error, deps.now()));
          return false;
        }
        // Шаг Action повторяет только владелец: его шаги идут по нажатию.
        const delay = isActionStage(stage) ? null : retryDelay(policy(), track);
        const retryAt = delay === null ? undefined : new Date(Date.parse(deps.now()) + delay).toISOString();
        // Упавший шаг ждёт владельца: с этой минуты этап простаивает, а не работает. Автоповтор кнопки не отнимает.
        await deps.progress.update(threadId, (p) => onIdleOpen(onStepFailed(p, stage.id, outcome.error, deps.now(), retryAt), stage.id, deps.now()));
        // Отмена, пришедшая во время записи, снимет и её: ожидания и автоповтора после неё не ставим.
        if (stale()) return false;
        await deps.store.putAwaiting(threadId, { briefId: awaitingId(stage.id), kind: "automation" });
        // Пока впереди автоповтор, падение видно только в баннере: тост — когда шаг ждёт владельца.
        if (delay === null) notify({ kind: "failed", threadId, stage, stepId: step.id, error: outcome.error });
        else if (!stale()) arm(threadId, stage.id, delay);
        return false;
      }
      await deps.progress.update(threadId, (p) => onStepDone(p, stage.id, deps.now(), outcome.detail, outcome.links));
      if (stale()) return false;
    }
    notify({ kind: "done", threadId, stage });
    return true;
  };

  /**
   * Этапы Action, до которых дошёл прогон: не начатый получает снимок шагов, и тред встаёт в ожидание владельца на каждом.
   * Начатый не трогается — снимок у него есть. Ответ — последняя доигранная автоматизация за Action без шагов, который закрывается сразу.
   */
  const awaitAction = async (threadId: string): Promise<WorkStage | null> => {
    const record = await deps.progress.get(threadId);
    const pending = record === null ? [] : dueActions(deps.stages(threadId).stages, record);
    for (const { stage } of pending) {
      if (record?.stages[stage.id]?.run === undefined) {
        const steps = stepsOf(stage);
        await deps.progress.update(threadId, (p) => onRunStart(p, stage.id, steps, deps.now()));
        // Этап без шагов закрывается сразу — как пустая автоматизация; ждать владельца тогда нечего.
        if (steps.length === 0) return await chain(threadId);
      }
      // Ожидание нажатия — простой этапа: работой оно не считается ни в минутах, ни в отчёте. Запись — мимо `update`: она не двигает работу.
      await deps.progress.annotate(threadId, (p) => onIdleOpen(p, stage.id, deps.now()));
      await deps.store.putAwaiting(threadId, { briefId: actionAwaitingId(stage.id), kind: "action" });
    }
    return null;
  };

  /**
   * Цепочка: следующая наступившая автоматизация за следующей, пока ни одна не упала; `resumeOnly` — только прерванная.
   * Ответ — последний доигранный этап или `null`: по нему Flow решает, будить ли агента, и смотрит на этап за ним.
   */
  const chain = async (threadId: string, resumeOnly = false, ran: WorkStage | null = null): Promise<WorkStage | null> => {
    const record = await deps.progress.get(threadId);
    const pending = record === null ? null : (resumeOnly ? interruptedAutomation : pendingAutomation)(deps.stages(threadId).stages, record);
    if (pending === null) return (await awaitAction(threadId)) ?? ran;
    const { stage, from } = pending;
    // Прерванный прогон идёт по своему снимку шагов, новый — по шагам этапа сейчас.
    const steps = from === null ? stepsOf(stage) : (record?.stages[stage.id]?.run?.steps ?? []);
    if (from === null) await deps.progress.update(threadId, (p) => onRunStart(p, stage.id, steps, deps.now()));
    return (await runSteps(threadId, stage, steps, from ?? 0)) ? chain(threadId, resumeOnly, stage) : ran;
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
      // Пропуски, запомненные во время упавшей попытки, применяются, пока тред ещё за этой работой: свободный тред перехватило бы чужое пробуждение.
      // Тред отпускается только синхронно с последней проверкой `woken`: пробуждение, пришедшее во время чтения, ещё раз проходит цепочку.
      for (;;) {
        while (woken.delete(threadId)) await drive(threadId).catch(deps.onError);
        if (await applyQueuedSkip(threadId).catch((error: unknown) => (deps.onError(error), false))) continue;
        if (!woken.has(threadId)) break;
      }
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
  type Exit = { change: (p: FlowProgress) => FlowProgress; from: (at: number) => number };

  /** Выход из упавшего шага в занятом этой работой треде: правка записи, снятие ожидания и цепочка с шага `from`; `null` — шаг не падал. */
  const exitWork = async (threadId: string, stageId: string, { change, from }: Exit): Promise<(() => Promise<void>) | null> => {
    disarm(threadId, stageId);
    const failed = await failedRun(threadId, stageId);
    if (failed === null) return null;
    return async () => {
      await deps.progress.update(threadId, change);
      await deps.store.clearAwaiting(threadId, awaitingId(stageId));
      if (!(await runSteps(threadId, failed.stage, failed.run.steps, from(failed.run.at)))) return;
      const last = (await chain(threadId)) ?? failed.stage;
      await wakeIfAgentNext(threadId, isActionStage(failed.stage) ? "action" : "automation", last);
    };
  };

  /** Выход из упавшего шага по нажатию или таймеру: тред берётся, работа идёт в фоне. */
  const unblock = async (threadId: string, stageId: string, exit: Exit): Promise<StepAnswer> => {
    if (!claim(threadId)) return { started: false, busy: true };
    const work = await exitWork(threadId, stageId, exit);
    if (work === null) {
      active.delete(threadId);
      return { started: false };
    }
    void release(threadId, work());
    return { started: true };
  };

  const skipExit = (stageId: string): Exit => ({ change: (p) => onStepDone(onIdleClose(p, stageId, deps.now()), stageId, deps.now()), from: (at) => at + 1 });

  // Запомненный пропуск применяется один раз на нажатие: пропуск, который не смог записаться, не крутится по кругу через `release`.
  const skipsTried = new Set<string>();

  /** Один запомненный пропуск упавшей попытки — внутри работы, которая держит тред; `false` — применять нечего. */
  const applyQueuedSkip = async (threadId: string): Promise<boolean> => {
    const record = await deps.progress.get(threadId);
    const stageId = (record === null ? [] : queuedSkips(record)).find((id) => !skipsTried.has(timerKey(threadId, id)));
    if (stageId === undefined) return false;
    skipsTried.add(timerKey(threadId, stageId));
    const work = await exitWork(threadId, stageId, skipExit(stageId));
    await work?.().catch(deps.onError);
    return true;
  };

  /** Пропуск в занятом треде: упавший шаг или попытка его автоповтора — пропуск запоминается до итога попытки, и назначенный повтор снимается. */
  const queueSkip = async (threadId: string, stageId: string): Promise<StepAnswer> => {
    const track = (await deps.progress.get(threadId))?.stages[stageId];
    if (track === undefined || !skipQueueable(track)) return { started: false };
    disarm(threadId, stageId);
    skipsTried.delete(timerKey(threadId, stageId));
    await deps.progress.annotate(threadId, (p) => onSkipQueued(p, stageId));
    // Тред занят — его работа ещё раз пройдёт цикл и прочтёт отметку; освободился, пока она писалась, — пропуск применяется сам.
    if (active.has(threadId)) woken.add(threadId);
    else await unblock(threadId, stageId, skipExit(stageId));
    return { started: true };
  };

  /** Автоповтор сняли, пока шаг ждал: шаг теперь ждёт владельца, и тост о падении, которого при падении не было, уходит сейчас. */
  const dropRetry = async (threadId: string, stageId: string): Promise<void> => {
    await deps.progress.annotate(threadId, (p) => onRetryDropped(p, stageId));
    const failed = await failedRun(threadId, stageId);
    const step = failed?.run.steps[failed.run.at];
    if (failed !== null && step !== undefined) notify({ kind: "failed", threadId, stage: failed.stage, stepId: step.id, error: failed.run.error ?? "" });
  };

  /**
   * Автоповтор по таймеру. Настройку выключили, пока шаг ждал, — повтор снимается, шаг ждёт владельца.
   * Тред занят — повтор ждёт секунду и пробует снова: упавший шаг никуда не делся.
   */
  const autoRetry = async (threadId: string, stageId: string): Promise<void> => {
    if (policy().seconds <= 0) return dropRetry(threadId, stageId);
    if (active.has(threadId)) return arm(threadId, stageId, BUSY_RETRY_MS);
    await unblock(threadId, stageId, { change: (p) => onRunRetry(onIdleClose(p, stageId, deps.now()), stageId, true), from: (at) => at });
  };

  /** Назначенные автоповторы треда заново — после загрузки плагина таймеров прежнего процесса нет; срок вышел — повтор сразу. */
  const rearm = async (threadId: string): Promise<void> => {
    const record = await deps.progress.get(threadId);
    for (const [stageId, track] of Object.entries(record?.stages ?? {})) {
      const due = retryDueIn(track, deps.now());
      if (due !== null) arm(threadId, stageId, due);
    }
  };

  /** Ждёт ли тред ответа владельца на бриф: тогда работа продолжится с ответа, и будить агента нечем. */
  const holdsOwner = async (threadId: string): Promise<boolean> =>
    (await deps.store.listAwaiting()).some((entry) => entry.threadId === threadId && waitsForAnswer(entry.kind));

  /**
   * Этап за последним доигранным этапом `last` ведёт агент — его надо разбудить; автоматизацию и этап Action Flow тянет сам.
   * Смотрится этап прогона за `last`, а не первый незакрытый во flow: нетронутые этапы в начале flow работой за автоматизацией не являются.
   * Реплика несёт простой по этапам.
   */
  const wakeIfAgentNext = async (threadId: string, kind: "automation" | "action", last: WorkStage): Promise<void> => {
    const record = await deps.progress.get(threadId);
    if (record === null) return;
    const stages = deps.stages(threadId).stages;
    const next = openAfter(stages, record, last.id);
    if (next === null || !isAgentStage(next)) return;
    // Бриф этого этапа уже у владельца — Демонстрация ждёт кнопки: реплика
    // разбудила бы агента там, где его работа сделана и решает владелец.
    if (await holdsOwner(threadId)) return;
    await deps.wake?.(threadId, wakeText(kind, idleStages(record, stages), next));
  };

  /** Цепочка и реплика за ней: агент будится, только когда Flow действительно доиграл автоматизацию. */
  const drive = async (threadId: string, resumeOnly = false): Promise<void> => {
    const last = await chain(threadId, resumeOnly);
    if (last !== null) await wakeIfAgentNext(threadId, "automation", last);
  };

  return {
    advance: async (threadId) => {
      if (claim(threadId)) await release(threadId, drive(threadId));
      else woken.add(threadId);
    },
    resume: async (threadId) => {
      await rearm(threadId).catch(deps.onError);
      if (claim(threadId)) await release(threadId, drive(threadId, true));
    },
    // Повтор снимает ошибку и закрывает простой: этап снова пошёл.
    retry: (threadId, stageId) => unblock(threadId, stageId, { change: (p) => onRunRetry(onIdleClose(p, stageId, deps.now()), stageId), from: (at) => at }),
    runActionStep: async (threadId, stageId) => {
      // Идущий шаг не перезапускается: второе нажатие отказывает сразу, не дожидаясь первого.
      if ((await deps.progress.get(threadId).catch(() => null))?.stages[stageId]?.run?.busy === true) return false;
      // Нажатие пришло, пока Flow доводит цепочку до этапа Action: ждём её, а не отказываем владельцу.
      await settling.get(threadId);
      if (!claim(threadId)) return false;
      const record = await deps.progress.get(threadId).catch(() => null);
      const stages = deps.stages(threadId).stages;
      const stage = stages.find((s) => s.id === stageId);
      const at = record === null ? null : actionAt(stages, record, stageId);
      // Нажатие принимается только на ждущем шаге ждущего этапа — любого из открытых Action, а не только первого.
      if (stage === undefined || at === null || record?.stages[stageId]?.run?.busy === true) {
        active.delete(threadId);
        return false;
      }
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
        await deps.progress.update(threadId, (p) => onStepDone(p, stageId, deps.now(), outcome.detail, outcome.links));
        const closed = (await deps.progress.get(threadId))?.stages[stageId]?.finishedAt !== undefined;
        // Этап не закрылся — он снова ждёт нажатия, и это снова простой.
        if (!closed) return void (await deps.progress.annotate(threadId, (p) => onIdleOpen(p, stageId, deps.now())));
        await deps.store.clearAwaiting(threadId, actionAwaitingId(stageId));
        const last = (await chain(threadId)) ?? stage;
        await wakeIfAgentNext(threadId, "action", last);
      };
      void release(threadId, work());
      return true;
    },
    undo: async (threadId, stages) => {
      // Откат идёт после того, что Flow уже доводит в треде, и держит тред: ни повтор, ни нажатие не начнут цепочку посреди него.
      await settling.get(threadId);
      if (!claim(threadId)) return ["Undo did not run: Flow is still running this thread's automations — tell the owner the plugin was not returned."];
      const lines: string[] = [];
      const work = async () => {
        for (const stage of stages) {
          for (const step of undoStepsOf(stage)) {
            const outcome = await execute(stage, step, threadId).catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
            lines.push(`Undo of ${stage.name}: ${step.label} — ${outcome.ok ? (outcome.detail ?? "done") : `failed: ${outcome.error}`}`);
          }
        }
      };
      await release(threadId, work());
      return lines;
    },
    // Пропуск тоже снимает этап с простоя: владелец ответил, ждать больше нечего.
    skip: (threadId, stageId) => (active.has(threadId) ? queueSkip(threadId, stageId) : unblock(threadId, stageId, skipExit(stageId))),
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
    cancel: (threadId) => {
      cancels.set(threadId, epochOf(threadId) + 1);
      for (const key of [...timers.keys()].filter((key) => key.startsWith(timerKey(threadId, "")))) {
        timers.get(key)?.();
        timers.delete(key);
      }
    },
    dispose: () => {
      disposed = true;
      for (const cancel of timers.values()) cancel();
      timers.clear();
    },
  };
};

export const registerAutomationRunner = (bb: Pick<BbPluginApi, "rpc">, runner: AutomationRunner): void => {
  bb.rpc.register(automationRpcContract, {
    // Повтор отвечает сразу, шаги идут в фоне: мёрдж ждёт GitHub минутами.
    retryAutomation: ({ threadId, stage }) => runner.retry(threadId, stage),
    skipAutomationStep: ({ threadId, stage }) => runner.skip(threadId, stage),
    // Шаг Action идёт в фоне: ответ приходит сразу, а кнопка держит лоадер до записи прогресса.
    runActionStep: async ({ threadId, stage }) => ({ started: await runner.runActionStep(threadId, stage) }),
    runningThreads: () => runner.running(),
  });
};
