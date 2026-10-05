// Заполненность окна контекста треда — то самое число, которое bb показывает
// над композером в «Estimated context». Считать его заново не надо и нечем:
// bb пишет его в журнал треда событием `thread/contextWindowUsage/updated`,
// оттуда его и берёт баннер. События ещё нет, окно не названо или журнал не
// прочитался — числа нет, и второй полосы не будет.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { COMPACT_PRESELECT_LABELS, DEFAULT_ALERT_TOKENS, DEFAULT_COMPACT_PRESELECT, DEFAULT_WARN_TOKENS, compactPreselectOf, contextShare, contextTone, isOrderedPair, preselectsCompact, thresholdsOrDefault } from "../core/context";
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

/**
 * Что отдают настройки плагина: пороги и предвыбор компактации свободные и могут быть пусты.
 * Пороги прошлой версии в процентах лежали под другими ключами и не читаются:
 * без окна треда перевести их в токены нечем, поэтому действуют умолчания.
 */
export type ContextSettingValues = { contextWarnTokens?: unknown; contextAlertTokens?: unknown; compactPreselect?: unknown };
export type ContextSettings = () => Promise<ContextSettingValues>;

const tokens = z.number().int().nonnegative();

/**
 * Пороги второй полосы — решение владельца, и задаются они в токенах: окно у
 * тредов разное, а тревожить надо по объёму занятого, а не по доле окна.
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
    contextWarnTokens: {
      type: "number" as const,
      label: "Context bar — yellow from, tokens",
      description: "Tokens of the context window from which the second bar of the progress banner turns yellow; the bar is split at this point. Must be lower than the red threshold.",
      experimental_schema: tokens.superRefine((value, ctx) => {
        const alert = peer("contextAlertTokens", DEFAULT_ALERT_TOKENS);
        if (!isOrderedPair(value, alert)) ctx.addIssue({ code: "custom", message: `Must be lower than the red threshold (${alert} tokens)` });
      }),
      default: DEFAULT_WARN_TOKENS,
    },
    contextAlertTokens: {
      type: "number" as const,
      label: "Context bar — red from, tokens",
      description: "Tokens of the context window from which the second bar of the progress banner turns red; the bar is split at this point. Must be higher than the yellow threshold.",
      experimental_schema: tokens.superRefine((value, ctx) => {
        const warn = peer("contextWarnTokens", DEFAULT_WARN_TOKENS);
        if (!isOrderedPair(warn, value)) ctx.addIssue({ code: "custom", message: `Must be higher than the yellow threshold (${warn} tokens)` });
      }),
      default: DEFAULT_ALERT_TOKENS,
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
  return { ...fill, ...thresholdsOrDefault(values.contextWarnTokens, values.contextAlertTokens) };
};

/** Предвыбор компактации — выбор из трёх подписей; по умолчанию — с жёлтой зоны. */
export const compactPreselectSetting = {
  compactPreselect: {
    type: "select" as const,
    label: "Preselect thread compaction",
    description: "When a brief opens, «Compact the thread first» is already chosen once the context window reaches this zone of the second bar. The yellow zone includes the red one.",
    options: [COMPACT_PRESELECT_LABELS.never, COMPACT_PRESELECT_LABELS.warn, COMPACT_PRESELECT_LABELS.alert],
    default: COMPACT_PRESELECT_LABELS[DEFAULT_COMPACT_PRESELECT],
  },
};

/**
 * Открывается ли бриф треда с выбранной компактацией: окно дошло до зоны,
 * выбранной в настройке. При «не выбирать» журнал треда не читается. Настройки
 * не прочитались или числа нет — не предвыбираем: лишняя компактация стоит
 * владельцу контекста, а забытая — только клика.
 */
export const compactPreselectedOf = async (source: ContextSource, settings: ContextSettings, threadId: string): Promise<boolean> => {
  const values: ContextSettingValues | null = await settings().catch(() => null);
  if (values === null) return false;
  const preselect = compactPreselectOf(values.compactPreselect);
  if (preselect === "never") return false;
  const fill = await readContextFill(source, threadId);
  return fill !== null && preselectsCompact(preselect, contextTone(fill.usedTokens, thresholdsOrDefault(values.contextWarnTokens, values.contextAlertTokens)));
};
