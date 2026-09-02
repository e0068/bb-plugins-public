import { describe, expect, it } from "vitest";
import { chooseToken } from "./token";

describe("chooseToken", () => {
  it("explicit setting takes priority over gh", () => {
    expect(chooseToken("from-setting", "from-gh")).toBe("from-setting");
  });

  it("no setting — falls back to gh", () => {
    expect(chooseToken(undefined, "from-gh")).toBe("from-gh");
    expect(chooseToken("", "from-gh")).toBe("from-gh");
    expect(chooseToken("   ", "from-gh")).toBe("from-gh");
  });

  it("trims whitespace and newline from gh", () => {
    expect(chooseToken(undefined, "tok\n")).toBe("tok");
  });

  it("neither is available — null", () => {
    expect(chooseToken(undefined, null)).toBeNull();
    expect(chooseToken("  ", "")).toBeNull();
  });
});
