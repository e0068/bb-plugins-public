// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createFlowSettings } from "./flow-settings";
import { registerFlowSettingsApi } from "./settings-api";
import { readSkillFile, type SkillFileSources } from "./stage-catalog";

const sources = (patch: Partial<SkillFileSources> = {}): SkillFileSources => ({
  projectIds: async () => ["prj_1", "prj_2"],
  skills: async (projectId) =>
    projectId === "prj_1"
      ? [{ name: "flow", filePath: "/plugins/flow/skills/flow/SKILL.md", pluginId: "flow" }, { name: "spec", filePath: "/home/owner/.claude/skills/spec/SKILL.md", pluginId: null }]
      : [{ name: "flow", filePath: "/home/owner/.claude/skills/flow/SKILL.md", pluginId: null }],
  primaryHostId: async () => "host_local",
  ...patch,
});

describe("файл навыка по имени", () => {
  it("находит файл навыка и хост сервера", async () => {
    expect(await readSkillFile(sources(), "spec")).toEqual({ hostId: "host_local", path: "/home/owner/.claude/skills/spec/SKILL.md" });
  });

  it("навык владельца важнее одноимённого навыка плагина", async () => {
    expect(await readSkillFile(sources(), "flow")).toEqual({ hostId: "host_local", path: "/home/owner/.claude/skills/flow/SKILL.md" });
  });

  it("нет навыка, хоста или источник упал — null", async () => {
    expect(await readSkillFile(sources(), "nope")).toBeNull();
    expect(await readSkillFile(sources({ primaryHostId: async () => null }), "spec")).toBeNull();
    expect(
      await readSkillFile(
        sources({
          projectIds: async () => {
            throw new Error("нет доступа");
          },
        }),
        "spec",
      ),
    ).toBeNull();
  });
});

describe("RPC файла навыка", () => {
  const setup = async (revealed: string[]) => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const settings = await createFlowSettings(bb.storage.kv);
    registerFlowSettingsApi(bb, settings, {
      catalog: async () => ({ skills: [], executors: [] }),
      rootSkill: async () => null,
      skillFile: async (name) => (name === "spec" ? { hostId: "h", path: "/s/SKILL.md" } : null),
      reveal: async (path) => {
        revealed.push(path);
        return { revealed: true, error: null };
      },
    });
    return harness;
  };

  it("getSkillFile отдаёт файл навыка по имени", async () => {
    const harness = await setup([]);
    expect(await harness.callRpc("getSkillFile", { name: "spec" })).toEqual({ hostId: "h", path: "/s/SKILL.md" });
    expect(await harness.callRpc("getSkillFile", { name: "nope" })).toBeNull();
  });

  it("revealSkill показывает в файловой системе только файл найденного навыка", async () => {
    const revealed: string[] = [];
    const harness = await setup(revealed);
    expect(await harness.callRpc("revealSkill", { name: "spec" })).toEqual({ revealed: true, error: null });
    expect(await harness.callRpc("revealSkill", { name: "nope" })).toEqual({ revealed: false, error: "skill file not found" });
    expect(revealed).toEqual(["/s/SKILL.md"]);
  });
});
