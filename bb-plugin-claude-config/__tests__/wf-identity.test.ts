import { describe, expect, it } from "vitest";
import { isSameWorkflow, type WorkflowRef } from "../src/workflow/identity";

const ref = (over: Partial<WorkflowRef> = {}): WorkflowRef => ({
  store: "project",
  path: "/repo/.bb/workflows/review-changes.js",
  name: "review-changes",
  ...over,
});

describe("isSameWorkflow", () => {
  it("nothing open — no row is the open one", () => {
    expect(isSameWorkflow(null, ref())).toBe(false);
  });

  it("same store and path — the same file", () => {
    expect(isSameWorkflow(ref(), ref())).toBe(true);
  });

  it("same store and name, different checkout root — still the same workflow", () => {
    // wfList unions the project's checkouts and keeps the first one that has
    // the file, while wfSave always writes into the default checkout: one
    // workflow, two absolute paths.
    const listed = ref({ path: "/wt/feature/.bb/workflows/review-changes.js" });
    const saved = ref({ path: "/repo/.bb/workflows/review-changes.js" });
    expect(isSameWorkflow(saved, listed)).toBe(true);
  });

  it("different name in the same directory — different workflows", () => {
    const other = ref({
      path: "/repo/.bb/workflows/ship-it.js",
      name: "ship-it",
    });
    expect(isSameWorkflow(ref(), other)).toBe(false);
  });

  it("same name in the other store — different workflows", () => {
    const global = ref({
      store: "global",
      path: "/home/u/.claude/workflows/review-changes.js",
    });
    expect(isSameWorkflow(global, ref())).toBe(false);
  });

  it("is symmetric", () => {
    const listed = ref({ path: "/wt/feature/.bb/workflows/review-changes.js" });
    expect(isSameWorkflow(listed, ref())).toBe(
      isSameWorkflow(ref(), listed),
    );
  });

  it("is reflexive for any ref", () => {
    for (const candidate of [
      ref(),
      ref({ store: "global", name: "a", path: "/g/a.js" }),
      ref({ name: "", path: "" }),
    ]) {
      expect(isSameWorkflow(candidate, candidate)).toBe(true);
    }
  });
});
