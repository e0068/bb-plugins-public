// Выбор flow треду с «Автоматически» до хода его агента (docs/decisions/flow-auto-choice-by-script.md). Хук отправки
// спрашивает `gate` (./owner-turn.ts): выбора ещё не было — он начинается в фоне, а сообщение ждёт в очереди треда;
// выбор идёт — ждёт дальше. Выбор — файл-скрипт ../scripts/choose-flow.sh: он один раз вызывает модель блока «Агент»
// строки «Автоматически» с правилами навыка ../skills/flow-choose и печатает id flow. Назначенный flow получает пустой
// прогон и свою модель; «без flow», сбой, тайм-аут и неизвестный id оставляют тред без flow. Затем очередь
// перепроверяется, и сообщение уходит агенту уже с этапами в инструкциях хода.
import type { StepOutcome } from "@bb-plugins/automation-steps/index";

import { choicePrompt, parseChoice } from "../core/auto-choice";
import { AUTO_FLOW, NO_FLOW } from "../core/flows";
import type { FlowSettings } from "../shared/contract";
import type { ThreadFlows } from "./thread-flows";

/** Сколько ждать модель: дольше сообщение владельца в очереди не стоит. */
export const CHOICE_TIMEOUT_MS = 90_000;

/** Агент выбора, когда блок «Агент» строки «Автоматически» модели не задаёт. */
const DEFAULT_CHOOSER = { providerId: "claude-code", model: "sonnet", reasoningLevel: "low" } as const;

export type AutoChoice = {
  /** Решение хука для сообщения владельца в треде с «Автоматически»: `wait` — держать в очереди, пока flow выбирается. */
  gate(threadId: string, text: string): "wait" | "proceed";
};

export const createAutoChoice = (deps: {
  settings: () => FlowSettings;
  threads: Pick<ThreadFlows, "flowOf" | "assign" | "pickedOf">;
  /** Тред получил flow: пустой прогон и модель flow. */
  started: (threadId: string) => Promise<void>;
  /** Текст навыка flow-choose. */
  skill: () => Promise<string>;
  /** Запускает скрипт выбора со входом в stdin и переменными окружения. */
  script: (input: string, env: Readonly<Record<string, string>>) => Promise<StepOutcome>;
  /** Перепроверить очередь: ждущее сообщение уходит. */
  release: () => void;
  warn: (message: string) => void;
}): AutoChoice => {
  const choosing = new Set<string>();
  /**
   * Треды, чей выбор кончился: следующая попытка отправки уходит без нового выбора, что бы ни стояло у треда, — один выбор
   * отпускает ровно одну попытку, и выбор не идёт по кругу, даже если назначение упало или тред снова встал на «Автоматически».
   */
  const released = new Set<string>();

  /** Id flow по выводу скрипта; сбой и неизвестный id — `null`, с причиной в журнале. */
  const pick = async (text: string): Promise<string | null> => {
    const settings = deps.settings();
    const { providerId, model, reasoningLevel } = settings.autoAgent?.execution ?? DEFAULT_CHOOSER;
    const outcome = await deps.script(choicePrompt(await deps.skill(), settings, text), { FLOW_PROVIDER: providerId, FLOW_MODEL: model, FLOW_EFFORT: reasoningLevel });
    if (!outcome.ok) {
      deps.warn(`flow choice: ${outcome.error}`);
      return null;
    }
    const chosen = parseChoice(outcome.detail ?? "", settings.flows.map((flow) => flow.id));
    if (chosen === null) deps.warn(`flow choice: no known flow in the answer "${outcome.detail ?? ""}"`);
    return chosen;
  };

  const choose = async (threadId: string, text: string): Promise<void> => {
    const chosen = await pick(text).catch((error: unknown) => {
      deps.warn(`flow choice: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    // Владелец выбрал flow над композером, пока модель думала, — его выбор выигрывает: попытка отправки применит его сама.
    if (deps.threads.flowOf(threadId) !== AUTO_FLOW || deps.threads.pickedOf(threadId) !== undefined) return;
    const flowId = chosen ?? NO_FLOW;
    await deps.threads.assign(threadId, flowId);
    if (flowId !== NO_FLOW) await deps.started(threadId).catch((error: unknown) => deps.warn(`flow choice: ${error instanceof Error ? error.message : String(error)}`));
  };

  return {
    gate(threadId, text) {
      if (released.delete(threadId) || deps.threads.flowOf(threadId) !== AUTO_FLOW) return "proceed";
      if (choosing.has(threadId)) return "wait";
      choosing.add(threadId);
      void choose(threadId, text)
        .catch((error: unknown) => deps.warn(`flow choice: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => {
          choosing.delete(threadId);
          released.add(threadId);
          deps.release();
        });
      return "wait";
    },
  };
};
