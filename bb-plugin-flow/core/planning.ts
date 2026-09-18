// Сколько длилось и стоило планирование в треде до брифа. Доллары считаются
// так же, как в Token Usage (tools/tokens.py): по логу сессии Claude Code —
// каждый ответ ассистента с расходом, повторы стриминга схлопнуты по
// (message.id, requestId) с последней записью, цена по семейству модели.
const PRICES: ReadonlyArray<{ family: string; input: number; output: number }> = [
  { family: "fable", input: 10, output: 50 },
  { family: "opus", input: 5, output: 25 },
  { family: "sonnet", input: 3, output: 15 },
  { family: "haiku", input: 1, output: 5 },
];

/** Множители цены входа: запись в кэш на 5 минут, на час, чтение кэша. */
const CACHE_5M = 1.25;
const CACHE_1H = 2;
const CACHE_READ = 0.1;

// Неизвестная модель — по цене sonnet, как в Token Usage: цифры должны сходиться с его шапкой.
const priceOf = (model: string) => PRICES.find((p) => model.toLowerCase().includes(p.family)) ?? PRICES[2]!;

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

const costOf = ({ model, usage }: Usage): number => {
  const price = priceOf(model);
  const split = record(usage.cache_creation);
  const splitKnown = Object.keys(split).length > 0;
  const write5m = num(split.ephemeral_5m_input_tokens) + (splitKnown ? 0 : num(usage.cache_creation_input_tokens));
  const write1h = num(split.ephemeral_1h_input_tokens);
  const input = num(usage.input_tokens) + write5m * CACHE_5M + write1h * CACHE_1H + num(usage.cache_read_input_tokens) * CACHE_READ;
  return (input * price.input + num(usage.output_tokens) * price.output) / 1_000_000;
};

/** Доллары по строкам логов сессии; `undefined`, если ни одного ответа с расходом нет. */
export const transcriptCost = (lines: Iterable<string>): number | undefined => {
  const records = new Map<string, Usage>();
  for (const line of lines) {
    const parsed = parse(line);
    if (parsed !== undefined) records.set(parsed[0], parsed[1]);
  }
  if (records.size === 0) return undefined;
  return Math.round([...records.values()].reduce((sum, r) => sum + costOf(r), 0) * 100) / 100;
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

/** Целые минуты от создания треда до брифа — вместе с ожиданием владельца. */
export const planningMinutes = (threadCreatedAt: number, now: number): number => Math.max(0, Math.floor((now - threadCreatedAt) / 60_000));
