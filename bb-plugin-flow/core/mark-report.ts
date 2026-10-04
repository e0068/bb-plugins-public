// Слой 2 — чисто. Что наступает за этапом, который агент отметил сделанным, факт старта по записи прогресса и
// строка ответа flow_stage об этом. «Started» ответ говорит только по записанному старту: обещание запуска,
// которого не было, агент пересказывает владельцу. Ожидание записи — у server/progress.ts.
import type { FlowProgress, StageTrack, WorkStage } from "../shared/contract";
import { isActionStage, isAgentStage, isDue, isFailed, nextInRun, stoppedBy } from "./automation-run";

/** Почему этап со шагами за отмеченным не наступает: уже прошёл или цепочку держит упавший шаг — его или другой автоматизации. */
export type Blocker = { kind: "ran" } | { kind: "failed"; stage: WorkStage; step: string; error: string };

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
const failureOf = (progress: FlowProgress, stage: WorkStage): Blocker => {
  const run = progress.stages[stage.id]?.run;
  return { kind: "failed", stage, step: run?.steps[run.at]?.id ?? "", error: run?.error ?? "" };
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

const label = (stage: WorkStage): string => `${stage.id} "${stage.name}"`;

/** Следующий этап прогона за отмеченным владелец вернул чекбоксом после выбора этапов — агент знает прогон по брифу и иначе прошёл бы мимо. */
export const returnedNote = (stages: readonly WorkStage[], progress: FlowProgress, markedId: string): string => {
  const next = nextInRun(stages, progress, markedId);
  return next !== null && !hasSteps(next) && (progress.returned ?? []).includes(next.id)
    ? ` The owner put stage ${label(next)} back into the run with a checkbox after the stage selection: it is the next stage of the run — do it.`
    : "";
};

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
    ? ` ${head} was NOT started: its step ${reason.step} failed (${reason.error}) and waits for the owner's Retry or Skip above the composer — end your turn and tell the owner that.`
    : ` ${head} was NOT started: automation ${reason.stage.id} failed at step ${reason.step} (${reason.error}), and the chain stands until the owner retries or skips it above the composer — end your turn and tell the owner that.`;
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
        ? `${ran}; automation ${failure.stage.id} failed at step ${failure.step} (${failure.error}) and waits for the owner's Retry or Skip above the composer — end your turn and tell the owner that.`
        : `${ran}; nothing is due for you now — end your turn without a message to the owner: Flow sends you a message when your next stage is due.`;
    case "timeout":
    case "aborted":
      return ` Flow started the next stage ${label(stage)} — an automation; it still runs — end your turn without a message to the owner: Flow sends you a message when it ends.`;
  }
};
