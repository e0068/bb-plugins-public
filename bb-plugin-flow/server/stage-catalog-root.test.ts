// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createFlowSettings } from "./flow-settings";
import { registerFlowSettingsApi } from "./settings-api";
import { readRootSkill, type RootSkillSources } from "./stage-catalog";

const sources = (patch: Partial<RootSkillSources> = {}): RootSkillSources => ({
  home: "/home/owner",
  primaryHostId: async () => "host_local",
  exists: async (path) => path === "/home/owner/.claude/skills/flow/SKILL.md",
  ...patch,
});

describe("корневой навык flow", () => {
  it("есть файл навыка — отдаёт его путь и хост, на котором он лежит", async () => {
    expect(await readRootSkill(sources())).toEqual({ hostId: "host_local", path: "/home/owner/.claude/skills/flow/SKILL.md" });
  });

  it("нет файла навыка — null", async () => {
    expect(await readRootSkill(sources({ exists: async () => false }))).toBeNull();
  });

  it("хост не известен или источник упал — null, а не ошибка", async () => {
    expect(await readRootSkill(sources({ primaryHostId: async () => null }))).toBeNull();
    expect(
      await readRootSkill(
        sources({
          exists: async () => {
            throw new Error("нет доступа");
          },
        }),
      ),
    ).toBeNull();
  });

  it("страница Flow получает корневой навык запросом getRootSkill", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const settings = await createFlowSettings(bb.storage.kv);
    registerFlowSettingsApi(bb, settings, { catalog: async () => ({ skills: [], executors: [] }), rootSkill: async () => ({ hostId: "h", path: "/p/SKILL.md" }), skillFile: async () => null, reveal: async () => ({ revealed: false, error: null }) });
    expect(await harness.callRpc("getRootSkill", {})).toEqual({ hostId: "h", path: "/p/SKILL.md" });
  });
});
