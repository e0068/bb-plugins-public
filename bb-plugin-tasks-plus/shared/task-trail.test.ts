import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { backInTrail, openInTrail, previousInTrail, startTrail } from "./task-trail";

const key = fc.stringMatching(/^[A-Z]{2,4}-[1-9][0-9]{0,3}$/);

describe("a side panel's trail of tasks", () => {
  it("starts on its first task with nowhere to go back to", () => {
    fc.assert(
      fc.property(key, (first) => {
        const trail = startTrail(first);
        expect(trail.current).toBe(first);
        expect(previousInTrail(trail)).toBeNull();
        expect(backInTrail(trail)).toEqual(trail);
      }),
    );
  });

  it("goes back to exactly where it was before opening another task", () => {
    fc.assert(
      fc.property(fc.array(key, { minLength: 1, maxLength: 8 }), key, (path, next) => {
        const trail = path.slice(1).reduce(openInTrail, startTrail(path[0]!));
        fc.pre(next !== trail.current);
        const opened = openInTrail(trail, next);
        expect(opened.current).toBe(next);
        expect(previousInTrail(opened)).toBe(trail.current);
        expect(backInTrail(opened)).toEqual(trail);
      }),
    );
  });

  it("walks back through every task in reverse order", () => {
    const trail = ["TSK-1", "TSK-2", "TSK-3"].reduce(openInTrail, startTrail("TSK-0"));
    const walked = [trail.current];
    let step = trail;
    while (previousInTrail(step) !== null) {
      step = backInTrail(step);
      walked.push(step.current);
    }
    expect(walked).toEqual(["TSK-3", "TSK-2", "TSK-1", "TSK-0"]);
  });

  it("does not record reopening the task already shown", () => {
    fc.assert(
      fc.property(key, key, (first, second) => {
        const trail = openInTrail(startTrail(first), second);
        expect(openInTrail(trail, trail.current)).toEqual(trail);
      }),
    );
  });
});
