import { describe, expect, it } from "vitest";
import { parseComments } from "../filesync/comments.js";
import { attachmentOwnerSchema, attachmentSchema, tasksRpcContract } from "./contract.js";

// Агенты вписывают комментарии в файл задачи руками, и id у них — любая
// уникальная строка: навык ведения задачи формата не задаёт. Такой
// комментарий не должен ронять Activity всей задачи.
const TASK_FILE_COMMENTS = `## Comments

<!-- comment id="c1" kind="agent" author="claude" at="2026-09-24T00:40:00Z" -->
Спецификация готова.

<!-- comment id="c2" kind="agent" author="claude" at="2026-09-24T01:05:00Z" -->
План готов.

<!-- comment id="01M39NRPSHKNH5FP9MPKFDVPFX" kind="user" author="You" at="2026-09-24T12:20:40.369Z" -->
делай эту и все задачи по Shell
`;

const TASK_ID = "01M1PAAE346PVZ70F1JQRPKF7B:shell-tokens";

function listedComments(text: string) {
  return parseComments(text).map((comment) => ({
    ...comment,
    taskId: TASK_ID,
    threadTitle: null,
    provider: null,
  }));
}

describe("comment id in the rpc contract", () => {
  it("lists comments whose ids a hand-written task file gave them", () => {
    const comments = listedComments(TASK_FILE_COMMENTS);

    const result = tasksRpcContract.listComments.output.safeParse({ comments });

    expect(result.success).toBe(true);
    expect(comments.map((comment) => comment.id)).toEqual([
      "c1",
      "c2",
      "01M39NRPSHKNH5FP9MPKFDVPFX",
    ]);
  });

  it("returns a stored comment with a hand-written id", () => {
    const [comment] = parseComments(TASK_FILE_COMMENTS);

    const result = tasksRpcContract.createComment.output.safeParse({
      comment: { ...comment, taskId: TASK_ID },
    });

    expect(result.success).toBe(true);
  });

  it("addresses attachments of a hand-written comment", () => {
    expect(attachmentOwnerSchema.safeParse({ commentId: "c1" }).success).toBe(true);
    expect(
      attachmentSchema.safeParse({
        id: "01M39NRPSHKNH5FP9MPKFDVPFX",
        taskId: null,
        commentId: "c1",
        fileName: "shot.png",
        mime: "image/png",
        sizeBytes: 1,
        isImage: true,
        createdAt: "2026-09-24T12:20:40.369Z",
      }).success,
    ).toBe(true);
  });

  it("still rejects a blank comment id", () => {
    const [comment] = listedComments(TASK_FILE_COMMENTS);

    const result = tasksRpcContract.listComments.output.safeParse({
      comments: [{ ...comment, id: "" }],
    });

    expect(result.success).toBe(false);
  });
});
