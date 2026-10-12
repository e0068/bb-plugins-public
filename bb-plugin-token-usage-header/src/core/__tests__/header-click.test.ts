import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_HEADER_CLICK, HEADER_CLICK_OPTIONS, parseHeaderClick } from "../gear-settings";

describe("parseHeaderClick", () => {
  it("defaults to the popover while the host is still loading settings", () => {
    expect(DEFAULT_HEADER_CLICK).toBe("popover");
    expect(parseHeaderClick(undefined)).toBe("popover");
    expect(parseHeaderClick({})).toBe("popover");
  });

  it("keeps every declared option", () => {
    for (const option of HEADER_CLICK_OPTIONS) expect(parseHeaderClick({ headerClick: option })).toBe(option);
  });

  it("falls back to the popover for any value outside the declared options", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.boolean()), (raw) => {
        fc.pre(!(HEADER_CLICK_OPTIONS as readonly unknown[]).includes(raw));
        expect(parseHeaderClick({ headerClick: raw })).toBe("popover");
      }),
    );
  });
});
