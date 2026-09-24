// @vitest-environment node
import { describe, expect, it } from "vitest";

import { acrossThreads, readWindowCost, readWindowMinutes, withDescendants, type PlanningSource, type ThreadTree } from "./planning";

// Опус: 40 000 токенов вывода — ровно доллар.
const line = (id: string, timestamp: string) =>
  JSON.stringify({ type: "assistant", timestamp, requestId: id, message: { id, model: "claude-opus-5", usage: { input_tokens: 0, output_tokens: 40_000 } } });

const FROM = Date.parse("2026-09-24T00:00:00.000Z");
const TO = Date.parse("2026-09-24T12:00:00.000Z");

/** Треды с сессиями и деревом родства; сессия треда — `sess-<тред>`. */
const world = (parents: Record<string, string>, archived: readonly string[] = []) => {
  const source: PlanningSource & ThreadTree = {
    threads: {
      get: async () => ({ createdAt: 0 }) as never,
      events: { list: (async ({ threadId }: { threadId: string }) => [{ type: "thread/identity", data: { providerThreadId: `sess-${threadId}` } }]) as never },
      list: async ({ parentThreadId, archived: wantArchived }) =>
        Object.entries(parents)
          .filter(([child, parent]) => parent === parentThreadId && archived.includes(child) === (wantArchived === true))
          .map(([id]) => ({ id })),
    },
  };
  return source;
};

const logs: Record<string, readonly string[]> = {
  "sess-thr_a": [line("a1", "2026-09-24T01:00:00.000Z")],
  "sess-thr_b": [line("b1", "2026-09-24T05:00:00.000Z")],
  "sess-thr_c": [line("c1", "2026-09-24T09:00:00.000Z")],
  "sess-thr_kid": [line("k1", "2026-09-24T06:00:00.000Z"), line("k2", "2026-09-24T06:30:00.000Z")],
  "sess-thr_grandkid": [line("g1", "2026-09-24T07:00:00.000Z")],
  "sess-thr_stranger": [line("s1", "2026-09-24T08:00:00.000Z")],
};
const read = async (session: string) => logs[session];

describe("треды прогона вместе с потомками", () => {
  it("к тредам прогона добавляются дети и внуки, каждый по разу", async () => {
    const source = world({ thr_kid: "thr_b", thr_grandkid: "thr_kid", thr_other: "thr_stranger" });
    expect((await withDescendants(source, ["thr_a", "thr_b", "thr_c"])).sort()).toEqual(["thr_a", "thr_b", "thr_c", "thr_grandkid", "thr_kid"]);
  });

  it("архивированный дочерний тред тоже в счёте: архив не отменяет потраченного", async () => {
    const source = world({ thr_kid: "thr_b" }, ["thr_kid"]);
    expect((await withDescendants(source, ["thr_b"])).sort()).toEqual(["thr_b", "thr_kid"]);
  });

  it("кольцо родства не зацикливает обход", async () => {
    const source = world({ thr_a: "thr_b", thr_b: "thr_a" });
    expect((await withDescendants(source, ["thr_a"])).sort()).toEqual(["thr_a", "thr_b"]);
  });
});

describe("окно этапа по всем тредам прогона", () => {
  it("доллары окна — сумма логов всех тредов прогона и их потомков, а не одного треда, закрывшего этап", async () => {
    const source = world({ thr_kid: "thr_b", thr_grandkid: "thr_kid" });
    const run = acrossThreads(source, async () => withDescendants(source, ["thr_a", "thr_b", "thr_c"]));
    expect(await readWindowCost(source, "thr_c", FROM, TO, read)).toBe(1);
    expect(await readWindowCost(run, "thr_c", FROM, TO, read)).toBe(6);
  });

  it("активные минуты окна берутся из логов всех тредов прогона", async () => {
    const source = world({ thr_kid: "thr_b" });
    const run = acrossThreads(source, async () => withDescendants(source, ["thr_a", "thr_b", "thr_c"]));
    expect(await readWindowMinutes(run, "thr_c", [{ from: FROM, to: TO }], read)).toEqual([5]);
  });

  it("чужой тред вне прогона в счёт не попадает", async () => {
    const source = world({});
    const run = acrossThreads(source, async () => ["thr_a", "thr_c"]);
    expect(await readWindowCost(run, "thr_c", FROM, TO, read)).toBe(2);
  });
});
