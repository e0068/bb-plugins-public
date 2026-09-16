import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

// Create and delete for the section headers' "+" and for the delete button on
// the file's own surface: hooks (an entry inside settings.json), skills (a
// folder) and agents (a single file). The seams with the world — files.read,
// files.write, files.remove — are stubbed; what's under test is the shell's
// own rules: what it refuses, what it writes, what it removes.

const REAL_HOME = process.env.HOME;
const tempHomes: string[] = [];

afterEach(() => {
  if (REAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = REAL_HOME;
  while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
});

/**
 * A global area rooted in a throwaway HOME: settings.json is held in memory,
 * every other read misses, and removals are recorded instead of performed.
 */
function fakeHome(initialSettings = "{}") {
  const home = mkdtempSync(join(tmpdir(), "claude-config-crud-"));
  tempHomes.push(home);
  process.env.HOME = home;
  const settingsPath = join(home, ".claude", "settings.json");
  const files = new Map<string, string>([[settingsPath, initialSettings]]);
  const removed: { path: string; recursive?: boolean }[] = [];

  const { bb, harness } = createFakePluginHost({
    pluginId: "claude-config",
    sdk: {
      projects: { list: async () => [] },
      system: { config: async () => ({ primaryHostId: "host-1" }) },
    },
  });
  harness.sdk.stub("files.read", (args: { path: string }) => {
    const content = files.get(args.path);
    if (content === undefined) throw new Error("not found");
    return {
      content,
      sha256: "sha-" + content.length,
      contentEncoding: "utf8",
      sizeBytes: content.length,
    };
  });
  harness.sdk.stub("files.write", (args: { path: string; content: string }) => {
    files.set(args.path, args.content);
    return { outcome: "written", sha256: "written", sizeBytes: args.content.length };
  });
  harness.sdk.stub("files.remove", (args: { path: string; recursive?: boolean }) => {
    removed.push(args);
    files.delete(args.path);
    return { outcome: "removed" };
  });

  return {
    bb,
    harness,
    home,
    settings: () => JSON.parse(files.get(settingsPath) ?? "{}") as Record<string, unknown>,
    put: (path: string, content: string) => files.set(path, content),
    has: (path: string) => files.has(path),
    removed,
  };
}

const hooksOf = async (harness: { behavior: { callRpc: (n: string, i: unknown) => Promise<unknown> } }) =>
  (
    (await harness.behavior.callRpc("getConfig", { areaId: "global" })) as {
      hooks: { event: string; command: string; enabled: boolean }[];
    }
  ).hooks;

describe("createHook", () => {
  it("writes the hook into the edited settings file and lists it back", async () => {
    const world = fakeHome();
    await plugin(world.bb);

    const result = await world.harness.behavior.callRpc("createHook", {
      areaId: "global",
      event: "PreToolUse",
      matcher: "Bash",
      command: "echo hi",
    });
    expect(result).toEqual({ outcome: "ok", message: null });
    expect(world.settings().hooks).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
    });
    expect(await hooksOf(world.harness)).toMatchObject([
      { event: "PreToolUse", matcher: "Bash", command: "echo hi", enabled: true },
    ]);
  });

  it("no matcher — a group without the field, matching every tool", async () => {
    const world = fakeHome();
    await plugin(world.bb);

    await world.harness.behavior.callRpc("createHook", {
      areaId: "global",
      event: "SessionStart",
      matcher: null,
      command: "date",
    });
    expect(world.settings().hooks).toEqual({
      SessionStart: [{ hooks: [{ type: "command", command: "date" }] }],
    });
  });

  it("refuses a blank command and writes nothing", async () => {
    const world = fakeHome();
    await plugin(world.bb);

    const result = (await world.harness.behavior.callRpc("createHook", {
      areaId: "global",
      event: "PreToolUse",
      matcher: null,
      command: "   ",
    })) as { outcome: string; message: string | null };
    expect(result.outcome).toBe("denied");
    expect(result.message).toBeTruthy();
    expect(world.settings()).toEqual({});
  });

  it("refuses a blank event and writes nothing", async () => {
    const world = fakeHome();
    await plugin(world.bb);

    const result = (await world.harness.behavior.callRpc("createHook", {
      areaId: "global",
      event: "  ",
      matcher: null,
      command: "date",
    })) as { outcome: string };
    expect(result.outcome).toBe("denied");
    expect(world.settings()).toEqual({});
  });

  it("area not found — no write", async () => {
    const world = fakeHome();
    await plugin(world.bb);

    const result = (await world.harness.behavior.callRpc("createHook", {
      areaId: "proj_missing",
      event: "PreToolUse",
      matcher: null,
      command: "date",
    })) as { outcome: string };
    expect(result.outcome).toBe("not-found");
    expect(world.settings()).toEqual({});
  });
});

