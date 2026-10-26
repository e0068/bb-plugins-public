// Тред другого провайдера bb исполнителем этапа (BBPL-965), оболочка: лимиты провайдеров в памяти для синхронной сборки
// хода и дочерний тред, которому Flow отдаёт этап по отметке его начала. Решения — в ../core/provider-threads.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { delegateMessage, limitsLine, threadProviderOf, type DelegateResult, type UsageSnapshot } from "../core/provider-threads";
import type { WorkStage } from "../shared/contract";

/** Сколько мс ответ bb о лимитах годится для хода; старше — ход берёт его, а новый читается в фоне. */
const FRESH_MS = 60_000;

export type ProviderThreads = {
  /** Строка лимитов для хода треда; лимиты ещё не прочитаны или у flow нет тредов провайдеров — `null`. */
  line: (threadId: string) => string | null;
  /** Заводит дочерний тред провайдера `providerId`, которому отдан этап `stage`; `results` — результаты пройденных этапов прогона. */
  delegate: (args: { threadId: string; stage: WorkStage; providerId: string; results: ReadonlyArray<{ label: string; target: string }> }) => Promise<DelegateResult>;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const createProviderThreads = (
  bb: Pick<BbPluginApi, "sdk">,
  deps: {
    /** Этапы flow треда. */
    stages: (threadId: string) => readonly WorkStage[];
    /** Следующий ребёнок треда идёт без flow (./thread-flows.ts). */
    expectDelegate: (parentThreadId: string) => void;
    /** Утверждённый Definition of Done треда. */
    criteria: (threadId: string) => Promise<readonly string[]>;
    /** Файл навыка по имени; не нашёлся — `null`. */
    skillPath: (name: string) => Promise<string | null>;
    now: () => number;
  },
): ProviderThreads => {
  let snapshot: { usage: UsageSnapshot; at: number } | null = null;
  let reading = false;

  const refresh = (): void => {
    if (reading) return;
    reading = true;
    // Синхронный сбой SDK — тот же сбой чтения: вклад хода не падает из-за лимитов.
    void Promise.resolve()
      .then(() => bb.sdk.system.usageLimits())
      .then((usage) => {
        snapshot = { usage, at: deps.now() };
      })
      .catch(() => undefined)
      .finally(() => {
        reading = false;
      });
  };

  return {
    line: (threadId) => {
      const executors = deps.stages(threadId).flatMap((stage) => stage.executors);
      // Flow без тредов провайдеров лимиты не читает: строки у него всё равно нет.
      if (!executors.some((executor) => threadProviderOf(executor.id) !== null)) return null;
      if (snapshot === null || deps.now() - snapshot.at >= FRESH_MS) refresh();
      return snapshot === null ? null : limitsLine(snapshot.usage, executors);
    },
    delegate: async ({ threadId, stage, providerId, results }) => {
      try {
        const parent = await bb.sdk.threads.get({ threadId });
        if (parent.environmentId === null) return { kind: "failed", error: "the thread has no environment" };
        const [criteria, skillPath] = await Promise.all([deps.criteria(threadId).catch(() => []), stage.skill === "" ? null : deps.skillPath(stage.skill).catch(() => null)]);
        deps.expectDelegate(threadId);
        const child = await bb.sdk.threads.spawn({
          projectId: parent.projectId,
          parentThreadId: threadId,
          title: `${stage.name} — ${parent.title ?? threadId}`,
          providerId,
          environment: { type: "reuse", environmentId: parent.environmentId },
          prompt: delegateMessage({ stage, skillPath, criteria, results }),
        });
        return { kind: "created", threadId: child.id };
      } catch (error) {
        return { kind: "failed", error: errorText(error) };
      }
    },
  };
};
