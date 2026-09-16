import { describe, expect, it } from "vitest";

import {
  GENERIC_SETTINGS,
  decodeSettingText,
  encodeSettingValue,
  findSettingDef,
} from "../src/settings-catalog";

describe("GENERIC_SETTINGS", () => {
  it("every key is unique", () => {
    const keys = GENERIC_SETTINGS.map((def) => def.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("doesn't repeat a key already owned by another section", () => {
    const owned = [
      "enabledPlugins",
      "skillOverrides",
      "hooks",
      "enabledMcpjsonServers",
      "disabledMcpjsonServers",
      "enableAllProjectMcpServers",
      "env",
    ];
    for (const key of owned) {
      expect(GENERIC_SETTINGS.some((def) => def.key === key)).toBe(false);
    }
  });

  it("findSettingDef looks a key up by name", () => {
    expect(findSettingDef("model")?.kind).toBe("string");
    expect(findSettingDef("no-such-key")).toBeUndefined();
  });
});

describe("encodeSettingValue", () => {
  it("boolean: renders true/false as display text", () => {
    const def = findSettingDef("alwaysThinkingEnabled")!;
    expect(encodeSettingValue(def, true)).toBe("true");
    expect(encodeSettingValue(def, false)).toBe("false");
  });

  it("boolean: a value of the wrong shape is treated as unset", () => {
    const def = findSettingDef("alwaysThinkingEnabled")!;
    expect(encodeSettingValue(def, "yes")).toBe("inherit");
    expect(encodeSettingValue(def, undefined)).toBe("inherit");
  });

  it("number: renders as decimal text", () => {
    const def = findSettingDef("cleanupPeriodDays")!;
    expect(encodeSettingValue(def, 30)).toBe("30");
    expect(encodeSettingValue(def, 0)).toBe("0");
  });

  it("number: a non-number value is treated as unset", () => {
    const def = findSettingDef("cleanupPeriodDays")!;
    expect(encodeSettingValue(def, "30")).toBe("inherit");
  });

  it("string: renders as-is, including an empty string", () => {
    const def = findSettingDef("model")!;
    expect(encodeSettingValue(def, "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(encodeSettingValue(def, "")).toBe("");
  });

  it("string: a non-string value is treated as unset", () => {
    const def = findSettingDef("model")!;
    expect(encodeSettingValue(def, 5)).toBe("inherit");
  });

  it("json: pretty-prints any JSON-compatible value", () => {
    const def = findSettingDef("permissions")!;
    expect(encodeSettingValue(def, { allow: ["Bash(git:*)"] })).toBe(
      '{\n  "allow": [\n    "Bash(git:*)"\n  ]\n}',
    );
  });

  it("json: undefined is treated as unset", () => {
    const def = findSettingDef("permissions")!;
    expect(encodeSettingValue(def, undefined)).toBe("inherit");
  });
});

describe("decodeSettingText", () => {
  it("boolean: accepts exactly true/false", () => {
    const def = findSettingDef("alwaysThinkingEnabled")!;
    expect(decodeSettingText(def, "true")).toEqual({ ok: true, value: true });
    expect(decodeSettingText(def, "false")).toEqual({ ok: true, value: false });
    expect(decodeSettingText(def, "yes").ok).toBe(false);
  });

  it("number: accepts finite decimal text", () => {
    const def = findSettingDef("cleanupPeriodDays")!;
    expect(decodeSettingText(def, "30")).toEqual({ ok: true, value: 30 });
    expect(decodeSettingText(def, "0")).toEqual({ ok: true, value: 0 });
  });

  it("number: rejects text that isn't a finite number", () => {
    const def = findSettingDef("cleanupPeriodDays")!;
    expect(decodeSettingText(def, "abc").ok).toBe(false);
    expect(decodeSettingText(def, "").ok).toBe(false);
    expect(decodeSettingText(def, "NaN").ok).toBe(false);
  });

  it("string: accepts any text, including empty", () => {
    const def = findSettingDef("model")!;
    expect(decodeSettingText(def, "claude-sonnet-5")).toEqual({
      ok: true,
      value: "claude-sonnet-5",
    });
    expect(decodeSettingText(def, "")).toEqual({ ok: true, value: "" });
  });

  it("json: parses valid JSON", () => {
    const def = findSettingDef("statusLine")!;
    expect(decodeSettingText(def, '{"type":"command","command":"x"}')).toEqual(
      { ok: true, value: { type: "command", command: "x" } },
    );
  });

  it("json: rejects invalid JSON with a message, doesn't throw", () => {
    const def = findSettingDef("statusLine")!;
    const result = decodeSettingText(def, "{ oops");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/json/i);
  });

  it("round-trips through encode/decode for every kind in the catalog", () => {
    const samples: Record<string, unknown> = {
      boolean: true,
      number: 5,
      string: "x",
      enum: "x",
      json: { a: 1 },
    };
    for (const def of GENERIC_SETTINGS) {
      const value = samples[def.kind];
      const text = encodeSettingValue(def, value);
      expect(decodeSettingText(def, text)).toEqual({ ok: true, value });
    }
  });
});
