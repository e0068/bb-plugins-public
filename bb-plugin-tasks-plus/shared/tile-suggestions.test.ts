import { describe, expect, it } from "vitest";

import { aTask, PROJECT_A, PROJECT_B } from "../test-support/analytics-tasks.js";
import { SUGGESTIONS_MAX, suggestionsOf, type SuggestionScope } from "./tile-conditions.js";

const scope: SuggestionScope = {
  tasks: [
    aTask(1, { assignee: "claude", type: "epic", title: "Analytics" }),
    aTask(2, { assignee: "codex", parentTaskId: "01HZZZZZZZZZZZZZZZZZZZZT01", epicId: "01HZZZZZZZZZZZZZZZZZZZZT01" }),
    aTask(3, { assignee: "claude" }),
  ],
  projects: [
    { id: PROJECT_A, name: "Shader Lab" },
    { id: PROJECT_B, name: "bb-plugins" },
  ],
  labels: [{ name: "ui" }, { name: "backend" }, { name: "ui" }],
};

describe("suggestionsOf — values already on the boards, to pick instead of typing", () => {
  it("offers label and project names, each once", () => {
    expect(suggestionsOf("labels", scope, "").map((entry) => entry.value)).toEqual(["backend", "ui"]);
    expect(suggestionsOf("project", scope, "").map((entry) => entry.value)).toEqual(["bb-plugins", "Shader Lab"]);
  });

  it("offers the assignees in use, matching what is typed, case aside", () => {
    expect(suggestionsOf("assignee", scope, "CL").map((entry) => entry.value)).toEqual(["claude"]);
  });

  it("offers an epic or a parent by its key, named with its title", () => {
    expect(suggestionsOf("epic", scope, "")).toEqual([{ value: "TSK-1", label: "TSK-1 Analytics" }]);
    expect(suggestionsOf("parent", scope, "analytics")).toEqual([{ value: "TSK-1", label: "TSK-1 Analytics" }]);
  });

  it("offers nothing for a field typed freely, and no more than the cap", () => {
    expect(suggestionsOf("title", scope, "")).toEqual([]);
    expect(suggestionsOf("cost", scope, "")).toEqual([]);
    const many: SuggestionScope = { ...scope, labels: Array.from({ length: 30 }, (_, index) => ({ name: `l${index}` })) };
    expect(suggestionsOf("labels", many, "")).toHaveLength(SUGGESTIONS_MAX);
  });
});
