// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DEFAULT_HISTORY_SORT, HISTORY_COLUMNS, historyOrder, nextHistorySort, sortHistory, type HistoryColumn, type HistorySort } from "./run-history";

const MIN = Date.parse("2026-01-01T00:00:00.000Z");
const MAX = Date.parse("2027-01-01T00:00:00.000Z");
const iso = fc.integer({ min: MIN, max: MAX }).map((ms) => new Date(ms).toISOString());

const entry = fc
  .record({
    briefId: fc.string({ minLength: 1, maxLength: 6 }),
    title: fc.constantFrom<string>("Альфа", "бета", "Гамма", "delta", ""),
    flowName: fc.option(fc.constantFrom<string>("General", "Bug", "Code"), { nil: undefined }),
    project: fc.option(fc.constantFrom<string>("bb-plugins", "Cellular", "kasimov"), { nil: null }),
    startedAt: iso,
    finishedAt: iso,
    minutes: fc.integer({ min: 0, max: 600 }),
    cost: fc.integer({ min: 0, max: 5000 }).map((cents) => cents / 100),
  })
  .map(({ briefId, title, flowName, project, ...summary }) => ({ briefId, title, project, ...(flowName === undefined ? {} : { flowName }), summary }));

type Entry = typeof entry extends fc.Arbitrary<infer T> ? T : never;

const entries = fc.array(entry, { maxLength: 20 });
const column = fc.constantFrom(...HISTORY_COLUMNS);
const sort = fc.record({ column, direction: fc.constantFrom("asc" as const, "desc" as const) });
const titleOf = (e: { title: string }) => e.title;

/** Значение колонки так, как его видит владелец в строке. */
const cell = (e: Entry, c: HistoryColumn): string | number =>
  c === "title" ? e.title : c === "flow" ? (e.flowName ?? "") : c === "project" ? (e.project ?? "") : c === "started" ? Date.parse(e.summary.startedAt) : c === "finished" ? Date.parse(e.summary.finishedAt) : e.summary[c];

const compare = (a: string | number, b: string | number): number => (typeof a === "string" ? a.localeCompare(b as string) : a - (b as number));
const byBrief = (a: Entry, b: Entry) => a.briefId.localeCompare(b.briefId) || a.summary.finishedAt.localeCompare(b.summary.finishedAt);

describe("сортировка истории по колонке", () => {
  it("по умолчанию — тот же порядок, что отдаёт сервер: свежие по окончанию сверху", () => {
    expect(DEFAULT_HISTORY_SORT).toEqual({ column: "finished", direction: "desc" });
    fc.assert(
      fc.property(entries, (list) => {
        expect(sortHistory(list, DEFAULT_HISTORY_SORT, titleOf)).toEqual(historyOrder(list));
      }),
    );
  });

  it("выход — перестановка входа, вход не мутируется", () => {
    fc.assert(
      fc.property(entries, sort, (list, s) => {
        const copy = [...list];
        const out = sortHistory(list, s, titleOf);
        expect([...out].sort(byBrief)).toEqual([...list].sort(byBrief));
        expect(list).toEqual(copy);
      }),
    );
  });

  it("соседние строки упорядочены по колонке в выбранную сторону, равные — свежие сверху", () => {
    fc.assert(
      fc.property(entries, sort, (list, s) => {
        const out = sortHistory(list, s, titleOf);
        out.slice(1).forEach((next, i) => {
          const prev = out[i]!;
          const order = compare(cell(prev, s.column), cell(next, s.column)) * (s.direction === "asc" ? 1 : -1);
          expect(order <= 0).toBe(true);
          if (order === 0) expect(historyOrder([next, prev])[0]).toBe(prev);
        });
      }),
    );
  });

  it("название берётся тем, что видит владелец, а не полем записи", () => {
    const a = { briefId: "a", title: null, summary: { startedAt: "2026-09-01T10:00:00.000Z", finishedAt: "2026-09-01T11:00:00.000Z", minutes: 1, cost: 1 } };
    const b = { ...a, briefId: "b", title: "Альфа" };
    const shown = (e: typeof a | typeof b) => e.title ?? "Тред удалён";
    expect(sortHistory([a, b], { column: "title", direction: "asc" }, shown).map((e) => e.briefId)).toEqual(["b", "a"]);
  });

  it("числа сравниваются как числа, а не как строки", () => {
    const base = { briefId: "a", title: "", summary: { startedAt: "2026-09-01T10:00:00.000Z", finishedAt: "2026-09-01T11:00:00.000Z", minutes: 9, cost: 9 } };
    const big = { ...base, briefId: "b", summary: { ...base.summary, minutes: 100, cost: 23 } };
    expect(sortHistory([base, big], { column: "minutes", direction: "desc" }, titleOf).map((e) => e.briefId)).toEqual(["b", "a"]);
    expect(sortHistory([base, big], { column: "cost", direction: "asc" }, titleOf).map((e) => e.briefId)).toEqual(["a", "b"]);
  });
});

describe("клик по заголовку колонки", () => {
  it("по той же колонке — разворачивает порядок, второй клик возвращает прежний", () => {
    fc.assert(
      fc.property(sort, (s: HistorySort) => {
        const once = nextHistorySort(s, s.column);
        expect(once).toEqual({ column: s.column, direction: s.direction === "asc" ? "desc" : "asc" });
        expect(nextHistorySort(once, s.column)).toEqual(s);
      }),
    );
  });

  it("по другой колонке: текст — от А, время и числа — от большего", () => {
    const from = (c: HistoryColumn): HistorySort => nextHistorySort({ column: c === "title" ? "flow" : "title", direction: "asc" }, c);
    expect(from("title")).toEqual({ column: "title", direction: "asc" });
    expect(from("flow")).toEqual({ column: "flow", direction: "asc" });
    expect(from("started")).toEqual({ column: "started", direction: "desc" });
    expect(from("finished")).toEqual({ column: "finished", direction: "desc" });
    expect(from("minutes")).toEqual({ column: "minutes", direction: "desc" });
    expect(from("cost")).toEqual({ column: "cost", direction: "desc" });
  });

  it("колонки идут в порядке шапки, проект — сразу после треда, этапов среди них нет", () => {
    expect(HISTORY_COLUMNS).toEqual(["title", "project", "flow", "started", "finished", "minutes", "cost"]);
  });

  it("проект — текстовая колонка: первый клик сортирует от А", () => {
    expect(nextHistorySort(DEFAULT_HISTORY_SORT, "project")).toEqual({ column: "project", direction: "asc" });
  });

  it("строки без проекта при сортировке от А идут первыми", () => {
    const base = { briefId: "a", title: "", project: "bb-plugins", summary: { startedAt: "2026-09-01T10:00:00.000Z", finishedAt: "2026-09-01T11:00:00.000Z", minutes: 1, cost: 1 } };
    const gone = { ...base, briefId: "b", project: null };
    expect(sortHistory([base, gone], { column: "project", direction: "asc" }, titleOf).map((e) => e.briefId)).toEqual(["b", "a"]);
  });
});
