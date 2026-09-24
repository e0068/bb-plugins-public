// Заполненность окна контекста треда — то самое число, которое bb показывает
// над композером в «Estimated context». Считать его заново не надо и нечем:
// bb пишет его в журнал треда событием `thread/contextWindowUsage/updated`,
// оттуда его и берёт баннер. События ещё нет, окно не названо или журнал не
// прочитался — числа нет, и второй полосы не будет.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { DEFAULT_ALERT_PERCENT, DEFAULT_WARN_PERCENT, contextShare, isOrderedPair, thresholdsOrDefault } from "../core/context";
import type { ContextFillView } from "../shared/contract";

export type ContextSource = { threads: { events: Pick<BbPluginApi["sdk"]["threads"]["events"], "list"> } };

/** Занятое окно треда и его размер; доля считается здесь, чтобы фронт не делил заново. */
export interface ContextFill {
  readonly share: number;
  readonly usedTokens: number;
  readonly windowTokens: number;
}

// Окно объявлено обнуляемым, а занятое приходит от провайдера: обе величины
// разбираются мягко, и любая непонятная строка журнала просто не считается.
const usageRow = z.object({
  data: z.object({ contextWindowUsage: z.object({ usedTokens: z.number(), modelContextWindow: z.number() }) }),
});

export const readContextFill = async (source: ContextSource, threadId: string): Promise<ContextFill | null> => {
  try {
    const rows = await source.threads.events.list({
      threadId,
      types: ["thread/contextWindowUsage/updated"],
      order: "desc",
      limit: "1",
    });
    // Фильтру `types` верим, но строка разбирается схемой: непонятая строка —
    // это «числа нет», а не исключение посреди ответа баннера.
    const usage = rows.map((row) => usageRow.safeParse(row)).find((parsed) => parsed.success)?.data.data.contextWindowUsage;
    if (usage === undefined) return null;
    const share = contextShare(usage.usedTokens, usage.modelContextWindow);
    return share === null ? null : { share, usedTokens: usage.usedTokens, windowTokens: usage.modelContextWindow };
  } catch {
    return null;
  }
};

/** Что отдают настройки плагина: обе ручки свободные и могут быть пусты. */
export type ContextSettingValues = { contextWarnPercent?: unknown; contextAlertPercent?: unknown };
export type ContextSettings = () => Promise<ContextSettingValues>;

const percent = z.number().min(0).max(100);

/**
 * Пороги второй полосы — решение владельца: у Flow они означают не то же, что
 * доля до конца окна. Окно в миллион токенов кончается задолго до ста
 * процентов, и тревожить надо на первой трети, а не на девяностых.
 *
 * Ввод сторожит схема: страница настроек сохраняет поле по одному и печатает
 * первую ошибку схемы под полем, поэтому жёлтый не ниже красного отклоняется
 * там же, где его ввели, с числом соседа в тексте. Схема видит только своё
 * значение — соседа она спрашивает у `stored`, последней записи хранилища.
 */
export const contextSettings = (stored: () => ContextSettingValues) => {
  const peer = (key: keyof ContextSettingValues, fallback: number): number => {
    const value = stored()[key];
    return typeof value === "number" ? value : fallback;
  };
  return {
    contextWarnPercent: {
      type: "number" as const,
      label: "Context bar — yellow from, %",
      description: "Share of the context window from which the second bar of the progress banner turns yellow. Must be lower than the red threshold.",
      experimental_schema: percent.superRefine((value, ctx) => {
        const alert = peer("contextAlertPercent", DEFAULT_ALERT_PERCENT);
        if (!isOrderedPair(value, alert)) ctx.addIssue({ code: "custom", message: `Must be lower than the red threshold (${alert}%)` });
      }),
      default: DEFAULT_WARN_PERCENT,
    },
    contextAlertPercent: {
      type: "number" as const,
      label: "Context bar — red from, %",
      description: "Share of the context window from which the second bar of the progress banner turns red. Must be higher than the yellow threshold.",
      experimental_schema: percent.superRefine((value, ctx) => {
        const warn = peer("contextWarnPercent", DEFAULT_WARN_PERCENT);
        if (!isOrderedPair(warn, value)) ctx.addIssue({ code: "custom", message: `Must be higher than the yellow threshold (${warn}%)` });
      }),
      default: DEFAULT_ALERT_PERCENT,
    },
  };
};

/**
 * Заполненность окна с порогами владельца — ровно то, что уезжает в ответ
 * баннера. Чисел нет — настройки не спрашиваем: полосы всё равно не будет.
 * Настройки не прочитались или пара в них бессмысленна — умолчание: полоса без
 * цвета хуже, чем полоса с цветом не по вкусу.
 */
export const contextFillOf = async (source: ContextSource, settings: ContextSettings, threadId: string): Promise<ContextFillView | null> => {
  const fill = await readContextFill(source, threadId);
  if (fill === null) return null;
  const values: ContextSettingValues = await settings().catch(() => ({}));
  return { ...fill, ...thresholdsOrDefault(values.contextWarnPercent, values.contextAlertPercent) };
};
