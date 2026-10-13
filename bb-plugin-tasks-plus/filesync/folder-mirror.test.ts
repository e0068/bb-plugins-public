// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFolderMirror, MIRROR_MANIFEST, mirrorDirectory, mirrorFileName, mirrorPlan } from "./folder-mirror.js";

const record = (key: string | null, title: string) => `---\ntitle: ${title}\n${key === null ? "" : `key: ${key}\n`}---\n\nBody of ${title}.\n`;
const id = (text: string) => text;

describe("mirrorFileName", () => {
  it("names a record by its key, and by its slug while it has none", () => {
    expect(mirrorFileName("glow", record("DOC-3", "Glow"))).toBe("DOC-3.md");
    expect(mirrorFileName("glow", record(null, "Glow"))).toBe("glow.md");
    expect(mirrorFileName("glow", "---\nkey: ../escape\n---\n")).toBe("glow.md");
  });
});

describe("mirrorPlan", () => {
  it("writes new and changed records only, and removes files no record names", () => {
    const a = record("DOC-1", "A");
    const manifest = new Map([["DOC-1.md", a], ["DOC-2.md", "old"], ["DOC-9.md", "gone"]]);
    const plan = mirrorPlan(manifest, new Map([["a", a], ["b", record("DOC-2", "B")], ["c", record(null, "C")]]), id);
    expect(plan.write.map((file) => file.name)).toEqual(["DOC-2.md", "c.md"]);
    expect(plan.remove).toEqual(["DOC-9.md"]);
    expect([...plan.manifest.keys()]).toEqual(["DOC-1.md", "DOC-2.md", "c.md"]);
  });

  it("moves a record's file when it gets its key", () => {
    const plan = mirrorPlan(new Map([["glow.md", "x"]]), new Map([["glow", record("DOC-1", "Glow")]]), id);
    expect(plan.write.map((file) => file.name)).toEqual(["DOC-1.md"]);
    expect(plan.remove).toEqual(["glow.md"]);
  });
});

describe("mirrorDirectory", () => {
  it("takes an absolute path or one from the home folder, and nothing else", () => {
    expect(mirrorDirectory("/tmp/docs")).toBe("/tmp/docs");
    expect(mirrorDirectory("/tmp/docs/")).toBe("/tmp/docs");
    expect(mirrorDirectory(" ~/docs ")).toBe(join(homedir(), "docs"));
    expect(mirrorDirectory("docs")).toBeNull();
    expect(mirrorDirectory("")).toBeNull();
  });
});

describe("createFolderMirror", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "folder-mirror-"));
    dirs.push(dir);
    return dir;
  };

  it("writes records as files, removes a deleted one and leaves files it did not write", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "notes.md"), "mine");
    writeFileSync(join(dir, "DOC-2.md"), "also mine");
    const mirror = createFolderMirror(join(dir, "docs"));
    await mirror.sync(new Map([["a", record("DOC-1", "A")], ["b", record("DOC-2", "B")]]));
    expect(readdirSync(join(dir, "docs")).sort()).toEqual([MIRROR_MANIFEST, "DOC-1.md", "DOC-2.md"]);
    expect(readFileSync(join(dir, "docs", "DOC-1.md"), "utf8")).toBe(record("DOC-1", "A"));

    await mirror.sync(new Map([["b", record("DOC-2", "B2")]]));
    expect(readdirSync(join(dir, "docs")).sort()).toEqual([MIRROR_MANIFEST, "DOC-2.md"]);
    expect(readFileSync(join(dir, "docs", "DOC-2.md"), "utf8")).toBe(record("DOC-2", "B2"));
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe("mine");
  });

  it("never writes over a file someone else put under a record's name", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "DOC-1.md"), "someone else's");
    const warnings: string[] = [];
    await createFolderMirror(dir, (message) => warnings.push(message)).sync(new Map([["a", record("DOC-1", "A")]]));
    expect(readFileSync(join(dir, "DOC-1.md"), "utf8")).toBe("someone else's");
    expect(warnings).toHaveLength(1);
  });

  it("writes a hand edit over only when its record changes, and remembers its files across restarts", async () => {
    const dir = tempDir();
    await createFolderMirror(dir).sync(new Map([["a", record("DOC-1", "A")]]));
    writeFileSync(join(dir, "DOC-1.md"), "hand edit");
    const again = createFolderMirror(dir);
    await again.sync(new Map([["a", record("DOC-1", "A")]]));
    expect(readFileSync(join(dir, "DOC-1.md"), "utf8")).toBe("hand edit");
    await again.sync(new Map([["a", record("DOC-1", "A2")]]));
    expect(readFileSync(join(dir, "DOC-1.md"), "utf8")).toBe(record("DOC-1", "A2"));
  });
});
