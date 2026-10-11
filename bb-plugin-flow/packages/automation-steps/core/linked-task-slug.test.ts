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

describe("задача из двух источников доски", () => {
  it("одна задача под одним ключом — одна, а числа, записанные в любой из копий, у неё есть", () => {
    const stdout = JSON.stringify({
      tasks: [
        { id: "main:threads-overview", key: "BBPL-756", title: "T", actualMinutes: null },
        { id: "db:threads-overview", key: "BBPL-756", title: "T", actualMinutes: 44 },
        { id: "main:other", key: "BBPL-757", title: "O" },
      ],
    });
    expect(parseLinkedTasks(stdout)).toEqual([
      { key: "BBPL-756", title: "T", slug: "threads-overview", spentRecorded: true },
      { key: "BBPL-757", title: "O", slug: "other" },
    ]);
  });
});
