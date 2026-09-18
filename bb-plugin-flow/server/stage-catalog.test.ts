// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readStageCatalog, type CatalogSources } from "./stage-catalog";

const sources = (patch: Partial<CatalogSources> = {}): CatalogSources => ({
  projectIds: async () => ["prj_1", "prj_2"],
  skills: async (projectId) =>
    projectId === "prj_1"
      ? [{ name: "task-flow", description: "Ведение задачи" }, { name: "spec", description: null }]
      : [{ name: "spec", description: "Спецификация" }, { name: "local", description: null }],
  listDir: async (dir) => (dir.endsWith("agents") ? ["reviewer.md", "notes.txt"] : ["dev2.js", "broken.js"]),
  readFile: async (path) =>
    path.endsWith("reviewer.md") ? "---\nname: reviewer\nmodel: opus\n---\n" : path.endsWith("dev2.js") ? 'export const meta = { name: "DEV2", description: "конвейер" }' : "мусор",
  home: "/home/owner",
  ...patch,
});

describe("каталог этапов", () => {
  it("навыки объединены по проектам по имени, агенты и workflow прочитаны из файлов владельца", async () => {
    const catalog = await readStageCatalog(sources());
    expect(catalog.skills.map((s) => s.name)).toEqual(["local", "spec", "task-flow"]);
    expect(catalog.skills.find((s) => s.name === "spec")?.description).toBe("Спецификация");
    expect(catalog.executors.map((e) => e.id)).toEqual(["agent:reviewer", "workflow:DEV2"]);
  });

  it("сбой источника — пустая часть каталога, а не ошибка", async () => {
    const fail = async () => {
      throw new Error("нет доступа");
    };
    const catalog = await readStageCatalog(sources({ projectIds: fail, listDir: fail }));
    expect(catalog).toEqual({ skills: [], executors: [] });
  });

  it("сбой одного проекта не прячет навыки остальных", async () => {
    const catalog = await readStageCatalog(sources({ skills: async (id) => { if (id === "prj_1") throw new Error("x"); return [{ name: "spec", description: null }]; } }));
    expect(catalog.skills.map((s) => s.name)).toEqual(["spec"]);
  });
});
