// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { StageCatalog } from "../shared/contract";
import { registerMentionsApi } from "./mentions";

type Calls = { commands: unknown[]; paths: unknown[] };

const CATALOG: StageCatalog = {
  skills: [
    { name: "spec", description: "Спецификация" },
    { name: "plan" },
    { name: "code-review" },
  ],
  executors: [],
};

const setup = (opts: { environmentId?: string | null; fail?: boolean } = {}) => {
  const calls: Calls = { commands: [], paths: [] };
  const failing = async () => {
    throw new Error("host unavailable");
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: { get: async () => ({ projectId: "proj_1", environmentId: opts.environmentId === undefined ? "env_1" : opts.environmentId, providerId: "claude-code" }) },
      projects: {
        commands: opts.fail
          ? failing
          : async (args: unknown) => {
              calls.commands.push(args);
              return {
                commands: [
                  { name: "compact", description: "Сжать контекст", origin: "builtin", source: "command", argumentHint: null },
                  { name: "spec", description: "Спецификация задачи", origin: "user", source: "skill", argumentHint: null },
                  { name: "bb-global-skills:spec-writer", description: null, origin: "user", source: "skill", argumentHint: null },
                ],
              };
            },
        paths: opts.fail
          ? failing
          : async (args: unknown) => {
              calls.paths.push(args);
              return {
                paths: [
                  { kind: "directory", name: "app", path: "bb-plugin-flow/app", positions: [], score: 1 },
                  { kind: "file", name: "brief-card.tsx", path: "bb-plugin-flow/app/brief-card.tsx", positions: [], score: 1 },
                ],
                truncated: false,
              };
            },
      },
    },
  });
  registerMentionsApi(bb, { catalog: async () => (opts.fail ? failing() : CATALOG) });
  return { harness, calls };
};

describe("список по `/` в треде — тот же, что у композера треда", () => {
  it("спрашивает у bb команды и навыки агента треда в его рабочей копии и сужает их по набранному", async () => {
    const { harness, calls } = setup();
    expect(await harness.callRpc("mentions", { threadId: "thr_1", trigger: "/", query: "spe" })).toEqual({
      kind: "found",
      items: [
        { kind: "skill", name: "spec", insert: "spec", description: "Спецификация задачи" },
        { kind: "skill", name: "bb-global-skills:spec-writer", insert: "bb-global-skills:spec-writer" },
      ],
    });
    expect(calls.commands).toEqual([{ projectId: "proj_1", environmentId: "env_1", provider: "claude-code" }]);
  });

  it("встроенная команда агента — строкой команды, а не навыка", async () => {
    const { harness } = setup();
    expect(await harness.callRpc("mentions", { threadId: "thr_1", trigger: "/", query: "comp" })).toEqual({
      kind: "found",
      items: [{ kind: "command", name: "compact", insert: "compact", description: "Сжать контекст" }],
    });
  });

  it("тред без рабочей копии — команды проекта без окружения", async () => {
    const { harness, calls } = setup({ environmentId: null });
    await harness.callRpc("mentions", { threadId: "thr_1", trigger: "/", query: "" });
    expect(calls.commands).toEqual([{ projectId: "proj_1", provider: "claude-code" }]);
  });
});

describe("список по `@` в треде — файлы и папки его рабочей копии", () => {
  it("ищет у bb файлы и папки по набранному, путь встаёт в текст", async () => {
    const { harness, calls } = setup();
    expect(await harness.callRpc("mentions", { threadId: "thr_1", trigger: "@", query: "brief" })).toEqual({
      kind: "found",
      items: [
        { kind: "directory", name: "app", insert: "bb-plugin-flow/app", description: "bb-plugin-flow/app" },
        { kind: "file", name: "brief-card.tsx", insert: "bb-plugin-flow/app/brief-card.tsx", description: "bb-plugin-flow/app/brief-card.tsx" },
      ],
    });
    expect(calls.paths).toEqual([{ projectId: "proj_1", environmentId: "env_1", query: "brief", includeFiles: "true", includeDirectories: "true", limit: "30" }]);
  });
});

describe("поле вне треда — страница настроек", () => {
  it("`/` берёт навыки каталога Flow, сужая по набранному", async () => {
    const { harness, calls } = setup();
    expect(await harness.callRpc("mentions", { trigger: "/", query: "pl" })).toEqual({ kind: "found", items: [{ kind: "skill", name: "plan", insert: "plan" }] });
    expect(calls.commands).toEqual([]);
  });

  it("`@` без треда — пустой список: рабочей копии нет", async () => {
    const { harness, calls } = setup();
    expect(await harness.callRpc("mentions", { trigger: "@", query: "a" })).toEqual({ kind: "found", items: [] });
    expect(calls.paths).toEqual([]);
  });
});

describe("сбой bb", () => {
  it.each([
    { threadId: "thr_1", trigger: "/" as const },
    { threadId: "thr_1", trigger: "@" as const },
    { trigger: "/" as const },
  ])("читается отказом, а не ошибкой: поле работает и без списка (%o)", async (input) => {
    const { harness } = setup({ fail: true });
    expect(await harness.callRpc("mentions", { ...input, query: "" })).toEqual({ kind: "unavailable" });
  });
});
