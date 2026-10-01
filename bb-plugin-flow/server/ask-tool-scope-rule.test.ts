// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ASK_INSTRUCTIONS } from "./ask-tool";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("агент знает цену от объёма", () => {
  it("описание инструмента называет scope, share и factors и не учит add на этапах", async () => {
    const { createFakePluginHost } = await import("@get-bb/plugin-sdk/testing");
    const { createStore } = await import("./store");
    const { registerAskTool } = await import("./ask-tool");
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerAskTool(bb, createStore(bb.storage.kv), { newId: () => "D1", now: () => "2026-10-01T00:00:00.000Z" });
    const description = harness.registrations.agentTools.find((t) => t.name === "ask_decision")?.description ?? "";
    for (const word of ["scope", "share", "factors"]) expect(description).toContain(word);
    expect(description).not.toContain("executor and add");
  });

  it("инструкция называет «Что я понял», цену пунктов, доли этапов и множители исполнителей", () => {
    for (const word of ["scope", "share", "percent", "factors", "factor", "minutes"]) expect(ASK_INSTRUCTIONS).toContain(word);
    expect(ASK_INSTRUCTIONS).not.toContain("an item's add is its share inside the stages");
    expect(ASK_INSTRUCTIONS).not.toContain("an option's add is its difference from the recommended option");
  });

  it("навыки flow, Критерии и Выбор этапов учат той же модели", () => {
    expect(read("../skills/flow/SKILL.md")).toContain('"share": {');
    expect(read("../skills/flow/SKILL.md")).toContain('"scope":');
    for (const path of ["../skills/flow-criteria/SKILL.md", "../skills/flow-criteria/ru.md"]) expect(read(path)).not.toMatch(/share inside the stages|доля пункта в цене этапов/);
    for (const path of ["../skills/flow-stage-selection/SKILL.md", "../skills/flow-stage-selection/ru.md"]) expect(read(path)).toContain("factors");
  });
});
