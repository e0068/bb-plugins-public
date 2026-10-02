import { describe, expect, it } from "vitest";

import { visibleColumns, workflowColumns } from "../src/panel-columns";

describe("visibleColumns", () => {
  it("stands every column side by side on a wide screen, whatever is open", () => {
    expect(visibleColumns({ compact: false, hasSection: false, hasOpen: false })).toBe("all");
    expect(visibleColumns({ compact: false, hasSection: true, hasOpen: true })).toBe("all");
  });

  it("gives a narrow screen the innermost place open: document over list over sections", () => {
    expect(visibleColumns({ compact: true, hasSection: true, hasOpen: true })).toBe("document");
    expect(visibleColumns({ compact: true, hasSection: true, hasOpen: false })).toBe("list");
    expect(visibleColumns({ compact: true, hasSection: false, hasOpen: false })).toBe("sections");
  });

  it("gives the whole narrow screen to a file opened past the sections — a memory file", () => {
    expect(visibleColumns({ compact: true, hasSection: false, hasOpen: true })).toBe("document");
  });
});

describe("workflowColumns", () => {
  it("stands the builder's columns side by side on a wide screen", () => {
    expect(workflowColumns({ compact: false, hasOpen: false, hasDetail: false })).toBe("all");
    expect(workflowColumns({ compact: false, hasOpen: true, hasDetail: true })).toBe("all");
  });

  it("walks a narrow screen inwards: the list, the workflow, then what is picked inside it", () => {
    expect(workflowColumns({ compact: true, hasOpen: false, hasDetail: false })).toBe("list");
    expect(workflowColumns({ compact: true, hasOpen: true, hasDetail: false })).toBe("builder");
    expect(workflowColumns({ compact: true, hasOpen: true, hasDetail: true })).toBe("detail");
  });

  it("holds the list while nothing is open, whatever is selected inside nothing", () => {
    expect(workflowColumns({ compact: true, hasOpen: false, hasDetail: true })).toBe("list");
  });
});
