// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { emptyDraft, setOutcomeNote, setPlace, setRoute } from "./draft";
import { decodeDraft, encodeDraft } from "./draft-storage";

describe("черновик хранит всё, что набрал и выбрал владелец", () => {
  it("комментарий Демонстрации, место и маршрут переживают уход во вкладку", () => {
    const draft = setRoute(setPlace(setOutcomeNote(emptyDraft(), "Поправь подпись"), "thread"), { tree: "new", branch: "from-current" });
    expect(decodeDraft(encodeDraft(draft))).toEqual(draft);
  });

  it("чужие значения этих полей отбрасываются, остальной черновик читается", () => {
    const raw = JSON.stringify({ ...emptyDraft(), note: "Ко всему", outcomeNote: 5, outcomeRework: "да", place: "где-то", route: { tree: 1 } });
    expect(decodeDraft(raw)).toEqual({ ...emptyDraft(), note: "Ко всему" });
  });
});
