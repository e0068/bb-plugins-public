// @vitest-environment node
// Строка «Flow» не бывает ни под-этапом, ни владельцем: перетаскивание не даёт собрать такую связку.
import { describe, expect, it } from "vitest";

import type { WorkStage } from "../shared/contract";
import { dropStage } from "./sub-stages";
import { stage } from "./stages-fixtures";

const ref = (id: string): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], flowId: "answer" });
const ids = (stages: readonly WorkStage[] | null) => stages?.map((s) => s.id) ?? null;

const LIST = [stage("task"), ref("nested"), stage("ship")];

describe("dropStage со строкой «Flow»", () => {
  it("обычный этап в середину строки «Flow» не встаёт: связки со строкой нет", () => {
    expect(dropStage(LIST, "task", "nested", 2)).toBeNull();
    expect(dropStage(LIST, "ship", "nested", 3)).toBeNull();
  });

  it("строка «Flow» в середину обычного этапа не встаёт: она не под-этап", () => {
    expect(dropStage(LIST, "nested", "ship", 2)).toBeNull();
    expect(dropStage(LIST, "nested", "task", 3)).toBeNull();
  });

  it("строка «Flow» переставляется на верхнем уровне: верхняя и нижняя четверти работают", () => {
    expect(ids(dropStage(LIST, "nested", "task", 1))).toEqual(["nested", "task", "ship"]);
    expect(ids(dropStage(LIST, "nested", "ship", 4))).toEqual(["task", "ship", "nested"]);
  });

  it("обычный этап рядом со строкой «Flow» переставляется как раньше", () => {
    expect(ids(dropStage(LIST, "task", "nested", 4))).toEqual(["nested", "task", "ship"]);
  });

  it("список без строк «Flow» ведёт себя как раньше: под-этап в середину владельца встаёт", () => {
    const plain = [stage("preview"), stage("demo")];
    expect(dropStage(plain, "preview", "demo", 2)?.find((s) => s.id === "preview")?.parent).toBe("demo");
  });
});
