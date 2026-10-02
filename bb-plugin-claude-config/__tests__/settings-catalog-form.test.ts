import { describe, expect, it } from "vitest";

import {
  GENERIC_SETTINGS,
  SETTING_GROUPS,
  decodeSettingText,
  encodeSettingValue,
  findSettingDef,
  formValues,
  withFormValue,
} from "../src/settings-catalog";

const def = (key: string) => findSettingDef(key)!;

describe("groups", () => {
  it("every key belongs to a declared group, and every group has a key", () => {
    const groups = SETTING_GROUPS.map((group) => group.key);
    for (const entry of GENERIC_SETTINGS) expect(groups).toContain(entry.group);
    for (const group of groups) expect(GENERIC_SETTINGS.some((entry) => entry.group === group)).toBe(true);
  });
});

describe("dropdowns with a custom value", () => {
  it("model, output style, theme and login method are enums that accept own text", () => {
    for (const key of ["model", "outputStyle", "theme", "forceLoginMethod"]) {
      expect(def(key).kind).toBe("enum");
      expect(def(key).allowCustom).toBe(true);
      expect(def(key).enumOptions!.length).toBeGreaterThan(1);
    }
  });

  it("an own value outside the options reads and writes back as itself", () => {
    expect(encodeSettingValue(def("model"), "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(decodeSettingText(def("theme"), "custom:mine")).toEqual({ ok: true, value: "custom:mine" });
  });

  it("blank text is not a value", () => {
    expect(decodeSettingText(def("model"), " ").ok).toBe(false);
  });

  it("an enum without allowCustom still rejects text outside its options", () => {
    const strict = { key: "k", label: "K", kind: "enum" as const, description: "", group: "look" as const, enumOptions: [{ value: "a", label: "A" }] };
    expect(decodeSettingText(strict, "b").ok).toBe(false);
    expect(encodeSettingValue(strict, "b")).toBe("inherit");
  });
});

describe("detail keys", () => {
  it("permissions, autoMode, statusLine and attribution open in the document column", () => {
    const detail = GENERIC_SETTINGS.filter((entry) => entry.detail).map((entry) => entry.key).sort();
    expect(detail).toEqual(["attribution", "autoMode", "permissions", "statusLine"]);
  });

  it("statusLine and attribution carry form fields", () => {
    expect(def("statusLine").fields!.map((field) => field.key)).toEqual(["command", "padding"]);
    expect(def("attribution").fields!.map((field) => field.key)).toEqual(["commit", "pr"]);
  });
});

describe("formValues / withFormValue", () => {
  const statusLine = def("statusLine");


  it("writes one field, keeps unknown keys and the fixed ones", () => {
    const next = withFormValue(statusLine, '{"type":"command","command":"x.sh","extra":true}', "padding", "3");
    expect(JSON.parse(next!)).toEqual({ type: "command", command: "x.sh", extra: true, padding: 3 });
  });

  it("starts from the fixed keys when unset, and clearing the last field unsets the key", () => {
    const set = withFormValue(statusLine, null, "command", "s.sh");
    expect(JSON.parse(set!)).toEqual({ type: "command", command: "s.sh" });
    expect(withFormValue(statusLine, set, "command", "")).toBeNull();
  });

  it("a number field ignores text that isn't a number", () => {
    const next = withFormValue(statusLine, '{"type":"command","command":"x"}', "padding", "abc");
    expect(JSON.parse(next!)).toEqual({ type: "command", command: "x" });
  });

  it("attribution keeps an empty string: it means no attribution", () => {
    const attribution = def("attribution");
    const next = withFormValue(attribution, '{"commit":"A","pr":"B"}', "pr", "");
    expect(JSON.parse(next!)).toEqual({ commit: "A", pr: "" });
  });
});

describe("findSettingDef", () => {
  it("looks a key up by name", () => {
    expect(findSettingDef("model")?.key).toBe("model");
    expect(findSettingDef("no-such-key")).toBeUndefined();
  });
});

describe("string kind", () => {
  it("accepts any text, including empty", () => {
    const text = { key: "k", label: "K", kind: "string" as const, description: "", group: "look" as const };
    expect(decodeSettingText(text, "claude-sonnet-5")).toEqual({ ok: true, value: "claude-sonnet-5" });
    expect(decodeSettingText(text, "")).toEqual({ ok: true, value: "" });
  });
});
