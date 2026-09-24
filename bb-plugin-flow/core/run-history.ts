// Порядок строк истории прогонов: ключи kv приходят в своём порядке, а владелец ищет последние прогоны.

type Ordered = { briefId: string; summary: { finishedAt: string } };

/** Свежие прогоны сверху; одновременно закончившиеся — по брифу, чтобы порядок не зависел от порядка ключей. */
export const historyOrder = <T extends Ordered>(entries: readonly T[]): T[] =>
  [...entries].sort((a, b) => Date.parse(b.summary.finishedAt) - Date.parse(a.summary.finishedAt) || (a.briefId < b.briefId ? -1 : a.briefId > b.briefId ? 1 : 0));
