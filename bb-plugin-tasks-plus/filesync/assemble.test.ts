import { describe, it, expect } from "vitest";
import type { BoardTaskFile } from "./fs-boards.js";
import { assembleBoardTasks } from "./assemble.js";

function file(overrides: Partial<BoardTaskFile["task"]> & { slug: string; filePath?: string }): BoardTaskFile {
  const { slug, filePath, ...taskOverrides } = overrides;
  return {
    task: { title: "T", description: "", labels: [], checks: [], parentRef: null, ...taskOverrides },
    comments: [],
    frontmatter: {},
    filePath: filePath ?? `todo/${slug}.md`,
    status: "todo",
    slug,
    assignee: null,
    epic: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    origin: { kind: "main" },
  } as BoardTaskFile;
}

describe("assembleBoardTasks", () => {
  it("собирает id детерминированно из boardId и slug", () => {
    const result = assembleBoardTasks({ id: "board1" }, [file({ slug: "my-task", key: "TSK-1" })]);
    expect(result.tasks[0]?.task.id).toBe("board1:my-task");
  });

  it("файл без key показывается под своим слагом, без выдуманного номера", () => {
    const result = assembleBoardTasks({ id: "b" }, [
      file({ slug: "ok", key: "TSK-1" }),
      file({ slug: "no-key" }),
    ]);
    expect(result.tasks).toHaveLength(2);
    const keyless = result.tasks.find((t) => t.task.id === "b:no-key");
    expect(keyless?.task.key).toBe("no-key");
    expect(keyless?.task.number).toBeNull();
  });

  it("у файла без key всё равно есть source — по нему его и находят", () => {
    const result = assembleBoardTasks({ id: "b" }, [file({ slug: "no-key" })]);
    expect(result.tasks[0]?.task.source).toEqual({
      filePath: "todo/no-key.md",
      origin: { kind: "main" },
    });
  });

  it("метки — сами имена, без отдельных id", () => {
    const result = assembleBoardTasks({ id: "b" }, [
      file({ slug: "t", key: "TSK-1", labels: ["frontend", "urgent"] }),
    ]);
    expect(result.tasks[0]?.task.labelIds).toEqual(["frontend", "urgent"]);
  });

  it("резолвит родителя по key среди задач той же доски", () => {
    const result = assembleBoardTasks({ id: "b" }, [
      file({ slug: "parent", key: "TSK-1" }),
      file({ slug: "child", key: "TSK-2", parentRef: "TSK-1" }),
    ]);
    const child = result.tasks.find((t) => t.task.key === "TSK-2");
    const parent = result.tasks.find((t) => t.task.key === "TSK-1");
    expect(child?.task.parentTaskId).toBe(parent?.task.id);
  });

  it("родитель вне доски остаётся null, а не падает", () => {
    const result = assembleBoardTasks({ id: "b" }, [
      file({ slug: "orphan", key: "TSK-1", parentRef: "OTHER-9" }),
    ]);
    expect(result.tasks[0]?.task.parentTaskId).toBeNull();
  });

  it("читает attachments из сырого frontmatter как есть, а из threads — только факт привязки", () => {
    const f = file({ slug: "t", key: "TSK-1" });
    f.frontmatter = {
      threads: [{ id: "th1", threadId: "thr_x", liveStatus: "working" }],
      attachments: [{ id: "at1", fileName: "a.png", isImage: true }],
    };
    const result = assembleBoardTasks({ id: "b" }, [f]);
    expect(result.tasks[0]?.threads).toEqual([
      { id: "th1", taskId: "b:t", threadId: "thr_x", presetName: "", title: "", attachedAt: "" },
    ]);
    expect(result.tasks[0]?.attachments[0]?.fileName).toBe("a.png");
  });

  it("ключ не по формату PREFIX-NUMBER читается как отсутствующий, файл остаётся", () => {
    const result = assembleBoardTasks({ id: "b" }, [
      file({ slug: "placeholder", key: "—" }),
    ]);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.task.key).toBe("placeholder");
    expect(result.tasks[0]?.task.number).toBeNull();
  });

  it("родителя находит и по слагу, когда у него нет ключа", () => {
    const result = assembleBoardTasks({ id: "b" }, [
      file({ slug: "parent-no-key" }),
      file({ slug: "child", key: "TSK-2", parentRef: "parent-no-key" }),
    ]);
    const child = result.tasks.find((t) => t.task.key === "TSK-2");
    expect(child?.task.parentTaskId).toBe("b:parent-no-key");
  });
});
