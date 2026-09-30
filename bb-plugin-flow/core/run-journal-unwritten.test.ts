import { describe, expect, it } from "vitest";

import { runJournal } from "./run-journal";

const WINDOW = { startedAt: "2026-09-30T06:00:00.000Z", finishedAt: "2026-09-30T14:00:00.000Z" };

describe("ответ, чей файл журнала не записан", () => {
  it("в журнал прогона не входит, но имя занимает — следующий с тем же названием получает суффикс", () => {
    const entries = [
      { briefId: "b1", title: "Демо", answeredAt: "2026-09-30T07:00:00.000Z", path: null },
      { briefId: "b2", title: "Демо", answeredAt: "2026-09-30T08:00:00.000Z" },
    ];
    expect(runJournal(entries, WINDOW, "docs/flows")).toEqual(["docs/flows/demo-2.md"]);
  });
});
