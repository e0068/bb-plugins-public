import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatPermissionRule, parsePermissionRule } from "../src/rule-set";

describe("permission rule text", () => {
  it("parse then format gives back any text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const { tool, pattern } = parsePermissionRule(text);
        expect(formatPermissionRule(tool, pattern)).toBe(text);
      }),
    );
  });

  it("a pattern is written even when blank; only null is the bare tool", () => {
    expect(formatPermissionRule("Read", "  ")).toBe("Read(  )");
    expect(formatPermissionRule("Bash", "")).toBe("Bash()");
    expect(formatPermissionRule("WebSearch", null)).toBe("WebSearch");
  });
});
