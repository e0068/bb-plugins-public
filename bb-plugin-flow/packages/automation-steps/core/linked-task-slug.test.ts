import { describe, expect, it } from "vitest";

import { parseLinkedTasks } from "./bb-tasks-commands";

describe("слаг связанной задачи", () => {
  it("слаг берётся из id задачи — части после проекта", () => {
    const stdout = JSON.stringify({ tasks: [{ id: "01M1PAAE:flow-ssylki", key: "BBPL-12", title: "Flow — ссылки" }] });
    expect(parseLinkedTasks(stdout)).toEqual([{ key: "BBPL-12", title: "Flow — ссылки", slug: "flow-ssylki" }]);
  });

  it("id без проекта или без строки слага не даёт", () => {
    const stdout = JSON.stringify({ tasks: [{ id: "flow-ssylki", key: "BBPL-12" }, { id: 7, key: "BBPL-13" }] });
    expect(parseLinkedTasks(stdout)).toEqual([
      { key: "BBPL-12", title: "" },
      { key: "BBPL-13", title: "" },
    ]);
  });
});
