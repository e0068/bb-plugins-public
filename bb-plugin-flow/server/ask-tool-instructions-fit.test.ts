// @vitest-environment node
import { describe, expect, it } from "vitest";

import { LONG_FLOW } from "../core/long-flow-fixture";
import { stageInstructions } from "../core/stages";
import { STAGES } from "../core/stages-fixtures";
import { INSTRUCTIONS_LIMIT_CHARS } from "../lib/agent-limits";
import type { WorkStage } from "../shared/contract";
import { flowTurnInstructions } from "./ask-tool";

const longer = (count: number): WorkStage[] =>
  Array.from({ length: count }, (_, i) => ({ ...(LONG_FLOW[i % LONG_FLOW.length] as WorkStage), id: `${LONG_FLOW[i % LONG_FLOW.length]?.id}-${i}`, parent: undefined }));

describe("инструкции хода влезают в лимит bb и несут все этапы", () => {
  it("flow из семнадцати этапов — целиком, ни один этап не оборван", () => {
    const text = flowTurnInstructions(LONG_FLOW);
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_LIMIT_CHARS);
    for (const stage of LONG_FLOW) expect(text).toContain(`${stage.id} "${stage.name}"`);
  });

  it("flow из двадцати четырёх этапов — тоже целиком", () => {
    const stages = longer(24);
    const text = flowTurnInstructions(stages);
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_LIMIT_CHARS);
    for (const stage of stages) expect(text).toContain(`${stage.id} "${stage.name}"`);
  });

  it("в тесном виде у каждого этапа видно, что это за вид: демонстрация, утверждение, автоматизация", () => {
    const text = flowTurnInstructions(LONG_FLOW);
    expect(text).toMatch(/stage-iiiiiiiiiiii "Approval" — approval/);
    expect(text).toMatch(/\bdemo "Demonstration" — demo/);
    expect(text).toMatch(/flow-automation-2 "Finalize" — automation/);
  });

  it("короткий flow остаётся в подробном виде, как был", () => {
    expect(flowTurnInstructions(STAGES)).toContain(stageInstructions(STAGES) ?? "");
  });
});
