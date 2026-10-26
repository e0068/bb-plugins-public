// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("навыки: Демонстрация — отчёт, комментарий и переход в другой flow — на утверждении", () => {
  it("демонстрация без кнопок, вопросов и nextFlow; поле комментария — только когда впереди Утверждение", () => {
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/The demo widget is the report: no buttons\. When an approval stands ahead, it has a comment field/);
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/no `questions` and no `nextFlow`/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/кнопок нет\. Когда впереди Утверждение, у него есть поле комментария/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/без `questions` и без `nextFlow`/);
  });

  it("nextFlow описан у утверждения, комментарий пишется на нём", () => {
    expect(read("./skills/flow-approve/SKILL.md")).toMatch(/`nextFlow` — optional, only here/);
    expect(read("./skills/flow-approve/SKILL.md")).toMatch(/The tool refuses `nextFlow` on a demo/);
    expect(read("./skills/flow-approve/ru.md")).toMatch(/`nextFlow` — необязательно и только здесь/);
    expect(read("./skills/flow-approve/ru.md")).toMatch(/У демонстрации инструмент `nextFlow` отбивает/);
  });

  it("старого поля комментария у демонстрации в навыках нет", () => {
    expect(read("./skills/flow-demo/SKILL.md")).not.toMatch(/the owner may send a comment later/);
    expect(read("./skills/flow/SKILL.md")).not.toMatch(/A comment on it may arrive later/);
  });
});
