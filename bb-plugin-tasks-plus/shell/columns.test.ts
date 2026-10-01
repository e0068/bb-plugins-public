import { describe, expect, it } from "vitest";

import { visibleColumns } from "./columns.js";

describe("visibleColumns", () => {
  it("keeps navigation beside the area on a wide screen, and drops it when it is hidden", () => {
    expect(visibleColumns({ compact: false, navOpen: true })).toBe("all");
    expect(visibleColumns({ compact: false, navOpen: false })).toBe("area");
  });

  it("gives a narrow screen one column: the area, and navigation only while it is open", () => {
    expect(visibleColumns({ compact: true, navOpen: false })).toBe("area");
    expect(visibleColumns({ compact: true, navOpen: true })).toBe("navigation");
  });
});
