// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DEFAULT_STAGES } from "./flows";
import { FLOW_RULE, stageInstructions } from "./stages";

describe("инструкции flow по умолчанию", () => {
  const text = stageInstructions(DEFAULT_STAGES) ?? "";

  it("вклад flow по умолчанию в инструкции треда укладывается в 4096 символов", () => {
    const rule = "x".repeat(300);
    expect([rule, FLOW_RULE, text].join("\n\n").length).toBeLessThanOrEqual(4096);
  });
});
