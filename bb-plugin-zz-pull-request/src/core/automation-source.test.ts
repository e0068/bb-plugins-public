import { describe, expect, it } from "vitest";
import { republishSourceOf } from "./automation";

describe("republishSourceOf", () => {
  it("reads the state trigger the server named", () => {
    expect(republishSourceOf({ source: "state.env" })).toBe("state.env");
    expect(republishSourceOf({ source: "state.thread-pr" })).toBe("state.thread-pr");
  });

  it("treats anything else — an older server, a refresh, junk — as a refresh every shown button obeys", () => {
    for (const payload of [{}, null, undefined, "x", { source: "state.poll" }, { source: "refresh" }]) {
      expect(republishSourceOf(payload)).toBe("refresh");
    }
  });
});