describe("removeHook", () => {
  const withOneHook = () =>
    fakeHome(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] },
          ],
        },
      }),
    );

  it("cuts the hook out of the file for good", async () => {
    const world = withOneHook();
    await plugin(world.bb);

    const result = await world.harness.behavior.callRpc("removeHook", {
      areaId: "global",
      origin: "user",
      event: "PreToolUse",
      matcher: "Bash",
      command: "echo hi",
    });
    expect(result).toEqual({ outcome: "ok", message: null });
    // Not just absent from the file — absent from the panel, i.e. it didn't
    // come back as a disabled row the way the toggle leaves it.
    expect(world.settings().hooks).toBeUndefined();
    expect(await hooksOf(world.harness)).toEqual([]);
  });

  it("a disabled hook is dropped from the disabled store, not resurrected", async () => {
    const world = withOneHook();
    await plugin(world.bb);
    await world.harness.behavior.callRpc("setHookEnabled", {
      areaId: "global",
      origin: "user",
      event: "PreToolUse",
      matcher: "Bash",
      command: "echo hi",
      enabled: false,
    });
    expect(await hooksOf(world.harness)).toHaveLength(1);

    const result = await world.harness.behavior.callRpc("removeHook", {
      areaId: "global",
      origin: "user",
      event: "PreToolUse",
      matcher: "Bash",
      command: "echo hi",
    });
    expect(result).toEqual({ outcome: "ok", message: null });
    expect(await hooksOf(world.harness)).toEqual([]);
  });

  it("unknown hook — not-found, file untouched", async () => {
    const world = withOneHook();
    await plugin(world.bb);

    const result = (await world.harness.behavior.callRpc("removeHook", {
      areaId: "global",
      origin: "user",
      event: "PreToolUse",
      matcher: "Bash",
      command: "echo other",
    })) as { outcome: string };
    expect(result.outcome).toBe("not-found");
    expect(await hooksOf(world.harness)).toHaveLength(1);
  });
});

describe("removeSkill", () => {
  it("removes the skill's own folder, recursively", async () => {
    const world = fakeHome();
    const skillDir = join(world.home, ".claude", "skills", "old-skill");
    world.put(join(skillDir, "SKILL.md"), "---\nname: old-skill\n---\n");
    await plugin(world.bb);

    const result = await world.harness.behavior.callRpc("removeSkill", {
      areaId: "global",
      name: "old-skill",
    });
    expect(result).toEqual({ outcome: "ok", message: null });
    expect(world.removed).toEqual([{ path: skillDir, recursive: true }]);
  });

  it("clears the deleted skill's leftover override so no orphan row is left", async () => {
    // A skillOverrides entry outlives the folder, and buildConfigView lists
    // such an orphan as a row on purpose (so the override can be cleared).
    // After a delete that row would be a dead end — the file it points at is
    // gone — so deleting the skill clears its override too.
    const world = fakeHome(
      JSON.stringify({ skillOverrides: { "old-skill": "off" } }),
    );
    const skillDir = join(world.home, ".claude", "skills", "old-skill");
    world.put(join(skillDir, "SKILL.md"), "---\nname: old-skill\n---\n");
    await plugin(world.bb);

    await world.harness.behavior.callRpc("removeSkill", {
      areaId: "global",
      name: "old-skill",
    });
    expect(world.settings().skillOverrides).toBeUndefined();

    const config = (await world.harness.behavior.callRpc("getConfig", {
      areaId: "global",
    })) as { skills: { name: string }[] };
    expect(config.skills.map((skill) => skill.name)).not.toContain("old-skill");
  });

  it("unknown skill — not-found and nothing removed", async () => {
    const world = fakeHome();
    await plugin(world.bb);

    const result = (await world.harness.behavior.callRpc("removeSkill", {
      areaId: "global",
      name: "ghost",
    })) as { outcome: string };
    expect(result.outcome).toBe("not-found");
    expect(world.removed).toEqual([]);
  });
});

describe("removeAgent", () => {
  it("removes an agent file from the area's agents directory", async () => {
    const world = fakeHome();
    const agentPath = join(world.home, ".claude", "agents", "scout.md");
    world.put(agentPath, "---\nname: scout\n---\n");
    await plugin(world.bb);

    const result = await world.harness.behavior.callRpc("removeAgent", {
      areaId: "global",
      path: agentPath,
    });
    expect(result).toEqual({ outcome: "ok", message: null });
    expect(world.removed).toEqual([{ path: agentPath }]);
  });

  it("refuses a path outside the agents directories", async () => {
    const world = fakeHome();
    const outside = join(world.home, ".claude", "settings.json");
    await plugin(world.bb);

    const result = (await world.harness.behavior.callRpc("removeAgent", {
      areaId: "global",
      path: outside,
    })) as { outcome: string; message: string | null };
    expect(result.outcome).toBe("denied");
    expect(result.message).toBeTruthy();
    expect(world.removed).toEqual([]);
  });

  it("refuses a path that only looks like it's inside — a sibling directory prefix", async () => {
    const world = fakeHome();
    const lookalike = join(world.home, ".claude", "agents-backup", "scout.md");
    await plugin(world.bb);

    const result = (await world.harness.behavior.callRpc("removeAgent", {
      areaId: "global",
      path: lookalike,
    })) as { outcome: string };
    expect(result.outcome).toBe("denied");
    expect(world.removed).toEqual([]);
  });
});
