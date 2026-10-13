// Тред «Tasks+ — таблицы в базе проекта» записал в настройки проекта таблицу базы раньше, чем его код дошёл до main:
// живой Tasks+ отказывал «projects.7.database: Unrecognized key: "table"», и вместе с ним падали bb tasks и шаг Flow «Задача → done».
import { describe, expect, it } from "vitest";
import { projectSchema } from "./contract.js";

const project = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  name: "Cellular",
  prefix: "CEL",
  nextTaskNumber: 9,
  color: "steelblue",
  folderId: null,
  linkedBbProjectId: "proj_hpqtcwvtsv",
  tasksFolder: null,
  createdAt: "2026-10-11T00:00:00.000Z",
};

describe("база проекта с таблицей", () => {
  it("проект с таблицей, родителем и папкой зеркала в базе читается", () => {
    const database = { url: "https://www.notion.so/x", mirrorFolder: "docs/notion", table: "tbl_1", parent: "page_1" };
    expect(projectSchema.parse({ ...project, database }).database).toEqual(database);
  });

  it("неизвестный ключ базы по-прежнему не принимается", () => {
    expect(projectSchema.safeParse({ ...project, database: { url: "libsql://x", other: "y" } }).success).toBe(false);
  });
});
