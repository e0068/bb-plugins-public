// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { boardByPrefix, tasksHost, type TasksHost } from "../test-support/tasks-host.js";

let hrana: HranaFake;
const hosts: TasksHost[] = [];

beforeEach(() => {
  hrana = createHranaFake();
  vi.stubGlobal("fetch", hrana.fetch);
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  vi.unstubAllGlobals();
});

async function board() {
  hrana.addDatabase("team-me.turso.io", "owner-token");
  const host = await tasksHost({ machine: "Mac mini" });
  hosts.push(host);
  await host.call("connectDatabase", { url: "libsql://team-me.turso.io", token: "owner-token", name: "Team", prefix: "TSK" });
  return { host, boardId: (await boardByPrefix(host, "TSK"))!.id };
}

type Task = { id: string; icon?: string };
type Label = { name: string; icon?: string };
type Project = { id: string; icon?: string; columnIcons?: Record<string, string> };

describe("icons over the plugin's RPC", () => {
  it("set and take off a task's icon", async () => {
    const { host, boardId } = await board();
    const created = await host.call<{ task: Task }>("createTask", { projectId: boardId, title: "Onboarding" });

    const set = await host.call<{ ok: true; task: Task }>("updateTask", { taskId: created.task.id, icon: "filled:Rocket" });
    expect(set.task.icon).toBe("filled:Rocket");
    const cleared = await host.call<{ ok: true; task: Task }>("updateTask", { taskId: created.task.id, icon: null });
    expect(cleared.task.icon).toBeUndefined();
  });

  it("refuse what is no icon", async () => {
    const { host, boardId } = await board();
    const created = await host.call<{ task: Task }>("createTask", { projectId: boardId, title: "Onboarding" });

    await expect(host.call("updateTask", { taskId: created.task.id, icon: "NoSuchIcon" })).rejects.toThrow();
  });

  it("set a label's icon", async () => {
    const { host, boardId } = await board();
    await host.call("createLabel", { projectId: boardId, name: "urgent", color: "#ef4444" });

    await host.call("updateLabel", { labelId: "urgent", icon: "🔥" });

    const { labels } = await host.call<{ labels: Label[] }>("listLabels", { projectId: boardId });
    expect(labels.find((label) => label.name === "urgent")?.icon).toBe("🔥");
  });

  it("set a project's icon of any kind and its column icons", async () => {
    const { host, boardId } = await board();

    await host.call("updateProject", { projectId: boardId, icon: "🚀", columnIcons: { status: "🚦" } });

    const { projects } = await host.call<{ projects: Project[] }>("listProjects", {});
    expect(projects.find((project) => project.id === boardId)).toMatchObject({ icon: "🚀", columnIcons: { status: "🚦" } });
  });
});
