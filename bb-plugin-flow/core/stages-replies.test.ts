// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FLOW_RULE, stageInstructions } from "./stages";
import { builtinStage } from "../lib/stage-constants";

describe("правила, которые реплика ответа больше не повторяет, живут в инструкциях агенту", () => {
  it("строка этапа Демонстрация: комментарий с правкой возвращает работу на этап правки и проводит по следующим заново, комментарий без правки — та же демонстрация снова", () => {
    const line = stageInstructions([{ ...builtinStage("demo", []), name: "Демонстрация" }]);
    expect(line).toMatch(/if it asks for a change, mark the stage where the change is made started — Flow drops the done state of every stage after it — and go through those stages again in order/);
    expect(line).toMatch(/without a change, send this demo again, not going further/);
  });

  it("ход с брифом в треде с flow — строка директивы и не больше одной фразы, без пересказа брифа", () => {
    expect(FLOW_RULE).toMatch(/Around a brief's directive line write at most one sentence — do not retell the brief\./);
  });
});
