// Прогресс прогонов flow: запись прогона и указатели тредов на неё в kv, инструмент агента `flow_stage` и RPC баннера.
// Бриф и ответ пишут прогресс после своей записи — сбой прогресса их не отменяет.
import { randomBytes } from "node:crypto";

import type { BbPluginApi, PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { idleNote, idleStages, isActionStage } from "../core/automation-run";
import { undoDue } from "../core/automation-undo";
import { afterMark, markReply, returnedNote, startFact, stopFailure, waitedReply, type StartFact } from "../core/mark-report";
import { carriedBy, carrierOf, EMPTY_PROGRESS, forHandoff, onAnswer, onBrief, onMark, pendingActive, progressView, recounted, reopen, isAhead, recountWindows, toggleStageInRun, touchesProgress, answerMovesProgress, withActive } from "../core/progress";
import { historyOrder } from "../core/run-history";
import { isRunFinished, runSummary } from "../core/run-summary";
import { isTaskFile, taskTitle } from "../core/run-tasks";
import { stampFlow, type TaskFlow } from "../core/task-flow";
import { flowProgressSchema, flowStageParamsSchema, frozenRunSchema, progressRpcContract, type ContextFillView, type DecisionAnswer, type DecisionBrief, type FlowProgress, type FrozenRun, type Planned, type RunHistoryEntry, type StageSettings, type WorkStage } from "../shared/contract";
import type { AgentRelay, RelayHold } from "./agent-relay";

export const FLOW_STAGE_TOOL = "flow_stage";

/** Запись прогона под его адресом: id прогона не зависит ни от треда, ни от рабочего дерева, в котором тред сейчас. */
const PROGRESS_PREFIX = "flow-progress:";
const progressKey = (runId: string) => `${PROGRESS_PREFIX}${runId}`;
/** Указатель треда на его прогон; `run: null` — тред отпустил прогон, а нового ещё не начал. */
const POINTER_PREFIX = "flow-thread:";
const pointerKey = (threadId: string) => `${POINTER_PREFIX}${threadId}`;
const pointerSchema = z.object({ run: z.string().nullable() });
type Pointer = z.output<typeof pointerSchema>;
/** Итог завершённого прогона живёт отдельно от записи: следующий прогон её перепишет, а итог в ленте должен остаться. */
const FROZEN_PREFIX = "flow-run:";
const frozenKey = (briefId: string) => `${FROZEN_PREFIX}${briefId}`;

type Rerun = ReadonlyArray<{ id: string; run: boolean; executor?: string }>;

/**
 * Прогресс прогонов flow. Снаружи всё адресуется тредом: хранилище само находит прогон треда по указателю,
 * и все треды, причастные к работе, видят одну запись.
 */
export type ProgressStore = {
  get(threadId: string): Promise<FlowProgress | null>;
  /** Запись прогона треда вместе с его носителем — одним чтением записи; у треда без прогона — `null`. */
  run(threadId: string): Promise<{ progress: FlowProgress; carrier: string } | null>;
  update(threadId: string, change: (progress: FlowProgress) => FlowProgress): Promise<void>;
  /** Правка, которая не двигает работу: та же очередь на прогон, но исполнитель автоматизаций о ней не узнаёт. */
  annotate(threadId: string, change: (progress: FlowProgress) => FlowProgress): Promise<void>;
  recordBrief(brief: DecisionBrief, at: string): Promise<void>;
  recordAnswer(brief: DecisionBrief, answer: DecisionAnswer, at: string, planned?: Planned): Promise<void>;
  /** Прогон переходит к новому треду вместе с работой: тот получает указатель на него, этапы прогона ответа начинаются заново. */
  handOver(fromThreadId: string, toThreadId: string, rerun: Rerun): Promise<void>;
  /** Тред, который ведёт прогон треда; у треда без прогона — он сам. */
  carrier(threadId: string): Promise<string>;
  /** Тред отпускает прогон; прогон снимается, только если тред его и вёл. */
  remove(threadId: string): Promise<void>;
  /** Тред удалён: как `remove`, но и указатель треда снимается целиком — спрашивать о нём больше некому. */
  forget(threadId: string): Promise<void>;
  /** Носители прогонов, по одному на прогон. */
  threads(): Promise<string[]>;
  /** Все треды, через которые прошёл прогон треда, — сам тред первым; у треда без прогона — только он. */
  members(threadId: string): Promise<string[]>;
  /** Кладёт итог завершённого прогона под его бриф; уже лежащий не переписывается — он история. */
  freezeRun(briefId: string, run: FrozenRun): Promise<void>;
  frozenRun(briefId: string): Promise<FrozenRun | null>;
  /** Все замороженные итоги с брифами, под которыми они лежат; битые записи пропускаются. */
  frozenRuns(): Promise<Array<{ briefId: string; run: FrozenRun }>>;
};

export interface ProgressOptions {
  /** Зовётся после каждой записанной правки прогресса с тредом-носителем прогона — по ней Flow продвигает автоматизации. */
  onChange?: (threadId: string) => void;
  /** Тред, которому передали работу ответом на бриф; нет передачи — `undefined`. Так находится прогон треда, переданного до указателей. */
  handedTo?: (briefId: string) => Promise<string | undefined>;
}

/** Адрес нового прогона. */
const RUN_PREFIX = "run_";
const newRunId = (): string => `${RUN_PREFIX}${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;

export const createProgress = (kv: PluginKvStorage, options: ProgressOptions = {}): ProgressStore => {
  // Правки идут одной очередью: kv не транзакционен, бриф и отметка могут прийти рядом, в том числе из разных тредов одного
  // прогона, а первая правка треда заводит прогон — две параллельные завели бы два.
  let tail: Promise<void> = Promise.resolve();
  const record = async (runId: string) => {
    const parsed = flowProgressSchema.safeParse(await kv.get(progressKey(runId)));
    return parsed.success ? parsed.data : null;
  };
  // Указатели пишет только это хранилище, поэтому они живут в памяти и пишутся сквозь неё: опрос баннера и левой
  // панели находит прогон треда без чтения kv и читает только саму запись прогона. `undefined` — указателя нет.
  const pointers = new Map<string, Pointer | undefined>();
  const pointer = async (threadId: string): Promise<Pointer | undefined> => {
    if (pointers.has(threadId)) return pointers.get(threadId);
    const parsed = pointerSchema.safeParse(await kv.get(pointerKey(threadId)));
    // Пока чтение шло, указатель могли записать: прочитанное ложится, только если свежего нет.
    if (!pointers.has(threadId)) pointers.set(threadId, parsed.success ? parsed.data : undefined);
    return pointers.get(threadId);
  };
  const setPointer = async (threadId: string, value: Pointer) => {
    pointers.set(threadId, value);
    await kv.set(pointerKey(threadId), value);
  };
  const dropPointer = async (threadId: string) => {
    pointers.set(threadId, undefined);
    await kv.delete(pointerKey(threadId));
  };
  /**
   * Прогон треда без указателя: запись под id треда — прогон, начатый до указателей; нет её — `undefined`. Если её
   * последний бриф передал работу, прогон — тот, что у треда передачи; `seen` не даёт кольцу передач зациклить поиск.
   * Прогон с адресом нового вида тред передачи начал уже после неё, а отпущенный прогон он закрыл: переданная работа там
   * закончилась, и прогона нет — по всей цепочке.
   */
  const legacyRun = async (threadId: string, seen: ReadonlySet<string>): Promise<string | null | undefined> => {
    const own = await record(threadId);
    if (own === null) return undefined;
    const to = own.lastBriefId === undefined ? undefined : await options.handedTo?.(own.lastBriefId);
    const onward = to === undefined || seen.has(to) ? undefined : await runAt(to, new Set([...seen, threadId]));
    // Тред передачи отпустил прогон или ушёл дальше по цепочке — переданная работа тоже закончилась.
    if (onward === null || onward?.startsWith(RUN_PREFIX)) return null;
    return onward ?? threadId;
  };
  const runAt = async (threadId: string, seen: ReadonlySet<string>): Promise<string | null | undefined> => {
    const found = await pointer(threadId);
    return found === undefined ? legacyRun(threadId, seen) : found.run;
  };
  /** Прогон треда; найденный по старой записи запоминается указателем, чтобы следующий опрос не читал ответы брифов. */
  const runOf = async (threadId: string): Promise<string | null> => {
    const found = await pointer(threadId);
    if (found !== undefined) return found.run;
    const legacy = await legacyRun(threadId, new Set());
    if (legacy !== undefined) await setPointer(threadId, { run: legacy });
    return legacy ?? null;
  };
  const run = async (threadId: string) => {
    const runId = await runOf(threadId);
    const found = runId === null ? null : await record(runId);
    return found === null || runId === null ? null : { progress: found, carrier: carrierOf(found, runId) };
  };
  const get = async (threadId: string) => (await run(threadId))?.progress ?? null;
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const queued = tail.then(work);
    tail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  };
  /** Правка записи прогона треда; зовётся только изнутри очереди. */
  const apply = async (threadId: string, change: (progress: FlowProgress) => FlowProgress, notify: boolean) => {
    const found = await runOf(threadId);
    // Первая правка треда без прогона начинает новый.
    const runId = found ?? newRunId();
    if (found === null) await setPointer(threadId, { run: runId });
    const current = (await record(runId)) ?? { ...EMPTY_PROGRESS, thread: threadId };
    const next = change(current);
    // Правка, собравшая запись заново, носителя не теряет.
    const kept = next.thread === undefined ? { ...next, thread: carrierOf(current, runId) } : next;
    await kv.set(progressKey(runId), kept);
    if (notify) options.onChange?.(carrierOf(kept, runId));
  };
  const write = (threadId: string, change: (progress: FlowProgress) => FlowProgress, notify: boolean) => serial(() => apply(threadId, change, notify));
  const update = (threadId: string, change: (progress: FlowProgress) => FlowProgress) => write(threadId, change, true);
  const carrier = async (threadId: string) => (await run(threadId))?.carrier ?? threadId;
  /**
   * Тред отпускает прогон. Прогон снимается, только если тред его и вёл; запись под id треда, когда прогон у него
   * другой, — только если её ведёт сам тред: это старая копия от передачи. Прогон, начатый до указателей и переданный
   * после них, лежит под id треда, но ведёт его уже носитель — он остаётся.
   */
  const release = async (threadId: string) => {
    const runId = await runOf(threadId);
    if (runId !== null && (await carrier(threadId)) === threadId) await kv.delete(progressKey(runId));
    const own = runId === null || runId === threadId ? null : await record(threadId);
    if (own !== null && carrierOf(own, threadId) === threadId) await kv.delete(progressKey(threadId));
  };
  return {
    get,
    run,
    update,
    annotate: (threadId, change) => write(threadId, change, false),
    // Бриф без этапов и без итога — вопросы посреди работы: этапов он не меняет, а его ответ с прогнозом меняет только план.
    // Бриф треда, отдавшего работу, прогресса не трогает: прогон двигает только его носитель.
    recordBrief: async (brief, at) => {
      if (!touchesProgress(brief) || (await carrier(brief.threadId)) !== brief.threadId) return;
      await update(brief.threadId, (p) => onBrief(p, brief, at));
    },
    recordAnswer: async (brief, answer, at, planned) => {
      if (!answerMovesProgress(brief, planned) || (await get(brief.threadId)) === null || (await carrier(brief.threadId)) !== brief.threadId) return;
      await update(brief.threadId, (p) => onAnswer(p, brief, answer, at, planned));
    },
    handOver: (fromThreadId, toThreadId, rerun) =>
      serial(async () => {
        const runId = await runOf(fromThreadId);
        if (runId === null || (await record(runId)) === null) return;
        await setPointer(toThreadId, { run: runId });
        await apply(toThreadId, (p) => carriedBy(forHandoff(p, rerun), toThreadId), true);
      }),
    carrier,
    remove: (threadId) =>
      serial(async () => {
        await release(threadId);
        // Уцелевшая запись под id треда — чужой прогон: тред нашёл бы его снова по старой записи, пустой указатель не даёт.
        if ((await record(threadId)) !== null) await setPointer(threadId, { run: null });
        else await dropPointer(threadId);
      }),
    forget: (threadId) =>
      serial(async () => {
        await release(threadId);
        await dropPointer(threadId);
      }),
    threads: async () => {
      const runIds = (await kv.list(PROGRESS_PREFIX)).map((key) => key.slice(PROGRESS_PREFIX.length));
      const carriers = await Promise.all(
        runIds.map(async (runId) => {
          const found = await record(runId);
          if (found === null) return null;
          const threadId = carrierOf(found, runId);
          // Старая копия у треда, чей прогон теперь другой, — не прогон.
          return (await runOf(threadId)) === runId ? threadId : null;
        }),
      );
      return [...new Set(carriers.filter((threadId): threadId is string => threadId !== null))];
    },
    // Указатель тред отдаёт прогону навсегда: передача пишет новому треду указатель на тот же прогон и не снимает прежний,
    // поэтому все указатели на прогон — вся его цепочка тредов.
    members: async (threadId) => {
      const runId = await runOf(threadId);
      if (runId === null) return [threadId];
      const found = await record(runId);
      const pointed = await Promise.all(
        (await kv.list(POINTER_PREFIX)).map(async (key) => {
          const id = key.slice(POINTER_PREFIX.length);
          return (await pointer(id))?.run === runId ? [id] : [];
        }),
      );
      // Прогон до указателей лежит под id треда, который его начал.
      const legacy = runId.startsWith(RUN_PREFIX) ? [] : [runId];
      return [...new Set([threadId, ...legacy, ...(found === null ? [] : [carrierOf(found, runId)]), ...pointed.flat()])];
    },
    freezeRun: async (briefId, run) => {
      // Уже лежащий итог — история: переписывать его нечем и незачем.
      if (frozenRunSchema.safeParse(await kv.get(frozenKey(briefId))).success) return;
      await kv.set(frozenKey(briefId), run);
    },
    frozenRun: async (briefId) => {
      const parsed = frozenRunSchema.safeParse(await kv.get(frozenKey(briefId)));
      return parsed.success ? parsed.data : null;
    },
    frozenRuns: async () => {
      const found = await Promise.all(
        (await kv.list(FROZEN_PREFIX)).map(async (key) => {
          const parsed = frozenRunSchema.safeParse(await kv.get(key));
          return parsed.success ? [{ briefId: key.slice(FROZEN_PREFIX.length), run: parsed.data }] : [];
        }),
      );
      return found.flat();
    },
  };
};

/** Что сервер знает о треде: окружение для ссылок на файлы, идёт ли ход агента, провайдер. */
export type ThreadState = { environmentId: string | null; active: boolean; providerId: string | null; title?: string | null; projectId?: string };

const NO_THREAD: ThreadState = { environmentId: null, active: false, providerId: null };

/** Тред строки истории: прочитан, bb ответил «не найден» или чтение не удалось. */
type ThreadTitle = { kind: "read"; title: string | null; project: string | null } | { kind: "gone" } | { kind: "unread" };

/** Сколько тредов история читает одновременно: ~200 чтений разом bb часть отбивает. */
const THREAD_READS_AT_ONCE = 8;

/** Ответ bb «не найден»: SDK бросает ошибку со `status` и текстом `HTTP 404: …`. */
const isNotFound = (error: unknown): boolean =>
  error instanceof Error && ((error as { status?: unknown }).status === 404 || error.message.startsWith("HTTP 404"));

const historyTitle = (run: FrozenRun, thread: ThreadTitle): Pick<RunHistoryEntry, "title" | "project" | "exists"> => {
  switch (thread.kind) {
    case "read":
      return { title: thread.title, project: thread.project, exists: true };
    case "gone":
      return { title: null, project: null, exists: false };
    case "unread":
      return { title: run.title ?? null, project: null, exists: true };
  }
};

const INSTRUCTIONS = `Mark the stages of the thread's flow as you go, so the owner sees the progress above the composer.
- Call ${FLOW_STAGE_TOOL} with state "started" when you begin a skill stage of the run, before its first action.
- Call it with state "done" and results — links to what the stage produced, [{ label, target }] with the file name or task key as label — when you finish the stage.
- Built-in stages (questions, criteria, stage selection, demo) are marked by the briefs themselves: do not mark them.
- Automation stages are run and marked by Flow itself: when the next stage is an automation, mark the current stage done and wait for the answer — the call waits until Flow has run it. When the answer hands you Flow's message, act on it in the same turn; when it says to end your turn, end it — Flow sends you a message when your next stage is due. The answer says whether Flow started it, and if it did not, why and what to do. Never tell the owner an automation runs unless the answer says it started — relay what the answer says.
- Action stages are run by the owner, step by step, with a button above the composer: when the next stage is an action, mark the current stage done and end your turn — Flow marks the action stage itself.
- A stage sent back for rework is started again: marking a done stage started drops the done state of every stage after it, so the run goes through them again in order and the automations behind them run again. The undo steps of the done automations it reopens run before the answer, which names their outcome — relay a failed one to the owner.
- Flow measures the time a stage stood waiting for the owner: a failed automation step until the owner retries or skips it, an action stage between presses. When this tool's answer or a reply from Flow names that idle time, carry it into the flow report and the task report — which stages stood and for how long.
The stage ids are in the Flow instructions for the turn.`;

type Result = NonNullable<FlowProgress["stages"][string]["results"]>[number];

/**
 * Название задачи читается в момент отметки: дерево треда ещё живо, а к заморозке итога оно может быть уже
 * архивировано. Файл не прочёлся или без названия — результат остаётся как есть.
 */
const withTaskTitles = (results: readonly Result[], read: (target: string) => Promise<string | undefined>): Promise<Result[]> =>
  Promise.all(
    results.map(async (result) => {
      if (!isTaskFile(result.target)) return result;
      const title = taskTitle((await read(result.target).catch(() => undefined)) ?? "");
      return title === undefined ? result : { ...result, title };
    }),
  );

/** Сколько ответ flow_stage ждёт записи старта: исполнитель пишет старт через миллисекунды после отметки, срок — с запасом. */
const START_TIMEOUT_MS = 5000;
const START_POLL_MS = 25;
/** Сколько отметка ждёт автоматизацию за этапом: дольше — ход агента держит вызов, а Flow напишет в тред сам. */
const RELAY_WAIT_MS = 10 * 60_000;

const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

export const registerProgress = (
  bb: Pick<BbPluginApi, "agents" | "rpc">,
  progress: ProgressStore,
  deps: {
    now: () => string;
    stages: (threadId: string) => StageSettings;
    /** Название flow треда — читается на каждый опрос, поэтому переименование видно сразу. */
    /** Имя flow треда; `undefined` — тред без flow, и строки с именем над композером нет. */
    flowName?: (threadId: string) => string | undefined;
    /** Доллары лога сессий треда в окне времени; `undefined` — неизвестно. */
    windowCost: (threadId: string, from: number, to: number) => Promise<number | undefined>;
    /** Активные минуты окон по логу сессий треда — минуты на конце этапа и добор закрытым этапам без них. */
    windowMinutes?: (threadId: string, windows: ReadonlyArray<{ from: number; to: number }>) => Promise<readonly number[]>;
    /** Окружение, ход агента и провайдер треда одним чтением; не прочиталось — нет ни одного. */
    thread?: (threadId: string) => Promise<ThreadState>;
    /** Заполненность окна контекста треда с порогами полосы; `null` — чисел ещё нет, и второй полосы не будет. */
    context?: (threadId: string) => Promise<ContextFillView | null>;
    /** Текст файла из дерева треда по пути результата — относительному от корня дерева или абсолютному. */
    readTaskFile?: (threadId: string, target: string) => Promise<string>;
    /** Запись файла в дерево треда по тому же пути, что и чтение. */
    writeTaskFile?: (threadId: string, target: string, text: string) => Promise<void>;
    /** Flow треда; `undefined` — тред без flow, и файлы задач его не получают. */
    flow?: (threadId: string) => TaskFlow | undefined;
    /** Проекты bb для колонки «Проект» истории: читаются один раз на запрос истории. */
    projects?: () => Promise<ReadonlyArray<{ id: string; name: string }>>;
    /** Id живого flow для строки истории по id и названию из итога; flow удалён — `undefined`. */
    liveFlowId?: (id: string | undefined, name: string | undefined) => string | undefined;
    /** Файлы журнала треда за окно прогона (core/run-journal.ts); нет — итог без журнала. */
    journal?: (threadId: string, window: { startedAt: string; finishedAt: string }) => Promise<readonly string[]>;
    /** Сколько мс ответ flow_stage ждёт записи старта этапа со шагами за отмеченным; нет — 5 000. */
    startTimeoutMs?: number;
    /** Шаги отката автоматизаций, с которых доработка сняла готовность, — итог строкой на шаг; нет — отката нет. */
    undo?: (threadId: string, stages: readonly WorkStage[]) => Promise<readonly string[]>;
    /** Ожидание реплики Flow: отметка перед автоматизацией ждёт её конца и отдаёт реплику агенту в ответе; нет — ответ сразу. */
    relay?: Pick<AgentRelay, "hold">;
    /** Сколько мс отметка ждёт автоматизацию; нет — 10 минут. */
    relayWaitMs?: number;
  },
): { freezeFinished: (threadId: string) => Promise<void> } => {
  /**
   * Файл задачи из результата — тем же чтением, что даёт название, получает в шапку flow треда: по нему Tasks+ ведёт
   * из карточки на страницу flow. Штамп записывается, только когда меняет текст; сбой записи отметку не роняет.
   */
  const readStamped = async (threadId: string, target: string): Promise<string | undefined> => {
    const text = await deps.readTaskFile?.(threadId, target);
    const flow = deps.flow?.(threadId);
    if (text === undefined || flow === undefined) return text;
    const stamped = stampFlow(text, flow);
    if (stamped !== text) await deps.writeTaskFile?.(threadId, target, stamped).catch(() => undefined);
    return text;
  };

  /**
   * Факт старта этапа со шагами — по записи прогресса, а не по расчёту: запись опрашивается, пока в ней не появится
   * старт этапа или другой идущий этап треда, а до срока не появилось ни того, ни другого — старта не было.
   */
  const awaitStart = async (threadId: string, stages: readonly WorkStage[], stageId: string, deadline: number): Promise<StartFact> => {
    const fact = startFact(stages, (await progress.get(threadId)) ?? EMPTY_PROGRESS, stageId);
    if (fact !== null) return fact;
    if (Date.now() >= deadline) return { kind: "not-started" };
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
    return awaitStart(threadId, stages, stageId, deadline);
  };

  /** Ждёт, пока Flow доиграет автоматизацию `next`, и отвечает её итогом: реплика агенту, упавший шаг, тишина или ещё идёт. */
  const waitFor = async (threadId: string, stages: readonly WorkStage[], next: WorkStage, hold: RelayHold, signal: AbortSignal): Promise<{ text: string; replied: boolean }> => {
    const outcome = await hold.wait({ ms: deps.relayWaitMs ?? RELAY_WAIT_MS, signal });
    const failure = outcome.kind === "quiet" ? stopFailure(stages, (await progress.get(threadId)) ?? EMPTY_PROGRESS) : null;
    return { text: waitedReply(next, outcome, failure), replied: outcome.kind === "reply" };
  };

  bb.agents.registerTool({
    name: FLOW_STAGE_TOOL,
    description: "Mark a stage of the thread's flow as started or done, with links to its results, for the progress banner above the composer.",
    instructions: INSTRUCTIONS,
    presentation: { label: { pending: "Marking the stage", completed: "Stage marked" } },
    parameters: flowStageParamsSchema,
    async execute({ stage, state, results }, ctx) {
      const stages = deps.stages(ctx.threadId).stages;
      const ids = stages.map((s) => s.id);
      if (!ids.includes(stage)) return toolError(`Stage ${stage} is not a stage of the thread's flow: ${ids.join(", ")}.`);
      // Работа ушла в другой тред: его прогон двигает только он, иначе два треда вели бы одну работу наперебой.
      const carrier = await progress.carrier(ctx.threadId);
      if (carrier !== ctx.threadId)
        return toolError(`The work of this thread's flow run was handed off to thread ${carrier}: that thread carries the run now — do not mark its stages from here. Nothing was marked, and no automation was started from here.`);
      const marking = stages.find((s) => s.id === stage);
      if (marking !== undefined && isActionStage(marking)) return toolError(`Stage ${stage} is an action: the owner runs its steps with a button, and Flow marks it — do not mark it.`);
      if (marking?.automation !== undefined) return toolError(`Stage ${stage} is an automation: Flow runs and marks it itself — do not mark it.`);
      const track = (await progress.get(ctx.threadId))?.stages[stage];
      // Владелец снял этап чекбоксом баннера уже после выбора этапов: агент узнаёт об этом здесь.
      if (state === "started" && track?.skipped === true && track.finishedAt === undefined)
        return toolError(`The owner took stage ${stage} out of the run: skip it and go on with the next stage of the run. Nothing was marked.`);
      const at = deps.now();
      const startedAt = track?.startedAt;
      const window = state === "done" && startedAt !== undefined ? { from: Date.parse(startedAt), to: Date.parse(at) } : undefined;
      const cost = window === undefined ? undefined : await deps.windowCost(ctx.threadId, window.from, window.to).catch(() => undefined);
      const minutes = window === undefined ? undefined : (await deps.windowMinutes?.(ctx.threadId, [window]).catch(() => undefined))?.[0];
      const titled = results === undefined ? undefined : await withTaskTitles(results, (target) => readStamped(ctx.threadId, target));
      // Ожидание встаёт до отметки: автоматизация, которую она запустит, может доиграть раньше, чем вызов начнёт ждать.
      // Снимается на любом выходе — иначе реплика ушла бы в вызов, который уже ответил.
      const hold = state === "done" ? deps.relay?.hold(ctx.threadId) : undefined;
      try {
        let marked = EMPTY_PROGRESS;
        let undone: WorkStage[] = [];
        // Снова начатый этап — доработка: этапы за ним теряют готовность, и автоматизации за ним пройдут заново.
        await progress.update(ctx.threadId, (p) => {
          if (state === "started") undone = undoDue(p, stages, stage);
          return (marked = onMark(state === "started" ? reopen(p, stages, stage) : p, stage, state, at, titled, cost, minutes));
        });
        // Откат закрытых автоматизаций идёт до ответа: агент берётся за правки, когда их эффект уже отменён.
        const undoLines = undone.length === 0 || deps.undo === undefined ? [] : await deps.undo(ctx.threadId, undone).catch((error: unknown) => [`Undo failed: ${error instanceof Error ? error.message : String(error)}`]);
        // Что за отмеченным этапом — по записи этой отметки; о старте ответ говорит только по записанному старту.
        const verdict = state === "done" ? afterMark(stages, marked, stage) : ({ kind: "none" } as const);
        const fact = verdict.kind === "due" ? await awaitStart(ctx.threadId, stages, verdict.stage.id, Date.now() + (deps.startTimeoutMs ?? START_TIMEOUT_MS)) : null;
        // Автоматизация пошла или стоит в очереди за идущей — вызов ждёт её конца; этап Action ждёт владельца, и ждать нечего.
        const waits = hold !== undefined && verdict.kind === "due" && !isActionStage(verdict.stage) && (fact?.kind === "started" || fact?.kind === "busy");
        const waited = waits ? await waitFor(ctx.threadId, stages, verdict.stage, hold, ctx.signal) : null;
        const ahead = `${waited?.text ?? markReply(stage, verdict, fact)}${state === "done" ? returnedNote(stages, marked, stage) : ""}`;
        // Простой прогона — в ответе отметки: отчёт агент пишет до автоматизаций, и другого места узнать числа у него нет.
        // Реплика Flow, отданная в ответ, уже несёт простой — вместе с простоем самих автоматизаций.
        const idle = state === "done" && waited?.replied !== true ? idleNote(idleStages(marked, stages)) : "";
        const undoNote = undoLines.length === 0 ? "" : ` ${undoLines.join(" ")}`;
        return `Stage ${stage} marked ${state}.${ahead}${idle === "" ? "" : ` ${idle}`}${undoNote}`;
      } finally {
        hold?.release();
      }
    },
  });

  /**
   * Добор активных минут этапам, закрытым до того, как их начали считать: лог
   * читается один раз на все такие этапы, число ложится в запись — на следующем
   * опросе добирать уже нечего. Не прочиталось — вид по прежней записи, добор
   * повторится позже.
   */
  const backfill = async (threadId: string, record: FlowProgress): Promise<FlowProgress> => {
    if (record.countedAcrossRun !== true) return recount(threadId, record);
    const windows = pendingActive(record);
    if (windows.length === 0 || deps.windowMinutes === undefined) return record;
    const minutes = await deps.windowMinutes(threadId, windows).catch(() => undefined);
    // Ответ не по числу окон — считать нечего: ждём следующего опроса, а не пишем половину.
    if (minutes === undefined || minutes.length !== windows.length) return record;
    let filled = record;
    await progress.annotate(threadId, (p) => (filled = withActive(p, windows.map((window, i) => ({ id: window.id, minutes: minutes[i]! })))));
    return filled;
  };

  /**
   * Запись, чьи этапы считались по логу одного треда — того, что закрыл этап, — пересчитывается однажды по всем тредам
   * прогона. Минуты не прочитались — запись остаётся прежней и пересчёт повторится на следующем опросе.
   */
  const recount = async (threadId: string, record: FlowProgress): Promise<FlowProgress> => {
    if (deps.windowMinutes === undefined) return record;
    const windows = recountWindows(record);
    const minutes = windows.length === 0 ? [] : await deps.windowMinutes(threadId, windows).catch(() => undefined);
    if (minutes === undefined || minutes.length !== windows.length) return record;
    const costs = await Promise.all(windows.map((window) => (window.priced ? deps.windowCost(threadId, window.from, window.to).catch(() => undefined) : undefined)));
    const entries = windows.map((window, i) => ({ id: window.id, minutes: minutes[i]!, ...(costs[i] === undefined ? {} : { cost: costs[i] }) }));
    let filled = record;
    await progress.annotate(threadId, (p) => (filled = recounted(p, entries)));
    return filled;
  };

  /**
   * Завершённый прогон замораживается под своим брифом: следующий прогон перепишет запись, а итог в ленте и в истории
   * останется. Уже лежащий итог `freezeRun` не переписывает.
   */
  const freeze = async (record: FlowProgress, carrier: string, stages: StageSettings["stages"], thread: ThreadState): Promise<void> => {
    const summary = isRunFinished(record, stages) ? runSummary(record, stages) : null;
    if (record.lastBriefId === undefined || summary === null) return;
    const view = progressView(record, stages, thread.active, thread.providerId);
    const flowName = deps.flowName?.(carrier);
    const flowId = deps.flow?.(carrier)?.id;
    await progress
      .freezeRun(record.lastBriefId, {
        threadId: carrier,
        summary,
        stages: view.stages,
        done: view.done,
        total: view.total,
        planned: view.planned,
        ...(flowName === undefined ? {} : { flowName }),
        ...(flowId === undefined ? {} : { flowId }),
        environmentId: thread.environmentId,
        ...(thread.title ? { title: thread.title } : {}),
      })
      .catch(() => undefined);
  };

  /**
   * Заморозка в момент завершения, а не на опросе баннера: тред, который после завершения никто не открыл, иначе
   * потерял бы итог при следующем прогоне. Зовётся на каждую правку прогона, поэтому незавершённый отсекается одним
   * чтением записи, а минуты добираются только прогону, чей итог ещё не лежит.
   */
  const freezeFinished = async (threadId: string): Promise<void> => {
    const found = await progress.run(threadId);
    if (found === null || found.progress.lastBriefId === undefined) return;
    const stages = deps.stages(found.carrier).stages;
    if (!isRunFinished(found.progress, stages) || (await progress.frozenRun(found.progress.lastBriefId)) !== null) return;
    const record = await backfill(found.carrier, found.progress);
    const thread = (await deps.thread?.(found.carrier).catch(() => null)) ?? NO_THREAD;
    await freeze(record, found.carrier, stages, thread);
  };

  /**
   * Названия треда и его проекта для строки истории. Удалённым тред считается только по ответу bb «не найден»: прочий
   * сбой — один повтор, затем `unread`, и строка берёт название, сохранённое при заморозке.
   */
  const titled = async (threadId: string, projectNames: Promise<ReadonlyMap<string, string>>): Promise<ThreadTitle> => {
    if (deps.thread === undefined) return { kind: "unread" };
    const read = deps.thread;
    const attempt = () => read(threadId).then((thread) => ({ thread }), (error: unknown) => ({ error }));
    let result = await attempt();
    if ("error" in result && !isNotFound(result.error)) result = await attempt();
    if ("error" in result) return isNotFound(result.error) ? { kind: "gone" } : { kind: "unread" };
    const { thread } = result;
    const project = thread.projectId === undefined ? undefined : (await projectNames).get(thread.projectId);
    return { kind: "read", title: thread.title ?? null, project: project ?? null };
  };

  /** Имена проектов по id; список не прочитался — у строк просто нет проекта. */
  const readProjectNames = async (): Promise<ReadonlyMap<string, string>> => {
    const projects = (await deps.projects?.().catch(() => undefined)) ?? [];
    return new Map(projects.map(({ id, name }) => [id, name] as const));
  };

  /** Журнал читается при показе, а не замораживается: итоги, замороженные раньше, получают его тоже. Не прочитался — итог без него. */
  const withJournal = async <T extends FrozenRun>(run: T): Promise<T> => {
    const { startedAt, finishedAt } = run.summary;
    const journal = await deps.journal?.(run.threadId, { startedAt, finishedAt }).catch(() => undefined);
    return journal === undefined ? run : { ...run, journal: [...journal] };
  };

  bb.rpc.register(progressRpcContract, {
    async getFlowProgress({ threadId }) {
      const stored = await progress.get(threadId);
      if (stored === null) return null;
      // Прогон показывается глазами треда, который его ведёт: его этапы, flow, окружение для ссылок на результаты и ход агента.
      const carrier = await progress.carrier(threadId);
      const record = await backfill(carrier, stored);
      const thread = (await deps.thread?.(carrier).catch(() => null)) ?? NO_THREAD;
      // Заполненность окна — самого треда баннера: она едет тем же ответом, что и прогресс, второго опроса у баннера нет.
      const context = (await deps.context?.(threadId).catch(() => null)) ?? null;
      const flowName = deps.flowName?.(carrier);
      // Завершённость и итог считаются по той же записи, что и вид: баннер снимается и блок в ленте появляются одним ответом.
      const stages = deps.stages(carrier).stages;
      const finished = isRunFinished(record, stages);
      const view = progressView(record, stages, thread.active, thread.providerId);
      const summary = finished ? runSummary(record, stages) : null;
      await freeze(record, carrier, stages, thread);
      return {
        ...view,
        environmentId: thread.environmentId,
        ...(flowName === undefined ? {} : { flowName }),
        finished,
        summary,
        summaryBriefId: record.lastBriefId ?? null,
        ...(context === null ? {} : { context }),
        ...(carrier === threadId ? {} : { carrier: { threadId: carrier, title: thread.title ?? null } }),
      };
    },

    async setStageInRun({ threadId, stageId, run }) {
      const found = await progress.run(threadId);
      if (found === null) return { kind: "failed" as const, reason: "no-run" as const };
      // Состав чужого прогона меняет тред, который его ведёт, — как и отметки этапов.
      if (found.carrier !== threadId) return { kind: "failed" as const, reason: "carried" as const };
      const stages = deps.stages(threadId).stages;
      if (!isAhead(found.progress, stages, stageId)) return { kind: "failed" as const, reason: "reached" as const };
      await progress.update(threadId, (record) => toggleStageInRun(record, stages, stageId, run));
      return { kind: "set" as const };
    },

    async getRunSummary({ briefId }) {
      const run = await progress.frozenRun(briefId);
      return run === null ? null : withJournal(run);
    },

    async getRunHistory() {
      const runs = await progress.frozenRuns();
      const projectNames = readProjectNames();
      const titles = new Map<string, ThreadTitle>();
      const ids = [...new Set(runs.map(({ run }) => run.threadId))];
      for (let i = 0; i < ids.length; i += THREAD_READS_AT_ONCE) {
        const batch = ids.slice(i, i + THREAD_READS_AT_ONCE);
        (await Promise.all(batch.map((id) => titled(id, projectNames)))).forEach((title, j) => titles.set(batch[j]!, title));
      }
      const withLiveFlow = ({ flowId: stored, ...run }: FrozenRun) => {
        const flowId = deps.liveFlowId?.(stored, run.flowName);
        return flowId === undefined ? run : { ...run, flowId };
      };
      return historyOrder(await Promise.all(runs.map(async ({ briefId, run }) => ({ ...(await withJournal(withLiveFlow(run))), briefId, ...historyTitle(run, titles.get(run.threadId)!) }))));
    },
  });

  return { freezeFinished };
};
