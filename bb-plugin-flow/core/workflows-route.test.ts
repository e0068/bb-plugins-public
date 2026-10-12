// @vitest-environment node
import { describe, expect, it } from "vitest";

import { workflowsPlace, workflowsSubPath, type WorkflowsPlace } from "./workflows-route";

describe("адрес раздела Workflows", () => {
  it("список, открытый workflow и новый — туда и обратно", () => {
    const places: WorkflowsPlace[] = [{ kind: "list" }, { kind: "open", name: "lead-waves" }, { kind: "new" }];
    for (const place of places) expect(workflowsPlace(workflowsSubPath(place))).toEqual(place);
  });

  it("адреса flow и истории — не раздел", () => {
    for (const subPath of ["", "history", "flow-abc", "workflowsx", "none"]) expect(workflowsPlace(subPath)).toBeNull();
  });

  it("пустой или вложенный хвост — список", () => {
    expect(workflowsPlace("workflows/")).toEqual({ kind: "list" });
    expect(workflowsPlace("workflows/a/b")).toEqual({ kind: "list" });
  });
});
