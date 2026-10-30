// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FLOW_RULE, stageInstructions } from "./stages";
import { builtinStage } from "../lib/stage-constants";

describe("правила, которые реплика ответа больше не повторяет, живут в инструкциях агенту", () => {
  it("строка этапа Демонстрация: не ждать ответа; у неё нет поля комментария, а сообщение с правкой откатывает работу к этапу правки", () => {
    const line = stageInstructions([{ ...builtinStage("demo", []), name: "Демонстрация" }]);
    expect(line).toMatch(/go on to the next stage without waiting: sending closes the stage/);
    expect(line).toMatch(/a chat message may ask for a change — then roll back to the stage where the change is made \(flow_stage\)/);
    expect(line).not.toMatch(/\bstop\b/);
  });

  it("строка этапа Утверждение: единственная остановка; виджет без карточки, кнопка «Продолжить»", () => {
    const line = stageInstructions([{ ...builtinStage("approve", []), name: "Утверждение" }]);
    expect(line).toMatch(/the only stage that holds the work: stop/);
    expect(line).toMatch(/Continue without a comment — go on to the next stage/);
  });

  it("ход с брифом в треде с flow — строка директивы и не больше одной фразы, без пересказа брифа", () => {
    expect(FLOW_RULE).toMatch(/Around a brief's directive line write at most one sentence — do not retell the brief\./);
  });
});
