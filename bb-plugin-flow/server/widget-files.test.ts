// @vitest-environment node
// Файлы виджета для просмотрщика bb: путь из состава плагина — абсолютный путь на хосте; всё остальное — `null`.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { allowedWidgetFiles } from "../core/widget-anatomy";
import { readWidgetFile, registerWidgetFiles, type WidgetFileSources } from "./widget-files";

const OWN = { name: "flow-questions", filePath: "/plugins/flow/skills/flow-questions/SKILL.md", pluginId: "flow" };
const owners = { name: "flow-questions", filePath: "/home/owner/.claude/skills/flow-questions/SKILL.md", pluginId: null };
const CARD = "app/brief-card.tsx";

const sources = (patch: Partial<WidgetFileSources> = {}): WidgetFileSources => ({
  projectIds: async () => ["prj_1"],
  skills: async () => [owners, { name: "other", filePath: "/plugins/other/skills/other/SKILL.md", pluginId: "other" }, OWN],
  primaryHostId: async () => "host_local",
  exists: async () => true,
  ...patch,
});

describe("файл виджета по пути из состава", () => {
  it("корень берётся у навыка этого плагина, а не у одноимённого навыка владельца", async () => {
    expect(await readWidgetFile(sources(), CARD)).toEqual({ hostId: "host_local", path: `/plugins/flow/${CARD}` });
  });

  it("файлы навыков плагина открываются тем же путём", async () => {
    expect(await readWidgetFile(sources(), "skills/flow-questions/ru.md")).toEqual({ hostId: "host_local", path: "/plugins/flow/skills/flow-questions/ru.md" });
  });

  it("любой путь вне состава — null, даже существующий; наружу из корня не выйти", async () => {
    const asked: string[] = [];
    const spy = sources({ exists: async (path) => (asked.push(path), true) });
    expect(await Promise.all(["../../etc/passwd", "package.json", "/etc/passwd", `${CARD}/../../x`, ""].map((p) => readWidgetFile(spy, p)))).toEqual(Array(5).fill(null));
    expect(asked).toEqual([]);
  });

  it("любая строка вне состава — null", async () => {
    const allowed = allowedWidgetFiles();
    await fc.assert(fc.asyncProperty(fc.string(), async (path) => allowed.has(path) || (await readWidgetFile(sources(), path)) === null));
  });

  it("файла нет на диске — null: в установке без исходников страница пишет об этом строкой", async () => {
    expect(await readWidgetFile(sources({ exists: async () => false }), CARD)).toBeNull();
  });

  it("нет навыка плагина, хоста или источник упал — null", async () => {
    expect(await readWidgetFile(sources({ skills: async () => [owners] }), CARD)).toBeNull();
    expect(await readWidgetFile(sources({ primaryHostId: async () => null }), CARD)).toBeNull();
    expect(
      await readWidgetFile(
        sources({
          projectIds: async () => {
            throw new Error("нет доступа");
          },
        }),
        CARD,
      ),
    ).toBeNull();
    expect(
      await readWidgetFile(
        sources({
          exists: async () => {
            throw new Error("нет доступа");
          },
        }),
        CARD,
      ),
    ).toBeNull();
  });

  it("навык плагина вне папки skills/<имя>/SKILL.md корня не даёт", async () => {
    const odd = sources({ skills: async () => [{ name: "flow-questions", filePath: "/plugins/flow/elsewhere.md", pluginId: "flow" }] });
    expect(await readWidgetFile(odd, CARD)).toBeNull();
  });
});

describe("RPC файла виджета", () => {
  it("getWidgetFile отвечает по пути из состава и null по чужому", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerWidgetFiles(bb, sources());
    expect(await harness.callRpc("getWidgetFile", { path: CARD })).toEqual({ hostId: "host_local", path: `/plugins/flow/${CARD}` });
    expect(await harness.callRpc("getWidgetFile", { path: "../secret" })).toBeNull();
  });
});
