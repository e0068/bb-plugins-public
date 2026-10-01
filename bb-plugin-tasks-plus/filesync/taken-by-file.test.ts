import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";
import { assembleBoardTasks } from "./assemble.js";
import { parseTaskFile, renderTaskFile } from "./task-file.js";

const mapPath = "./map.js";
const { mapTakenBy } = await planned<typeof import("./map.js")>(() => import(/* @vite-ignore */ mapPath));

const takenBy = { machine: "Mac mini", threadId: "thr_x", at: "2026-09-30T12:00:00.000Z" };

const file = (content: string) => ({
  ...parseTaskFile(content, "in_progress", "glow"),
  filePath: "/repo/docs/tasks/in_progress/glow.md",
  status: "in_progress" as const,
  slug: "glow",
  createdAt: "2026-09-30T12:00:00.000Z",
  updatedAt: "2026-09-30T12:00:00.000Z",
  assignee: null,
  epic: null,
  origin: { kind: "main" as const },
});

describe("the taken_by block of a task file", () => {
  it("reads the block into a mark", () => {
    expect(mapTakenBy({ machine: "Mac mini", thread: "thr_x", at: "2026-09-30T12:00:00.000Z" })).toEqual(takenBy);
    expect(mapTakenBy({ machine: "Mac mini", thread: null, at: "2026-09-30T12:00:00.000Z" })).toEqual({ ...takenBy, threadId: null });
  });

  it("reads a missing or broken block as nobody", () => {
    for (const value of [undefined, null, "Mac mini", { thread: "thr_x", at: "2026-09-30T12:00:00.000Z" }, { machine: "", at: "x" }, { machine: "Mac mini" }]) {
      expect(mapTakenBy(value)).toBeNull();
    }
  });

  it("survives a write and a read: render then parse gives the same mark", () => {
    const content = renderTaskFile({ title: "Glow", takenBy }, "glow", []);
    expect(content).toContain("taken_by:");
    expect(parseTaskFile(content, "in_progress", "glow").task.takenBy).toEqual(takenBy);
  });

  it("takes the block off the file when the mark is cleared, and leaves it when the field is not given", () => {
    const withMark = renderTaskFile({ title: "Glow", takenBy }, "glow", []);
    const existing = parseTaskFile(withMark, "in_progress", "glow").frontmatter;
    expect(renderTaskFile({ title: "Glow", takenBy: null }, "glow", [], existing)).not.toContain("taken_by");
    expect(renderTaskFile({ title: "Glow" }, "glow", [], existing)).toContain("taken_by:");
  });

  it("gives the board's task the mark from its file, and nobody for a file without one", () => {
    const marked = renderTaskFile({ title: "Glow", takenBy }, "glow", []);
    const [task] = assembleBoardTasks({ id: "b1" }, [file(marked)]).tasks;
    expect(task?.task.takenBy).toEqual(takenBy);
    const [plain] = assembleBoardTasks({ id: "b1" }, [file("---\ntitle: Glow\n---\n\nBody.\n")]).tasks;
    expect(plain?.task.takenBy).toBeNull();
  });

  it("keeps a board readable when the block is broken", () => {
    const broken = "---\ntitle: Glow\ntaken_by: [1, 2]\n---\n\nBody.\n";
    const [task] = assembleBoardTasks({ id: "b1" }, [file(broken)]).tasks;
    expect(task?.task.title).toBe("Glow");
    expect(task?.task.takenBy).toBeNull();
  });
});
