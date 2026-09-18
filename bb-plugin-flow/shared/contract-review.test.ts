// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionBriefSchema } from "./contract";

const forkOption = (id: string, extra: Record<string, unknown>) => ({ id, action: `Вариант ${id}`, description: "Что произойдёт", cost: "~1M", ...extra });

const accepts = (value: unknown) => askDecisionParamsSchema.safeParse(value).success;

describe("края схемы после ревью", () => {
  it("развилка нового брифа только с рисками прозой отбивается, старый бриф с ними читается", () => {
    const fork = { id: "f", question: "Как?", kind: "fork", options: [forkOption("a", { risk: "S" }), forkOption("b", { risks: "мелкие" })] };
    expect(accepts({ title: "Бриф", questions: [fork] })).toBe(false);
    const stored = { id: "dec_1", threadId: "thr_1", createdAt: "2026-09-13T00:00:00.000Z", title: "Старый", kind: "brief", questions: [fork] };
    expect(decisionBriefSchema.safeParse(stored).success).toBe(true);
  });
});
