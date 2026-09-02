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
    expect(res).toEqual({ hostId: "host-1", error: null });
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
    expect(res).toEqual({ hostId: null, error: "Area not found." });
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
});
