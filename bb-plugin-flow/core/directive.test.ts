// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DECISION_ID_PREFIX, directiveLine, readDecisionId } from "./directive";

/** Разбор атрибутов так, как его делает хост: `::name{key="value"}`. */
const attributesOf = (line: string): Record<string, string> =>
  Object.fromEntries([...line.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));

const idArb = fc
  .stringMatching(/^[A-Za-z0-9_-]{1,40}$/)
  .map((tail) => `${DECISION_ID_PREFIX}${tail}`);

describe("директива брифа", () => {
  it("строка директивы читается обратно в тот же идентификатор", () => {
    fc.assert(
      fc.property(idArb, (id) => {
        const line = directiveLine(id);
        expect(line.startsWith("::decision{")).toBe(true);
        expect(readDecisionId(attributesOf(line))).toEqual({ kind: "ok", id });
      }),
    );
  });

  it("пустой идентификатор недействителен", () => {
    expect(readDecisionId({ id: "" })).toEqual({ kind: "invalid" });
    expect(readDecisionId({ id: DECISION_ID_PREFIX })).toEqual({ kind: "invalid" });
  });

  it("идентификатор с пробелом недействителен", () => {
    fc.assert(
      fc.property(idArb, fc.constantFrom(" ", "\t", "\n"), (id, space) => {
        expect(readDecisionId({ id: `${id}${space}x` })).toEqual({ kind: "invalid" });
      }),
    );
  });

  it("идентификатор без префикса dec_ недействителен", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9_-]{1,40}$/).filter((s) => !s.startsWith(DECISION_ID_PREFIX)), (id) => {
        expect(readDecisionId({ id })).toEqual({ kind: "invalid" });
      }),
    );
  });

  it("отсутствующий атрибут id недействителен", () => {
    expect(readDecisionId({})).toEqual({ kind: "invalid" });
    expect(readDecisionId({ file: "dec_1" })).toEqual({ kind: "invalid" });
  });
});
