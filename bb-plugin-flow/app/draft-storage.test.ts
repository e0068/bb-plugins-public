// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { editCriterion, emptyDraft, pickOption, setNote, setOwn, toggleCriterion } from "./draft";
import { clearStoredDraft, decodeDraft, encodeDraft, readStoredDraft, storeDraft } from "./draft-storage";

const question: DecisionBrief["questions"][number] = {
  id: "how",
  question: "Как?",
  kind: "fork",
  allowOwn: false,
  options: [
    { id: "a", action: "А", recommended: true, description: "А.", cost: "$1", risk: "S" },
    { id: "b", action: "Б", recommended: false, description: "Б.", cost: "$2", risk: "M" },
  ],
};

const filled = () => editCriterion(toggleCriterion(setNote(setOwn(pickOption(emptyDraft(), question, "a"), question, "Своё"), "Ко всему"), 1), 0, "Иначе");

describe("черновик переживает уход из треда", () => {
  it("кодирование и разбор возвращают тот же черновик", () => {
    expect(decodeDraft(encodeDraft(filled()))).toEqual(filled());
  });

  it("мусор, чужой формат и старый черновик без критерия не роняют разбор", () => {
    expect(decodeDraft("не json")).toBeNull();
    expect(decodeDraft(JSON.stringify({ entries: "x" }))).toBeNull();
    expect(decodeDraft(JSON.stringify({ entries: { how: { optionIds: ["a"], own: "" } }, note: "" }))).toEqual({
      ...emptyDraft(),
      entries: { how: { optionIds: ["a"], own: "" } },
    });
  });

  it("черновик лежит по id брифа, после очистки его нет", () => {
    storeDraft("dec_1", filled());
    expect(readStoredDraft("dec_1")).toEqual(filled());
    expect(readStoredDraft("dec_2")).toBeNull();
    clearStoredDraft("dec_1");
    expect(readStoredDraft("dec_1")).toBeNull();
  });
});
