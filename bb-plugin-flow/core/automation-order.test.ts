import { describe, expect, it } from "vitest";

import { unopenedPrSteps } from "./automation-order";
import { stage } from "./stages-fixtures";
import type { WorkStage } from "../shared/contract";

const chain = (id: string, steps: string[]): WorkStage =>
  stage(id, { name: id, skill: "", automation: { source: "flow", steps: steps as never } });

const external = (id: string): WorkStage => stage(id, { name: id, skill: "", automation: { id: "auto-1", name: "Pull Request" } });

const WORKING = [
  stage("implement"),
  chain("flow-automation", ["git.commit", "git.fast-forward", "git.create-pr"]),
  stage("demo"),
  chain("flow-automation-2", ["files.bump-patch", "git.merge", "git.pull-main", "bb.tasks-done", "bb.archive"]),
];

describe("unopenedPrSteps", () => {
  it("рабочий flow: PR открывает первая цепочка, мёрджит вторая — помечать нечего", () => {
    expect(unopenedPrSteps(WORKING, "flow-automation-2")).toEqual([]);
    expect(unopenedPrSteps(WORKING, "flow-automation")).toEqual([]);
  });

  it("бамп раньше открытия PR в той же цепочке — помечен только он, шаги после открытия нет", () => {
    const stages = [chain("a", ["git.commit", "files.bump-patch", "git.create-pr", "git.merge"])];
    expect(unopenedPrSteps(stages, "a")).toEqual(["files.bump-patch"]);
  });

  it("мёрдж и бамп без открытия PR вовсе — помечены оба, в порядке цепочки", () => {
    expect(unopenedPrSteps([chain("a", ["files.bump-minor", "git.merge"])], "a")).toEqual(["files.bump-minor", "git.merge"]);
  });

  it("PR открыт этапом выше — шаги этапа не помечены", () => {
    expect(unopenedPrSteps([chain("open", ["git.create-pr"]), chain("merge", ["git.merge"])], "merge")).toEqual([]);
  });

  it("PR открывает этап ниже — этап выше помечен: к его шагам PR ещё нет", () => {
    expect(unopenedPrSteps([chain("merge", ["git.merge"]), chain("open", ["git.create-pr"])], "merge")).toEqual(["git.merge"]);
  });

  it("автоматизация Automations — чёрный ящик: после неё метки нет", () => {
    expect(unopenedPrSteps([external("ext"), chain("a", ["git.merge"])], "a")).toEqual([]);
  });

  it("этап, сам ставший автоматизацией Automations, не помечается: его шагов не видно", () => {
    expect(unopenedPrSteps([external("ext")], "ext")).toEqual([]);
  });

  it("скрипт шагом не мешает: он не открывает PR, но и сам не помечается", () => {
    expect(unopenedPrSteps([chain("a", ["script:s1", "git.create-pr", "files.bump-patch"])], "a")).toEqual([]);
  });

  it("неизвестный этап и этап без автоматизации — пусто", () => {
    expect(unopenedPrSteps(WORKING, "missing")).toEqual([]);
    expect(unopenedPrSteps(WORKING, "implement")).toEqual([]);
  });
});
