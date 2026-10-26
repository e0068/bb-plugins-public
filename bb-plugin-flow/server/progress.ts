// Прогресс прогонов flow: запись прогона и указатели тредов на неё в kv, инструмент агента `flow_stage` и RPC баннера.
// Бриф и ответ пишут прогресс после своей записи — сбой прогресса их не отменяет.
import { randomBytes } from "node:crypto";

import type { BbPluginApi, PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { stageGlyph } from "../components/ui/stage-glyphs";
import { isActionStage, unfinishedBefore } from "../core/automation-run";
import { checklistBlock, openItems } from "../core/checklist";
import { undoDue } from "../core/automation-undo";
import { delegatedReply, earlierResults, reworkReply, threadProviderOf } from "../core/provider-threads";
import { afterMark, boundaryNote, markReply, returnedNote, stageRef, startFact, stopFailure, upcomingAfter, waitedReply, type StartFact } from "../core/mark-report";
import { carriedBy, carrierOf, EMPTY_PROGRESS, forHandoff, onAnswer, onBrief, onMark, pendingActive, progressView, recounted, reopen, isAhead, recountWindows, toggleStageInRun, touchesProgress, answerMovesProgress, withActive } from "../core/progress";
import { historyOrder } from "../core/run-history";
import { isRunFinished, runSummary } from "../core/run-summary";
import { isTaskFile, taskTitle } from "../core/run-tasks";
import { stageTimeline } from "../core/stage-timeline";
import { stampFlow, type TaskFlow } from "../core/task-flow";
import { flowProgressSchema, flowStageParamsSchema, frozenRunSchema, progressRpcContract, type ContextFillView, type DecisionAnswer, type DecisionBrief, type ChecklistItem, type FlowProgress, type FrozenRun, type Planned, type RunHistoryEntry, type RunSummaryView, type StageSettings, type WorkStage } from "../shared/contract";
import { runKey, type PastRun, type RunFigures, type RunSpend } from "@bb-plugins/automation-steps/index";
import { RELAY_WAIT_MS, type AgentRelay, type RelayHold } from "./agent-relay";
import type { Boundary, StageState } from "./boundary";
import type { StageModels } from "./stage-models";
import type { ProviderThreads } from "./provider-threads";

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
  run(threadId: string): Promise<{ progress: FlowProgress; carrier: string; runId: string } | null>;
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

/**
 * Итог прогона для задачи: минуты и доллары под id прогона — он не меняется, когда работу передают другому треду.
 * Дозапись до этого id называла прогон тредом-носителем и началом первого этапа: тот ключ — псевдоним, запись под id
 * его заменяет. Итог, замороженный без id, называется только так.
 */
const spendOf = (runId: string | undefined, thread: string, summary: Pick<RunSummaryView, "startedAt" | "minutes" | "cost">): RunSpend => {
  const legacy = runKey(thread, summary.startedAt);
  return { run: runId ?? legacy, ...(runId === undefined ? {} : { aliases: [legacy] }), minutes: summary.minutes, cost: summary.cost };
};

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
    return found === null || runId === null ? null : { progress: found, carrier: carrierOf(found, runId), runId };
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
- Call ${FLOW_STAGE_TOOL} with state "started" when you begin a skill stage of the run, before its first action. A stage starts only after every skill stage of the run before it is marked done.
- Call it with state "done" and results — links to what the stage produced, [{ label, target }] with the file name or task key as label — when you finish the stage.
- Built-in stages (questions, Definition of Done, stage selection, demo) are marked by the briefs themselves: mark one only to roll back to it.
- Automation stages are run and marked by Flow itself: when the next stage is an automation, mark the current stage done and wait for the answer — the call waits until Flow has run it. When the answer hands you Flow's message, act on it in the same turn; when it says to end your turn, end it — Flow sends you a message when your next stage is due. The answer says whether Flow started it, and if it did not, why and what to do. Never tell the owner an automation runs unless the answer says it started — relay what the answer says.
- Action stages are run by the owner, step by step, with a button above the composer: when the next stage is an action, mark the current stage done and end your turn — Flow marks the action stage itself.
- Rolling back: mark a done stage started, a built-in one too — every stage after it loses its done state, so the run goes through them again in order and the automations behind them run again. The undo steps of the done automations it reopens run before the answer, which names their outcome — relay a failed one to the owner. A chat message about a demo asking for a change rolls back to the stage of the change, an approval comment — to the stage before the approval; a new fork, criterion or stage choice after launch rolls back to Definition of Done.
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

/** Где этап в прогоне треда: закрыт, начат или ещё нет. */
export const stageStateOf = async (progress: Pick<ProgressStore, "get">, threadId: string, stageId: string): Promise<StageState> => {
  const track = (await progress.get(threadId))?.stages[stageId];
  return track?.finishedAt !== undefined ? "closed" : track?.startedAt !== undefined ? "started" : "todo";
};

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
    /** Утверждённые пункты Definition of Done треда — для строки этапа в баннере; пусто — строка не раскрывается. */
    criteria?: (threadId: string) => Promise<readonly string[]>;
    /** Ответы владельца на Вопросы треда строками — для строки этапа Вопросов в баннере; пусто — строка не раскрывается. */
    answers?: (threadId: string) => Promise<readonly string[]>;
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
    /** Сверка настроек Claude Code дерева треда с новым прогрессом: ответ отметки ждёт её; нет — не ждёт. */
    settled?: (threadId: string) => Promise<void>;
    /** Чек-лист треда по комментариям владельца: пока в нём есть открытые пункты, следующий этап не начинается. Нет — чек-листа не бывает. */
    checklist?: (threadId: string) => Promise<readonly ChecklistItem[]>;
    /** Граница этапов: на отметке «готово» Flow назначает обслуживание треда — сжатие и модель следующего этапа; нет — граница не работает. */
    boundary?: Pick<Boundary, "schedule" | "continueNow" | "carriedOn">;
    /** План обслуживания треда перед этапом — сжатие и модель этапа (./stage-models.ts); нет — граница не работает. */
    stageModels?: StageModels;
    /** Сбой, о котором нужна строка в логе: реплика границы не ушла. */
    warn?: (message: string) => void;
    /** Дочерний тред другого провайдера, которому отдан начатый этап с исполнителем `thread:<провайдер>` (./provider-threads.ts); нет — этап ведёт агент. */
    delegate?: ProviderThreads["delegate"];
  },
): { freezeFinished: (threadId: string) => Promise<void>; runFigures: (threadId: string) => Promise<RunFigures | null>; pastRuns: () => Promise<PastRun[]> } => {
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
      const record = (await progress.get(ctx.threadId)) ?? EMPTY_PROGRESS;
      const track = record.stages[stage];
      // Владелец снял этап чекбоксом баннера уже после выбора этапов: агент узнаёт об этом здесь.
      if (state === "started" && track?.skipped === true && track.finishedAt === undefined)
        return toolError(`The owner took stage ${stage} out of the run: skip it and go on with the next stage of the run. Nothing was marked.`);
      // Пропущенный этап прогона молча уходил из работы: следующий начинается только после него.
      // Чек-лист по комментариям владельца закрывается до следующего этапа: так «Продолжить с правками» не теряет правки.
      const checklist = state === "started" ? ((await deps.checklist?.(ctx.threadId).catch(() => [])) ?? []) : [];
      if (openItems(checklist).length > 0) return toolError(checklistBlock(checklist));
      const open = state === "started" ? unfinishedBefore(stages, record, stage) : null;
      if (open !== null)
        return toolError(`Stage ${open.id} "${open.name}" comes before ${stage} in the run and is not marked done: finish it and mark it done first, or ask the owner to take it out of the run. Nothing was marked.`);
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
          return (marked = onMark(state === "started" ? reopen(p, stages, stage, at) : p, stage, state, at, titled, cost, minutes));
        });
        // Агент зовёт навык этапа сразу после ответа: к нему файл настроек уже открывает этот навык.
        await deps.settled?.(ctx.threadId).catch(() => undefined);
        // Откат закрытых автоматизаций идёт до ответа: агент берётся за правки, когда их эффект уже отменён.
        const undoLines = undone.length === 0 || deps.undo === undefined ? [] : await deps.undo(ctx.threadId, undone).catch((error: unknown) => [`Undo failed: ${error instanceof Error ? error.message : String(error)}`]);
        // Что за отмеченным этапом — по записи этой отметки; о старте ответ говорит только по записанному старту.
        const verdict = state === "done" ? afterMark(stages, marked, stage) : ({ kind: "none" } as const);
        const fact = verdict.kind === "due" ? await awaitStart(ctx.threadId, stages, verdict.stage.id, Date.now() + (deps.startTimeoutMs ?? START_TIMEOUT_MS)) : null;
        // Автоматизация пошла или стоит в очереди за идущей — вызов ждёт её конца; этап Action ждёт владельца, и ждать нечего.
        const running = verdict.kind === "due" && !isActionStage(verdict.stage) && (fact?.kind === "started" || fact?.kind === "busy");
        // Граница этапов: следующая работа агента впереди — сразу за этапом или за автоматизацией, которая действительно пошла.
        const upcoming = state === "done" && deps.boundary !== undefined ? upcomingAfter(stages, marked, stage) : null;
        const plan = deps.stageModels === undefined || upcoming === null || (upcoming.via === "automation" && !running) ? null : await deps.stageModels.plan(ctx.threadId, upcoming.stage, true);
        if (plan !== null && upcoming !== null && deps.boundary !== undefined) {
          deps.boundary.schedule(ctx.threadId, { ...plan, nextStage: stageRef(upcoming.stage), stageId: upcoming.stage.id, fresh: true });
          // Агент без автоматизации впереди продолжит по реплике Flow, когда его ход кончится; перед автоматизацией будит она.
          if (upcoming.via === "agent") void deps.boundary.continueNow(ctx.threadId).catch((error: unknown) => deps.warn?.(`flow_stage: the stage boundary message failed to reach the thread (${error instanceof Error ? error.message : String(error)})`));
        }
        // Доработка: этап, чья модель не та, что у треда, начинается после конца хода — модель ставит Flow, сжатие здесь не нужно.
        // Этап, отданный дочернему треду другого провайдера, ведёт ребёнок: модель родителя ему не нужна.
        const reworkPlan =
          state === "started" && deps.boundary !== undefined && deps.stageModels !== undefined && marking !== undefined && threadProviderOf(marked.stages[stage]?.executor ?? "") === null && !deps.boundary.carriedOn(ctx.threadId, stage) ? await deps.stageModels.plan(ctx.threadId, marking, false) : null;
        if (reworkPlan !== null && marking !== undefined && deps.boundary !== undefined) {
          deps.boundary.schedule(ctx.threadId, { ...reworkPlan, nextStage: stageRef(marking), stageId: marking.id, fresh: false });
          void deps.boundary.continueNow(ctx.threadId).catch((error: unknown) => deps.warn?.(`flow_stage: the stage boundary message failed to reach the thread (${error instanceof Error ? error.message : String(error)})`));
        }
        // Автоматизация не держит вызов, когда назначена граница: она идёт, пока тред простаивает, и будящая реплика пройдёт через Flow.
        const waits = hold !== undefined && plan === null && running;
        const waited = waits && verdict.kind === "due" ? await waitFor(ctx.threadId, stages, verdict.stage, hold, ctx.signal) : null;
        const boundaryTail = plan !== null && upcoming !== null ? boundaryNote(plan, upcoming) : reworkPlan !== null && marking !== undefined ? boundaryNote(reworkPlan, { via: "agent", stage: marking }) : "";
        // За этапом агента, с границей или без, строка о незапущенной автоматизации после него остаётся: у агента она единственная.
        const ahead = `${waited?.text ?? markReply(stage, verdict, fact)}${boundaryTail}${state === "done" ? returnedNote(stages, marked, stage) : ""}`;
        const undoNote = undoLines.length === 0 ? "" : ` ${undoLines.join(" ")}`;
        // Этап с исполнителем-тредом ведёт дочерний тред провайдера: Flow заводит его сам, агент только ждёт отчёта.
        const providerId = state === "started" && marking !== undefined ? threadProviderOf(marked.stages[stage]?.executor ?? "") : null;
        // Повторное начало тем же исполнителем — доработка: этап уже у ребёнка, правки идут ему, второй тред не заводится.
        // Исполнитель прошлого прохода — из записи до отметки: после неё там уже исполнитель нового прохода.
        const delegated =
          providerId === null || deps.delegate === undefined || marking === undefined
            ? ""
            : track?.startedAt !== undefined && track.executor === marked.stages[stage]?.executor
              ? reworkReply(stage, providerId)
              : delegatedReply(stage, providerId, await deps.delegate({ threadId: ctx.threadId, stage: marking, providerId, results: earlierResults(stages, marked, stage) }));
        return `Stage ${stage} marked ${state}.${ahead}${undoNote}${delegated}`;
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
    // Встроенные этапы закрывает ответ владельца, а не отметка агента, и цены у них нет: доллары окна добираются вместе с минутами.
    const costs = await costsOf(threadId, windows);
    let filled = record;
    await progress.annotate(threadId, (p) => (filled = recounted(p, windows.map((window, i) => ({ id: window.id, minutes: minutes[i]!, ...(costs[i] === undefined ? {} : { cost: costs[i]! }) })))));
    return filled;
  };

  /**
   * Доллары каждого окна по логам сессий треда; не прочиталось — `undefined` на месте окна. Окно одного брифа общее для всех
   * его этапов: цена кладётся один раз, первому этапу группы, иначе сумма этапов утроила бы деньги. Нулевое окно цены не получает.
   */
  const costsOf = (threadId: string, windows: ReadonlyArray<{ from: number; to: number }>): Promise<Array<number | undefined>> => {
    const seen = new Set<string>();
    return Promise.all(
      windows.map((window) => {
        const key = `${window.from}:${window.to}`;
        if (window.to <= window.from || seen.has(key)) return undefined;
        seen.add(key);
        return deps.windowCost(threadId, window.from, window.to).catch(() => undefined);
      }),
    );
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
  const freeze = async (record: FlowProgress, runId: string, carrier: string, stages: StageSettings["stages"], thread: ThreadState): Promise<void> => {
    const summary = isRunFinished(record, stages) ? runSummary(record, stages) : null;
    if (record.lastBriefId === undefined || summary === null) return;
    const view = progressView(record, stages, thread.active);
    const flowName = deps.flowName?.(carrier);
    const flowId = deps.flow?.(carrier)?.id;
    await progress
      .freezeRun(record.lastBriefId, {
        threadId: carrier,
        runId,
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
    await freeze(record, found.runId, found.carrier, stages, thread);
  };

  /**
   * План и факт прогона треда для шагов «План → задача» и «Факт → задача»: id прогона, бюджет, с которым владелец
   * отпустил прогон, и итог его закрытых этапов. Итог считается только по запросу: минуты и доллары добираются тем же
   * `backfill`, что и у баннера, — иначе этапы, закрытые минуту назад, ушли бы в задачу без своей стоимости, — а шагу
   * плана этот добор не нужен. Прогона нет — `null`.
   */
  const runFigures = async (threadId: string): Promise<RunFigures | null> => {
    const found = await progress.run(threadId);
    if (found === null) return null;
    const spent = async () => {
      const summary = runSummary(await backfill(found.carrier, found.progress), deps.stages(found.carrier).stages);
      return summary === null ? null : spendOf(found.runId, found.carrier, summary);
    };
    return { planned: found.progress.planned ?? null, spent };
  };

  /**
   * Все прогоны, что-то потратившие: идущие и завершённые, по одному на прогон. Итог прогона заморожен под каждым
   * брифом, после которого прогон кончался, а идущий прогон ещё и лежит записью — одинаковый id прогона сводит их
   * в один, с большим итогом.
   */
  const pastRuns = async (): Promise<PastRun[]> => {
    const live = await Promise.all(
      (await progress.threads()).map(async (thread) => {
        const spent = await (await runFigures(thread))?.spent().catch(() => null);
        return spent ? [{ thread, spent }] : [];
      }),
    );
    const frozen = (await progress.frozenRuns()).map(({ run }) => ({ thread: run.threadId, spent: spendOf(run.runId, run.threadId, run.summary) }));
    const byRun = new Map<string, PastRun>();
    for (const run of [...live.flat(), ...frozen]) {
      const seen = byRun.get(run.spent.run);
      if (seen === undefined || run.spent.minutes + run.spent.cost > seen.spent.minutes + seen.spent.cost) byRun.set(run.spent.run, run);
    }
    // Итог, замороженный без id, — тот же прогон, что идёт под id с этим псевдонимом.
    const aliased = new Set([...byRun.values()].flatMap((run) => run.spent.aliases ?? []));
    // Прогон без минут и долларов задаче ничего не говорит: «0 мин, $0» в ней было бы неправдой.
    return [...byRun.values()].filter((run) => !aliased.has(run.spent.run) && (run.spent.minutes > 0 || run.spent.cost > 0));
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
    async getStageTimeline({ threadId }) {
      const stored = await progress.get(threadId);
      if (stored === null) return [];
      // Этапы — того flow, по которому идёт тред-носитель прогона, как у баннера.
      const stages = deps.stages(await progress.carrier(threadId)).stages;
      return stageTimeline(stored, stages).map(({ icon, fallbackIcon, ...stage }) => ({ ...stage, glyph: stageGlyph({ icon, fallbackIcon }) }));
    },
    async getFlowProgress({ threadId }) {
      const found = await progress.run(threadId);
      if (found === null) return null;
      // Прогон показывается глазами треда, который его ведёт: его этапы, flow, окружение для ссылок на результаты и ход агента.
      const { carrier, runId } = found;
      const record = await backfill(carrier, found.progress);
      const thread = (await deps.thread?.(carrier).catch(() => null)) ?? NO_THREAD;
      // Заполненность окна — самого треда баннера: она едет тем же ответом, что и прогресс, второго опроса у баннера нет.
      const context = (await deps.context?.(threadId).catch(() => null)) ?? null;
      const flowName = deps.flowName?.(carrier);
      const criteria = (await deps.criteria?.(carrier).catch(() => [])) ?? [];
      const answers = (await deps.answers?.(carrier).catch(() => [])) ?? [];
      // Завершённость и итог считаются по той же записи, что и вид: баннер снимается и блок в ленте появляются одним ответом.
      const stages = deps.stages(carrier).stages;
      const finished = isRunFinished(record, stages);
      const view = progressView(record, stages, thread.active);
      const summary = finished ? runSummary(record, stages) : null;
      await freeze(record, runId, carrier, stages, thread);
      return {
        ...view,
        environmentId: thread.environmentId,
        ...(flowName === undefined ? {} : { flowName }),
        finished,
        summary,
        summaryBriefId: record.lastBriefId ?? null,
        ...(context === null ? {} : { context }),
        ...(carrier === threadId ? {} : { carrier: { threadId: carrier, title: thread.title ?? null } }),
        ...(criteria.length === 0 ? {} : { criteria: [...criteria] }),
        ...(answers.length === 0 ? {} : { answers: [...answers] }),
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

  return { freezeFinished, runFigures, pastRuns };
};
