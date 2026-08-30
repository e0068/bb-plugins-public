import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

// resolveOpenTarget — оболочка: область + границы (matchRoot) + primaryHostId.
// Стыки с миром (projects.list, system.config) заглушаем; проверяем разбор
// хоста и границ, а не сам bb.
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
  it("личный путь (~/.claude) — на локальном хосте: отдаёт primaryHostId", async () => {
    const { bb, harness } = host();
    await plugin(bb);
    const path = join(homedir(), ".claude", "skills", "x", "SKILL.md");
    const res = await harness.behavior.callRpc("resolveOpenTarget", {
      areaId: "global",
      path,
    });
    expect(res).toEqual({ hostId: "host-1", error: null });
  });

  it("путь вне границ области — hostId null и сообщение", async () => {
    const { bb, harness } = host();
    await plugin(bb);
    const res = (await harness.behavior.callRpc("resolveOpenTarget", {
      areaId: "global",
      path: "/etc/passwd",
    })) as { hostId: string | null; error: string | null };
    expect(res.hostId).toBeNull();
    expect(res.error).toBeTruthy();
  });

  it("несуществующая область — hostId null и «Область не найдена»", async () => {
    const { bb, harness } = host();
    await plugin(bb);
    const res = await harness.behavior.callRpc("resolveOpenTarget", {
      areaId: "proj_missing",
      path: join(homedir(), ".claude", "settings.json"),
    });
    expect(res).toEqual({ hostId: null, error: "Область не найдена." });
  });

  it("нет primaryHostId — hostId null и сообщение о хосте", async () => {
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
