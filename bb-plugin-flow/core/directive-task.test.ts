import { describe, expect, it } from "vitest";

import { taskDirectiveLine } from "./directive";

describe("taskDirectiveLine", () => {
  it("ключ задачи — директива карточки Tasks+", () => {
    expect(taskDirectiveLine("BBPL-7")).toBe('::task{key="BBPL-7"}');
  });

  it("ключ с пробелом или кавычкой директиву бы сломал — строки нет", () => {
    expect(taskDirectiveLine("BBPL 7")).toBeNull();
    expect(taskDirectiveLine('BBPL"7')).toBeNull();
    expect(taskDirectiveLine("")).toBeNull();
  });
});
