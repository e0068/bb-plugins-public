import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect } from "vitest";
import plugin from "../server";

/**
 * One machine running the whole Tasks+ plugin on a fake bb host: its own
 * settings (secrets included), its own KV, and the name bb gives its host.
 * `bbProject` is a bb project with a local checkout, for boards connected to
 * a folder. The network is whatever global `fetch` the test stubbed.
 */
export interface TasksHostOptions {
  machine: string;
  settings?: Record<string, string>;
  bbProject?: { id: string; name: string; path: string };
}

export async function tasksHost(options: TasksHostOptions) {
  const project = options.bbProject
    ? {
        id: options.bbProject.id,
        name: options.bbProject.name,
        sources: [{ isDefault: true, path: options.bbProject.path, hostId: "host_1", type: "local_path" }],
      }
    : null;
  const { bb, harness } = createFakePluginHost({
    pluginId: "tasks",
    ...(options.settings ? { settings: options.settings } : {}),
    sdk: {
      hosts: { list: async () => [{ id: "host_1", name: options.machine }] },
      projects: {
        get: async () => {
          if (project === null) throw new Error("no bb project");
          return project;
        },
        list: async () => (project === null ? [] : [project]),
      },
    } as never,
  });
  await plugin(bb);
  /** An RPC call; a method the host does not have or an input it rejects fails the test on an assertion naming the method. */
  const call = <T = unknown>(method: string, input: unknown = null) =>
    harness.callRpc(method, input).catch((error: unknown) =>
      expect.fail(`${method} failed on the host: ${error instanceof Error ? error.message : String(error)}`),
    ) as Promise<T>;
  return { bb, harness, call };
}

export type TasksHost = Awaited<ReturnType<typeof tasksHost>>;

/** The board a host lists under `prefix`. */
export async function boardByPrefix(host: TasksHost, prefix: string) {
  const { projects } = await host.call<{ projects: { id: string; name: string; prefix: string; database?: { url: string } | null }[] }>("listProjects", {});
  return projects.find((project) => project.prefix === prefix);
}
