// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { WorkStage } from "../shared/contract";
import { dropStage } from "./sub-stages";

const stage = (id: string, parent?: string): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...(parent === undefined ? {} : { parent }) });
const ids = (stages: readonly WorkStage[] | null) => stages?.map((s) => (s.parent === undefined ? s.id : `${s.id}<${s.parent}`)) ?? null;

describe("внешний край связки — место наверху", () => {
  it("над первым под-этапом flow этап встаёт первым, а не в связку", () => {
    expect(ids(dropStage([stage("preview", "demo"), stage("demo"), stage("x")], "x", "preview", 1))).toEqual(["x", "preview<demo", "demo"]);
  });

  it("между двумя связками есть место наверху с обеих сторон стыка", () => {
    const stages = [stage("a"), stage("a1", "a"), stage("b0", "b"), stage("b"), stage("x")];
    expect(ids(dropStage(stages, "x", "a1", 4))).toEqual(["a", "a1<a", "x", "b0<b", "b"]);
    expect(ids(dropStage(stages, "x", "b0", 1))).toEqual(["a", "a1<a", "x", "b0<b", "b"]);
  });

  it("связку можно увести в конец flow, который кончается под-этапом", () => {
    const stages = [stage("x"), stage("x1", "x"), stage("a"), stage("a1", "a")];
    expect(ids(dropStage(stages, "x", "a1", 4))).toEqual(["a", "a1<a", "x", "x1<x"]);
  });

  it("внутренняя граница связки по-прежнему ведёт в связку", () => {
    const stages = [stage("a"), stage("a1", "a"), stage("a2", "a"), stage("x")];
    expect(ids(dropStage(stages, "x", "a2", 1))).toEqual(["a", "a1<a", "x<a", "a2<a"]);
  });
});
