// Estimating a file's "weight" in tokens and displaying it. A pure layer
// with no I/O: the server reads the content and calls estimateTokens, the
// UI prints formatWeight.

// A rough estimate: ~4 characters per token — a common heuristic for Latin
// text and markup. No need for an exact tokenizer here: this is a "how much
// context will the file eat" indicator, not a billing count.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// A compact label without the word "tokens": "~340", "~1.2k", "~12k".
export function formatWeight(tokens: number): string {
  if (tokens < 1000) return `~${tokens}`;
  const thousands = tokens / 1000;
  return `~${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
}
