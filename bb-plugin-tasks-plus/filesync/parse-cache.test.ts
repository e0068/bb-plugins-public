import { mkdtempSync, mkdirSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createParseCache } from "./parse-cache.js";
import { readTaskFiles } from "./fs-repo.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tasks-parse-cache-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A parse that counts its runs and hands back a fresh object each time. */
function countingParse() {
  const calls: string[] = [];
  return {
    calls,
    parse: (content: string) => {
      calls.push(content);
      return { content };
    },
  };
}

describe("createParseCache", () => {
  it("parses an unchanged file once and hands back the same result", async () => {
    const path = join(root, "a.md");
    writeFileSync(path, "one");
    const cache = createParseCache();
    const { calls, parse } = countingParse();

    const first = await cache.read(path, parse);
    const second = await cache.read(path, parse);

    expect(first).toEqual({ content: "one" });
    expect(second).toBe(first);
    expect(calls).toEqual(["one"]);
  });

  it("parses the file again once it changed on disk", async () => {
    const path = join(root, "a.md");
    writeFileSync(path, "one");
    const cache = createParseCache();
    const { parse } = countingParse();
    await cache.read(path, parse);

    writeFileSync(path, "two");
    utimesSync(path, new Date(), new Date(Date.now() + 5_000));

    expect(await cache.read(path, parse)).toEqual({ content: "two" });
  });

  it("gives null for a file the disk will not hand over", async () => {
    const cache = createParseCache();
    expect(await cache.read(join(root, "missing.md"), countingParse().parse)).toBeNull();
  });

  it("forgets files under a folder that its last walk did not see", async () => {
    const kept = join(root, "kept.md");
    const dropped = join(root, "dropped.md");
    writeFileSync(kept, "k");
    writeFileSync(dropped, "d");
    const cache = createParseCache();
    const { calls, parse } = countingParse();
    await cache.read(kept, parse);
    await cache.read(dropped, parse);

    cache.keepOnly(root, new Set([kept]));
    await cache.read(kept, parse);
    await cache.read(dropped, parse);

    expect(calls).toEqual(["k", "d", "d"]);
  });
});

describe("readTaskFiles with a shared cache", () => {
  const TASK = "---\ntitle: My Task\n---\n\nBody.\n";

  it("sees a task that moved to another status folder", async () => {
    mkdirSync(join(root, "todo"), { recursive: true });
    mkdirSync(join(root, "done"), { recursive: true });
    writeFileSync(join(root, "todo", "my-task.md"), TASK);
    const cache = createParseCache();
    await readTaskFiles(root, cache);

    renameSync(join(root, "todo", "my-task.md"), join(root, "done", "my-task.md"));
    const files = await readTaskFiles(root, cache);

    expect(files.map((file) => [file.slug, file.status])).toEqual([["my-task", "done"]]);
  });

  it("sees an edit to a task file between two reads", async () => {
    mkdirSync(join(root, "todo"), { recursive: true });
    const path = join(root, "todo", "my-task.md");
    writeFileSync(path, TASK);
    const cache = createParseCache();
    await readTaskFiles(root, cache);

    writeFileSync(path, TASK.replace("My Task", "Renamed"));
    utimesSync(path, new Date(), new Date(Date.now() + 5_000));
    const [file] = await readTaskFiles(root, cache);

    expect(file?.task.title).toBe("Renamed");
  });
});
