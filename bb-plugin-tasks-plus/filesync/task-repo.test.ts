// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";
import { createHranaFake } from "../test-support/hrana-fake.js";
import { renderTaskFile } from "./task-file.js";

const repoPath = "./task-repo.js";
const dbRepoPath = "./db-repo.js";
const hranaPath = "../remote/hrana.js";
const { diskRepo } = await planned<typeof import("./task-repo.js")>(() => import(/* @vite-ignore */ repoPath));
const { createDbRepo } = await planned<typeof import("./db-repo.js")>(() => import(/* @vite-ignore */ dbRepoPath));
const { createHranaClient } = await planned<typeof import("../remote/hrana.js")>(() => import(/* @vite-ignore */ hranaPath));

type TaskRepo = import("./task-repo.js").TaskRepo;

const NO_PLACEMENT = { assignee: null, epic: null };
const content = (title: string, slug = "glow", key?: string) => renderTaskFile({ title, ...(key ? { key } : {}) }, slug, []);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function onDisk(): TaskRepo {
  const root = mkdtempSync(join(tmpdir(), "task-repo-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return diskRepo(root);
}

function inDatabase(): TaskRepo {
  const fake = createHranaFake();
  const { url } = fake.addDatabase("board-me.turso.io", "t1");
  const repo = createDbRepo(createHranaClient({ url, token: "t1", fetch: fake.fetch }), { url });
  cleanups.push(() => repo.stop());
  return repo;
}

/**
 * The port's contract: whatever holds the files — a folder or a database —
 * the store sees the same tree of task files through it.
 */
describe.each([
  ["a folder", onDisk],
  ["a database", inDatabase],
])("a board's task files in %s", (_, open) => {
  it("lists what was written, reads its text back, and reports it live", async () => {
    const repo = open();
    await repo.sync();
    const written = await repo.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow", "TSK-1") });
    const [file] = await repo.list();
    expect(file).toMatchObject({ status: "todo", slug: "glow", filePath: written.filePath, task: { title: "Glow", key: "TSK-1" } });
    expect(await repo.readText(written.filePath)).toBe(content("Glow", "glow", "TSK-1"));
    expect(repo.state()).toEqual({ kind: "live" });
  });

  it("moves a task to another status and leaves no copy behind", async () => {
    const repo = open();
    await repo.sync();
    const first = await repo.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow") });
    const moved = await repo.write({ status: "done", slug: "glow", placement: NO_PLACEMENT, content: content("Glow"), previousPath: first.filePath, revision: first.revision ?? undefined });
    const files = await repo.list();
    expect(files.map((file) => [file.status, file.slug])).toEqual([["done", "glow"]]);
    expect(moved.filePath).not.toBe(first.filePath);
  });

  it("puts a task under its assignee and reads the assignee back", async () => {
    const repo = open();
    await repo.sync();
    await repo.write({ status: "todo", slug: "glow", placement: { assignee: "Claude", epic: null }, content: content("Glow") });
    const [file] = await repo.list();
    expect(file).toMatchObject({ assignee: "Claude", epic: null, slug: "glow" });
  });

  it("renames a task: the new slug is listed, the old one is gone", async () => {
    const repo = open();
    await repo.sync();
    const first = await repo.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow") });
    await repo.write({ status: "todo", slug: "shine", placement: NO_PLACEMENT, content: content("Glow", "shine"), previousPath: first.filePath, revision: first.revision ?? undefined });
    expect((await repo.list()).map((file) => file.slug)).toEqual(["shine"]);
  });

  it("removes a task for good", async () => {
    const repo = open();
    await repo.sync();
    const written = await repo.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow") });
    await repo.remove(written.filePath, written.revision ?? undefined);
    expect(await repo.list()).toEqual([]);
  });
});

describe("the folder repository", () => {
  it("has no row versions: a write reports none", async () => {
    const repo = onDisk();
    const written = await repo.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow") });
    expect(written.revision).toBeNull();
    expect((await repo.list())[0]?.revision).toBeNull();
  });
});

describe("the database repository", () => {
  it("counts a version per row: each write moves it on", async () => {
    const repo = inDatabase();
    await repo.sync();
    const first = await repo.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow") });
    const second = await repo.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glowing"), previousPath: first.filePath, revision: first.revision ?? undefined });
    expect(typeof first.revision).toBe("number");
    expect(second.revision).toBe((first.revision ?? 0) + 1);
    expect((await repo.list())[0]).toMatchObject({ revision: second.revision, task: { title: "Glowing" } });
  });
});
