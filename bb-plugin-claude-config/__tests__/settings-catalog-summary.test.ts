import { describe, expect, it } from "vitest";

import { findSettingDef, formValues, settingSummary, withFormValue } from "../src/settings-catalog";

const attribution = findSettingDef("attribution")!;
const statusLine = findSettingDef("statusLine")!;

describe("form fields: absent is not empty", () => {
  it("an absent field reads as undefined, an empty one as empty text", () => {
    expect(formValues(attribution, null)).toEqual({ commit: undefined, pr: undefined });
    expect(formValues(attribution, '{"commit":""}')).toEqual({ commit: "", pr: undefined });
    expect(formValues(statusLine, "[1]")).toEqual({ command: undefined, padding: undefined });
  });

  it("null drops one field and keeps the rest", () => {
    const next = withFormValue(attribution, '{"commit":"","pr":"P"}', "commit", null);
    expect(JSON.parse(next!)).toEqual({ pr: "P" });
    expect(withFormValue(attribution, '{"commit":""}', "commit", null)).toBeNull();
  });
});

describe("settingSummary", () => {
  it("permissions: mode and rule counts", () => {
    expect(settingSummary("permissions", '{"defaultMode":"plan","allow":["a","b"],"deny":["c"]}')).toBe(
      "plan · 2 allow · 0 ask · 1 deny",
    );
    expect(settingSummary("permissions", null)).toBe("default · 0 allow · 0 ask · 0 deny");
  });

  it("statusLine: the command, or not set", () => {
    expect(settingSummary("statusLine", '{"type":"command","command":"x.sh"}')).toBe("x.sh");
    expect(settingSummary("statusLine", null)).toBe("Not set");
  });

  it("attribution: custom or the default", () => {
    expect(settingSummary("attribution", '{"commit":""}')).toBe("Custom");
    expect(settingSummary("attribution", null)).toBe("Claude Code default");
  });

  it("autoMode goes through the auto mode summary", () => {
    expect(settingSummary("autoMode", null)).toMatch(/^Environment: defaults · \d+ built-in rules$/);
  });

  it("a value that isn't a JSON object is flagged", () => {
    expect(settingSummary("autoMode", "[1]")).toBe("Can't read as a form — JSON");
    expect(settingSummary("permissions", "{broken")).toBe("Can't read as a form — JSON");
  });
});
