// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { historyOrder } from "./run-history";

const MIN = Date.parse("2026-01-01T00:00:00.000Z");
const MAX = Date.parse("2027-01-01T00:00:00.000Z");

const entry = fc.record({
  briefId: fc.string({ minLength: 1, maxLength: 6 }),
  finishedAt: fc.integer({ min: MIN, max: MAX }).map((ms) => new Date(ms).toISOString()),
}).map(({ briefId, finishedAt }) => ({ briefId, summary: { finishedAt } }));

const entries = fc.array(entry, { maxLength: 20 });

describe("порядок строк истории", () => {
  it("свежий прогон — выше", () => {
    const old = { briefId: "dec_a", summary: { finishedAt: "2026-09-01T10:00:00.000Z" } };
    const fresh = { briefId: "dec_b", summary: { finishedAt: "2026-09-20T10:00:00.000Z" } };
    expect(historyOrder([old, fresh])).toEqual([fresh, old]);
  });

  it("выход — перестановка входа", () => {
    fc.assert(
      fc.property(entries, (list) => {
        const out = historyOrder(list);
        expect([...out].sort((a, b) => a.briefId.localeCompare(b.briefId) || a.summary.finishedAt.localeCompare(b.summary.finishedAt))).toEqual(
          [...list].sort((a, b) => a.briefId.localeCompare(b.briefId) || a.summary.finishedAt.localeCompare(b.summary.finishedAt)),
        );
      }),
    );
  });

  it("соседние строки упорядочены: конец прогона убывает, при равенстве — бриф по возрастанию", () => {
    fc.assert(
      fc.property(entries, (list) => {
        const out = historyOrder(list);
        out.slice(1).forEach((next, i) => {
          const prev = out[i]!;
          const byTime = Date.parse(prev.summary.finishedAt) - Date.parse(next.summary.finishedAt);
          expect(byTime > 0 || (byTime === 0 && prev.briefId <= next.briefId)).toBe(true);
        });
      }),
    );
  });

  it("повторный порядок ничего не меняет, вход не мутируется", () => {
    fc.assert(
      fc.property(entries, (list) => {
        const copy = [...list];
        const once = historyOrder(list);
        expect(historyOrder(once)).toEqual(once);
        expect(list).toEqual(copy);
      }),
    );
  });
});
