// @vitest-environment node
import { describe, expect, it } from "vitest";

import { SETUP_ROW, rowsOf } from "../core/rows";
import type { DecisionBrief } from "../shared/contract";
import { decidedCount, initialDraft, pickOption } from "./draft";

const brief = (recommended: "self" | "agent" | "workflow", executor: "self" | "workflow"): DecisionBrief => ({
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  setup: { executor: { recommended: executor }, checker: { recommended, models: [{ name: "Opus 5", recommended: recommended === "agent" }] } },
  questions: [],
});

const row = (b: DecisionBrief, id: string) => rowsOf(b).find((r) => r.id === id)!;

describe("смена исполнителя не оставляет проверку в рамках workflow без workflow", () => {
  it("исполнитель workflow с фанаутом сохраняет выбранный шаг workflow", () => {
    const b = brief("workflow", "workflow");
    const fanout = pickOption(initialDraft(b), row(b, SETUP_ROW.executor), "fanout", b);
    expect(fanout.entries[SETUP_ROW.checker]?.optionIds).toEqual(["workflow"]);
  });
});
