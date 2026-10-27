// @vitest-environment node
// BBPL-968: бриф с этапами несёт план моделей — тот же, что потом ставит граница, — и модель треда для прогноза.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { CatalogModel } from "../core/context";
import { stage } from "../core/stages-fixtures";
import type { Execution } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { priced } from "./priced-fixture";
import { createStore } from "./store";

const OPUS: Execution = { providerId: "claude-code", model: "claude-opus-4-1", reasoningLevel: "high" };
const CATALOG: CatalogModel[] = [
  { model: "claude-opus-4-1", efforts: ["medium", "high"] },
  { model: "claude-sonnet-4-5", efforts: ["medium", "high"] },
];
const land = stage("land", { skill: "", name: "Commit", automation: { source: "flow", steps: ["git.commit"] } });
const stages = [stage("demo", { kind: "demo", name: "Demo" }), stage("spec", { skill: "spec" }), stage("implement", { skill: "code-standards-fp" }), land];

const brief = async (threadModels: (() => Promise<{ current: Execution; models: readonly CatalogModel[] } | null>) | undefined) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  registerAskTool(bb, store, {
    newId: () => "A1",
    now: () => "2026-10-27T10:00:00.000Z",
    stages: () => ({ stages, minButtonWidth: 170 }),
    ...(threadModels === undefined ? {} : { threadModels }),
  });
  await harness.callAgentTool(
    ASK_TOOL_NAME,
    priced({ title: "Бриф", setup: { stages: [{ id: "demo", state: "todo", recommended: true }, { id: "spec", state: "todo", recommended: true }, { id: "implement", state: "todo", recommended: true }, { id: "land", state: "todo" }] } }),
    { threadId: "thr_1" },
  );
  return (await store.getBrief("dec_A1"))?.stages;
};

describe("бриф несёт план моделей этапов", () => {
  it("каждый навыковый этап — модель по роли, встроенный и автоматизация — без модели; рядом модель треда", async () => {
    const stored = await brief(async () => ({ current: OPUS, models: CATALOG }));
    expect(stored?.models).toEqual({ spec: OPUS, implement: { ...OPUS, model: "claude-sonnet-4-5" } });
    expect(stored?.threadModel).toEqual(OPUS);
  });

  it("тред не Claude Code — полей нет, бриф принимается", async () => {
    const stored = await brief(async () => null);
    expect(stored?.list).toHaveLength(4);
    expect(stored?.models).toBeUndefined();
    expect(stored?.threadModel).toBeUndefined();
  });

  it("каталог не прочёлся — полей нет, бриф принимается", async () => {
    const stored = await brief(async () => {
      throw new Error("нет каталога");
    });
    expect(stored?.list).toHaveLength(4);
    expect(stored?.models).toBeUndefined();
  });

  it("без чтения моделей бриф прежний", async () => {
    expect((await brief(undefined))?.models).toBeUndefined();
  });
});
