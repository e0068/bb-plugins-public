import table from "./rates.json";
import longTable from "./long-rates.json";

/** USD per million: uncached input, output, cache read, 5m write, 1h write. */
export const rates = table as Readonly<Record<string, readonly number[]>>;
export const priceKey = (model: string): string | undefined => {
  const lower = model.toLowerCase().replace(/^(openai|moonshot)\//, "");
  if (rates[lower]) return lower;
  const dated = lower.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (rates[dated]) return dated;
  return ["fable", "opus", "sonnet", "haiku"].find((family) => lower.startsWith("claude-") && lower.includes(family));
};
export const priceOf = (model: string, contextInput = 0): readonly number[] | undefined => {
  const key = priceKey(model);
  if (key === undefined) return undefined;
  const long = longTable as Readonly<Record<string, readonly number[]>>;
  return contextInput > 272_000 ? long[key] ?? rates[key] : rates[key];
};
