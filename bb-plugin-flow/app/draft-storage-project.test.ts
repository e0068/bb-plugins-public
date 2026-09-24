// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { emptyDraft, setPlace, setRoute } from "./draft";
import { decodeDraft, encodeDraft } from "./draft-storage";

describe("выбранный чужой проект переживает перезагрузку страницы", () => {
  it("маршрут с projectId читается обратно целиком", () => {
    const draft = setRoute(setPlace(emptyDraft(), "other"), { tree: "new", branch: "none", projectId: "proj_2" });
    expect(decodeDraft(encodeDraft(draft))).toEqual(draft);
  });

  it("маршрут прежнего вида, записанный до чужих проектов, читается без потери выбора", () => {
    const written = JSON.parse(encodeDraft(setRoute(setPlace(emptyDraft(), "thread"), { tree: "local", branch: "none" }))) as Record<string, unknown>;
    expect(decodeDraft(JSON.stringify(written))?.route).toEqual({ tree: "local", branch: "none" });
  });

  it("projectId чужого вида отбрасывает весь маршрут, черновик остаётся", () => {
    const written = JSON.parse(encodeDraft(setRoute(setPlace(emptyDraft(), "other"), { tree: "new", branch: "none", projectId: "proj_2" }))) as Record<string, unknown>;
    const broken = { ...written, route: { tree: "new", branch: "none", projectId: 42 } };
    const read = decodeDraft(JSON.stringify(broken));
    expect(read?.route).toBeUndefined();
    expect(read?.place).toBe("other");
  });
});
