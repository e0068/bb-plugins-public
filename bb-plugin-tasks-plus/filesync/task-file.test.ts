import type { Comment, TaskCheck } from "../db/types.js";
import { describe, it, expect } from "vitest";
import { parseTaskFile, renderTaskFile } from "./task-file.js";
import { parseComments, renderComments } from "./comments.js";

describe("task file round-trip", () => {
  it("парсит фронтметр и комментарии", () => {
    const content = `---
title: My Task
slug: my-task
key: TSK-1
priority: high
estimate: m
checks: [test, review]
---

Описание задачи.

## Comments

<!-- comment id="cmt1" kind="user" author="Alice" at="2026-09-04T10:00:00Z" -->
First comment.

<!-- comment id="cmt2" kind="agent" author="Claude" preset="Opus" thread="thr_x" at="2026-09-04T11:00:00Z" -->
Agent response.
`;

    const parsed = parseTaskFile(content, "in_progress", "my-task");
    
    expect(parsed.task.title).toBe("My Task");
    expect(parsed.task.priority).toBe("high");
    expect(parsed.task.estimate).toBe("m");
    expect(parsed.task.description).toBe("Описание задачи.");
    expect(parsed.comments).toHaveLength(2);
    expect(parsed.comments[0]?.authorName).toBe("Alice");
    expect(parsed.comments[1]?.presetName).toBe("Opus");
  });

  it("рендерит в markdown с маркерами комментариев", () => {
    const task = {
      title: "Test Task",
      description: "A task.",
      priority: "medium" as const,
      estimate: "s" as const,
    };

    const comments: Comment[] = [
      {
        id: "c1",
        taskId: "t1",
        kind: "user",
        authorName: "Bob",
        presetName: null,
        threadId: null,
        body: "Comment text.",
        notifiedCount: 0,
        createdAt: "2026-09-04T12:00:00Z",
      },
    ];

    const rendered = renderTaskFile(task, "test-task", comments);
    
    expect(rendered).toContain("title: Test Task");
    expect(rendered).toContain("slug: test-task");
    expect(rendered).toContain("priority: medium");
    expect(rendered).toContain("A task.");
    expect(rendered).toContain("## Comments");
    expect(rendered).toContain('<!-- comment id="c1"');
    expect(rendered).toContain('author="Bob"');
  });

  it("обратимость: разобрать + отрендерить + разобрать", () => {
    const original = `---
title: Reversible
slug: reversible
priority: low
estimate: l
tokens: 100k
---

Body text.

## Comments

<!-- comment id="cm1" kind="user" author="User" at="2026-09-04T10:00:00Z" -->
A comment.
`;

    const parsed1 = parseTaskFile(original, "backlog", "reversible");
    const rendered = renderTaskFile(parsed1.task, "reversible", parsed1.comments);
    const parsed2 = parseTaskFile(rendered, "backlog", "reversible");
    
    expect(parsed2.task.title).toBe(parsed1.task.title);
    expect(parsed2.task.priority).toBe(parsed1.task.priority);
    expect(parsed2.task.estimate).toBe(parsed1.task.estimate);
    expect(parsed2.task.description).toBe(parsed1.task.description);
    expect(parsed2.comments).toHaveLength(1);
    expect(parsed2.comments[0]?.body).toBe("A comment.");
  });

  it("обрабатывает пустые комментарии", () => {
    const content = `---
title: No Comments
slug: no-comments
---

Just a description.
`;

    const parsed = parseTaskFile(content, "todo", "no-comments");
    expect(parsed.comments).toHaveLength(0);
    
    const rendered = renderTaskFile(parsed.task, "no-comments", parsed.comments);
    expect(rendered).not.toContain("## Comments");
  });

  it("сохраняет неизвестные ключи фронтметра", () => {
    const existingData = { owner: "TeamA", commits: ["abc123"] };
    const task = { title: "Test", description: "" };
    const comments: Comment[] = [];

    const rendered = renderTaskFile(task, "test", comments, existingData);
    
    expect(rendered).toContain("owner: TeamA");
    expect(rendered).toContain("commits:");
    expect(rendered).toContain("abc123");
  });
});

