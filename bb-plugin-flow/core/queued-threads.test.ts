// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { queuedThreadIds } from "./queued-threads";

const ids = (json: unknown): string[] => [...queuedThreadIds(json)].sort();

describe("треды с сообщением в очереди хоста", () => {
  it("тред с ждущим или упавшим сообщением в очереди; тред без очереди — нет", () => {
    const json = [
      { id: "a", queuedWork: "waiting" },
      { id: "b", queuedWork: "failed" },
      { id: "c", queuedWork: "none" },
    ];
    expect(ids(json)).toEqual(["a", "b"]);
  });

  it("лишние поля треда не мешают", () => {
    expect(ids([{ id: "a", queuedWork: "waiting", title: "Тред", archived: false }])).toEqual(["a"]);
  });

  it("неизвестное состояние очереди — не очередь", () => {
    expect(ids([{ id: "a", queuedWork: "sending" }, { id: "b", queuedWork: "" }])).toEqual([]);
  });

  it("запись без id, с чужим типом id или без queuedWork пропускается, остальные читаются", () => {
    const json = [
      { queuedWork: "waiting" },
      { id: 7, queuedWork: "waiting" },
      { id: "a" },
      { id: "b", queuedWork: 1 },
      null,
      "waiting",
      42,
      [],
      { id: "ok", queuedWork: "failed" },
    ];
    expect(ids(json)).toEqual(["ok"]);
  });

  it.each([null, undefined, "строка", 0, true, {}, { threads: [{ id: "a", queuedWork: "waiting" }] }])(
    "ответ не массив (%j) — пустое множество",
    (json) => {
      expect(queuedThreadIds(json).size).toBe(0);
    },
  );

  it("пустой массив — пустое множество", () => {
    expect(queuedThreadIds([]).size).toBe(0);
  });

  it("повторный тред входит один раз", () => {
    expect(ids([{ id: "a", queuedWork: "waiting" }, { id: "a", queuedWork: "failed" }])).toEqual(["a"]);
  });

  it("на любом входе не бросает и возвращает ровно id записей с ждущей или упавшей очередью", () => {
    const entry = fc.record({ id: fc.string(), queuedWork: fc.constantFrom("none", "waiting", "failed", "other") });
    fc.assert(
      fc.property(fc.array(entry), (list) => {
        const expected = new Set(list.filter((e) => e.queuedWork === "waiting" || e.queuedWork === "failed").map((e) => e.id));
        expect(queuedThreadIds(list)).toEqual(expected);
      }),
    );
    fc.assert(fc.property(fc.anything(), (anything) => queuedThreadIds(anything) instanceof Set));
  });
});
