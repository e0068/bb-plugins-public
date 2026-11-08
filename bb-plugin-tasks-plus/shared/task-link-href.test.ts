import { describe, expect, it } from "vitest";

import { taskKeyOfHref } from "./inline-task-directive.js";

describe("taskKeyOfHref", () => {
  it("reads the task address from a bb://tasks link", () => {
    expect(taskKeyOfHref("bb://tasks/SSS-40")).toBe("SSS-40");
    expect(taskKeyOfHref("bb://tasks/scene-as-data-not-code")).toBe("scene-as-data-not-code");
  });

  it("takes the link as the engine hands it over: spaces around, angle brackets", () => {
    expect(taskKeyOfHref("  bb://tasks/BBPL-1057 ")).toBe("BBPL-1057");
    expect(taskKeyOfHref("<bb://tasks/BBPL-1057>")).toBe("BBPL-1057");
  });

  it("names no task for any other address or an empty one", () => {
    expect(taskKeyOfHref("https://example.com/tasks/A-1")).toBeNull();
    expect(taskKeyOfHref("docs/tasks/A-1.md")).toBeNull();
    expect(taskKeyOfHref("bb://tasks/")).toBeNull();
    expect(taskKeyOfHref("bb://tasks/A 1")).toBeNull();
    expect(taskKeyOfHref("bb://tasks/A-1/extra")).toBeNull();
  });
});
