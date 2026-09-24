// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { emptyDraft, setPlace, setRoute } from "./draft";
import { decodeDraft, encodeDraft } from "./draft-storage";

describe("выбор дочернего треда переживает уход из треда", () => {
  it("место child и его маршрут читаются обратно", () => {
    const draft = setRoute(setPlace(emptyDraft(), "child"), { tree: "new", branch: "from-current" });
    expect(decodeDraft(encodeDraft(draft))).toEqual(draft);
  });

  it("место чужого вида отбрасывается, остальной черновик остаётся", () => {
    const written = JSON.parse(encodeDraft(setPlace(emptyDraft(), "child"))) as Record<string, unknown>;
    expect(decodeDraft(JSON.stringify({ ...written, place: "somewhere" }))?.place).toBeUndefined();
  });
});
