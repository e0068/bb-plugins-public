import { describe, expect, it } from "vitest";
import { queuedWorkOf } from "./queued";

describe("queuedWorkOf", () => {
  it.each(["none", "waiting", "failed"] as const)("reads %s as it is", (state) => {
    expect(queuedWorkOf(state)).toBe(state);
  });

  it.each([undefined, null, "", "sending", "WAITING", 0, true, {}, ["waiting"]])(
    "takes %j, which the host's types do not promise, for none",
    (raw) => {
      expect(queuedWorkOf(raw)).toBe("none");
    },
  );
});
