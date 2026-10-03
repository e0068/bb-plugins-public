// Flow и прогон нового треда — на его первом сообщении: хук `message.dispatch` видит его раньше инструкций первого хода,
// а ссылки на исходный тред у передачи работы bb плагину не даёт — `sourceThreadId` он принимает только у форка.
// Тред, который Flow создал передачей работы, — его первое сообщение упоминает исходный тред, — получает flow исходного;
// прогон исходного ему передаёт ответ на бриф (./api.ts), поэтому своего он не заводит. Передача, которой Демонстрация
// выбрала другой flow, получает выбранный и пустой прогон этого flow. Любой другой новый тред
// с настоящим flow получает пустой прогон, и контейнер состояния Flow показывает этапы с первой минуты.
import type { ProgressStore } from "./progress";
import type { ThreadFlows } from "./thread-flows";

/** Первое сообщение треда: тред с его проектом и родителем, создан ли он самим Flow и какие треды упомянуты в сообщении. */
export type FirstMessage = { thread: { id: string; projectId: string; parentThreadId: string | null }; byFlow: boolean; mentioned: readonly string[] };

export const startThread =
  (deps: {
    threads: Pick<ThreadFlows, "flowOf" | "assign" | "bind">;
    progress: Pick<ProgressStore, "run" | "annotate">;
    /** Есть ли у треда настоящий flow — не «Автоматически» и не «Без flow». */
    hasFlow: (threadId: string) => boolean;
    /** Flow, выбранный в Демонстрации исходного треда для его передачи; забирается один раз. */
    handoffFlow?: (sourceThreadId: string) => string | undefined;
  }) =>
  async ({ thread, byFlow, mentioned }: FirstMessage): Promise<void> => {
    const threadId = thread.id;
    // Flow создаёт треды только передачей работы, и её первое сообщение начинается упоминанием исходного треда.
    const source = byFlow ? mentioned[0] : undefined;
    if (source !== undefined) {
      const switched = deps.handoffFlow?.(source);
      // Передача с переходом в другой flow: прогон исходного не едет, у нового треда — свой пустой.
      if (switched !== undefined) {
        await deps.threads.assign(threadId, switched);
        await deps.progress.annotate(threadId, (progress) => progress);
        return;
      }
      const flowId = deps.threads.flowOf(source);
      if (flowId !== undefined) await deps.threads.assign(threadId, flowId);
      return;
    }
    // Событие создания может прийти позже первого сообщения: тред привязывается здесь же тем же правилом.
    deps.threads.bind(thread);
    if (deps.hasFlow(threadId) && (await deps.progress.run(threadId)) === null) await deps.progress.annotate(threadId, (progress) => progress);
  };
