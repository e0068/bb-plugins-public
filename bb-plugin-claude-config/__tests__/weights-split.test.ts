import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { skillWeightKey } from "../src/weight";

// BBPL-333: host-daemon serves file reads one at a time, so every read is
// paid for in wall time. getConfig reads only what draws the area; the
// per-row files (SKILL.md, agent files, plugin manifest and README) are read
// by getWeights, which the panel calls after the area is on screen.

describe("getConfig / getWeights split", () => {
  const REAL_HOME = process.env.HOME;
  let home = "";
  let files: Record<string, string> = {};
  let read: string[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "claude-config-home-"));
    process.env.HOME = home;
    read = [];
    const pluginDir = join(home, "plugins", "p");
    files = {
      [join(home, ".claude", "plugins", "installed_plugins.json")]: JSON.stringify({
        plugins: { "p@m": [{ installPath: pluginDir, version: "1.0.0" }] },
      }),
      [join(pluginDir, ".claude-plugin", "plugin.json")]: '{"name":"p"}',
      [join(pluginDir, "README.md")]: "# P plugin readme",
      [join(home, ".claude", "skills", "s", "SKILL.md")]: "x".repeat(400),
      [join(home, ".claude", "agents", "a.md")]: "y".repeat(80),
    };
  });

  afterEach(() => {
    if (REAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = REAL_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  async function start() {
    const { bb, harness } = createFakePluginHost({
      pluginId: "claude-config",
      sdk: {
        projects: { list: async () => [] },
        system: { config: async () => ({ primaryHostId: "host-1" }) },
      },
    });
    harness.sdk.stub("files.read", (args: { path: string }) => {
      read.push(args.path);
      const content = files[args.path];
      if (content === undefined) throw new Error("not found");
      return { content, sha256: "x", contentEncoding: "utf8", sizeBytes: content.length };
    });
    harness.sdk.stub("files.listPaths", (args: { path: string }) => {
      const prefix = args.path.endsWith("/") ? args.path : `${args.path}/`;
      const paths = Object.keys(files)
        .filter((path) => path.startsWith(prefix))
        .map((path) => ({ path: path.slice(prefix.length), kind: "file" }));
      if (paths.length === 0) throw new Error("not found");
      return { paths };
    });
    await plugin(bb);
    return harness;
  }

  it("getConfig lists the rows without reading any per-row file", async () => {
    const harness = await start();
    const config = (await harness.behavior.callRpc("getConfig", { areaId: "global" })) as {
      plugins: { key: string; tokens: number | null; readmePath: string | null }[];
      skills: { name: string; tokens: number | null }[];
      agents: { name: string; tokens: number | null }[];
    };

    expect(config.plugins.map((p) => [p.key, p.tokens, p.readmePath])).toEqual([["p@m", null, null]]);
    expect(config.skills.map((s) => [s.name, s.tokens])).toEqual([["s", null]]);
    expect(config.agents.map((a) => [a.name, a.tokens])).toEqual([["a", null]]);
    const perRow = read.filter(
      (path) => path.includes(join(home, "plugins")) || path.endsWith("SKILL.md") || path.endsWith("a.md"),
    );
    expect(perRow).toEqual([]);
  });

  it("getWeights brings token weights and the plugin README path", async () => {
    const harness = await start();
    const weights = await harness.behavior.callRpc("getWeights", { areaId: "global" });

    expect(weights).toEqual({
      plugins: {
        "p@m": {
          tokens: Math.ceil(('{"name":"p"}' + "# P plugin readme").length / 4),
          readmePath: join(home, "plugins", "p", "README.md"),
        },
      },
      skills: { [skillWeightKey("personal", "s")]: 100 },
      agents: { [join(home, ".claude", "agents", "a.md")]: 20 },
    });
  });

  it("a plugin without README gets readmePath null", async () => {
    delete files[join(home, "plugins", "p", "README.md")];
    const harness = await start();
    const weights = (await harness.behavior.callRpc("getWeights", { areaId: "global" })) as {
      plugins: Record<string, { readmePath: string | null }>;
    };
    expect(weights.plugins["p@m"]?.readmePath).toBeNull();
  });

  it("a lowercase readme.md is found when README.md is absent", async () => {
    delete files[join(home, "plugins", "p", "README.md")];
    files[join(home, "plugins", "p", "readme.md")] = "# lower";
    const harness = await start();
    const weights = (await harness.behavior.callRpc("getWeights", { areaId: "global" })) as {
      plugins: Record<string, { readmePath: string | null }>;
    };
    expect(weights.plugins["p@m"]?.readmePath).toBe(join(home, "plugins", "p", "readme.md"));
  });

  it("a plugin with no install directory gets no weight entry", async () => {
    files[join(home, ".claude", "settings.json")] = JSON.stringify({
      enabledPlugins: { "gone@m": true },
    });
    const harness = await start();
    const weights = (await harness.behavior.callRpc("getWeights", { areaId: "global" })) as {
      plugins: Record<string, unknown>;
    };
    expect(Object.keys(weights.plugins)).toEqual(["p@m"]);
  });

  it("an area with corrupt settings has no weights", async () => {
    files[join(home, ".claude", "settings.json")] = "{ not json";
    const harness = await start();
    const weights = await harness.behavior.callRpc("getWeights", { areaId: "global" });
    expect(weights).toEqual({ plugins: {}, skills: {}, agents: {} });
  });

  // host-daemon serves reads one at a time: a weight run the panel no longer
  // wants must stop reading, or the next area's reads queue behind it.
  describe("a weight run the panel has left stops reading", () => {
    const SKILLS = 40;
    let skillReads = 0;

    async function slowStart() {
      for (let i = 0; i < SKILLS; i++) {
        files[join(home, ".claude", "skills", `s${i}`, "SKILL.md")] = "z";
      }
      const harness = await start();
      harness.sdk.stub("files.read", async (args: { path: string }) => {
        if (args.path.endsWith("SKILL.md")) skillReads++;
        await new Promise((resolve) => setTimeout(resolve, 2));
        const content = files[args.path];
        if (content === undefined) throw new Error("not found");
        return { content, sha256: "x", contentEncoding: "utf8", sizeBytes: content.length };
      });
      skillReads = 0;
      return harness;
    }

    it("getConfig for another area retires it", async () => {
      const harness = await slowStart();
      const running = harness.behavior.callRpc("getWeights", { areaId: "global" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await harness.behavior.callRpc("getConfig", { areaId: "proj_other" });
      await expect(running).rejects.toThrow();
      expect(skillReads).toBeLessThan(SKILLS);
    });

    it("a newer getWeights retires it, the newer one completes", async () => {
      const harness = await slowStart();
      const older = harness.behavior.callRpc("getWeights", { areaId: "global" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const newer = harness.behavior.callRpc("getWeights", { areaId: "global" });
      await expect(older).rejects.toThrow();
      const weights = (await newer) as { skills: Record<string, number | null> };
      expect(Object.keys(weights.skills)).toHaveLength(SKILLS + 1);
    });

    it("getConfig for the same area leaves it running", async () => {
      const harness = await slowStart();
      const running = harness.behavior.callRpc("getWeights", { areaId: "global" });
      await harness.behavior.callRpc("getConfig", { areaId: "global" });
      const weights = (await running) as { skills: Record<string, number | null> };
      expect(Object.keys(weights.skills)).toHaveLength(SKILLS + 1);
    });
  });

  it("an unknown area has no weights", async () => {
    const harness = await start();
    const weights = await harness.behavior.callRpc("getWeights", { areaId: "proj_missing" });
    expect(weights).toEqual({ plugins: {}, skills: {}, agents: {} });
  });
});
