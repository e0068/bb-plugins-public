// @vitest-environment node
// Перестановка flow в списке: порядок коллекции — это и вид списка, и flow по умолчанию (первый).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { defaultFlow, moveFlow, newFlow } from "./flows";
import type { FlowSettings } from "../shared/contract";

const settingsOf = (ids: readonly string[]): FlowSettings => ({ version: 2, minButtonWidth: 170, flows: ids.map((id) => newFlow(id, id.toUpperCase())) });
const idsOf = (settings: FlowSettings): string[] => settings.flows.map((flow) => flow.id);
const idLists = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 8 });

describe("перестановка flow в списке", () => {
  it("flow встаёт на указанное место, остальные сохраняют порядок между собой, набор тот же", () => {
    fc.assert(
      fc.property(idLists, fc.nat(), fc.nat(), (ids, a, b) => {
        const from = a % ids.length;
        const to = b % ids.length;
        const moved = idsOf(moveFlow(settingsOf(ids), ids[from]!, to));
        expect([...moved].sort()).toEqual([...ids].sort());
        expect(moved[to]).toBe(ids[from]);
        expect(moved.filter((id) => id !== ids[from])).toEqual(ids.filter((id) => id !== ids[from]));
      }),
    );
  });

  it("flow, перенесённый на первое место, становится flow по умолчанию", () => {
    const moved = moveFlow(settingsOf(["a", "b", "c"]), "c", 0);
    expect(idsOf(moved)).toEqual(["c", "a", "b"]);
    expect(defaultFlow(moved).id).toBe("c");
  });

  it("поля настроек и самих flow при переносе не меняются", () => {
    const settings = settingsOf(["a", "b"]);
    const moved = moveFlow(settings, "a", 1);
    expect(moved.minButtonWidth).toBe(settings.minButtonWidth);
    expect(moved.flows.find((flow) => flow.id === "a")).toEqual(settings.flows[0]);
  });

  it("неизвестный id и место за пределами списка оставляют порядок как был", () => {
    const settings = settingsOf(["a", "b"]);
    expect(idsOf(moveFlow(settings, "zzz", 0))).toEqual(["a", "b"]);
    expect(idsOf(moveFlow(settings, "a", 5))).toEqual(["a", "b"]);
    expect(idsOf(moveFlow(settings, "a", -1))).toEqual(["a", "b"]);
  });
});
