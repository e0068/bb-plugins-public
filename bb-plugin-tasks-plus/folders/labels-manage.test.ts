// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { tasksHost, type TasksHost } from "../test-support/tasks-host.js";

const hosts: TasksHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
});

type Label = { id: string; name: string; color: string };

describe("Manage → Labels", () => {
  it("lists a label added there, and the project list still answers", async () => {
    const host = await tasksHost({ machine: "Mac mini" });
    hosts.push(host);
    const { project } = await host.call<{ project: { id: string } }>("createProject", { name: "Local", prefix: "LOC", color: "#888888" });

    await host.call("createLabel", { projectId: project.id, name: "urgent", color: "#ef4444" });

    const { labels } = await host.call<{ labels: Label[] }>("listLabels", { projectId: project.id });
    expect(labels.map(({ name, color }) => ({ name, color }))).toEqual([{ name: "urgent", color: "#ef4444" }]);
    const { projects } = await host.call<{ projects: { id: string }[] }>("listProjects", {});
    expect(projects.map((listed) => listed.id)).toContain(project.id);
  });
});
