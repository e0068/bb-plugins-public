// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { createTursoFake, type TursoFake } from "../test-support/turso-fake.js";
import type { ProjectRow, ProjectRowBoard } from "./contract.js";

let hrana: HranaFake;
let turso: TursoFake;
const disposers: (() => Promise<void>)[] = [];
const dirs: string[] = [];

beforeEach(() => {
  hrana = createHranaFake();
  turso = createTursoFake(hrana);
  vi.stubGlobal("fetch", turso.fetch);
});
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

type BbProject = { id: string; name: string; sources: { isDefault: boolean; path: string; hostId: string; type: string }[] };

/** bb with the given projects, whose names a test may change between calls, and Tasks+ running on it. */
async function machine(names: Record<string, string>) {
  const projects: BbProject[] = Object.entries(names).map(([id, name]) => {
    const checkout = mkdtempSync(join(tmpdir(), "project-rows-"));
    dirs.push(checkout);
    return { id, name, sources: [{ isDefault: true, path: checkout, hostId: "host_1", type: "local_path" }] };
  });
  const personal: BbProject = { id: "proj_personal", name: "Personal", sources: [] };
  const listed = () => [...projects, personal];
  const { bb, harness } = createFakePluginHost({
    pluginId: "tasks",
    settings: { tursoApiToken: turso.accountToken },
    sdk: {
      hosts: { list: async () => [{ id: "host_1", name: "Mac mini" }] },
      projects: {
        get: async ({ projectId }: { projectId: string }) => {
          const found = listed().find((project) => project.id === projectId);
          if (found === undefined) throw new Error("no bb project");
          return found;
        },
        list: async () => listed(),
      },
    } as never,
  });
  await plugin(bb);
  disposers.push(() => harness.dispose());
  const call = <T = unknown>(method: string, input: unknown = null) => harness.callRpc(method, input) as Promise<T>;
  const rows = () => call<{ projects: ProjectRow[]; orphans: ProjectRowBoard[] }>("listProjectRows");
  const checkoutOf = (id: string) => projects.find((project) => project.id === id)!.sources[0]!.path;
  const rename = (id: string, name: string) => void (projects.find((project) => project.id === id)!.name = name);
  const drop = (id: string) => void projects.splice(projects.findIndex((project) => project.id === id), 1);
  return { call, rows, checkoutOf, rename, drop };
}

const rowOf = (rows: ProjectRow[], bbProjectId: string) => rows.find((row) => row.bbProject.id === bbProjectId);

describe("Projects tab: rows from bb's projects", () => {
  it("lists every bb project, the personal one included, each without a board at first", async () => {
    const host = await machine({ proj_plugins: "bb-plugins", proj_cellular: "Cellular" });
    const { projects, orphans } = await host.rows();
    expect(projects.map((row) => [row.bbProject.name, row.board])).toEqual([
      ["bb-plugins", null],
      ["Cellular", null],
      ["Personal", null],
    ]);
    expect(rowOf(projects, "proj_personal")?.bbProject.repoPath).toBeNull();
    expect(orphans).toEqual([]);
  });

  it("shows a folder connected from a row in that row, with its prefix, task count and folder", async () => {
    const host = await machine({ proj_plugins: "bb-plugins" });
    expect(await host.call("addSyncedFolder", { bbProjectId: "proj_plugins", tasksFolder: "docs/tasks" })).toMatchObject({ ok: true });
    const board = rowOf((await host.rows()).projects, "proj_plugins")?.board;
    expect(board).toMatchObject({ name: "bb-plugins", taskCount: 0, tasksFolder: "docs/tasks", source: { kind: "folder" } });
    expect(board?.prefix).toMatch(/^[A-Z][A-Z0-9]*$/);
  });

  it("takes the board's name from its bb project once the project is renamed in bb", async () => {
    const host = await machine({ proj_plugins: "bb-plugins" });
    await host.call("addSyncedFolder", { bbProjectId: "proj_plugins", tasksFolder: "docs/tasks" });
    host.rename("proj_plugins", "BB Plugins");
    expect(rowOf((await host.rows()).projects, "proj_plugins")?.board?.name).toBe("BB Plugins");
    const { projects } = await host.call<{ projects: { name: string }[] }>("listProjects", {});
    expect(projects.map((project) => project.name)).toEqual(["BB Plugins"]);
  });

  it("moves a board whose bb project is gone to the orphans, under the last name it had", async () => {
    const host = await machine({ proj_plugins: "bb-plugins", proj_old: "Old project" });
    await host.call("addSyncedFolder", { bbProjectId: "proj_old", tasksFolder: "docs/tasks" });
    await host.rows();
    host.drop("proj_old");
    const { projects, orphans } = await host.rows();
    expect(rowOf(projects, "proj_old")).toBeUndefined();
    expect(orphans.map((orphan) => orphan.name)).toEqual(["Old project"]);
  });
});

