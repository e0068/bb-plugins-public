// @vitest-environment node
// Иконка flow и счётчик вложений: flow хранит иконку из подборки этапов, а по строкам «Flow» видно, в каких flow он стоит.
import { describe, expect, it } from "vitest";

import { flowSettingsSchema, type Flow, type FlowSettings, type WorkStage } from "../shared/contract";
import * as flowsModule from "./flows";

/**
 * Функция ядра по имени из модуля: пока её нет, тест падает на ассерте с её именем, а не на импорте, и типы проекта сходятся.
 */
const exported = <F>(name: string): F => {
  const fn = (flowsModule as Record<string, unknown>)[name];
  expect(fn, `core/flows.ts экспортирует ${name}`).toBeTypeOf("function");
  return fn as F;
};
const flowHolders = (flows: readonly Flow[], id: string): Flow[] => exported<(flows: readonly Flow[], id: string) => Flow[]>("flowHolders")(flows, id);
const setFlowIcon = (settings: FlowSettings, id: string, icon: string | undefined): FlowSettings =>
  exported<(settings: FlowSettings, id: string, icon: string | undefined) => FlowSettings>("setFlowIcon")(settings, id, icon);

const skill = (id: string): WorkStage => ({ id, kind: "skill", skill: "code", name: id, executors: [] });
const ref = (id: string, flowId: string): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], flowId });
const flow = (id: string, stages: WorkStage[] = [skill("work")]): Flow => ({ id, name: id.toUpperCase(), stages });
/** Flow с иконкой: поле `icon` появляется в схеме этой подзадачей. */
const withIcon = (f: Flow, icon: string) => ({ ...f, icon }) as Flow;
const collection = (flows: Flow[]): FlowSettings => ({ version: 2, flows, minButtonWidth: 170 });
const ids = (flows: readonly Flow[]) => flows.map((f) => f.id);

describe("иконка flow в коллекции", () => {
  it("flow с иконкой проходит схему коллекции, flow без иконки — тоже", () => {
    const rocket = withIcon(flow("code"), "Rocket");
    const plain = flow("bug");
    expect(flowSettingsSchema.parse(collection([rocket, plain])).flows).toEqual([rocket, plain]);
  });
});

describe("в каких flow стоит flow", () => {
  const brief = flow("brief");
  const testing = flow("testing", [skill("a"), ref("to-brief", "brief")]);
  const testing2 = flow("testing-2", [ref("brief-row", "brief"), skill("b")]);

  it("flow, вложенный в два flow, называет оба по порядку коллекции", () => {
    expect(ids(flowHolders([testing2, brief, testing], "brief"))).toEqual(["testing-2", "testing"]);
    expect(ids(flowHolders([testing, testing2, brief], "brief"))).toEqual(["testing", "testing-2"]);
  });

  it("две строки одного flow в одном держателе считаются одним держателем", () => {
    const twice = flow("twice", [ref("first", "brief"), skill("between"), ref("second", "brief")]);
    expect(ids(flowHolders([twice, brief], "brief"))).toEqual(["twice"]);
  });

  it("flow без вложений не держит никто", () => {
    expect(flowHolders([testing, testing2, brief], "testing")).toEqual([]);
    expect(flowHolders([testing, testing2, brief], "missing")).toEqual([]);
  });

  it("flow не держит сам себя", () => {
    const self = flow("self", [ref("loop", "self"), ref("to-brief", "brief")]);
    expect(ids(flowHolders([self, brief], "self"))).toEqual([]);
    expect(ids(flowHolders([self, brief], "brief"))).toEqual(["self"]);
  });
});

describe("выбор иконки flow", () => {
  const settings = collection([flow("code"), flow("bug")]);

  it("иконка ставится выбранному flow и не трогает остальные", () => {
    const next = setFlowIcon(settings, "code", "Rocket");
    expect(next.flows).toEqual([withIcon(flow("code"), "Rocket"), flow("bug")]);
    expect(next.minButtonWidth).toBe(settings.minButtonWidth);
  });

  it("снятая иконка убирает поле целиком", () => {
    const cleared = setFlowIcon(setFlowIcon(settings, "code", "Rocket"), "code", undefined);
    expect(cleared.flows[0]).toStrictEqual(flow("code"));
    expect("icon" in cleared.flows[0]!).toBe(false);
  });
});
