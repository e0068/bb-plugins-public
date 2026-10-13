// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { boardByPrefix, tasksHost, type TasksHost } from "../test-support/tasks-host.js";
import { parseFields, sectionFields } from "../shared/section-fields.js";

let hrana: HranaFake;
const hosts: TasksHost[] = [];

beforeEach(() => {
  hrana = createHranaFake();
  vi.stubGlobal("fetch", hrana.fetch);
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  vi.unstubAllGlobals();
});

type Created = { ok: true; boardId: string } | { ok: false; message: string };
type Field = { name: string; type: string; options?: string[]; icon?: string; optionIcons?: Record<string, string> };
type Project = { id: string; database?: { fields?: Field[] } | null };

/** A section Docs with a Select «stage» of Idea and Done, on a board kept in a database. */
async function docsSection() {
  hrana.addDatabase("team-me.turso.io", "owner-token");
  const host = await tasksHost({ machine: "Mac mini" });
  hosts.push(host);
  await host.call("connectDatabase", { url: "libsql://team-me.turso.io", token: "owner-token", name: "Team", prefix: "TSK" });
  const board = (await boardByPrefix(host, "TSK"))!;
  const docs = await host.call<Created>("createTable", { boardId: board.id, name: "Docs" });
  const docsId = docs.ok ? docs.boardId : "";
  await host.call("addSectionField", { boardId: docsId, name: "stage", type: "select" });
  await host.call("changeFieldOption", { boardId: docsId, field: "stage", option: "Idea", change: "add" });
  await host.call("changeFieldOption", { boardId: docsId, field: "stage", option: "Done", change: "add" });
  const fields = async () =>
    (await host.call<{ projects: Project[] }>("listProjects", {})).projects.find((project) => project.id === docsId)?.database?.fields ?? [];
  return { host, docsId, fields };
}

describe("icons of a section's fields and of a Select's options", () => {
  it("are kept in the section's database and taken off with null", async () => {
    const { host, docsId, fields } = await docsSection();

    expect(await host.call("setFieldIcon", { boardId: docsId, field: "stage", icon: "filled:Flag01" })).toEqual({ ok: true });
    expect(await host.call("setFieldIcon", { boardId: docsId, field: "stage", option: "Done", icon: "✅" })).toEqual({ ok: true });
    expect(await host.call("setFieldIcon", { boardId: docsId, field: "stage", option: "Idea", icon: "💡" })).toEqual({ ok: true });
    expect(await fields()).toEqual([{ name: "stage", type: "select", options: ["Idea", "Done"], icon: "filled:Flag01", optionIcons: { Done: "✅", Idea: "💡" } }]);

    await host.call("setFieldIcon", { boardId: docsId, field: "stage", icon: null });
    await host.call("setFieldIcon", { boardId: docsId, field: "stage", option: "Idea", icon: null });
    expect(await fields()).toEqual([{ name: "stage", type: "select", options: ["Idea", "Done"], optionIcons: { Done: "✅" } }]);
  });

  it("give a default field an icon by listing it", async () => {
    const { host, docsId, fields } = await docsSection();

    expect(await host.call("setFieldIcon", { boardId: docsId, field: "date", icon: "📅" })).toEqual({ ok: true });

    expect((await fields()).find((field) => field.name === "date")).toEqual({ name: "date", type: "date", icon: "📅" });
  });

  it("give a record's own key a column icon by declaring it a text field", async () => {
    const { host, docsId, fields } = await docsSection();

    expect(await host.call("setFieldIcon", { boardId: docsId, field: "owner", icon: "👤" })).toEqual({ ok: true });

    expect((await fields()).find((field) => field.name === "owner")).toEqual({ name: "owner", type: "text", icon: "👤" });
  });

  it("are refused for an option the field lacks and for what is no icon", async () => {
    const { host, docsId } = await docsSection();

    expect(await host.call("setFieldIcon", { boardId: docsId, field: "stage", option: "Later", icon: "✅" })).toMatchObject({ ok: false });
    await expect(host.call("setFieldIcon", { boardId: docsId, field: "stage", icon: "NoSuchIcon" })).rejects.toThrow();
  });
});

describe("a section's fields", () => {
  it("show the icons a default field was declared with, keeping the default's type", () => {
    expect(
      sectionFields([{ name: "date", type: "text", icon: "Flag01" }, { name: "tags", type: "tags", options: ["a"], icon: "Tags", optionIcons: { a: "🔥" } }], []),
    ).toEqual([
      { name: "tags", type: "tags", options: ["a"], icon: "Tags", optionIcons: { a: "🔥" } },
      { name: "date", type: "date", icon: "Flag01" },
    ]);
  });
});

describe("a stored field list", () => {
  it("keeps the icons that read as icons, for options it has", () => {
    expect(parseFields([{ name: "stage", type: "select", options: ["Idea"], icon: "nope", optionIcons: { Idea: "💡", Gone: "✅", Bad: 7 } }])).toEqual([
      { name: "stage", type: "select", options: ["Idea"], optionIcons: { Idea: "💡" } },
    ]);
    expect(parseFields([{ name: "size", type: "number", icon: "Calculator" }])).toEqual([{ name: "size", type: "number", icon: "Calculator" }]);
  });
});
