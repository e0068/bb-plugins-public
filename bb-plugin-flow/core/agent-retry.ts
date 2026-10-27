// Слой 2 — чисто. Агент зовёт `retry_automation` на упавшем шаге автоматизации: когда Flow это допускает и что агент
// читает в ответе. Сам повтор и ожидание итога — у server/retry-tool.ts.
import { currentName, RETRY_AUTOMATION_TOOL } from "../lib/stage-constants";
import type { FlowProgress, StepAnswer, WorkStage } from "../shared/contract";
import { isActionStage, isFailed } from "./automation-run";
import { afterFailure, stoppedAt, type FailedBlocker, type WaitOutcome, type Blocker } from "./mark-report";

/** Повторять можно этап `stage`, иначе — причина отказа агенту. */
export type RetryVerdict = { kind: "retry"; stage: WorkStage } | { kind: "refused"; reason: string };

const label = (stage: WorkStage): string => `${stage.id} "${currentName(stage)}"`;

const refused = (reason: string): RetryVerdict => ({ kind: "refused", reason });

/** Допустим ли повтор этапа `stageId`: он есть во flow, это автоматизация Flow, шаг упал и ждёт владельца, и остановил его не владелец. */
export const retryVerdict = (stages: readonly WorkStage[], progress: FlowProgress, stageId: string): RetryVerdict => {
  const found = stages.find((stage) => stage.id === stageId);
  if (found === undefined) return refused(`Stage ${stageId} is not a stage of the thread's flow: ${stages.map((stage) => stage.id).join(", ")}.`);
  if (isActionStage(found)) return refused(`Stage ${label(found)} is an action: the owner runs its steps with a button — do not retry it.`);
  if (found.automation === undefined) return refused(`Stage ${label(found)} is not an automation: ${RETRY_AUTOMATION_TOOL} retries only a failed step of an automation stage.`);
  const track = progress.stages[stageId] ?? {};
  if (!isFailed(track)) return refused(`Stage ${label(found)} has no failed step waiting for a retry: nothing was started.`);
  if (track.run?.stopped === true) return refused(`Stage ${label(found)} was stopped by the owner: only the owner continues it from the banner header — do not retry it.`);
  return { kind: "retry", stage: found };
};

/** Ответ, когда Flow повтор не начал: тред занят его другой работой или шаг уже не ждёт. */
export const notStartedReply = (answer: StepAnswer): string =>
  answer.busy === true
    ? `Flow is busy with this thread's automations right now and did not start the retry: call ${RETRY_AUTOMATION_TOOL} again in a moment.`
    : "The step is no longer waiting for a retry: nothing was started.";

/** Где встал упавший шаг: тот же этап, что повторяли, — «упал снова»; другая автоматизация цепочки — «цепочка встала там». */
const failedAt = (retried: WorkStage, failure: FailedBlocker): string => {
  if (failure.stopped === true) return `, then ${stoppedAt(failure)}`;
  return failure.stage.id === retried.id
    ? `, and it failed again at step ${failure.step} (${failure.error})`
    : `, then the chain stopped at automation ${failure.stage.id}: step ${failure.step} failed (${failure.error})`;
};

/**
 * Хвост ответа `retry_automation`, дождавшегося конца повтора: реплика Flow — агенту в этот же ход; шаг упал снова —
 * сказать причину и что делать; иначе повтор прошёл и ход кончается молча.
 */
export const retriedReply = (stage: WorkStage, outcome: WaitOutcome, failure: Blocker | null): string => {
  const head = `Flow retried stage ${label(stage)}`;
  switch (outcome.kind) {
    case "reply":
      return `${head}; here is its message to you instead of a message in the thread. Act on it now, in this turn:\n\n${outcome.text}`;
    case "quiet":
      return failure?.kind === "failed"
        ? `${head}${failedAt(stage, failure)}${afterFailure(failure)}`
        : `${head}; the retry went through and nothing is due for you now — end your turn without a message to the owner: Flow sends you a message when your next stage is due.`;
    case "timeout":
    case "aborted":
      return `${head}; the step still runs — end your turn without a message to the owner: Flow sends you a message when it ends.`;
  }
};
