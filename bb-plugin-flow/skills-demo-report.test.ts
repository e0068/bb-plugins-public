// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("навыки: Демонстрация — отчёт, комментарий и переход в другой flow — на утверждении", () => {
  it("демонстрация без поля комментария, вопросов и nextFlow", () => {
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/no comment field and no buttons/);
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/no `questions` and no `nextFlow`/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/ни поля комментария, ни кнопок/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/без `questions` и без `nextFlow`/);
  });

  it("nextFlow описан у утверждения, комментарий пишется на нём", () => {
    expect(read("./skills/flow-approve/SKILL.md")).toMatch(/`nextFlow` — optional, only here/);
    expect(read("./skills/flow-approve/SKILL.md")).toMatch(/The tool refuses `nextFlow` on a demo/);
    expect(read("./skills/flow-approve/ru.md")).toMatch(/`nextFlow` — необязательно и только здесь/);
    expect(read("./skills/flow-approve/ru.md")).toMatch(/У демонстрации инструмент `nextFlow` отбивает/);
  });

  it("корневой навык: решённое уточнение закрывается через resolves, строку виджета вставляют один раз", () => {
    expect(read("./skills/flow/SKILL.md")).toMatch(/Paste each directive line once/);
    expect(read("./skills/flow/SKILL.md")).toMatch(/close it with `resolves: \["dec_…"\]`/);
  });

  it("старого поля комментария у демонстрации в навыках нет", () => {
    expect(read("./skills/flow-demo/SKILL.md")).not.toMatch(/the owner may send a comment later/);
    expect(read("./skills/flow/SKILL.md")).not.toMatch(/A comment on it may arrive later/);
  });
});
