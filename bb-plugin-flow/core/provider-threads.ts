// Тред другого провайдера bb исполнителем этапа (BBPL-965): исполнитель каталога, совет по темпу лимитов во вкладе хода и
// первое сообщение дочернему треду. Чистое ядро: ответ bb о лимитах и всё остальное приходят аргументами.
import type { FlowProgress, StageExecutor, WorkStage } from "../shared/contract";

/** Префикс id исполнителя-треда: `thread:<id провайдера bb>`. */
export const THREAD_EXECUTOR_PREFIX = "thread:";

/** Обгон по умолчанию, %: окно расходуется в 1,2 раза быстрее времени — жёлтое кольцо Usage Circles. */
export const DEFAULT_PACE_LEAD = 20;

/** Порог из настроек: целое от 1 до 500; пусто, дробь, ноль или мусор — умолчание: совет не должен пропадать из-за кривой настройки. */
export const paceLeadOf = (raw: unknown): number => (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 500 ? raw : DEFAULT_PACE_LEAD);

/** Провайдер треда, чей темп сравнивается: Flow ведёт треды на Claude Code. */
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

const HOUR_MS = 3_600_000;
// Длины окон bb не сообщает: их даёт подпись — как у колец Usage Circles (bb-plugin-usage-circles/lib/usage-model.ts).
// Серверный импорт за папку плагина bb 0.44+ не собирает, поэтому расчёт повторён здесь.
const SESSION_LABEL = /session|5\s*-?\s*hour/i;
const WEEK_LABEL = /^(weekly( limit)?|current week( \(all models\))?|7[\s-]*days?( limit)?)$/i;

export type WindowKind = "5-hour" | "weekly";
export type JudgedWindow = { kind: WindowKind; durationMs: number; window: UsageWindow };

/** Окна провайдера, о темпе которых судят: пятичасовое и недельное; окно одной модели, месячное и неясные подписи не судятся. */
export const judgedWindows = (usage: ProviderUsage | undefined): JudgedWindow[] =>
  (usage?.status === "ok" ? (usage.windows ?? []) : []).flatMap((window): JudgedWindow[] =>
    SESSION_LABEL.test(window.label) ? [{ kind: "5-hour", durationMs: 5 * HOUR_MS, window }] : WEEK_LABEL.test(window.label.trim()) ? [{ kind: "weekly", durationMs: 168 * HOUR_MS, window }] : [],
  );

/** Расход окна и прошедшее время: в миллисекундах, чтобы сравнение шло без дробей. */
export type Pace = { usedPercent: number; elapsedMs: number; durationMs: number };

/** Темп окна на момент `now`; сброс неизвестен или не разобрался — `null`. */
export const paceOf = (window: UsageWindow, durationMs: number, now: number): Pace | null => {
  const resetsAt = window.resetsAt === null ? Number.NaN : Date.parse(window.resetsAt);
  return Number.isNaN(resetsAt) ? null : { usedPercent: window.usedPercent, elapsedMs: Math.min(durationMs, Math.max(0, durationMs - (resetsAt - now))), durationMs };
};

/** Первые 10% окна темп не судится: пара минут работы там выглядит обгоном. */
const MIN_ELAPSED_PERCENT = 10;

const tooEarly = ({ elapsedMs, durationMs }: Pace): boolean => elapsedMs * 100 < durationMs * MIN_ELAPSED_PERCENT;

/** Окно расходуется быстрее времени на `lead`% и больше: `расход ≥ прошло × (1 + lead/100)`, как у жёлтого кольца Usage Circles. */
export const overtakes = (pace: Pace, lead: number): boolean => !tooEarly(pace) && pace.usedPercent * pace.durationMs >= pace.elapsedMs * (100 + lead);

/** Вердикт о темпе окна: сброс неизвестен, рано судить, обгоняет время или идёт в темпе. */
type Verdict = { kind: "reset-unknown" } | { kind: "too-early"; pace: Pace } | { kind: "ahead"; pace: Pace } | { kind: "on-pace"; pace: Pace };

