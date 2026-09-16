import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

// resolveOpenTarget — shell: area + bounds (matchRoot) + primaryHostId.
// Stub out the seams with the world (projects.list, system.config); test
// host and bounds resolution, not bb itself.
function host(overrides: Parameters<typeof createFakePluginHost>[0] = {}) {
  return createFakePluginHost({
    pluginId: "claude-config",
    sdk: {
      projects: { list: async () => [] },
      system: { config: async () => ({ primaryHostId: "host-1" }) },
    },
    ...overrides,
  });
}

describe("resolveOpenTarget", () => {
  it("personal path (~/.claude) on the local host: returns primaryHostId", async () => {
    const { bb, harness } = host();
    await plugin(bb);
    const path = join(homedir(), ".claude", "skills", "x", "SKILL.md");
    const res = await harness.behavior.callRpc("resolveOpenTarget", {
      areaId: "global",
      path,
    });
    expect(res).toEqual({ hostId: "host-1", path, error: null });
  });

  // BBPL-249: following a Claude `@~/...` import yields a path with a tilde.
  // `~` is a shell convention — the bb host doesn't expand it, so handing the
  // raw path to the native opener opens nothing at all (a silent click). Only
  // the server knows the home directory, so it returns the expanded path and
  // the panel opens THAT.
  it("a `~/` path comes back expanded, ready for the native opener", async () => {
    const { bb, harness } = host();
    await plugin(bb);
    const res = (await harness.behavior.callRpc("resolveOpenTarget", {
      areaId: "global",
      path: "~/.claude/skills/x/SKILL.md",
    })) as { hostId: string | null; path: string | null; error: string | null };
    expect(res.hostId).toBe("host-1");
    expect(res.path).toBe(join(homedir(), ".claude", "skills", "x", "SKILL.md"));
    expect(res.error).toBeNull();
  });

  it("out of bounds — no path to open either", async () => {
    const { bb, harness } = host();
    await plugin(bb);
    const res = (await harness.behavior.callRpc("resolveOpenTarget", {
      areaId: "global",
      path: "~/../../etc/passwd",
    })) as { hostId: string | null; path: string | null; error: string | null };
    expect(res.hostId).toBeNull();
    expect(res.path).toBeNull();
    expect(res.error).toBeTruthy();
  });

  it("path outside area bounds — hostId null and a message", async () => {
    const { bb, harness } = host();
    await plugin(bb);
    const res = (await harness.behavior.callRpc("resolveOpenTarget", {
      areaId: "global",
      path: "/etc/passwd",
    })) as { hostId: string | null; error: string | null };
    expect(res.hostId).toBeNull();
    expect(res.error).toBeTruthy();
  });

  it("nonexistent area — hostId null and an area-not-found message", async () => {
    const { bb, harness } = host();
    await plugin(bb);
    const res = await harness.behavior.callRpc("resolveOpenTarget", {
      areaId: "proj_missing",
      path: join(homedir(), ".claude", "settings.json"),
    });
    expect(res).toEqual({
      hostId: null,
      path: null,
      error: "Area not found.",
    });
  });

  it("no primaryHostId — hostId null and a host message", async () => {
    const { bb, harness } = host({
      pluginId: "claude-config",
      sdk: {
        projects: { list: async () => [] },
        system: { config: async () => ({ primaryHostId: null }) },
      },
    });
    await plugin(bb);
    const res = (await harness.behavior.callRpc("resolveOpenTarget", {
      areaId: "global",
      path: join(homedir(), ".claude", "settings.json"),
    })) as { hostId: string | null; error: string | null };
    expect(res.hostId).toBeNull();
    expect(res.error).toBeTruthy();
  });
});

