// @vitest-environment node
import { describe, expect, it } from "vitest";

import { transcriptCost } from "./planning";

describe("пустой расход", () => {
  it("ответ с пустым usage не считается ответом с расходом, как в Token Usage", () => {
    expect(transcriptCost([JSON.stringify({ type: "assistant", requestId: "r", message: { id: "m", model: "claude-opus-5", usage: {} } })])).toBeUndefined();
  });
});
