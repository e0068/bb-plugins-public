// Whether a scroller stands at the foot of what it scrolls: bb's compact Home
// lets the fade over its composer go there, so the last row of the queue is
// seen as bright as the rest.
import { describe, expect, it } from "vitest";
import { scrolledToEnd } from "./scroll-end";

describe("scrolledToEnd", () => {
  it("holds for a scroller scrolled all the way down", () => {
    expect(scrolledToEnd({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
  });

  it("does not hold for a scroller with more below", () => {
    expect(scrolledToEnd({ scrollTop: 300, clientHeight: 400, scrollHeight: 1000 })).toBe(false);
  });

  it("holds for a scroller with nothing to scroll", () => {
    expect(scrolledToEnd({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toBe(true);
  });

  it("holds a pixel short of the foot, where a phone's fractional scroll stops", () => {
    expect(scrolledToEnd({ scrollTop: 599.5, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
    expect(scrolledToEnd({ scrollTop: 598, clientHeight: 400, scrollHeight: 1000 })).toBe(false);
  });

  it("holds past the foot, where a phone bounces", () => {
    expect(scrolledToEnd({ scrollTop: 640, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
  });
});
