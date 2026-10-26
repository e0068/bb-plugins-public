// Слой 2 — чисто. Что наступает за этапом, который агент отметил сделанным, факт старта по записи прогресса и
// строка ответа flow_stage об этом. «Started» ответ говорит только по записанному старту: обещание запуска,
// которого не было, агент пересказывает владельцу. Ожидание записи — у server/progress.ts.
import { currentName, RETRY_AUTOMATION_TOOL } from "../lib/stage-constants";
import type { FlowProgress, StageTrack, WorkStage } from "../shared/contract";
import { isActionStage, isAgentStage, isDue, isFailed, nextInRun, openAfter, stoppedBy } from "./automation-run";

/** Почему этап со шагами за отмеченным не наступает: уже прошёл или цепочку держит упавший шаг — его или другой автоматизации. */
export type FailedBlocker = { kind: "failed"; stage: WorkStage; step: string; error: string; retryAt?: string };
export type Blocker = { kind: "ran" } | FailedBlocker;

/**
 * Что стоит за отмеченным этапом: наступивший этап со шагами, не наступивший с причиной, этап агента `gate`,
 * за которым сразу этап со шагами, или ничего, о чём стоит сказать.
 */
export type AfterMark =
  | { kind: "none" }
  | { kind: "due"; stage: WorkStage }
  | { kind: "blocked"; stage: WorkStage; reason: Blocker }
  | { kind: "gate"; stage: WorkStage; gate: WorkStage };

/** Что видно в записи прогресса: старт этапа записан, тред занят другим идущим этапом или старта не было. */
export type StartFact = { kind: "started" } | { kind: "busy"; stage: string } | { kind: "not-started" };

const NONE: AfterMark = { kind: "none" };

const hasSteps = (stage: WorkStage): boolean => stage.automation !== undefined;

const isClosed = (progress: FlowProgress, stage: WorkStage): boolean => progress.stages[stage.id]?.finishedAt !== undefined;

/** Упавший шаг этапа: его id и ошибка. */
const failureOf = (progress: FlowProgress, stage: WorkStage): FailedBlocker => {
  const run = progress.stages[stage.id]?.run;
  return { kind: "failed", stage, step: run?.steps[run.at]?.id ?? "", error: run?.error ?? "", ...(run?.retryAt === undefined ? {} : { retryAt: run.retryAt }) };
};

/** Этап со шагами за этапом агента `gate`: он стартует, когда `gate` закроют. */
const gated = (stages: readonly WorkStage[], progress: FlowProgress, gate: WorkStage): AfterMark => {
  const after = nextInRun(stages, progress, gate.id);
  return isAgentStage(gate) && !isClosed(progress, gate) && after !== null && hasSteps(after) && !isClosed(progress, after) ? { kind: "gate", stage: after, gate } : NONE;
};

/** Что наступает за этапом `markedId` по записи уже с его отметкой. */
export const afterMark = (stages: readonly WorkStage[], progress: FlowProgress, markedId: string): AfterMark => {
  const next = nextInRun(stages, progress, markedId);
  if (next === null) return NONE;
  if (!hasSteps(next)) return gated(stages, progress, next);
  if (isDue(stages, progress, next)) return { kind: "due", stage: next };
  if (isClosed(progress, next)) return { kind: "blocked", stage: next, reason: { kind: "ran" } };
  const stopper = isFailed(progress.stages[next.id] ?? {}) ? next : stoppedBy(stages, progress);
  return stopper === null ? NONE : { kind: "blocked", stage: next, reason: failureOf(progress, stopper) };
};

/** Этап идёт сам: автоматизация с прогоном без ошибки или Action с исполняемым сейчас шагом. */
const isRunning = (stage: WorkStage, track: StageTrack | undefined): boolean =>
  track?.run !== undefined && track.finishedAt === undefined && track.run.error === null && (!isActionStage(stage) || track.run.busy === true);

/** Факт по записи прогресса: старт этапа записан, тред занят другим идущим этапом; `null` — ни того, ни другого пока нет. */
export const startFact = (stages: readonly WorkStage[], progress: FlowProgress, stageId: string): StartFact | null => {
  if (progress.stages[stageId]?.run !== undefined) return { kind: "started" };
  const running = stages.find((stage) => stage.id !== stageId && isRunning(stage, progress.stages[stage.id]));
  return running === undefined ? null : { kind: "busy", stage: running.id };
};

