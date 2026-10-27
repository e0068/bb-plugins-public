import { describe, expect, it } from "vitest";

import { commentTaskArgs } from "./bb-tasks-commands";

describe("commentTaskArgs", () => {
  it("строит `tasks comment <ключ> --body <текст> --json`", () => {
    expect(commentTaskArgs("BBPL-982", "Кода нет в main")).toEqual(["tasks", "comment", "BBPL-982", "--body", "Кода нет в main", "--json"]);
  });

  it("текст с переводами строк и кавычками уходит одним аргументом", () => {
    const body = "строка один\n«строка» \"два\"";
    expect(commentTaskArgs("BBPL-1", body)[4]).toBe(body);
  });
});
