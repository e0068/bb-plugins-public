// @vitest-environment node
// Запуск плагина сразу кладёт коллекцию в папку синхронизации, а правка папки
// доходит до страницы Flow тем же RPC, что читает коллекцию.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import plugin from "./server";

afterEach(() => {
  vi.unstubAllEnvs();
});

const start = async () => {
  const home = await mkdtemp(join(tmpdir(), "flow-home-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("BB_FLOW_SYNC_DIR", undefined);
  const host = createFakePluginHost({ pluginId: "flow" });
  await plugin(host.bb);
  return { home, dir: join(home, ".claude", "BB Flows"), host };
};

describe("синхронизация flow в запущенном плагине", () => {
  it("коллекция ложится в папку ~/.claude/BB Flows при запуске", async () => {
    const { dir } = await start();
    await vi.waitFor(async () => expect(JSON.parse(await readFile(join(dir, "settings.json"), "utf8")).order).toEqual(["Default"]));
  });

  it("правка файла flow в папке видна странице Flow и в состоянии синхронизации", async () => {
    const { dir, host } = await start();
    await vi.waitFor(async () => expect(await readFile(join(dir, "Default.flow.json"), "utf8")).toContain("Default"));
    const file = JSON.parse(await readFile(join(dir, "Default.flow.json"), "utf8"));
    await writeFile(join(dir, "Default.flow.json"), JSON.stringify({ ...file, description: "приехало Syncthing'ом" }));
    await vi.waitFor(
      async () => {
        const settings = (await host.harness.callRpc("getFlowSettings", {})) as { flows: Array<{ description?: string }> };
        expect(settings.flows[0]!.description).toBe("приехало Syncthing'ом");
      },
      { timeout: 5000, interval: 100 },
    );
    expect(await host.harness.callRpc("getFlowSync", {})).toEqual({ dir: "~/.claude/BB Flows", status: { kind: "synced", at: expect.any(String) } });
  });
});
