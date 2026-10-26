// Тред другого провайдера bb исполнителем этапа (BBPL-965): исполнитель каталога, совет по лимитам во вкладе хода и
// первое сообщение дочернему треду. Чистое ядро: ответ bb о лимитах и всё остальное приходят аргументами.
import type { FlowProgress, StageExecutor, WorkStage } from "../shared/contract";

/** Префикс id исполнителя-треда: `thread:<id провайдера bb>`. */
export const THREAD_EXECUTOR_PREFIX = "thread:";

/** Порог совета: окно провайдера треда заполнено на столько процентов и больше, окно исполнителя — меньше. */
export const ADVICE_PERCENT = 80;

/** Провайдер треда, чей лимит сравнивается: Flow ведёт треды на Claude Code. */
export const OWN_PROVIDER = "claude-code";

/** Ключ Claude Code в ответе старых сборок bb — до перехода на ключи через дефис. */
const LEGACY_OWN_KEY = "claudeCode";

export type UsageWindow = { label: string; usedPercent: number; resetsAt: string | null };
export type ProviderUsage = { status: string; windows?: readonly UsageWindow[] };
/** Ответ `bb.sdk.system.usageLimits()`: провайдер bb → его лимиты. */
export type UsageSnapshot = Readonly<Record<string, ProviderUsage | undefined>>;

/** Провайдер исполнителя-треда; агент, workflow и пустой id провайдера — `null`. */
export const threadProviderOf = (executorId: string): string | null =>
  executorId.startsWith(THREAD_EXECUTOR_PREFIX) && executorId.length > THREAD_EXECUTOR_PREFIX.length ? executorId.slice(THREAD_EXECUTOR_PREFIX.length) : null;

/** Исполнитель каталога для провайдера bb: в меню — группой «bb», с логотипом провайдера. */
export const threadExecutor = (provider: { id: string; displayName: string }): StageExecutor => ({
  id: `${THREAD_EXECUTOR_PREFIX}${provider.id}`,
  kind: "thread",
  name: `Тред ${provider.displayName}`,
  provider: provider.id,
  origin: { kind: "plugin", plugin: "bb" },
});

const SESSION_LABEL = /session|5\s*-?\s*hour/i;

/** Пятичасовое окно провайдера: по подписи, без неё — первое; провайдер без данных — `null`. */
export const sessionWindow = (usage: ProviderUsage | undefined): UsageWindow | null => {
  const windows = usage?.status === "ok" ? (usage.windows ?? []) : [];
  return windows.find((window) => SESSION_LABEL.test(window.label)) ?? windows[0] ?? null;
};

const usageOf = (snapshot: UsageSnapshot, providerId: string): ProviderUsage | undefined =>
  snapshot[providerId] ?? (providerId === OWN_PROVIDER ? snapshot[LEGACY_OWN_KEY] : undefined);

const windowText = (window: UsageWindow | null): string =>
  window === null ? " — bb reports no limit" : ` ${Math.round(window.usedPercent)}%${window.resetsAt === null ? "" : `, resets ${window.resetsAt}`}`;

/**
 * Строка лимитов во вклад хода треда с flow: окно провайдера треда и провайдеров-исполнителей этапов, и совет, когда своё
 * окно у порога, а у исполнителя свободно. У flow нет исполнителей-тредов — `null`.
 */
export const limitsLine = (snapshot: UsageSnapshot, executors: readonly StageExecutor[]): string | null => {
  const threads = executors.flatMap((executor) => {
    const providerId = threadProviderOf(executor.id);
    return providerId === null ? [] : [{ id: executor.id, providerId, window: sessionWindow(usageOf(snapshot, providerId)) }];
  });
  if (threads.length === 0) return null;
  const own = sessionWindow(usageOf(snapshot, OWN_PROVIDER));
  const limits = [`${OWN_PROVIDER}${windowText(own)}`, ...threads.map((t) => `${t.providerId} (executor ${t.id})${windowText(t.window)}`)].join("; ");
  const free = own !== null && own.usedPercent >= ADVICE_PERCENT ? threads.filter((t) => t.window !== null && t.window.usedPercent < ADVICE_PERCENT) : [];
  const advice =
    free.length === 0
      ? ` Recommend a thread executor only when the ${OWN_PROVIDER} window reaches ${ADVICE_PERCENT}% and the executor's is below it.`
      : ` The ${OWN_PROVIDER} window is at ${ADVICE_PERCENT}% or more: in the stage-selection brief recommend executor ${free.map((t) => t.id).join(" or ")} on the stages that have it, and name both limits with their reset times in the brief intro.`;
  return `Provider limits now, 5-hour window: ${limits}.${advice} A thread executor runs the stage as a child thread of that provider in this worktree and branch; Flow starts it when you mark the stage started.`;
};

