// @vitest-environment node
// Учебное содержимое карточки каждого вида — настоящий виджет: схема виджета принимает его на обоих языках.
import { describe, expect, it } from "vitest";

import { BUILTIN_KINDS } from "../lib/stage-constants";
import { en } from "../lib/messages/en";
import { ru } from "../lib/messages/ru";
import { decisionBriefSchema } from "../shared/contract";
import { exampleBrief } from "./widget-page";

describe("учебное содержимое карточки виджета", () => {
  it.each([
    ["ru", ru],
    ["en", en],
  ] as const)("все виды проходят схему виджета, язык %s", (_, messages) => {
    const problems = BUILTIN_KINDS.map((kind) => {
      const parsed = decisionBriefSchema.safeParse(exampleBrief(kind, messages));
      return parsed.success ? null : `${kind}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
    });
    expect(problems.filter((p) => p !== null)).toEqual([]);
  });

  it("id каждого вида свой и не похож на id настоящего виджета: сервер для него черновик отвергает", () => {
    const ids = BUILTIN_KINDS.map((kind) => exampleBrief(kind, ru).id);
    expect(new Set(ids).size).toBe(BUILTIN_KINDS.length);
    expect(ids.every((id) => id.startsWith("example:"))).toBe(true);
  });
});
