// @vitest-environment node
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { flowTurnInstructions } from "./ask-tool";

const SELF = /self means you do the stage's work in your own session: no subagents and no workflows/;

describe("исполнитель self для агента — без субагентов и workflow", () => {
  it("инструкции хода с этапами называют запрет и как заявить нужду в субагенте заранее", () => {
    const text = flowTurnInstructions([stage("practice", { name: "Execution" })]);
    expect(text).toMatch(SELF);
    expect(text).toMatch(/recommend that executor in setup\.stages/);
  });

  it("тред без этапов запрета не получает — говорить не о чем", () => {
    expect(flowTurnInstructions([])).not.toMatch(SELF);
  });
});