const label = (stage: WorkStage): string => `${stage.id} "${currentName(stage)}"`;

/** Подпись этапа для агента: id и название, как в ответах flow_stage. */
export const stageRef = label;

/** Следующий этап прогона за отмеченным владелец вернул чекбоксом после выбора этапов — агент знает прогон по брифу и иначе прошёл бы мимо. */
export const returnedNote = (stages: readonly WorkStage[], progress: FlowProgress, markedId: string): string => {
  const next = nextInRun(stages, progress, markedId);
  return next !== null && !hasSteps(next) && (progress.returned ?? []).includes(next.id)
    ? ` The owner put stage ${label(next)} back into the run with a checkbox after the stage selection: it is the next stage of the run — do it.`
    : "";
};

/** Что делать агенту с упавшим шагом: починил причину — повторяет сам, иначе — владельцу и конец хода. */
const selfRetry = (failed: WorkStage): string =>
  `If the cause is in your reach, fix it and retry the step yourself with ${RETRY_AUTOMATION_TOOL} { "stage": "${failed.id}" }; otherwise end your turn and tell the owner that.`;

/** Что дальше с упавшим шагом: автоповтор назначен — Flow повторит сам; иначе шаг ждёт владельца, а агент может повторить его сам. */
export const afterFailure = (failure: FailedBlocker): string =>
  failure.retryAt === undefined
    ? ` and waits for the owner's Retry or Skip above the composer. ${selfRetry(failure.stage)}`
    : `; Flow retries the step by itself at ${failure.retryAt} — end your turn without a message to the owner: Flow writes to you if it still fails after the last attempt.`;

const kindOf = (stage: WorkStage): string => (isActionStage(stage) ? "action" : "automation");

/** Строка о наступившем этапе со шагами по факту старта; факта нет — старта не было. */
const dueReply = (markedId: string, stage: WorkStage, fact: StartFact): string => {
  const head = `The next stage ${label(stage)} (${kindOf(stage)})`;
  switch (fact.kind) {
    case "started":
      return isActionStage(stage)
        ? ` The next stage ${label(stage)} is an action: Flow put its steps above the composer, and the owner runs its steps with a button — end your turn.`
        : ` Flow started the next stage ${label(stage)} — an automation; it runs by itself now — end your turn without a message to the owner: the owner sees it run above the composer, and the demo reports the work.`;
    case "busy":
      return ` ${head} was NOT started yet: Flow is still running stage ${fact.stage} of this thread, and ${stage.id} is queued right after it — end your turn without a message to the owner: Flow starts it once that stage ends.`;
    case "not-started":
      return ` ${head} was NOT started: Flow recorded no start for it. Do not tell the owner it runs. Tell the owner that Flow did not start ${stage.id}; to retry, mark ${markedId} started and done again.`;
  }
};

/** Строка о не наступившем этапе со шагами: причина и что сделать. */
const blockedReply = (stage: WorkStage, reason: Blocker): string => {
  const head = `The next stage ${label(stage)} (${kindOf(stage)})`;
  if (reason.kind === "ran") return ` ${head} already ran — Flow does not run it again.`;
  return reason.stage.id === stage.id
    ? ` ${head} was NOT started: its step ${reason.step} failed (${reason.error})${afterFailure(reason)}`
    : ` ${head} was NOT started: automation ${reason.stage.id} failed at step ${reason.step} (${reason.error}), and the chain stands${afterFailure(reason)}`;
};

/** Хвост ответа flow_stage после отметки `markedId` сделанным: что с этапом за ним и почему; сказать нечего — пустая строка. */
export const markReply = (markedId: string, verdict: AfterMark, fact: StartFact | null): string => {
  switch (verdict.kind) {
    case "none":
      return "";
    case "due":
      return dueReply(markedId, verdict.stage, fact ?? { kind: "not-started" });
    case "blocked":
      return blockedReply(verdict.stage, verdict.reason);
    case "gate":
      return ` The next stage ${verdict.gate.id} is open; ${label(verdict.stage)} (${kindOf(verdict.stage)}) after it has NOT started — Flow starts it once ${verdict.gate.id} is marked done.`;
  }
};

