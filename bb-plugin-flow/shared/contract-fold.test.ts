// @vitest-environment node
import { describe, expect, it } from "vitest";

import { answerRecordSchema, decisionBriefSchema, decisionsRpcContract, foldSchema, restoredDraftSchema, threadGroupSchema } from "./contract";

const base = { id: "dec_1", threadId: "thr_1", createdAt: "2026-10-12T10:00:00.000Z", title: "Бриф", kind: "brief", questions: [{ id: "go", kind: "confirm", question: "Так?", allowOwn: false, options: [{ id: "yes", action: "Yes", recommended: true }] }] };
const answer = { briefId: "dec_0", answers: [{ questionId: "route", optionIds: ["a"] }] };

describe("выбор владельца в новом брифе", () => {
  it("принимает запись прежнего вида — один черновик — и новый вид с источниками", () => {
    expect(restoredDraftSchema.safeParse({ draft: "{}", criteria: ["Пункт"] }).success).toBe(true);
    expect(restoredDraftSchema.safeParse({ sources: [{ draft: "{}" }, { answer, criteria: ["Пункт"] }] }).success).toBe(true);
    expect(restoredDraftSchema.safeParse({}).success).toBe(true);
  });

  it("бриф, записанный до групп, читается без изменений; бриф с источниками — тоже", () => {
    expect(decisionBriefSchema.safeParse({ ...base, restored: { draft: "{}" } }).success).toBe(true);
    expect(decisionBriefSchema.safeParse({ ...base, restored: { sources: [{ answer }] } }).success).toBe(true);
  });

  it("источник с чужой формой ответа отбрасывается схемой", () => {
    expect(restoredDraftSchema.safeParse({ sources: [{ answer: { answers: "нет" } }] }).success).toBe(false);
  });
});

describe("запись ответа, сделанная до правки", () => {
  it("с меткой posted, которой больше нет в схеме, читается: лишний ключ отбрасывается", () => {
    const old = { answer, messageId: "msg_1", answeredAt: "2026-10-12T10:05:00.000Z", posted: true };
    const read = answerRecordSchema.safeParse(old);
    expect(read.success).toBe(true);
    expect(read.success && "posted" in read.data).toBe(false);
  });
});

describe("группа треда и свёртка", () => {
  it("список группы несёт id, признак утверждения последним и признак свёртки", () => {
    expect(threadGroupSchema.safeParse({ ids: ["a"], lastApprove: false, folded: false }).success).toBe(true);
    expect(threadGroupSchema.safeParse({ ids: ["a"], lastApprove: false }).success).toBe(false);
  });

  it("свёртка называет держателя и непустой список группы", () => {
    expect(foldSchema.safeParse({ holder: "a", ids: ["a"] }).success).toBe(true);
    expect(foldSchema.safeParse({ holder: "a", ids: [] }).success).toBe(false);
  });

  it("ответ getBrief несёт свёртку и черновик; без них — как раньше", () => {
    const { output } = decisionsRpcContract.getBrief;
    const brief = { ...base };
    expect(output.safeParse({ kind: "found", brief, answer: null }).success).toBe(true);
    expect(output.safeParse({ kind: "found", brief, answer: null, fold: { holder: "dec_2", ids: ["dec_1", "dec_2"] }, draft: "{}" }).success).toBe(true);
  });
});