describe("comments parsing", () => {
  it("парсит простой маркер", () => {
    const text = `<!-- comment id="c1" kind="user" author="Alice" at="2026-09-04T10:00:00Z" -->
Body text here.`;

    const comments = parseComments(text);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.id).toBe("c1");
    expect(comments[0]?.body).toBe("Body text here.");
  });

  it("парсит несколько комментариев", () => {
    const text = `<!-- comment id="c1" kind="user" author="Alice" at="2026-09-04T10:00:00Z" -->
First.

<!-- comment id="c2" kind="agent" author="Bob" preset="Opus" at="2026-09-04T11:00:00Z" -->
Second.`;

    const comments = parseComments(text);
    expect(comments).toHaveLength(2);
    expect(comments[0]?.body).toBe("First.");
    expect(comments[1]?.body).toBe("Second.");
  });

  it("не путает тело комментария, содержащее ---, с границей секции", () => {
    const text = `<!-- comment id="c1" kind="agent" author="Claude" at="2026-09-04T10:00:00Z" -->
Текст с разделителем внутри:

---
Ещё текст после дефисов.`;

    const comments = parseComments(text);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("---");
    expect(comments[0]?.body).toContain("Ещё текст после дефисов.");
  });

  it("отбрасывает маркер без обязательных атрибутов", () => {
    const text = `<!-- comment kind="user" -->
Нет id и author — маркер невалиден.`;

    expect(parseComments(text)).toHaveLength(0);
  });
});

describe("labels, checks, parent survive round-trip", () => {
  it("рендерит и разбирает метки, чек-лист и родителя обратно", () => {
    const task = {
      title: "With extras",
      description: "Body.",
      labels: ["frontend", "urgent-fix"],
      checks: ["test", "review"] as TaskCheck[],
      parentRef: "TSK-1",
    };

    const rendered = renderTaskFile(task, "with-extras", []);
    expect(rendered).toContain("labels:");
    expect(rendered).toContain("frontend");
    expect(rendered).toContain("checks:");
    expect(rendered).toContain("parent: TSK-1");

    const parsed = parseTaskFile(rendered, "backlog", "with-extras");
    expect(parsed.task.labels).toEqual(["frontend", "urgent-fix"]);
    expect(parsed.task.checks).toEqual(["test", "review"]);
    expect(parsed.task.parentRef).toBe("TSK-1");
  });

  it("не пишет updated в шапку и стирает его из старого файла", () => {
    const existingData = { title: "Old", updated: "2026-09-01T00:00:00.000Z" };
    const task = { title: "Old", description: "" };

    const rendered = renderTaskFile(task, "old", [], existingData);

    expect(rendered).not.toContain("updated:");
    const { frontmatter } = parseTaskFile(rendered, "backlog", "old");
    expect(frontmatter.updated).toBeUndefined();
  });

  it("пишет время и деньги пятью полями и не трогает старые строки tokens", () => {
    const existingData = { title: "T", tokens: "120k", tokens_actual: "140k" };
    const task = {
      title: "T",
      description: "",
      plannedMinutes: 90,
      actualMinutes: 120,
      budget: 34.1,
      budgetLimit: 60,
      cost: 41.5,
    };

    const rendered = renderTaskFile(task, "t", [], existingData);
    const { frontmatter, task: parsed } = parseTaskFile(rendered, "todo", "t");

    expect(frontmatter).toMatchObject({
      minutes: 90,
      minutes_actual: 120,
      budget: 34.1,
      limit: 60,
      cost: 41.5,
      tokens: "120k",
      tokens_actual: "140k",
    });
    expect(parsed).toMatchObject({
      plannedMinutes: 90,
      actualMinutes: 120,
      budget: 34.1,
      budgetLimit: 60,
      cost: 41.5,
    });
  });

  it("не стирает строку времени или денег, которую не прочитал", () => {
    const existingData = { title: "T", minutes: "1h 30m", cost: "12.5 USD" };
    const rendered = renderTaskFile(
      { title: "T", description: "", plannedMinutes: null, cost: null },
      "t",
      [],
      existingData,
    );
    const { frontmatter } = parseTaskFile(rendered, "todo", "t");
    expect(frontmatter.minutes).toBe("1h 30m");
    expect(frontmatter.cost).toBe("12.5 USD");
  });

  it("extraFields перекрывают собственные вычисленные поля", () => {
    const rendered = renderTaskFile(
      { title: "T", description: "" },
      "t",
      [],
      {},
      { threads: [{ id: "th1" }] },
    );
    expect(rendered).toContain("threads:");
    const { frontmatter } = parseTaskFile(rendered, "todo", "t");
    expect(frontmatter.threads).toEqual([{ id: "th1" }]);
  });
});
