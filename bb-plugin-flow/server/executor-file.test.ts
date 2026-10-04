// @vitest-environment node
// Файл исполнителя по id: чип агента или workflow открывает его в правой панели bb, а путь знает только сервер.
import { readFile } from "node:fs/promises";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createFlowSettings } from "./flow-settings";
import { registerFlowSettingsApi } from "./settings-api";
import { readExecutorFile, writeScriptFile, type ExecutorFileSources } from "./stage-catalog";

const files: Record<string, string> = {
  "/home/owner/.claude/agents/team/reviewer.md": "---\nname: reviewer\n---\n",
  "/work/bb-plugins/.claude/agents/scout.md": "---\nname: scout\n---\n",
  "/home/owner/.claude/plugins/installed_plugins.json": JSON.stringify({ plugins: { "cm@market": [{ installPath: "/cache/cm/1.0" }] } }),
  "/cache/cm/1.0/agents/critic.md": "---\nname: critic\n---\n",
  "/home/owner/.codex/agents/coder.toml": 'name = "coder"\n',
  "/home/owner/.claude/workflows/dev2.js": 'export const meta = { name: "DEV2" }',
};

const sources = (patch: Partial<ExecutorFileSources> = {}): ExecutorFileSources => ({
  projectIds: async () => [],
  skills: async () => [],
  listDir: async (dir) => {
    const names = Object.keys(files).filter((path) => path.startsWith(`${dir}/`)).map((path) => path.slice(dir.length + 1).split("/")[0]!);
    if (names.length === 0) throw new Error(`ENOENT ${dir}`);
    return [...new Set(names)];
  },
  readFile: async (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT ${path}`);
    return text;
  },
  home: "/home/owner",
  projects: async () => [{ name: "bb-plugins", path: "/work/bb-plugins" }],
  primaryHostId: async () => "host_local",
  ...patch,
});

describe("файл исполнителя по id", () => {
  it.each([
    ["agent:reviewer", "/home/owner/.claude/agents/team/reviewer.md"],
    ["agent:scout", "/work/bb-plugins/.claude/agents/scout.md"],
    ["agent:cm:critic", "/cache/cm/1.0/agents/critic.md"],
    ["agent:codex/coder", "/home/owner/.codex/agents/coder.toml"],
    ["workflow:DEV2", "/home/owner/.claude/workflows/dev2.js"],
  ])("%s — его файл на хосте сервера", async (id, path) => {
    expect(await readExecutorFile(sources(), id)).toEqual({ hostId: "host_local", path });
  });

  it("неизвестный исполнитель или нет хоста — null", async () => {
    expect(await readExecutorFile(sources(), "agent:nope")).toBeNull();
    expect(await readExecutorFile(sources({ primaryHostId: async () => null }), "agent:reviewer")).toBeNull();
  });
});

describe("файл своего скрипта", () => {
  it("текст скрипта ложится файлом с его именем, путь — на хосте сервера", async () => {
    const file = await writeScriptFile({ id: "s-1", name: "deploy.sh", content: "#!/bin/sh\necho hi\n" }, async () => "host_local");
    expect(file).toEqual({ hostId: "host_local", path: expect.stringMatching(/s-1\/deploy\.sh$/) });
    expect(await readFile(file!.path, "utf8")).toBe("#!/bin/sh\necho hi\n");
  });

  it("имя и id не выводят файл из своей папки", async () => {
    const file = await writeScriptFile({ id: "../../x", name: "../../evil.sh", content: "" }, async () => "h");
    expect(file!.path).toMatch(/bb-flow-scripts\/[^/]+\/evil\.sh$/);
  });

  it("id и имя из одних точек не поднимаются из папки снимков и не пишут в каталог", async () => {
    const file = await writeScriptFile({ id: "..", name: "..", content: "x" }, async () => "h");
    expect(file!.path).toMatch(/bb-flow-scripts\/script\/script$/);
    expect(await readFile(file!.path, "utf8")).toBe("x");
  });
});

describe("RPC файлов исполнителя и скрипта", () => {
  it("отдаёт то, что нашли зависимости", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerFlowSettingsApi(bb, await createFlowSettings(bb.storage.kv), {
      catalog: async () => ({ skills: [], executors: [] }),
      skillFile: async () => null,
      executorFile: async (id) => (id === "agent:reviewer" ? { hostId: "h", path: "/a/reviewer.md" } : null),
      scriptFile: async (script) => ({ hostId: "h", path: `/tmp/${script.name}` }),
      reveal: async () => ({ revealed: true, error: null }),
    });
    expect(await harness.callRpc("getExecutorFile", { id: "agent:reviewer" })).toEqual({ hostId: "h", path: "/a/reviewer.md" });
    expect(await harness.callRpc("getExecutorFile", { id: "agent:x" })).toBeNull();
    expect(await harness.callRpc("getScriptFile", { id: "s", name: "a.sh", content: "x" })).toEqual({ hostId: "h", path: "/tmp/a.sh" });
  });
});
