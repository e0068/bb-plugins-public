// Слой core — чисто. Немой ход: агент закрыл ход без ответа, потому что
// провайдер отказал, а bb этого не увидел. Kimi Code на отказ модели (429
// «лимит 5 часов») пишет у себя `turn.ended` с reason "failed", но по ACP
// отдаёт bb end_turn — и bb закрывает ход как успешный, без слов. Причину
// знает только журнал сессии Kimi: здесь его разбор и правило, по которому
// конец хода в журнале относится к простою треда.

/** Провайдер bb, чьи провалы ходов bb не видит. */
export const KIMI_PROVIDER = "acp-kimi";

/** Насколько конец хода в журнале Kimi может разойтись с простоем треда в bb. */
export const SILENT_WINDOW_MS = 2 * 60_000;

/** Немой ход: `quota` — упёрся в лимит подписки, `error` — другой отказ; `message` — слова провайдера, `null` — их нет. */
export type SilentTurn = { kind: "quota" | "error"; message: string | null; at: number };

/** Конец хода главного агента Kimi: когда, провален ли и с какими словами. */
export type KimiTurnEnd = { at: number; failed: boolean; message: string | null };

const parse = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

const record = (x: unknown): Record<string, unknown> | null => (typeof x === "object" && x !== null ? (x as Record<string, unknown>) : null);

/** Папки сессий Kimi, открытых в рабочей папке треда, — из session_index.jsonl. */
export const kimiSessionsOf = (index: string, workDir: string): string[] =>
  index.split("\n").flatMap((line) => {
    const entry = record(parse(line));
    return entry !== null && entry.workDir === workDir && typeof entry.sessionDir === "string" ? [entry.sessionDir] : [];
  });

/** Последний конец хода главного агента в хвосте wire.jsonl; хвост может начинаться обрывком строки — он пропускается. */
export const lastKimiTurnEnd = (wire: string): KimiTurnEnd | null => {
  const lines = wire.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const entry = record(parse(lines[i] ?? ""));
    if (entry === null || entry.type !== "turn.ended" || (entry.agentId !== undefined && entry.agentId !== "main") || typeof entry.time !== "number") continue;
    const error = record(entry.error);
    const message = typeof error?.message === "string" && error.message.trim() !== "" ? error.message.trim() : null;
    return { at: entry.time, failed: entry.reason === "failed", message };
  }
  return null;
};

const QUOTA = /\b429\b|usage limit|quota/i;

/** Немой ли ход: последний конец хода провален и лёг рядом с простоем треда; иначе — `null`. */
export const silentTurnOf = (end: KimiTurnEnd | null, idleAt: number, windowMs: number = SILENT_WINDOW_MS): SilentTurn | null => {
  if (end === null || !end.failed || Math.abs(idleAt - end.at) > windowMs) return null;
  return { kind: end.message !== null && QUOTA.test(end.message) ? "quota" : "error", message: end.message, at: end.at };
};

/** Самый свежий конец хода из нескольких сессий одной папки: тред в bb — та, что закончила ход последней. */
export const newestTurnEnd = (ends: ReadonlyArray<KimiTurnEnd | null>): KimiTurnEnd | null =>
  ends.reduce<KimiTurnEnd | null>((best, end) => (end !== null && (best === null || end.at > best.at) ? end : best), null);
