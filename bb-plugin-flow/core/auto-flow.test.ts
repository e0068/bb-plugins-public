// @vitest-environment node
// «Автоматически» — выбор композера, при котором flow треду выбирает агент: он не flow и не «без flow»,
// а правило выбора несёт список flow владельца прямо в инструкциях хода.
import { describe, expect, it } from "vitest";

import { flowDraftSchema, type FlowDraft } from "../shared/contract";
import { resolveFlowDraft } from "./flow-draft";
import { AUTO_FLOW, flowOrNone, newFlow, NO_FLOW } from "./flows";
import { CHOOSE_FLOW_RULE } from "./stages";

const two = { flows: [newFlow("default", "Default"), { ...newFlow("quick", "Quick"), description: "Мелкие правки" }], minButtonWidth: 200 };

describe("выбор «Автоматически»", () => {
  it("пока агент не выбрал, у треда нет flow — ни выбранного, ни по умолчанию", () => {
    expect(flowOrNone(two, AUTO_FLOW)).toBeNull();
    expect(AUTO_FLOW).not.toBe(NO_FLOW);
    expect(two.flows.map((flow) => flow.id)).not.toContain(AUTO_FLOW);
  });

  it("id «Автоматически» занят выбором композера и flow не достаётся", () => {
    const draft: FlowDraft = flowDraftSchema.parse({ id: AUTO_FLOW, name: "Auto", stages: [{ kind: "questions" }] });
    const result = resolveFlowDraft(draft, { skills: [], executors: [] }, () => "abc");
    expect(result.ok).toBe(false);
  });

  it("правило выбора перечисляет id, названия и описания всех flow и называет отказ от flow", () => {
    const rule = CHOOSE_FLOW_RULE(two, "choose_flow", NO_FLOW);
    expect(rule).toContain("choose_flow");
    expect(rule).toContain("`quick`");
    expect(rule).toContain("Quick");
    expect(rule).toContain("Мелкие правки");
    expect(rule).toContain(`\`${two.flows[0]!.id}\``);
    expect(rule).toContain(`\`${NO_FLOW}\``);
  });
});

describe("правило выбора с многострочными описаниями", () => {
  it("у каждого flow свой блок: разделы описания не сливаются со следующим flow", () => {
    const bug = { ...newFlow("bug", "Bug"), description: "Когда брать — баг.\n\nЭтапы:\n- reproduce — воспроизвести\n- fix — tdd" };
    const code = { ...newFlow("code", "Code"), description: "Когда брать — фича." };
    const rule = CHOOSE_FLOW_RULE({ flows: [bug, code] }, "choose_flow", NO_FLOW);
    const blocks = rule.split(/\n\n(?=### )/).slice(2);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("`bug`");
    expect(blocks[0]).toContain("- fix — tdd");
    expect(blocks[0]).not.toContain("`code`");
    expect(blocks[1]).toContain("`code`");
    expect(blocks[1]).toContain("Когда брать — фича.");
  });
});
