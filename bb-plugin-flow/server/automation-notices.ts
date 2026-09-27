// Уведомление об итоге этапа-автоматизации: исполнитель знает этап и шаг, а
// тосту нужны ещё название треда, flow и ссылка на PR. Здесь событие
// исполнителя дополняется ими и уходит фронту по realtime; как оно выглядит,
// решает core/automation-notice.ts.
import { pullRequestIn, type AutomationNotice, type NoticeStep } from "../core/automation-notice";
import type { FlowProgress } from "../shared/contract";
import type { RunnerNotice } from "./automation-runner";

export interface NoticePorts {
  progress: { get: (threadId: string) => Promise<FlowProgress | null> };
  /** Название и окружение треда; бросает — треда не прочитать. */
  thread: (threadId: string) => Promise<{ title: string | null; environmentId: string | null }>;
  /** PR окружения по хосту; `null` — PR нет или хост не ответил. */
  pullRequest: (environmentId: string) => Promise<{ number: number; url: string } | null>;
  flow: (threadId: string) => { id: string } | null;
  publish: (notice: AutomationNotice) => void;
  newId: () => string;
}

/** Шаги, после которых у треда есть PR и тосту есть куда вести. */
const PR_STEPS: ReadonlySet<string> = new Set(["git.create-pr", "git.merge"]);

const stepsOf = (record: FlowProgress | null, stageId: string): NoticeStep[] =>
  (record?.stages[stageId]?.run?.steps ?? []).map(({ id, label, detail }) => ({ id, label, detail: detail ?? null }));

/** Итоги шагов PR всего прогона: ссылку на PR берём только у них, а не из вывода скриптов и темы коммита. */
const prDetailsOf = (record: FlowProgress | null): string[] =>
  Object.values(record?.stages ?? {}).flatMap((track) => (track.run?.steps ?? []).flatMap((step) => (step.detail === undefined || !PR_STEPS.has(step.id) ? [] : [step.detail])));

export const createNoticePublisher =
  (ports: NoticePorts) =>
  async (event: RunnerNotice): Promise<void> => {
    const [record, thread] = await Promise.all([ports.progress.get(event.threadId).catch(() => null), ports.thread(event.threadId).catch(() => ({ title: null, environmentId: null }))]);
    const steps = stepsOf(record, event.stage.id);
    // PR ищется в строках всего прогона: этап мёрджа ссылку не пишет, её оставил этап, открывший PR.
    const pr = !steps.some((step) => PR_STEPS.has(step.id))
      ? null
      : (pullRequestIn(prDetailsOf(record)) ?? (thread.environmentId === null ? null : await ports.pullRequest(thread.environmentId).catch(() => null)));
    const base = {
      id: ports.newId(),
      threadId: event.threadId,
      threadTitle: thread.title,
      stageId: event.stage.id,
      stageName: event.stage.name || event.stage.id,
      flowId: ports.flow(event.threadId)?.id ?? null,
      pr,
      steps,
    };
    ports.publish(event.kind === "done" ? { ...base, kind: "done" } : { ...base, kind: "failed", stepId: event.stepId, error: event.error, retryAt: event.retryAt });
  };
