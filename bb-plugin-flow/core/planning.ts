// Сколько длилось и стоило планирование в треде до брифа. Доллары считаются
// так же, как в Token Usage (tools/tokens.py): по логу сессии Claude Code —
// каждый ответ ассистента с расходом, повторы стриминга схлопнуты по
// (message.id, requestId) с последней записью, цена по семейству модели.
import { priceOf } from "@bb-plugins/provider-usage/core/pricing";

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

type Usage = { model: string; usage: Record<string, unknown> };

const parse = (line: string): [string, Usage] | undefined => {
  try {
    const entry = record(JSON.parse(line));
    const message = record(entry.message);
    const usage = record(message.usage);
    if (entry.type !== "assistant" || Object.keys(usage).length === 0) return undefined;
    return [`${String(message.id)}|${String(entry.requestId)}`, { model: String(message.model ?? ""), usage }];
  } catch {
    return undefined;
  }
};

const costOf = ({ model, usage }: Usage): number | undefined => {
  const price = priceOf(model, num(usage.api_context_input_tokens));
  if (price === undefined) return undefined;
  const split = record(usage.cache_creation);
  const splitKnown = Object.keys(split).length > 0;
  const write5m = num(split.ephemeral_5m_input_tokens) + (splitKnown ? 0 : num(usage.cache_creation_input_tokens));
  const write1h = num(split.ephemeral_1h_input_tokens);
  return (num(usage.input_tokens) * price[0]! + num(usage.output_tokens) * price[1]! + num(usage.cache_read_input_tokens) * price[2]! + write5m * price[3]! + write1h * price[4]!) / 1_000_000;
};

/** Доллары по строкам логов сессии; `undefined`, если ни одного ответа с расходом нет. */
export const transcriptCost = (lines: Iterable<string>): number | undefined => {
  const records = new Map<string, Usage>();
  for (const line of lines) {
    const parsed = parse(line);
    if (parsed !== undefined) records.set(parsed[0], parsed[1]);
  }
  if (records.size === 0) return undefined;
  const costs = [...records.values()].map(costOf);
  if (costs.some((cost) => cost === undefined)) return undefined;
  return Math.round(costs.reduce<number>((sum, cost) => sum + cost!, 0) * 100) / 100;
};

const timestampOf = (line: string): number | undefined => {
  try {
    const value = record(JSON.parse(line)).timestamp;
    return typeof value === "string" ? Date.parse(value) : undefined;
  } catch {
    return undefined;
  }
};

/** Доллары строк лога с отметкой времени в окне `[from, to)`; `undefined`, если ответов с расходом в окне нет. */
export const windowCost = (lines: Iterable<string>, from: number, to: number): number | undefined =>
  transcriptCost(
    [...lines].filter((line) => {
      const at = timestampOf(line);
      return at !== undefined && at >= from && at < to;
    }),
  );

/**
 * Минуты окна `[from, to)`, в которых лог сессии писался: минута считается, если
 * в ней есть хоть одна запись. Минутные корзины — та же мера, которой чарт Usage
 * Analytics схлопывает пустоту, поэтому ожидание владельца и простой между
 * ходами в число не попадают.
 */
export const activeMinutes = (lines: Iterable<string>, from: number, to: number): number => {
  const minutes = new Set<number>();
  for (const line of lines) {
    const at = timestampOf(line);
    if (at !== undefined && at >= from && at < to) minutes.add(Math.floor(at / 60_000));
  }
  return minutes.size;
};

/** Целые минуты от создания треда до брифа — вместе с ожиданием владельца. */
export const planningMinutes = (threadCreatedAt: number, now: number): number => Math.max(0, Math.floor((now - threadCreatedAt) / 60_000));
