import { describe, expect, it } from "vitest";
import { deriveUniquePrefix } from "./prefix.js";

describe("deriveUniquePrefix", () => {
  it("suggests initials for multi-word names and letters otherwise", () => {
    expect(deriveUniquePrefix("Tasks Plugin", new Set())).toBe("TP");
    expect(deriveUniquePrefix("Connect", new Set())).toBe("CON");
    expect(deriveUniquePrefix("home-lab v2", new Set())).toBe("HLV");
  });

  it("drops leading digits and falls back for all-digit names", () => {
    expect(deriveUniquePrefix("2fa Rollout", new Set())).toBe("R");
    expect(deriveUniquePrefix("123", new Set())).toBe("PRJ");
  });

  it("caps at 10 characters", () => {
    expect(
      deriveUniquePrefix("a b c d e f g h i j k l", new Set()),
    ).toHaveLength(10);
  });

  it("appends a numeric suffix on collision", () => {
    expect(deriveUniquePrefix("Connect", new Set(["CON"]))).toBe("CON2");
    expect(
      deriveUniquePrefix("Connect", new Set(["CON", "CON2"])),
    ).toBe("CON3");
  });

  it("keeps the suffixed candidate within 10 characters", () => {
    const long = "a b c d e f g h i j k l"; // -> "ABCDEFGHIJ" (10 chars)
    const base = deriveUniquePrefix(long, new Set());
    const withCollision = deriveUniquePrefix(long, new Set([base]));
    expect(withCollision).toBe("ABCDEFGHI2");
    expect(withCollision).toHaveLength(10);
  });
});
