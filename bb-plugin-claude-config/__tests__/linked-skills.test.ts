import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

// The host daemon walks a directory with readdir and skips every symlink, and
// refuses a symlinked root outright. Skills linked into ~/.claude/skills from
// a marketplace clone must still reach the panel, as they reach Claude Code.

/** files.listPaths the way the host daemon serves it: real disk, symlinks skipped. */
function daemonListPaths(args: { path: string }) {
  if (lstatSync(args.path).isSymbolicLink()) throw new Error(`Path "${args.path}" must not be a symlink`);
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isSymbolicLink()) return [];
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [relative(args.path, full)];
    });
  return { paths: walk(args.path).map((path) => ({ path, kind: "file" })), truncated: false };
}

describe("skills linked into ~/.claude/skills", () => {
  const REAL_HOME = process.env.HOME;
  let home = "";

  const write = (path: string, text: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "claude-config-links-"));
    process.env.HOME = home;
    write(join(home, ".claude", "skills", "own", "SKILL.md"), "own");
    write(join(home, "clone", "skills", "linked", "SKILL.md"), "linked");
    symlinkSync(join(home, "clone", "skills", "linked"), join(home, ".claude", "skills", "linked"));
    symlinkSync(join(home, "nowhere"), join(home, ".claude", "skills", "dangling"));
    write(join(home, "clone", "agents", "helper.md"), "helper");
    mkdirSync(join(home, ".claude", "agents"), { recursive: true });
    symlinkSync(join(home, "clone", "agents", "helper.md"), join(home, ".claude", "agents", "helper.md"));
  });

  afterEach(() => {
    if (REAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = REAL_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  async function config() {
    const { bb, harness } = createFakePluginHost({
      pluginId: "claude-config",
      sdk: {
        projects: { list: async () => [] },
        system: { config: async () => ({ primaryHostId: "host-1" }) },
      },
    });
    harness.sdk.stub("files.read", () => {
      throw new Error("not found");
    });
    harness.sdk.stub("files.listPaths", daemonListPaths);
    await plugin(bb);
    return (await harness.behavior.callRpc("getConfig", { areaId: "global" })) as {
      skills: { name: string }[];
      agents: { name: string }[];
    };
  }

  it("a skill folder linked from elsewhere is listed next to a real one; a dangling link is not", async () => {
    const { skills } = await config();
    expect(skills.map((s) => s.name).sort()).toEqual(["linked", "own"]);
  });

  it("an agent file linked from elsewhere is listed", async () => {
    const { agents } = await config();
    expect(agents.map((a) => a.name)).toEqual(["helper"]);
  });

  it("a ~/.claude/skills that is itself a link is listed through it", async () => {
    rmSync(join(home, ".claude", "skills"), { recursive: true });
    write(join(home, "dotfiles", "skills", "kept", "SKILL.md"), "kept");
    symlinkSync(join(home, "dotfiles", "skills"), join(home, ".claude", "skills"));
    const { skills } = await config();
    expect(skills.map((s) => s.name)).toEqual(["kept"]);
  });
});