export type DelegateInput = {
  stage: { name: string; skill: string };
  /** Файл навыка этапа; не нашёлся — только имя навыка. */
  skillPath: string | null;
  /** Утверждённый Definition of Done треда. */
  criteria: readonly string[];
  /** Результаты пройденных этапов прогона: задача, спека, план. */
  results: ReadonlyArray<{ label: string; target: string }>;
};

const section = (title: string, lines: readonly string[]): string[] => (lines.length === 0 ? [] : ["", title, ...lines.map((line) => `- ${line}`)]);

/** Первое сообщение дочернему треду: этап, его навык, Definition of Done, результаты прошлых этапов и как сдать работу. */
export const delegateMessage = ({ stage, skillPath, criteria, results }: DelegateInput): string =>
  [
    `Flow handed you the "${stage.name}" stage of its parent thread's run. Do the stage's work in this worktree and branch.`,
    ...(stage.skill === "" ? [] : [skillPath === null ? `The stage's skill is ${stage.skill}.` : `The stage's skill is ${stage.skill}: read ${skillPath} and follow it.`]),
    ...section("Definition of Done:", criteria),
    ...section("Results of the stages before it:", results.map(({ label, target }) => (label === target ? label : `${label} — ${target}`))),
    "",
    "Commit your work in the current branch, staging only the paths you changed. Do not push, merge or open a pull request — the parent thread reviews and publishes it.",
    "Finish the whole stage in this turn and end it with a report: what is done, the commit hashes, what is not done and why, and which tests you ran.",
  ].join("\n");

/** Исход заведения дочернего треда. */
export type DelegateResult = { kind: "created"; threadId: string } | { kind: "failed"; error: string };

/** Результаты этапов прогона до `stageId`, закрытых к этому моменту, по порядку flow: их получает дочерний тред. */
export const earlierResults = (stages: readonly WorkStage[], progress: FlowProgress, stageId: string): Array<{ label: string; target: string }> =>
  stages
    .slice(0, Math.max(0, stages.findIndex((stage) => stage.id === stageId)))
    .flatMap((stage) => {
      const track = progress.stages[stage.id];
      return track?.finishedAt === undefined ? [] : (track.results ?? []).map(({ label, target }) => ({ label, target }));
    });

/** Хвост ответа отметки начала этапа, отданного дочернему треду: что агенту делать дальше или почему тред не завёлся. */
export const delegatedReply = (stageId: string, providerId: string, outcome: DelegateResult): string =>
  outcome.kind === "created"
    ? ` Flow handed the work of stage ${stageId} to child thread @thread:${outcome.threadId} on ${providerId}, in this worktree and branch: do not do the stage yourself and end your turn now. Its report comes to you as a message when it finishes its turn: check its commits against the Definition of Done, mark stage ${stageId} done with its results — the commits and files it names — and go on with the next stage. A report that asks a question or stops halfway — answer it with bb thread tell and end your turn again.`
    : ` Flow could not start a child thread on ${providerId} for stage ${stageId} (${outcome.error}): do the stage yourself and tell the owner in the next demo that the ${providerId} thread did not start.`;

/** Хвост ответа повторного начала этапа, уже отданного дочернему треду: правки идут прежнему ребёнку, второй тред не заводится. */
export const reworkReply = (stageId: string, providerId: string): string =>
  ` Stage ${stageId} was already handed to a child thread on ${providerId}: Flow does not start a second one. Send the changes the owner or the review asked for to that child thread with bb thread tell — its id is in the earlier answer that started the stage — and end your turn; its report comes back as a message, then mark stage ${stageId} done.`;
