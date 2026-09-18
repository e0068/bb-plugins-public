// Прогресс flow треда: запись в kv, инструмент агента `flow_stage` и RPC баннера.
// Бриф и ответ пишут прогресс после своей записи — сбой прогресса их не отменяет.
import type { BbPluginApi, PluginKvStorage } from "@get-bb/plugin-sdk";

import { nextAutomation } from "../core/automation-run";
import { EMPTY_PROGRESS, onAnswer, onBrief, onMark, progressView, touchesProgress } from "../core/progress";
import { flowProgressSchema, flowStageParamsSchema, progressRpcContract, type DecisionAnswer, type DecisionBrief, type FlowProgress, type Planned, type StageSettings } from "../shared/contract";

export const FLOW_STAGE_TOOL = "flow_stage";

const PROGRESS_PREFIX = "flow-progress:";
const progressKey = (threadId: string) => `${PROGRESS_PREFIX}${threadId}`;

export type ProgressStore = {
  get(threadId: string): Promise<FlowProgress | null>;
  update(threadId: string, change: (progress: FlowProgress) => FlowProgress): Promise<void>;
  recordBrief(brief: DecisionBrief, at: string): Promise<void>;
  recordAnswer(brief: DecisionBrief, answer: DecisionAnswer, at: string, planned?: Planned): Promise<void>;
  /** Прогресс уходит вместе с работой в новый тред. */
  copy(fromThreadId: string, toThreadId: string): Promise<void>;
  remove(threadId: string): Promise<void>;
  /** Треды, у которых есть запись прогресса. */
  threads(): Promise<string[]>;
};

export interface ProgressOptions {
  /** Зовётся после каждой записанной правки прогресса треда — по ней Flow продвигает автоматизации. */
  onChange?: (threadId: string) => void;
}

export const createProgress = (kv: PluginKvStorage, options: ProgressOptions = {}): ProgressStore => {
  // Правки одного треда идут очередью: kv не транзакционен, а бриф и отметка могут прийти рядом.
  const queues = new Map<string, Promise<void>>();
  const get = async (threadId: string) => {
    const parsed = flowProgressSchema.safeParse(await kv.get(progressKey(threadId)));
    return parsed.success ? parsed.data : null;
  };
  const update = (threadId: string, change: (progress: FlowProgress) => FlowProgress) => {
    const run = (queues.get(threadId) ?? Promise.resolve()).then(async () => {
      await kv.set(progressKey(threadId), change((await get(threadId)) ?? EMPTY_PROGRESS));
      options.onChange?.(threadId);
    });
    queues.set(threadId, run.catch(() => undefined));
    return run;
  };
  return {
    get,
    update,
    // Бриф без этапов и без итога — вопросы посреди работы: прогресса он не меняет.
    recordBrief: (brief, at) => (touchesProgress(brief) ? update(brief.threadId, (p) => onBrief(p, brief, at)) : Promise.resolve()),
    recordAnswer: async (brief, answer, at, planned) => {
      if (!touchesProgress(brief) || (await get(brief.threadId)) === null) return;
      await update(brief.threadId, (p) => onAnswer(p, brief, answer, at, planned));
    },
    copy: async (fromThreadId, toThreadId) => {
      const record = await get(fromThreadId);
      if (record !== null) await update(toThreadId, () => record);
    },
    remove: async (threadId) => {
      await (queues.get(threadId) ?? Promise.resolve());
      await kv.delete(progressKey(threadId));
    },
    threads: async () => (await kv.list(PROGRESS_PREFIX)).map((key) => key.slice(PROGRESS_PREFIX.length)),
  };
};

/** Что сервер знает о треде: окружение для ссылок на файлы, идёт ли ход агента, провайдер. */
export type ThreadState = { environmentId: string | null; active: boolean; providerId: string | null };

const NO_THREAD: ThreadState = { environmentId: null, active: false, providerId: null };

const INSTRUCTIONS = `Mark the stages of the thread's flow as you go, so the owner sees the progress above the composer.
- Call ${FLOW_STAGE_TOOL} with state "started" when you begin a skill stage of the run, before its first action.
- Call it with state "done" and results — links to what the stage produced, [{ label, target }] with the file name or task key as label — when you finish the stage.
- Built-in stages (questions, criteria, stage selection, demo) are marked by the briefs themselves: do not mark them.
- Automation stages are run and marked by Flow itself: when the next stage is an automation, mark the current stage done and end your turn.
- A stage sent back for rework is started again.
The stage ids are in the Flow instructions for the turn.`;

const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

export const registerProgress = (
  bb: Pick<BbPluginApi, "agents" | "rpc">,
  progress: ProgressStore,
  deps: {
    now: () => string;
    stages: (threadId: string) => StageSettings;
    /** Название flow треда — читается на каждый опрос, поэтому переименование видно сразу. */
    flowName?: (threadId: string) => string;
    /** Доллары лога сессий треда в окне времени; `undefined` — неизвестно. */
    windowCost: (threadId: string, from: number, to: number) => Promise<number | undefined>;
    /** Окружение, ход агента и провайдер треда одним чтением; не прочиталось — нет ни одного. */
    thread?: (threadId: string) => Promise<ThreadState>;
  },
): void => {
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
      if (stages.find((s) => s.id === stage)?.automation !== undefined) return toolError(`Stage ${stage} is an automation: Flow runs and marks it itself — do not mark it.`);
      const at = deps.now();
      const startedAt = (await progress.get(ctx.threadId))?.stages[stage]?.startedAt;
      const cost = state === "done" && startedAt !== undefined ? await deps.windowCost(ctx.threadId, Date.parse(startedAt), Date.parse(at)).catch(() => undefined) : undefined;
      let marked = EMPTY_PROGRESS;
      await progress.update(ctx.threadId, (p) => (marked = onMark(p, stage, state, at, results, cost)));
      // Следующий этап — по записи этой отметки: исполнитель может успеть начать автоматизацию раньше, чем агент получит ответ.
      const next = state === "done" ? nextAutomation(stages, marked) : null;
      return next === null ? `Stage ${stage} marked ${state}.` : `Stage ${stage} marked ${state}. The next stage ${next.id} is an automation: Flow runs it now by itself — end your turn.`;
    },
  });

  bb.rpc.register(progressRpcContract, {
    async getFlowProgress({ threadId }) {
      const record = await progress.get(threadId);
      if (record === null) return null;
      const thread = (await deps.thread?.(threadId).catch(() => null)) ?? NO_THREAD;
      const flowName = deps.flowName?.(threadId);
      return { ...progressView(record, deps.stages(threadId).stages, thread.active, thread.providerId), environmentId: thread.environmentId, ...(flowName === undefined ? {} : { flowName }) };
    },
  });
};
