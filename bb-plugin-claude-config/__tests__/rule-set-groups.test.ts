import { describe, expect, it } from "vitest";

import { ruleSetFor } from "../src/rule-set";

describe("ruleSetFor", () => {
  it("autoMode has allow, soft_deny, hard_deny and environment, and no mode", () => {
    const autoMode = ruleSetFor("autoMode")!;
    expect(autoMode.groups.map((group) => group.key)).toEqual(["allow", "soft_deny", "hard_deny", "environment"]);
    expect(autoMode.mode).toBeNull();
  });

  it("permissions has allow, ask and deny plus defaultMode", () => {
    const permissions = ruleSetFor("permissions")!;
    expect(permissions.groups.map((group) => group.key)).toEqual(["allow", "ask", "deny"]);
    expect(permissions.mode?.key).toBe("defaultMode");
  });
});