type Judgment = { kind: WindowKind; window: UsageWindow; verdict: Verdict };

const verdictOf = (pace: Pace | null, lead: number): Verdict =>
  pace === null ? { kind: "reset-unknown" } : tooEarly(pace) ? { kind: "too-early", pace } : overtakes(pace, lead) ? { kind: "ahead", pace } : { kind: "on-pace", pace };

const judge = (usage: ProviderUsage | undefined, now: number, lead: number): Judgment[] =>
  judgedWindows(usage).map(({ kind, durationMs, window }) => ({ kind, window, verdict: verdictOf(paceOf(window, durationMs, now), lead) }));

/** Окно исполнителя, на которое можно советовать: о темпе судили, оно не обгоняет время и не выбрано целиком. */
const roomy = ({ window, verdict }: Judgment): boolean => (verdict.kind === "on-pace" || verdict.kind === "too-early") && window.usedPercent < 100;

const usageOf = (snapshot: UsageSnapshot, providerId: string): ProviderUsage | undefined =>
  snapshot[providerId] ?? (providerId === OWN_PROVIDER ? snapshot[LEGACY_OWN_KEY] : undefined);

const VERDICT_MARK = { "too-early": " — too early to judge the pace", ahead: " — burning ahead of its time", "on-pace": "" } as const;

const judgmentText = ({ kind, window, verdict }: Judgment): string => {
  const used = `${kind} ${Math.round(window.usedPercent)}% used`;
  if (verdict.kind === "reset-unknown") return `${used}, reset time unknown`;
  const passed = Math.round((verdict.pace.elapsedMs * 100) / verdict.pace.durationMs);
  return `${used}, ${passed}% of the time passed${VERDICT_MARK[verdict.kind]}, resets ${window.resetsAt}`;
};

const providerText = (judgments: readonly Judgment[]): string => (judgments.length === 0 ? " — bb reports no limit" : ` — ${judgments.map(judgmentText).join("; ")}`);

/**
 * Строка лимитов во вклад хода треда с flow: окна провайдера треда и провайдеров-исполнителей этапов с темпом, и совет, когда окно
 * провайдера треда расходуется быстрее времени до сброса на `lead`% и больше, а окна исполнителя — нет. У flow нет исполнителей-тредов — `null`.
 */
export const limitsLine = (snapshot: UsageSnapshot, executors: readonly StageExecutor[], { now, lead }: { now: number; lead: number }): string | null => {
  const threads = executors.flatMap((executor) => {
    const providerId = threadProviderOf(executor.id);
    return providerId === null ? [] : [{ id: executor.id, providerId, windows: judge(usageOf(snapshot, providerId), now, lead) }];
  });
  if (threads.length === 0) return null;
  const own = judge(usageOf(snapshot, OWN_PROVIDER), now, lead);
  const limits = [`${OWN_PROVIDER}${providerText(own)}`, ...threads.map((t) => `${t.providerId} (executor ${t.id})${providerText(t.windows)}`)].join(". ");
  const ahead = own.filter((j) => j.verdict.kind === "ahead").map((j) => j.kind);
  const free = ahead.length === 0 ? [] : threads.filter((t) => t.windows.length > 0 && t.windows.every(roomy));
  const advice =
    free.length === 0
      ? ` Recommend a thread executor only when a ${OWN_PROVIDER} window (5-hour or weekly) burns ${lead}% or more ahead of its time — share used against share of the window passed, not judged in its first ${MIN_ELAPSED_PERCENT}% — and the executor's windows have known resets, do not burn ahead and are not used up.`
      : ` The ${OWN_PROVIDER} ${ahead.join(" and ")} window burns ${lead}% or more ahead of its time: in the stage-selection brief recommend executor ${free.map((t) => t.id).join(" or ")} on the stages that have it, and name that window, both providers' pace and their reset times in the brief intro.`;
  return `Provider limits now (pace = share used against share of the window passed): ${limits}.${advice} A thread executor runs the stage as a child thread of that provider in this worktree and branch; Flow starts it when you mark the stage started.`;
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