/** Чем кончилось ожидание автоматизации в вызове flow_stage: реплика Flow, работа Flow кончилась без неё, срок вышел или вызов отменён. */
export type WaitOutcome = { kind: "reply"; text: string } | { kind: "quiet" } | { kind: "timeout" } | { kind: "aborted" };

/** Упавший шаг, который держит цепочку после доигранной работы Flow; `null` — цепочку ничто не держит. */
export const stopFailure = (stages: readonly WorkStage[], progress: FlowProgress): Blocker | null => {
  const stopper = stoppedBy(stages, progress);
  return stopper === null ? null : failureOf(progress, stopper);
};

/**
 * Хвост ответа flow_stage, который дождался автоматизации `stage`: реплика Flow — агенту в этот же ход, вместо сообщения
 * в треде; упавший шаг `failure` — сказать владельцу и закончить ход; иначе ход кончается молча.
 */
export const waitedReply = (stage: WorkStage, outcome: WaitOutcome, failure: Blocker | null): string => {
  const ran = ` Flow ran the next stage ${label(stage)} — an automation — while this call waited`;
  switch (outcome.kind) {
    case "reply":
      return `${ran}; here is its message to you instead of a message in the thread. Act on it now, in this turn:\n\n${outcome.text}`;
    case "quiet":
      return failure?.kind === "failed"
        ? `${ran}; automation ${failure.stage.id} failed at step ${failure.step} (${failure.error})${afterFailure(failure)}`
        : `${ran}; nothing is due for you now — end your turn without a message to the owner: Flow sends you a message when your next stage is due.`;
    case "timeout":
    case "aborted":
      return ` Flow started the next stage ${label(stage)} — an automation; it still runs — end your turn without a message to the owner: Flow sends you a message when it ends.`;
  }
};

/**
 * Следующая работа агента за отмеченным этапом: этап агента сразу за ним или, когда между ними автоматизации, первый этап
 * агента за их цепочкой. Цепочка, которую обрывает Action, или её конец без этапа агента — работы нет: после Action
 * ждёт владелец, а не агент.
 */
export type Upcoming = { via: "agent" | "automation"; stage: WorkStage };

export const upcomingAfter = (stages: readonly WorkStage[], progress: FlowProgress, markedId: string): Upcoming | null => {
  const walk = (from: string, via: Upcoming["via"]): Upcoming | null => {
    const next = nextInRun(stages, progress, from);
    if (next === null || isActionStage(next)) return null;
    return hasSteps(next) ? walk(next.id, "automation") : { via, stage: next };
  };
  return walk(markedId, "agent");
};

/**
 * Следующая работа агента по записи прогресса, не по отметке: первый незакрытый и не вычеркнутый этап прогона или, когда это
 * автоматизация, первый этап агента за их цепочкой. Нужна ответу на бриф, который закрывает встроенные этапы без отметки агента.
 */
export const nextWork = (stages: readonly WorkStage[], progress: FlowProgress): Upcoming | null => {
  const open = openAfter(stages, progress, "");
  if (open === null || isActionStage(open)) return null;
  if (isAgentStage(open)) return { via: "agent", stage: open };
  const behind = upcomingAfter(stages, progress, open.id);
  return behind === null ? null : { via: "automation", stage: behind.stage };
};

const joined = (parts: readonly string[]): string => (parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/**
 * Хвост ответа flow_stage, когда на границе этапов Flow обслужит тред: агенту — закончить ход и ждать «продолжай»;
 * перед автоматизацией ход кончается и так, и ответ говорит только, что Flow успеет до будящей реплики.
 */
export const boundaryNote = (plan: { compact: boolean; model: string | null }, upcoming: Upcoming): string => {
  const doing = [...(plan.compact ? ["compacts the thread"] : []), ...(plan.model === null ? [] : [`sets the model of stage ${label(upcoming.stage)}`])];
  return upcoming.via === "agent" ? ` End your turn now: Flow ${joined([...doing, 'sends you "carry on"'])}.` : ` Before the message that wakes you, Flow ${joined(doing)}.`;
};
