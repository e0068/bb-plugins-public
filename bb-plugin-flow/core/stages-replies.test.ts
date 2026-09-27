// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FLOW_RULE, stageInstructions } from "./stages";
import { builtinStage } from "../lib/stage-constants";

describe("правила, которые реплика ответа больше не повторяет, живут в инструкциях агенту", () => {
  it("строка этапа Демонстрация: на комментарий ответить, поправить и прислать ту же демонстрацию снова, дальше не идти", () => {
    expect(stageInstructions([{ ...builtinStage("demo", []), name: "Демонстрация" }])).toMatch(/on a comment answer it, make the change if asked and send this demo again, not going further/);
  });

  it("ход с брифом в треде с flow — строка директивы и не больше одной фразы, без пересказа брифа", () => {
    expect(FLOW_RULE).toMatch(/Around a brief's directive line write at most one sentence — do not retell the brief\./);
  });
});
