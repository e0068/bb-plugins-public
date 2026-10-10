// @vitest-environment node
// «Без flow» — первый пункт выбора агента: описание владельца «когда flow не нужен» агент читает раньше flow. Тред, который
// агент оставил без flow, не закрыт для flow: каждый ход агент видит тот же список и выбирает сам, когда дошло до работы.
import { describe, expect, it } from "vitest";

import { flowSettingsSchema, type FlowSettings } from "../shared/contract";
import { describeNoFlow, newFlow, NO_FLOW } from "./flows";
import { CHOOSE_FLOW_AGAIN_RULE, CHOOSE_FLOW_RULE } from "./stages";

const settings: FlowSettings = {
  flows: [newFlow("default", "Default"), { ...newFlow("quick", "Quick"), description: "Мелкие правки" }],
  minButtonWidth: 200,
  noFlowDescription: "Вопросы и обсуждение без правок в файлах",
};

const blocksOf = (rule: string) => rule.split(/\n\n(?=### )/).slice(1);

describe("«Без flow» в правиле выбора flow", () => {
  it("первый блок — «Без flow» с id отказа и описанием владельца, за ним flow по порядку", () => {
    const blocks = blocksOf(CHOOSE_FLOW_RULE(settings, "choose_flow", NO_FLOW));
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain(`\`${NO_FLOW}\``);
    expect(blocks[0]).toContain("Вопросы и обсуждение без правок в файлах");
    expect(blocks[1]).toContain("`default`");
    expect(blocks[2]).toContain("Мелкие правки");
  });

  it("без описания владельца блок «Без flow» помечен как flow без описания, а отказ от flow всё равно назван", () => {
    const { noFlowDescription: _, ...bare } = settings;
    const rule = CHOOSE_FLOW_RULE(bare, "choose_flow", NO_FLOW);
    const [none] = blocksOf(rule);
    expect(none).toContain(`\`${NO_FLOW}\``);
    expect(none).toContain("No description.");
    expect(rule.split("\n\n")[0]).toMatch(/none of the flows fits, call `choose_flow` with `none`/);
  });
});

describe("тред, оставленный агентом без flow", () => {
  it("каждый ход агент видит «Без flow» первым и все flow с описаниями", () => {
    const rule = CHOOSE_FLOW_AGAIN_RULE(settings, "choose_flow");
    const blocks = blocksOf(rule);
    expect(rule).toContain("choose_flow");
    expect(blocks[0]).toContain("Вопросы и обсуждение без правок в файлах");
    expect(blocks.slice(1).map((block) => block.split("\n")[0])).toEqual(["### Default", "### Quick"]);
    expect(blocks[2]).toContain("Мелкие правки");
  });

  it("«Без flow» уже стоит: его id агенту не предложен", () => {
    const [none] = blocksOf(CHOOSE_FLOW_AGAIN_RULE(settings, "choose_flow"));
    expect(none).not.toContain(`\`${NO_FLOW}\``);
  });

  it("выбор flow не ставится в зависимость от просьбы владельца", () => {
    expect(CHOOSE_FLOW_AGAIN_RULE(settings, "choose_flow")).not.toMatch(/owner (asks|requests|wants)/i);
  });
});

describe("описание «Без flow» в настройках", () => {
  it("сохраняется без краевых пробелов, пустое снимает поле", () => {
    expect(describeNoFlow(settings, "  Только ответы  ").noFlowDescription).toBe("Только ответы");
    expect("noFlowDescription" in describeNoFlow(settings, "   ")).toBe(false);
  });

  it("принимается схемой настроек", () => {
    expect(flowSettingsSchema.parse(settings).noFlowDescription).toBe("Вопросы и обсуждение без правок в файлах");
  });
});
