// @vitest-environment node
import { describe, expect, it } from "vitest";

import { answerRecordSchema, askDecisionParamsSchema, decisionAnswerSchema, decisionBriefSchema } from "./contract";

const artifacts = (spec: Record<string, unknown>) => [
  { id: "task", name: "Задача", state: "missing", recommended: true },
  { id: "prototype", name: "HTML-прототип", state: "missing" },
  { id: "spec", name: "Спецификация", state: "ready", recommended: true, ...spec },
  { id: "plan", name: "План", state: "missing" },
];
const params = (link: { label: string; target: string }) => ({ title: "Бриф", setup: { artifacts: artifacts({ link }) } });
const parse = (value: unknown) => askDecisionParamsSchema.safeParse(value);

describe("память выбора в ответе и брифе", () => {
  it("ответ несёт picked у строки и читается без него", () => {
    expect(decisionAnswerSchema.parse({ briefId: "dec_1", answers: [{ questionId: "setup.executor", optionIds: ["self"], picked: ["self"] }] }).answers[0]?.picked).toEqual(["self"]);
    expect(decisionAnswerSchema.safeParse({ briefId: "dec_1", answers: [{ questionId: "setup.executor", optionIds: ["self"] }] }).success).toBe(true);
  });

  it("запись ответа несёт снимок прогноза и читается без него", () => {
    const base = { answer: { briefId: "dec_1", answers: [] }, messageId: "msg_1", answeredAt: "2026-09-14T10:00:00.000Z" };
    const forecast = { lines: [{ label: "Планирование в треде", note: "42 мин", minutes: 42, risk: 0, target: null, max: null }], minutes: 42, risk: 0, target: 0, max: 0 };
    expect(answerRecordSchema.parse({ ...base, forecast }).forecast).toEqual(forecast);
    expect(answerRecordSchema.safeParse(base).success).toBe(true);
  });

  it("бриф хранилища несёт carried", () => {
    const stored = { id: "dec_1", threadId: "thr_1", createdAt: "2026-09-14T00:00:00.000Z", title: "Бриф", setup: { executor: { recommended: "self" } }, carried: { "setup.executor": ["subagents"] } };
    expect(decisionBriefSchema.parse(stored).carried).toEqual({ "setup.executor": ["subagents"] });
  });
});

describe("подпись документа", () => {
  it("label документа — имя файла из target с расширением или без", () => {
    expect(parse(params({ label: "x.md", target: "docs/specs/x.md" })).success).toBe(true);
    expect(parse(params({ label: "x", target: "docs/specs/x.md" })).success).toBe(true);
  });

  it("label документа — ключ задачи", () => {
    expect(parse(params({ label: "BP-28", target: "docs/tasks/todo/some-slug.md" })).success).toBe(true);
  });

  it("label словом отклоняется сообщением file name or task key", () => {
    const result = parse(params({ label: "спецификация", target: "docs/specs/x.md" }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("file name or task key");
  });

  it("ссылка на URL правилу label не подчиняется", () => {
    expect(parse(params({ label: "Спека в Notion", target: "https://notion.so/spec" })).success).toBe(true);
  });

  it("записанный бриф с label словом читается хранилищем", () => {
    const stored = { id: "dec_1", threadId: "thr_1", createdAt: "2026-09-14T00:00:00.000Z", title: "Бриф", setup: { artifacts: artifacts({ link: { label: "спецификация", target: "docs/specs/x.md" } }) } };
    expect(decisionBriefSchema.safeParse(stored).success).toBe(true);
  });
});
