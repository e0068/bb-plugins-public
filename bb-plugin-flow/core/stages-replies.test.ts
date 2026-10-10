// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FLOW_RULE, stageInstructions } from "./stages";
import { builtinStage } from "../lib/stage-constants";

describe("правила, которые реплика ответа больше не повторяет, живут в инструкциях агенту", () => {
  it("строка этапа Демонстрация: комментарий с правкой откатывает работу к этапу правки, комментарий без правки — та же демонстрация снова", () => {
    const line = stageInstructions([{ ...builtinStage("demo", []), name: "Демонстрация" }]);
    expect(line).toMatch(/if it asks for a change, roll back to the stage where the change is made \(flow_stage\)/);
    expect(line).toMatch(/without a change, send this demo again, not going further/);
  });

  it("ход с брифом в треде с flow — строка директивы и не больше одной фразы, без пересказа брифа", () => {
    expect(FLOW_RULE).toMatch(/Around a brief's directive line write at most one sentence — do not retell the brief\./);
  });
});
