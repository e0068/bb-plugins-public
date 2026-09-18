// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { DEFAULT_STAGES } from "./flows";
import { stageInstructions } from "./stages";

const lines = (text: string | null): string[] => (text ?? "").split("\n");

describe("инструкции встроенного этапа называют его навык", () => {
  it("встроенный этап без своего навыка называет навык вида и поле брифа, в котором он отвечает", () => {
    const [, questions, criteria, select, demo] = lines(stageInstructions([builtinStage("questions", []), builtinStage("criteria", []), builtinStage("select", []), builtinStage("demo", [])]));
    expect(questions).toMatch(/^1\. questions "Questions" — skill flow-questions\b.*ask_decision/);
    expect(criteria).toMatch(/^2\. criteria "Criteria" — skill flow-criteria\b.*setup\.criteria/);
    expect(select).toMatch(/^3\. select "Stage selection" — skill flow-stage-selection\b.*setup\.stages/);
    expect(demo).toMatch(/^4\. demo "Demonstration" — skill flow-demo\b.*outcome\.stage — this id/);
  });

  it("свой навык владельца на встроенном этапе называется вместо навыка вида", () => {
    const [, demo] = lines(stageInstructions([{ ...builtinStage("demo", []), skill: "my-demo" }]));
    expect(demo).toMatch(/— skill my-demo\b/);
    expect(demo).not.toMatch(/flow-demo/);
  });

  it("работа этапа живёт в навыке: текста Демонстрации в инструкциях больше нет", () => {
    const text = stageInstructions(DEFAULT_STAGES) ?? "";
    expect(text).not.toMatch(/bb connect expose|documentsOnly|previous demo/);
  });

  it("встроенный этап по-прежнему исполняет сам агент и сдаёт без ссылок", () => {
    for (const line of lines(stageInstructions([builtinStage("questions", []), builtinStage("demo", [])])).slice(1)) expect(line).toMatch(/you execute it yourself, a done stage needs no results$/);
  });
});

describe("инструкции смешанного flow", () => {
  it("номера идут через этапы навыков, повторный вид называет свой id и навык, Review by User нет", () => {
    const text = stageInstructions([builtinStage("questions", []), builtinStage("select", []), { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] }, builtinStage("demo", []), builtinStage("select", ["select"])]);
    const [, , , spec, , again] = lines(text);
    expect(spec).toMatch(/^3\. spec "Spec" — skill spec;/);
    expect(again).toMatch(/^5\. select-2 "Stage selection" — skill flow-stage-selection\b/);
    expect(text).not.toMatch(/Review by User/);
  });
});
