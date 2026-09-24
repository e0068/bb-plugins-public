import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { afterAnswer, AWAIT_EXPIRES_MS, decideLiveAsk, LIVE_ASK_INTERVAL_MS, type AwaitMark } from "./pr-await";
import type { PrPresence } from "./visibility";

const NOW = 1_790_000_000_000;
const PR = { number: 41, url: "https://github.com/e0068/bb-plugins/pull/41" };
const mark = (over: Partial<AwaitMark> = {}): AwaitMark => ({ kind: "publish", since: NOW, askedAt: null, found: null, ...over });
const notOpen: PrPresence[] = ["absent", "settled", "unknown"];

describe("decideLiveAsk", () => {
  it("нет отметки → верить bb при любом сигнале", () => {
    for (const presence of [...notOpen, "open" as const]) expect(decideLiveAsk(null, presence, NOW)).toBe("host");
  });

  it("bb видит PR открытым → ожидание кончилось, отметка снимается", () => {
    expect(decideLiveAsk(mark({ kind: "publish" }), "open", NOW)).toBe("drop");
    expect(decideLiveAsk(mark({ kind: "merge" }), "open", NOW)).toBe("drop");
  });

  it("свежая отметка, GitHub ещё не спрашивали → спросить", () => {
    for (const presence of notOpen) expect(decideLiveAsk(mark(), presence, NOW)).toBe("ask");
  });

  it("спрашивали меньше минуты назад → переиспользовать прошлый ответ", () => {
    expect(decideLiveAsk(mark({ askedAt: NOW - LIVE_ASK_INTERVAL_MS + 1 }), "settled", NOW)).toBe("reuse");
  });

  it("минута прошла → спросить снова", () => {
    expect(decideLiveAsk(mark({ askedAt: NOW - LIVE_ASK_INTERVAL_MS }), "settled", NOW)).toBe("ask");
  });

  it("интервал — минута", () => {
    expect(LIVE_ASK_INTERVAL_MS).toBe(60_000);
  });

  it("отметка без найденного PR старше срока → снимается: публикация или мёрдж так и не состоялись", () => {
    expect(decideLiveAsk(mark({ since: NOW - AWAIT_EXPIRES_MS, askedAt: NOW - LIVE_ASK_INTERVAL_MS }), "settled", NOW)).toBe("drop");
    expect(decideLiveAsk(mark({ kind: "merge", since: NOW - AWAIT_EXPIRES_MS }), "settled", NOW)).toBe("drop");
  });

  it("найденный PR, который bb ещё не видит, держит отметку и после срока", () => {
    expect(decideLiveAsk(mark({ since: NOW - AWAIT_EXPIRES_MS * 3, askedAt: NOW - LIVE_ASK_INTERVAL_MS, found: PR }), "settled", NOW)).toBe("ask");
  });

  it("свойство: в пределах минуты после вопроса GitHub не спрашивается никогда", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AwaitMark["kind"]>("publish", "merge"),
        fc.constantFrom(...notOpen),
        fc.integer({ min: 0, max: LIVE_ASK_INTERVAL_MS - 1 }),
        fc.boolean(),
        (kind, presence, ago, withFound) => {
          const m = mark({ kind, askedAt: NOW - ago, found: withFound ? PR : null });
          expect(decideLiveAsk(m, presence, NOW)).not.toBe("ask");
        },
      ),
    );
  });
});

describe("afterAnswer", () => {
  it("спросить не вышло → отметка остаётся, время вопроса сдвигается: сбой не превращается в опрос на каждом тике", () => {
    expect(afterAnswer(mark({ found: PR }), { asked: false }, NOW)).toEqual(mark({ found: PR, askedAt: NOW }));
  });

  it("публикация: PR нашёлся → запомнить его до того, как bb его увидит", () => {
    expect(afterAnswer(mark(), { asked: true, pr: PR }, NOW)).toEqual(mark({ askedAt: NOW, found: PR }));
  });

  it("публикация: PR ещё не виден и не был → ждать дальше", () => {
    expect(afterAnswer(mark(), { asked: true, pr: null }, NOW)).toEqual(mark({ askedAt: NOW }));
  });

  it("публикация: найденный раньше PR больше не открыт → снять отметку", () => {
    expect(afterAnswer(mark({ found: PR }), { asked: true, pr: null }, NOW)).toBeNull();
  });

  it("мёрдж: открытого PR больше нет → снять отметку", () => {
    expect(afterAnswer(mark({ kind: "merge", found: PR }), { asked: true, pr: null }, NOW)).toBeNull();
    expect(afterAnswer(mark({ kind: "merge" }), { asked: true, pr: null }, NOW)).toBeNull();
  });

  it("мёрдж: PR ещё открыт → ждать дальше", () => {
    expect(afterAnswer(mark({ kind: "merge" }), { asked: true, pr: PR }, NOW)).toEqual(mark({ kind: "merge", askedAt: NOW, found: PR }));
  });
});
