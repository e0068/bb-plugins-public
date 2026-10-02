import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

// A skill or agent linked into ~/.claude from elsewhere is listed, so it must
// also open — while a read the client aims outside `.claude` stays closed.
// The stubs answer the way the host daemon does: a read with rootPath checks
// the real path of the file against the real root and refuses a symlinked
// root; remove refuses a symlink; listing skips symlinks.

const within = (root: string, path: string) => path === root || path.startsWith(`${root}/`);

const daemon = {
  listPaths(args: { path: string }) {
    if (lstatSync(args.path).isSymbolicLink()) throw new Error(`Path "${args.path}" must not be a symlink`);
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isSymbolicLink()) return [];
        const full = join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [relative(args.path, full)];
      });
    return { paths: walk(args.path).map((path) => ({ path, kind: "file" })), truncated: false };
  },
  read(args: { path: string; rootPath?: string }) {
    if (args.rootPath !== undefined) {
      if (lstatSync(args.rootPath).isSymbolicLink()) throw new Error("Root path must not be a symlink");
      if (!within(realpathSync(args.rootPath), realpathSync(args.path))) throw new Error("escapes read root");
    }
    const content = readFileSync(args.path, "utf8");
    return { content, sha256: "x", contentEncoding: "utf8", sizeBytes: content.length };
  },
  write(args: { path: string; rootPath?: string; content: string }) {
    if (args.rootPath !== undefined) {
      if (lstatSync(args.rootPath).isSymbolicLink()) throw new Error("Root path must not be a symlink");
      if (!within(realpathSync(args.rootPath), realpathSync(args.path))) throw new Error("escapes write root");
    }
    writeFileSync(args.path, args.content);
    return { outcome: "written", sha256: "y" };
  },
  remove(args: { path: string }) {
    if (lstatSync(args.path).isSymbolicLink()) throw new Error("must not be a symbolic link");
    rmSync(args.path, { recursive: true });
    return { ok: true };
  },
};

describe("skills and agents linked into ~/.claude open and stay confined", () => {
  const REAL_HOME = process.env.HOME;
  let home = "";
  let project = "";

  const write = (path: string, text: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "claude-config-open-"));
    process.env.HOME = home;
    project = join(home, "project");
    write(join(home, "outside.txt"), "secret");
    write(join(home, ".claude", "skills", "own", "SKILL.md"), "own");
    write(join(home, "clone", "skills", "linked", "SKILL.md"), "linked");
    write(join(home, "clone", "skills", "linked", "ref.md"), "ref");
    symlinkSync(join(home, "clone", "skills", "linked"), join(home, ".claude", "skills", "linked"));
    write(join(home, "clone", "agents", "helper.md"), "helper");
    mkdirSync(join(home, ".claude", "agents"), { recursive: true });
    symlinkSync(join(home, "clone", "agents", "helper.md"), join(home, ".claude", "agents", "helper.md"));
    mkdirSync(join(project, ".claude", "skills"), { recursive: true });
    symlinkSync(join(home, "clone", "skills", "linked"), join(project, ".claude", "skills", "shared"));
  });

  afterEach(() => {
    if (REAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = REAL_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  async function start(projectHostId = "host-1") {
    const { bb, harness } = createFakePluginHost({
      pluginId: "claude-config",
      sdk: {
        projects: {
          list: async () => [{ id: "p1", name: "Project", sources: [{ isDefault: true, hostId: projectHostId, path: project }] }],
        },
        system: { config: async () => ({ primaryHostId: "host-1" }) },
      },
    });
    harness.sdk.stub("files.listPaths", daemon.listPaths);
    harness.sdk.stub("files.read", daemon.read);
    harness.sdk.stub("files.remove", daemon.remove);
    harness.sdk.stub("files.write", daemon.write);
    await plugin(bb);
    return (method: string, args: Record<string, unknown>) => harness.behavior.callRpc(method, args) as Promise<any>;
  }

  it("a linked skill's SKILL.md and its sibling file open", async () => {
    const call = await start();
    expect((await call("readSkillFile", { areaId: "global", name: "linked", relPath: "SKILL.md" })).content).toBe("linked");
    expect((await call("readSkillFile", { areaId: "global", name: "linked", relPath: "ref.md" })).content).toBe("ref");
  });

  it("a linked agent file opens", async () => {
    const call = await start();
    const doc = await call("readDoc", { areaId: "global", path: join(home, ".claude", "agents", "helper.md") });
    expect(doc.content).toBe("helper");
  });

  it("an edit of a linked skill is saved into the link's target", async () => {
    const call = await start();
    const path = join(home, ".claude", "skills", "linked", "SKILL.md");
    const saved = await call("writeDoc", { areaId: "global", path, content: "edited", expectedSha256: null });
    expect(saved.outcome).toBe("written");
    expect(readFileSync(join(home, "clone", "skills", "linked", "SKILL.md"), "utf8")).toBe("edited");
  });

  it("a path from the client that walks out through a link is not let out of .claude", async () => {
    const call = await start();
    const escape = join(home, ".claude", "skills", "linked", "..", "..", "..", "outside.txt");
    expect((await call("readDoc", { areaId: "global", path: escape })).content).toBeNull();
    expect((await call("readSkillFile", { areaId: "global", name: "own", relPath: "../../../outside.txt" })).content).toBeNull();
  });

  it("removing a linked skill is refused in words, and its target stays", async () => {
    const call = await start();
    const outcome = await call("removeSkill", { areaId: "global", name: "linked" });
    expect(outcome.outcome).toBe("denied");
    expect(existsSync(join(home, "clone", "skills", "linked", "SKILL.md"))).toBe(true);
  });

  it("removing a linked agent is refused in words, and its target stays", async () => {
    const call = await start();
    const outcome = await call("removeAgent", { areaId: "global", path: join(home, ".claude", "agents", "helper.md") });
    expect(outcome.outcome).toBe("denied");
    expect(existsSync(join(home, "clone", "agents", "helper.md"))).toBe(true);
  });

  it("a project on bb's own host lists its linked skill", async () => {
    const call = await start("host-1");
    const config = await call("getConfig", { areaId: "p1" });
    expect(config.skills.map((s: { name: string }) => s.name)).toContain("shared");
  });

  it("a project on another host does not follow links — the plugin has no file system there", async () => {
    const call = await start("host-2");
    const config = await call("getConfig", { areaId: "p1" });
    expect(config.skills.map((s: { name: string }) => s.name)).not.toContain("shared");
  });
});
