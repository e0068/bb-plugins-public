import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { resolveCallerEnvironment, resolveMainRoot } from "./resolve-roots.js";

// Оба резолвера — точечные: один проект и одно окружение по известному id.
// Обхода списка живых деревьев здесь нет и быть не должно — см.
// decisions/tasks-plus-board-roots-blocks-rpc.md.
describe("resolveMainRoot", () => {
  it("резолвит только main-путь, без обращения к threads/environments", async () => {
    const { bb } = createFakePluginHost({
      pluginId: "resolve-main-root-test",
      sdk: {
        threads: { list: async () => { throw new Error("must not be called"); } },
        projects: {
          get: async () => ({ sources: [{ isDefault: true, path: "/repo/main", hostId: "host_1" }] }),
        },
        environments: { get: async () => { throw new Error("must not be called"); } },
      },
    });

    const root = await resolveMainRoot(bb, "proj_x", "memory/tasks");
    expect(root).toEqual({ absPath: "/repo/main/memory/tasks", origin: { kind: "main" } });
  });

  it("null, если проект недоступен", async () => {
    const { bb } = createFakePluginHost({
      pluginId: "resolve-main-root-test-2",
      sdk: {
        threads: { list: async () => [] },
        projects: { get: async () => { throw new Error("unreachable"); } },
        environments: { get: async () => ({ path: "/unused" }) },
      },
    });

    expect(await resolveMainRoot(bb, "proj_x", "tasks")).toBeNull();
  });

  it("null, если у проекта нет ни одного source", async () => {
    const { bb } = createFakePluginHost({
      pluginId: "resolve-main-root-test-3",
      sdk: {
        threads: { list: async () => [] },
        projects: { get: async () => ({ sources: [] }) },
        environments: { get: async () => ({ path: "/unused" }) },
      },
    });

    expect(await resolveMainRoot(bb, "proj_x", "tasks")).toBeNull();
  });
});

describe("resolveCallerEnvironment", () => {
  it("резолвит одно окружение по id, не спрашивая ни проектов, ни списка тредов", async () => {
    const calls: string[] = [];
    const { bb } = createFakePluginHost({
      pluginId: "resolve-caller-env-test",
      sdk: {
        threads: { list: async () => { throw new Error("must not be called"); } },
        projects: { get: async () => { throw new Error("must not be called"); } },
        environments: {
          get: async ({ environmentId }: { environmentId: string }) => {
            calls.push(environmentId);
            return {
              id: environmentId,
              projectId: "proj_x",
              path: `/worktrees/${environmentId}`,
              name: "agent-x",
              branchName: "bb/thr_1",
              isWorktree: true,
              hostId: "host_1",
            };
          },
        },
      },
    });

    expect(await resolveCallerEnvironment(bb, "env_x")).toEqual({
      environmentId: "env_x",
      projectId: "proj_x",
      path: "/worktrees/env_x",
      name: "agent-x",
      branchName: "bb/thr_1",
      isWorktree: true,
      hostId: "host_1",
    });
    expect(calls).toEqual(["env_x"]);
  });

  it("без id окружения не обращается к хосту вовсе", async () => {
    const { bb } = createFakePluginHost({
      pluginId: "resolve-caller-env-test-2",
      sdk: {
        threads: { list: async () => { throw new Error("must not be called"); } },
        projects: { get: async () => { throw new Error("must not be called"); } },
        environments: { get: async () => { throw new Error("must not be called"); } },
      },
    });

    expect(await resolveCallerEnvironment(bb, null)).toBeNull();
  });

  it("null, если окружение недоступно — команда просто работает с main", async () => {
    const { bb } = createFakePluginHost({
      pluginId: "resolve-caller-env-test-3",
      sdk: {
        threads: { list: async () => [] },
        projects: { get: async () => ({ sources: [] }) },
        environments: { get: async () => { throw new Error("unreachable"); } },
      },
    });

    expect(await resolveCallerEnvironment(bb, "env_gone")).toBeNull();
  });
});
