// Слой 1 — когда фоновый опрос вправе спросить GitHub о PR ветки. Эффектов нет.
//
// Сигнал bb о PR (GraphQL, своя квота) верен почти всегда. Живой вопрос к REST
// API GitHub нужен только треду, который ждёт: нажата публикация PR, а bb его
// ещё не видит, или была попытка мёрджа, а PR ещё открыт. Отметку «ждёт»
// ставит само действие (shell/pr-helpers.ts, markAwaiting), хранит конфиг
// ветки (wiring/pr-await-store.ts), а здесь решается, спрашивать ли и что
// делать с ответом. Спрашивать без отметки на каждом тике опроса значков —
// это и выжгло лимит 5000 запросов в час.
import type { OpenPullRequest } from "./github-requests";
import type { PrPresence } from "./visibility";

/** Тред ждёт публикации или мёрджа своего PR. `found` — PR, который GitHub уже показал, а bb ещё нет. */
export interface AwaitMark {
  kind: "publish" | "merge";
  since: number;
  askedAt: number | null;
  found: OpenPullRequest | null;
}

/** Не чаще раза в минуту на тред. */
export const LIVE_ASK_INTERVAL_MS = 60_000;

/** Действие, после которого GitHub полчаса так и не показал PR, не состоялось: ждать больше нечего. */
export const AWAIT_EXPIRES_MS = 30 * 60_000;

/**
 * `host` — отметки нет, верить bb; `drop` — ожидание кончилось, снять отметку и
 * верить bb; `ask` — спросить GitHub; `reuse` — минута не прошла, взять
 * запомненный ответ.
 */
export type LiveAsk = "host" | "drop" | "ask" | "reuse";

export function decideLiveAsk(mark: AwaitMark | null, host: PrPresence, now: number): LiveAsk {
  if (mark === null) return "host";
  if (host === "open") return "drop";
  if (mark.found === null && now - mark.since >= AWAIT_EXPIRES_MS) return "drop";
  return mark.askedAt === null || now - mark.askedAt >= LIVE_ASK_INTERVAL_MS ? "ask" : "reuse";
}

/** Ответ GitHub: `asked: false` — спросить не вышло, это не «открытого PR нет». */
export type LiveAnswer = { asked: true; pr: OpenPullRequest | null } | { asked: false };

/** Отметка после ответа GitHub; `null` — снять её. */
export function afterAnswer(mark: AwaitMark, answer: LiveAnswer, now: number): AwaitMark | null {
  if (!answer.asked) return { ...mark, askedAt: now };
  if (answer.pr === null && (mark.kind === "merge" || mark.found !== null)) return null;
  return { ...mark, askedAt: now, found: answer.pr };
}
