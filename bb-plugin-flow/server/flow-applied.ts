// «Применить» отдал треду flow посреди хода: агенту, который работает, уходит строка в тот же ход — видимая владельцу подпись
// Flow и, только для агента, этапы нового flow. Тред без хода ничего не получает: этапы придут с инструкциями следующего хода.
import { appliedFlowLine, noFlowLine } from "../core/applied-flow";
import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import type { WorkStage } from "../shared/contract";

type Input = { type: "text"; text: string; mentions: never[]; visibility?: "agent-only" };

export const tellApplied =
  (deps: {
    /** Идёт ли у треда ход агента. */
    active: (threadId: string) => Promise<boolean>;
    /** Строка в идущий ход — `steer`, без очереди. */
    steer: (threadId: string, input: Input[]) => Promise<unknown>;
    /** Своя отправка Flow: хук хода не применяет по ней выбор и не возвращает бриф. */
    mark: (threadId: string, text: string) => void;
    /** Имя и этапы flow; «Автоматически» и «Без flow» — `null`. */
    flowOf: (flowId: string) => { name: string; stages: readonly WorkStage[] } | null;
    /** «Без flow»: строка о снятом flow вместо этапов. */
    isNoFlow: (flowId: string) => boolean;
  }) =>
  async (threadId: string, flowId: string, locale: Locale | undefined): Promise<void> => {
    if (!(await deps.active(threadId))) return;
    const t = messages(locale);
    const flow = deps.flowOf(flowId);
    // «Автоматически» выбирает flow до хода агента — посреди хода ему сказать нечего.
    if (flow === null && !deps.isNoFlow(flowId)) return;
    const visible = t.flowChoice.applied(flow?.name ?? t.flowChoice.none);
    deps.mark(threadId, visible);
    await deps.steer(threadId, [
      { type: "text", text: visible, mentions: [] },
      { type: "text", text: flow === null ? noFlowLine : appliedFlowLine(flow.name, flow.stages), mentions: [], visibility: "agent-only" },
    ]);
  };
