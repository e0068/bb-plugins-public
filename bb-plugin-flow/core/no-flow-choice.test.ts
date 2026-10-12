// @vitest-environment node
// «Без flow» — первый пункт выбора flow: описание владельца «когда flow не нужен» модель читает раньше flow.
import { describe, expect, it } from "vitest";

import { flowSettingsSchema, type FlowSettings } from "../shared/contract";
import { describeNoFlow, newFlow, NO_FLOW } from "./flows";
import { choicePrompt } from "./auto-choice";

const settings: FlowSettings = {
  flows: [newFlow("default", "Default"), { ...newFlow("quick", "Quick"), description: "Мелкие правки" }],
  minButtonWidth: 200,
  noFlowDescription: "Вопросы и обсуждение без правок в файлах",
};

const blocksOf = (rule: string) => rule.split(/\n\n(?=##+ )/).filter((block) => block.startsWith("### "));

describe("«Без flow» во входе модели", () => {
  it("первый блок — «Без flow» с id отказа и описанием владельца, за ним flow по порядку", () => {
    const blocks = blocksOf(choicePrompt("RULES", settings, "Почини кнопку"));
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain(`\`${NO_FLOW}\``);
    expect(blocks[0]).toContain("Вопросы и обсуждение без правок в файлах");
    expect(blocks[1]).toContain("`default`");
    expect(blocks[2]).toContain("Мелкие правки");
  });

  it("без описания владельца блок «Без flow» помечен как flow без описания, а отказ от flow всё равно назван", () => {
    const { noFlowDescription: _, ...bare } = settings;
    const [none] = blocksOf(choicePrompt("RULES", bare, "Почини кнопку"));
    expect(none).toContain(`\`${NO_FLOW}\``);
    expect(none).toContain("No description.");
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
