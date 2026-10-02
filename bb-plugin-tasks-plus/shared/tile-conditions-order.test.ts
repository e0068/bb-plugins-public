import { describe, expect, it } from "vitest";

import { aTask } from "../test-support/analytics-tasks.js";
import { factsOf } from "./task-fields.js";
import { matchesConditions } from "./tile-conditions.js";

const facts = factsOf({});

describe("matchesConditions — what > and < mean, and where text is searched", () => {
  it("reads priority > as more urgent and < as less urgent", () => {
    const above = (priority: "urgent" | "high" | "medium" | "low" | "none") => matchesConditions(aTask(1, { priority }), [{ field: "priority", op: "gt", value: "medium" }], facts);
    const below = (priority: "urgent" | "high" | "medium" | "low" | "none") => matchesConditions(aTask(1, { priority }), [{ field: "priority", op: "lt", value: "medium" }], facts);
    expect((["urgent", "high", "medium", "low", "none"] as const).filter(above)).toEqual(["urgent", "high"]);
    expect((["urgent", "high", "medium", "low", "none"] as const).filter(below)).toEqual(["low", "none"]);
  });

  it("searches the whole description, not only its first paragraph", () => {
    const task = aTask(1, { description: "intro\n\nmail here" });
    expect(matchesConditions(task, [{ field: "description", op: "eq", value: "mail" }], facts)).toBe(true);
    expect(matchesConditions(task, [{ field: "description", op: "ne", value: "mail" }], facts)).toBe(false);
  });
});
