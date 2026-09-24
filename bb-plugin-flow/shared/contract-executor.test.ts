// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema } from "./contract";

const brief = (setup: Record<string, unknown>) => ({ title: "Бриф", setup });

const accepts = (setup: Record<string, unknown>) => askDecisionParamsSchema.safeParse(brief(setup)).success;

const models = (recommended: number, ...names: string[]) => names.map((name, i) => ({ name, recommended: i === recommended }));

describe("исполнитель и проверяющий в первой части", () => {
  it("исполнитель — одна рекомендация из четырёх способов", () => {
    for (const recommended of ["self", "subagents", "workflow", "fanout"]) expect(accepts({ executor: { recommended } })).toBe(true);
    expect(accepts({ executor: { recommended: "pipeline" } })).toBe(false);
  });

  it("проверяющий — сам, сторонний агент с моделями или шаг workflow", () => {
    expect(accepts({ checker: { recommended: "self" } })).toBe(true);
    expect(accepts({ checker: { recommended: "workflow" } })).toBe(true);
    expect(accepts({ checker: { recommended: "agent", models: models(0, "Opus 5", "Sonnet 5") } })).toBe(true);
  });

  it("рекомендованный сторонний агент называет ровно одну рекомендованную модель", () => {
    expect(accepts({ checker: { recommended: "agent" } })).toBe(false);
    expect(accepts({ checker: { recommended: "agent", models: models(-1, "Opus 5", "Sonnet 5") } })).toBe(false);
    expect(accepts({ checker: { recommended: "self", models: [{ name: "Opus 5", recommended: true }, { name: "Sonnet 5", recommended: true }] } })).toBe(false);
  });

  it("бриф только из исполнителя и проверяющего есть что решать", () => {
    expect(accepts({ executor: { recommended: "self" }, checker: { recommended: "self" } })).toBe(true);
  });

  it("у неактуального артефакта может быть ссылка на прежний документ", () => {
    const stale = { id: "spec", name: "Спецификация", state: "stale", recommended: true, link: { label: "spec.md", target: "docs/specs/spec.md" } };
    const artifacts = [
      { id: "task", name: "Задача", state: "missing" },
      { id: "prototype", name: "HTML-прототип", state: "missing" },
      stale,
      { id: "plan", name: "План", state: "missing" },
    ];
    expect(accepts({ artifacts })).toBe(true);
  });
});

describe("ссылки и рекомендации артефактов", () => {
  const artifacts = (overrides: Record<string, Record<string, unknown>>) =>
    [
      { id: "task", name: "Задача", state: "approved", link: { label: "SL-1", target: "t.md" } },
      { id: "prototype", name: "HTML-прототип", state: "ready", link: { label: "p.html", target: "p.html" } },
      { id: "spec", name: "Спецификация", state: "missing" },
      { id: "plan", name: "План", state: "missing" },
    ].map((a) => ({ ...a, ...(overrides[a.id] ?? {}) }));

  it("утверждённый и готовый без ссылки, отсутствующий со ссылкой и рекомендация у утверждённого отбиваются", () => {
    expect(accepts({ artifacts: artifacts({ task: { link: undefined } }) })).toBe(false);
    expect(accepts({ artifacts: artifacts({ prototype: { link: undefined } }) })).toBe(false);
    expect(accepts({ artifacts: artifacts({ plan: { link: { label: "plan.md", target: "plan.md" } } }) })).toBe(false);
    expect(accepts({ artifacts: artifacts({ task: { recommended: true } }) })).toBe(false);
  });

  it("все четыре утверждены — есть что решать: утверждение можно отозвать", () => {
    const approved = (label: string) => ({ state: "approved", link: { label, target: label } });
    expect(accepts({ artifacts: artifacts({ prototype: { state: "approved" }, spec: approved("spec.md"), plan: approved("plan.md") }) })).toBe(true);
  });
});

describe("проверка в рамках workflow в схеме", () => {
  it("рекомендовать шаг workflow можно только при исполнителе workflow или с фанаутом", () => {
    expect(accepts({ executor: { recommended: "self" }, checker: { recommended: "workflow" } })).toBe(false);
    expect(accepts({ executor: { recommended: "subagents" }, checker: { recommended: "workflow" } })).toBe(false);
    expect(accepts({ executor: { recommended: "workflow" }, checker: { recommended: "workflow" } })).toBe(true);
    expect(accepts({ executor: { recommended: "fanout" }, checker: { recommended: "workflow" } })).toBe(true);
  });
});
