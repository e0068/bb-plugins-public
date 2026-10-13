// @vitest-environment node
import { describe, expect, it } from "vitest";

import { prototypeEditSchema, stageOutcomeSchema } from "./contract";

const demo = { stage: "demo", final: false, next: "Approval", done: ["Прототип"], pending: [], results: [{ label: "p", target: "https://x.getbb.app/p.html" }] };

describe("прототип в итоге Демонстрации", () => {
  it("адрес http(s) принят, файл, скрипт и пустой — нет", () => {
    expect(stageOutcomeSchema.safeParse({ ...demo, prototype: { url: "https://e0068--8766.getbb.app/p.html" } }).success).toBe(true);
    expect(stageOutcomeSchema.safeParse({ ...demo, prototype: { url: "http://localhost:8766/p.html", title: "Поле ответа" } }).success).toBe(true);
    for (const url of ["file:///tmp/p.html", "javascript:alert(1)", " ", "p.html"]) expect(stageOutcomeSchema.safeParse({ ...demo, prototype: { url } }).success).toBe(false);
  });

  it("правка виджета держит пределы: развилок не больше 20, комментариев не больше 50", () => {
    const fork = { id: "a", label: "A", options: [{ value: "x", label: "X" }] };
    expect(prototypeEditSchema.safeParse({ forks: [fork], choices: { a: "x" }, comments: [{ id: "c", text: "t" }] }).success).toBe(true);
    expect(prototypeEditSchema.safeParse({ forks: Array.from({ length: 21 }, () => fork), choices: {}, comments: [] }).success).toBe(false);
    expect(prototypeEditSchema.safeParse({ forks: [], choices: {}, comments: Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, text: "t" })) }).success).toBe(false);
  });
});
