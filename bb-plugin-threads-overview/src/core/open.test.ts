import { describe, expect, it } from "vitest";
import { sidePaneSteps } from "./open";

describe("sidePaneSteps", () => {
  it("splits off a side panel when nothing was opened in one yet", () => {
    expect(sidePaneSteps("th_b", null)).toEqual([{ threadId: "th_b", split: true }]);
  });

  it("focuses the side panel of the previous thread, then swaps the new thread into it", () => {
    expect(sidePaneSteps("th_b", { threadId: "th_a", open: true })).toEqual([
      { threadId: "th_a", split: true },
      { threadId: "th_b", split: false },
    ]);
  });

  it("splits off a new side panel once the previous one was closed", () => {
    expect(sidePaneSteps("th_b", { threadId: "th_a", open: false })).toEqual([
      { threadId: "th_b", split: true },
    ]);
  });

  it("only focuses the panel when the thread asked for is the one already in it", () => {
    expect(sidePaneSteps("th_a", { threadId: "th_a", open: true })).toEqual([
      { threadId: "th_a", split: true },
    ]);
  });
});