describe("Projects tab: a database connected from a row", () => {
  it("belongs to the row's bb project and wears its name", async () => {
    const host = await machine({ proj_plugins: "bb-plugins" });
    const created = await host.call<{ ok: boolean; url: string }>("createDatabase", { prefix: "BBPL" });
    expect(await host.call("connectDatabase", { url: created.url, prefix: "BBPL", name: "Typed name", bbProjectId: "proj_plugins" })).toEqual({ ok: true });
    const board = rowOf((await host.rows()).projects, "proj_plugins")?.board;
    expect(board).toMatchObject({ name: "bb-plugins", prefix: "BBPL", source: { kind: "database", url: created.url } });
  });

  it("takes the row from the project's folder board it copies, keeping that board's prefix, and the folder board becomes an orphan with its files", async () => {
    const host = await machine({ proj_plugins: "bb-plugins" });
    const added = await host.call<{ ok: true; folder: { projectId: string; projectPrefix: string } }>("addSyncedFolder", { bbProjectId: "proj_plugins", tasksFolder: "docs/tasks" });
    await host.call("createTask", { projectId: added.folder.projectId, title: "Glow", status: "todo" });
    const created = await host.call<{ url: string }>("createDatabase", { prefix: added.folder.projectPrefix });
    expect(await host.call("connectDatabase", { url: created.url, copyFromBoardId: added.folder.projectId, bbProjectId: "proj_plugins" })).toEqual({ ok: true });
    const { projects, orphans } = await host.rows();
    expect(rowOf(projects, "proj_plugins")?.board).toMatchObject({ prefix: added.folder.projectPrefix, taskCount: 1, source: { kind: "database" } });
    expect(orphans.map((orphan) => orphan.id)).toEqual([added.folder.projectId]);
    expect(existsSync(join(host.checkoutOf("proj_plugins"), "docs/tasks"))).toBe(true);
  });
});

describe("Projects tab: deleting an orphan board", () => {
  it("takes a folder board off Tasks+ entirely and leaves its task files", async () => {
    const host = await machine({ proj_plugins: "bb-plugins", proj_old: "Old project" });
    const added = await host.call<{ ok: true; folder: { projectId: string } }>("addSyncedFolder", { bbProjectId: "proj_old", tasksFolder: "docs/tasks" });
    await host.call("createTask", { projectId: added.folder.projectId, title: "Glow", status: "todo" });
    const checkout = host.checkoutOf("proj_old");
    host.drop("proj_old");
    expect(await host.call("removeSyncedFolder", { projectId: added.folder.projectId })).toEqual({ ok: true });
    const { projects } = await host.call<{ projects: { id: string }[] }>("listProjects", {});
    expect(projects.map((project) => project.id)).not.toContain(added.folder.projectId);
    expect((await host.rows()).orphans).toEqual([]);
    expect(existsSync(join(checkout, "docs/tasks"))).toBe(true);
  });
});

describe("Projects tab: a linked board without a folder or a database", () => {
  it("is an orphan, and a database connected from the row takes the project from it", async () => {
    const host = await machine({ proj_plugins: "bb-plugins" });
    const { project: empty } = await host.call<{ project: { id: string } }>("createProject", { name: "bb-plugins", prefix: "OLD", color: "steelblue", linkedBbProjectId: "proj_plugins" });
    const before = await host.rows();
    expect(rowOf(before.projects, "proj_plugins")?.board).toBeNull();
    expect(before.orphans.map((orphan) => orphan.id)).toEqual([empty.id]);
    const created = await host.call<{ url: string }>("createDatabase", { prefix: "BBPL" });
    expect(await host.call("connectDatabase", { url: created.url, prefix: "BBPL", bbProjectId: "proj_plugins" })).toEqual({ ok: true });
    const after = await host.rows();
    expect(rowOf(after.projects, "proj_plugins")?.board).toMatchObject({ prefix: "BBPL", source: { kind: "database" } });
    expect(after.orphans.map((orphan) => orphan.id)).toEqual([empty.id]);
  });
});
