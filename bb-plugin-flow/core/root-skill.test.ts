// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CHOOSE_FLOW_TOOL } from "../lib/stage-constants";
import { NO_FLOW } from "./flows";
import type { Flow } from "../shared/contract";
import { rootSkillText } from "./root-skill";

const flows: Flow[] = [
  { id: "default", name: "Default", stages: [], description: "Большие задачи со спекой и планом" },
  { id: "quick", name: "Quick", stages: [] },
];

describe("корневой навык из flow владельца", () => {
  const text = rootSkillText(flows);

  it("это навык flow с описанием, когда его грузить", () => {
    expect(text.startsWith("---\nname: flow\ndescription: ")).toBe(true);
  });

  it("каждый flow — названием, id и описанием; без описания — пометка, что его нет", () => {
    expect(text).toContain("Default");
    expect(text).toContain("`default`");
    expect(text).toContain("Большие задачи со спекой и планом");
    expect(text).toContain("`quick`");
    expect(text).toMatch(/Quick[\s\S]*Описание не задано/);
  });

  it("ни один flow не подходит — тред можно оставить без flow тем же инструментом", () => {
    expect(text).toContain(`\`${NO_FLOW}\``);
    expect(text).not.toContain("бери первый flow");
  });

  it("называет инструмент, которым flow назначается треду", () => {
    expect(text).toContain(CHOOSE_FLOW_TOOL);
  });

  it("flow идут в порядке владельца, текст не зависит ни от чего, кроме flow", () => {
    expect(text.indexOf("`default`")).toBeLessThan(text.indexOf("`quick`"));
    expect(rootSkillText(flows)).toBe(text);
  });
});