// getConfig's output contract must accept whatever buildHooks actually
// produces. A disabled hook has no position in the file — buildHooks marks
// it index:-1 (see __tests__/config-view.test.ts) — but configOutput once
// required hooks[].index to be nonnegative, copied from the addressing
// input schemas (readHook/writeHook) where -1 is never valid. Disabling any
// hook then made every later getConfig call for that area reject with an
// output-validation error the panel never surfaces (no .catch() on the
// RPC), which read as "the panel stopped loading" (see
// memory/tasks/in_progress/cloud-config-plugin-kasimov-switch.md, "Правка 5").
describe("getConfig", () => {
  const REAL_HOME = process.env.HOME;
  const tempHomes: string[] = [];

  afterEach(() => {
    if (REAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = REAL_HOME;
    while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
  });

  it("a disabled hook (index:-1) doesn't break the output contract", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "claude-config-home-"));
    tempHomes.push(fakeHome);
    process.env.HOME = fakeHome;
    const settingsPath = join(fakeHome, ".claude", "settings.json");

    let settingsContent = JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] },
        ],
      },
    });

    const { bb, harness } = host();
    harness.sdk.stub("files.read", (args: { path: string }) => {
      if (args.path === settingsPath) {
        return {
          content: settingsContent,
          sha256: "x",
          contentEncoding: "utf8",
          sizeBytes: settingsContent.length,
        };
      }
      throw new Error("not found");
    });
    harness.sdk.stub("files.write", (args: { content: string }) => {
      settingsContent = args.content;
      return { outcome: "written", sha256: "y", sizeBytes: settingsContent.length };
    });
    await plugin(bb);

    const disabled = await harness.behavior.callRpc("setHookEnabled", {
      areaId: "global",
      origin: "user",
      event: "PreToolUse",
      matcher: "Bash",
      command: "echo hi",
      enabled: false,
    });
    expect(disabled).toMatchObject({ outcome: "ok" });
    // The hook really left the file — same fact the live bug report hinged on.
    expect(JSON.parse(settingsContent).hooks).toBeUndefined();

    const config = (await harness.behavior.callRpc("getConfig", {
      areaId: "global",
    })) as { hooks: unknown[] };
    expect(config.hooks).toEqual([
      {
        event: "PreToolUse",
        matcher: "Bash",
        command: "echo hi",
        origin: "user",
        index: -1,
        enabled: false,
      },
    ]);
  });

  // readmePath is what the panel now opens through the shared file-opener
  // path (useOpenFile), the same way it already opens a skill's SKILL.md —
  // see decisions/claude-config-plugin-readme-like-skill.md.
  it("a plugin's readmePath points at its README when present, null otherwise", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "claude-config-home-"));
    tempHomes.push(fakeHome);
    process.env.HOME = fakeHome;

    const withReadmeDir = join(fakeHome, "plugins", "with-readme");
    const withoutReadmeDir = join(fakeHome, "plugins", "without-readme");
    const installedPath = join(
      fakeHome,
      ".claude",
      "plugins",
      "installed_plugins.json",
    );
    const files: Record<string, string> = {
      [installedPath]: JSON.stringify({
        plugins: {
          "with-readme@m": [{ installPath: withReadmeDir, version: "1.0.0" }],
          "without-readme@m": [{ installPath: withoutReadmeDir, version: "1.0.0" }],
        },
      }),
      [join(withReadmeDir, ".claude-plugin", "plugin.json")]: '{"name":"with-readme"}',
      [join(withReadmeDir, "README.md")]: "# With Readme",
      [join(withoutReadmeDir, ".claude-plugin", "plugin.json")]:
        '{"name":"without-readme"}',
    };

    const { bb, harness } = host();
    harness.sdk.stub("files.read", (args: { path: string }) => {
      const content = files[args.path];
      if (content === undefined) throw new Error("not found");
      return {
        content,
        sha256: "x",
        contentEncoding: "utf8",
        sizeBytes: content.length,
      };
    });
    await plugin(bb);

    const config = (await harness.behavior.callRpc("getConfig", {
      areaId: "global",
    })) as { plugins: { key: string; readmePath: string | null }[] };

    expect(config.plugins).toEqual([
      expect.objectContaining({
        key: "with-readme@m",
        readmePath: join(withReadmeDir, "README.md"),
      }),
      expect.objectContaining({
        key: "without-readme@m",
        readmePath: null,
      }),
    ]);
  });
});

// setSetting — the generic "Settings" section's write path: same CAS +
// minimal-diff machinery as setPlugin/setToolSearch (writeLeveled), applied
// to an arbitrary settings.json key instead of a fixed one.
describe("setSetting", () => {
  const REAL_HOME = process.env.HOME;
  const tempHomes: string[] = [];

  afterEach(() => {
    if (REAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = REAL_HOME;
    while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
  });

  function fakeHomeHost() {
    const fakeHome = mkdtempSync(join(tmpdir(), "claude-config-home-"));
    tempHomes.push(fakeHome);
    process.env.HOME = fakeHome;
    const settingsPath = join(fakeHome, ".claude", "settings.json");
    let settingsContent = "{}";
    const { bb, harness } = host();
    harness.sdk.stub("files.read", (args: { path: string }) => {
      if (args.path === settingsPath) {
        return {
          content: settingsContent,
          sha256: "x",
          contentEncoding: "utf8",
          sizeBytes: settingsContent.length,
        };
      }
      throw new Error("not found");
    });
    harness.sdk.stub("files.write", (args: { content: string }) => {
      settingsContent = args.content;
      return { outcome: "written", sha256: "y", sizeBytes: settingsContent.length };
    });
    return { bb, harness, settingsPath, content: () => settingsContent };
  }

  it("writes a valid value, and getConfig reads it back display-encoded", async () => {
    const { bb, harness, content } = fakeHomeHost();
    await plugin(bb);

    const written = await harness.behavior.callRpc("setSetting", {
      areaId: "global",
      key: "cleanupPeriodDays",
      value: "30",
    });
    expect(written).toEqual({ outcome: "ok", message: null });
    expect(JSON.parse(content())).toEqual({ cleanupPeriodDays: 30 });

    const config = (await harness.behavior.callRpc("getConfig", {
      areaId: "global",
    })) as { settings: { key: string; value: string | null }[] };
    expect(
      config.settings.find((row) => row.key === "cleanupPeriodDays"),
    ).toMatchObject({ value: "30" });
  });

  it("rejects text that doesn't decode for the key's kind — parse-error, no write", async () => {
    const { bb, harness, content } = fakeHomeHost();
    await plugin(bb);

    const result = await harness.behavior.callRpc("setSetting", {
      areaId: "global",
      key: "cleanupPeriodDays",
      value: "not-a-number",
    });
    expect(result).toMatchObject({ outcome: "parse-error" });
    expect(content()).toBe("{}");
  });

  it("value:null clears the key back to inherit", async () => {
    const { bb, harness, content } = fakeHomeHost();
    await plugin(bb);

    await harness.behavior.callRpc("setSetting", {
      areaId: "global",
      key: "cleanupPeriodDays",
      value: "30",
    });
    const cleared = await harness.behavior.callRpc("setSetting", {
      areaId: "global",
      key: "cleanupPeriodDays",
      value: null,
    });
    expect(cleared).toEqual({ outcome: "ok", message: null });
    expect(JSON.parse(content())).toEqual({});
  });
});
