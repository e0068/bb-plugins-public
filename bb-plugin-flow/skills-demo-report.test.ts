// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("навыки: Демонстрация — отчёт, комментарий и переход в другой flow — на утверждении", () => {
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
