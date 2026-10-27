// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ALERT_TOKENS,
  DEFAULT_CONTEXT_THRESHOLDS,
  DEFAULT_WARN_TOKENS,
  CACHE_TTL_MS,
  withSubagents,
  SUBAGENT_FACTOR,
  boundaryPlan,
  cacheExpired,
  contextPercent,
  contextSegments,
  contextShare,
  contextTone,
  modelFor,
  type ContextTone,
  stageModelRole,
  thresholdsOrDefault,
  shortTokens,
} from "./context";
import { CODE_FLOW, stage } from "./stages-fixtures";

describe("доля занятого окна", () => {
  it("делит занятое на окно", () => {
    expect(contextShare(163_000, 900_000)).toBeCloseTo(0.1811, 4);
  });

  it("окно не положительное — делить не на что", () => {
    expect(contextShare(100, 0)).toBeNull();
    expect(contextShare(100, -1)).toBeNull();
  });

  it("нечисло — доли нет", () => {
    expect(contextShare(Number.NaN, 900_000)).toBeNull();
    expect(contextShare(100, Number.NaN)).toBeNull();
  });

  it("занятое сверх окна обрезается единицей, а не переполняет полосу", () => {
    expect(contextShare(1_200_000, 1_000_000)).toBe(1);
  });

  it("отрицательное занятое — ноль", () => {
    expect(contextShare(-5, 1_000_000)).toBe(0);
  });

  it("доля всегда в 0..1 либо её нет", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), fc.double({ noNaN: true }), (used, window) => {
        const share = contextShare(used, window);
        return share === null || (share >= 0 && share <= 1);
      }),
    );
  });
});

describe("процент занятого", () => {
  it("округляется до целого — того же, что стоит в подписи", () => {
    expect(contextPercent(0.2451)).toBe(25);
    expect(contextPercent(0.1811)).toBe(18);
  });

  it("всегда целое в 0..100", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (share) => {
        const percent = contextPercent(share);
        return Number.isInteger(percent) && percent >= 0 && percent <= 100;
      }),
    );
  });
});

describe("пара порогов в токенах", () => {
  it("жёлтый меньше красного — пара принимается как есть", () => {
    expect(thresholdsOrDefault(120_000, 550_000)).toEqual({ warnTokens: 120_000, alertTokens: 550_000 });
  });

  it("перевёрнутая пара — умолчание целиком, а не молчаливый разворот", () => {
    expect(thresholdsOrDefault(500_000, 300_000)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("равные пороги бессмысленны — умолчание", () => {
    expect(thresholdsOrDefault(300_000, 300_000)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("отрицательный порог — умолчание", () => {
    expect(thresholdsOrDefault(-10, 400_000)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("не число — умолчание", () => {
    expect(thresholdsOrDefault(Number.NaN, undefined)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
    expect(thresholdsOrDefault("двадцать", null)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
    expect(thresholdsOrDefault(250_000, Number.POSITIVE_INFINITY)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("по умолчанию жёлтый с 150 000 токенов, красный с 300 000", () => {
    expect(DEFAULT_WARN_TOKENS).toBe(150_000);
    expect(DEFAULT_ALERT_TOKENS).toBe(300_000);
  });

  it("порог ровно 150 000 — уже жёлтый, на токен ниже — обычный", () => {
    expect(contextTone(149_999, DEFAULT_CONTEXT_THRESHOLDS)).toBe("normal");
    expect(contextTone(150_000, DEFAULT_CONTEXT_THRESHOLDS)).toBe("warn");
    expect(contextTone(300_000, DEFAULT_CONTEXT_THRESHOLDS)).toBe("alert");
  });

  it("на любом входе пара осмысленна: жёлтый строго меньше красного, оба не отрицательны", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (warn, alert) => {
        const { warnTokens, alertTokens } = thresholdsOrDefault(warn, alert);
        return warnTokens >= 0 && warnTokens < alertTokens && Number.isFinite(alertTokens);
      }),
    );
  });
});

describe("тон полосы по занятым токенам", () => {
  const thresholds = { warnTokens: 250_000, alertTokens: 400_000 };

  it("до жёлтого порога — обычный тон", () => {
    expect(contextTone(249_999, thresholds)).toBe("normal");
  });

  it("порог входит в свою полосу", () => {
    expect(contextTone(250_000, thresholds)).toBe("warn");
    expect(contextTone(400_000, thresholds)).toBe("alert");
  });

  it("между порогами — жёлтый", () => {
    expect(contextTone(399_999, thresholds)).toBe("warn");
  });

  it("тон не зависит от окна: 300k жёлтые и в окне 1M, и в окне 2M", () => {
    expect(contextTone(300_000, thresholds)).toBe("warn");
  });

  it("тон не убывает с ростом занятого", () => {
    const rank = { normal: 0, warn: 1, alert: 2 };
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        return rank[contextTone(low, thresholds)] <= rank[contextTone(high, thresholds)];
      }),
    );
  });
});

describe("отрезки полосы по порогам", () => {
  const thresholds = { warnTokens: 250_000, alertTokens: 400_000 };

  it("оба порога внутри окна — три отрезка, границы на пороге ÷ окно", () => {
    const sizes = contextSegments(0, 1_000_000, thresholds).map((s) => s.size);
    expect(sizes).toHaveLength(3);
    [0.25, 0.15, 0.6].forEach((size, index) => expect(sizes[index]).toBeCloseTo(size, 10));
  });

  it("красный порог за окном — два отрезка, его граница не рисуется", () => {
    const segments = contextSegments(0, 300_000, thresholds);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.size).toBeCloseTo(250_000 / 300_000, 10);
  });

  it("порог ровно на окне своей границы не рисует", () => {
    expect(contextSegments(0, 400_000, thresholds)).toHaveLength(2);
  });

  it("оба порога за окном — один отрезок во всю длину", () => {
    expect(contextSegments(0, 200_000, thresholds)).toEqual([{ size: 1, filled: 0 }]);
  });

  it("нулевой порог не рождает пустой отрезок в начале", () => {
    expect(contextSegments(0, 1_000_000, { warnTokens: 0, alertTokens: 400_000 }).map((s) => s.size)).toEqual([0.4, 0.6]);
  });

  it("заполненность раскладывается по отрезкам: до занятого — полные, дальше — пустые", () => {
    const segments = contextSegments(325_000, 1_000_000, thresholds);
    expect(segments.map((s) => s.filled)).toEqual([1, 0.5, 0]);
  });

  it("окно не положительное — отрезков нет", () => {
    expect(contextSegments(100, 0, thresholds)).toEqual([]);
  });

  it("отрезки покрывают всю полосу, а заливка в сумме равна доле занятого", () => {
    fc.assert(
      fc.property(fc.nat(2_000_000), fc.integer({ min: 1, max: 2_000_000 }), fc.nat(1_000_000), fc.integer({ min: 1, max: 1_000_000 }), (used, window, warn, gap) => {
        const segments = contextSegments(used, window, { warnTokens: warn, alertTokens: warn + gap });
        const total = segments.reduce((sum, s) => sum + s.size, 0);
        const filled = segments.reduce((sum, s) => sum + s.size * s.filled, 0);
        return (
          segments.length >= 1 &&
          segments.length <= 3 &&
          segments.every((s) => s.size > 0 && s.filled >= 0 && s.filled <= 1) &&
          Math.abs(total - 1) < 1e-9 &&
          Math.abs(filled - Math.min(1, used / window)) < 1e-9
        );
      }),
    );
  });
});

describe("токены коротко", () => {
  it("тысячи и миллионы — как их пишет bb", () => {
    expect(shortTokens(163_000)).toBe("163k");
    expect(shortTokens(900_000)).toBe("900k");
    expect(shortTokens(1_000_000)).toBe("1M");
    expect(shortTokens(1_250_000)).toBe("1.3M");
    expect(shortTokens(950)).toBe("950");
  });
});

describe("кэш провайдера", () => {
  const created = "2026-10-26T00:00:00.000Z";
  const at = (ms: number) => new Date(Date.parse(created) + ms);

  it("час — это 3 600 000 мс", () => {
    expect(CACHE_TTL_MS).toBe(3_600_000);
  });

  it("через 59 мин 59 с кэш жив, через 60 мин 1 с истёк", () => {
    expect(cacheExpired(created, at(59 * 60_000 + 59_000))).toBe(false);
    expect(cacheExpired(created, at(60 * 60_000 + 1_000))).toBe(true);
  });

  it("ровно час — ещё не истёк: истёк, когда прошло больше часа", () => {
    expect(cacheExpired(created, at(CACHE_TTL_MS))).toBe(false);
    expect(cacheExpired(created, at(CACHE_TTL_MS + 1))).toBe(true);
  });

  it("время нечитаемо — кэш считается живым, сжатие само не включается", () => {
    expect(cacheExpired("не дата", at(10 * CACHE_TTL_MS))).toBe(false);
  });

  it("истечение монотонно по времени", () => {
    fc.assert(
      fc.property(fc.nat(10_000_000_000), fc.nat(10_000_000_000), (a, b) => {
        const [early, late] = a <= b ? [a, b] : [b, a];
        return !cacheExpired(created, at(early)) || cacheExpired(created, at(late));
      }),
    );
  });
});

describe("модель этапа", () => {
  const byId = (id: string) => CODE_FLOW.find((s) => s.id === id)!;

  it("реализация и тестирование — Sonnet", () => {
    expect(stageModelRole(byId("implement"))).toBe("sonnet");
    expect(stageModelRole(byId("testing"))).toBe("sonnet");
  });

  it("остальные этапы агента, встроенные и навыковые, — Opus", () => {
    ["questions", "criteria", "select", "task", "prototype", "demo", "spec", "plan", "review"].forEach((id) => expect(stageModelRole(byId(id))).toBe("opus"));
  });

  it("автоматизация и Action исполняются Flow, у них модели нет", () => {
    expect(stageModelRole(byId("flow-automation"))).toBeNull();
    expect(stageModelRole(stage("press", { kind: "action", skill: "" }))).toBeNull();
  });

  it("навык `code-standards-fp` у встроенного этапа тоже даёт Sonnet", () => {
    expect(stageModelRole(stage("x", { kind: "demo", skill: "code-standards-fp" }))).toBe("sonnet");
  });

  it("первая модель каталога, чей id содержит имя роли", () => {
    const models = [{ model: "claude-haiku-4-5" }, { model: "claude-opus-4-1" }, { model: "claude-sonnet-4-5" }, { model: "claude-sonnet-4-6" }];
    expect(modelFor("sonnet", models)).toBe("claude-sonnet-4-5");
    expect(modelFor("opus", models)).toBe("claude-opus-4-1");
  });

  it("нужной модели в каталоге нет или каталог пуст — null", () => {
    expect(modelFor("sonnet", [{ model: "claude-opus-4-1" }])).toBeNull();
    expect(modelFor("opus", [])).toBeNull();
  });

  it("регистр id не важен", () => {
    expect(modelFor("sonnet", [{ model: "Claude-SONNET-4" }])).toBe("Claude-SONNET-4");
  });
});

describe("план границы этапов", () => {
  const opus = { model: "opus", reasoningLevel: "high" } as const;
  const sonnet = { model: "sonnet", reasoningLevel: "high" } as const;

  it("контекст ниже жёлтого и та же модель с тем же effort — плана нет", () => {
    expect(boundaryPlan({ tone: "normal", current: opus, approved: opus })).toBeNull();
  });

  it("утверждённой модели нет — модель не трогается, плана нет", () => {
    expect(boundaryPlan({ tone: "normal", current: opus, approved: null })).toBeNull();
    expect(boundaryPlan({ tone: "normal", current: null, approved: null })).toBeNull();
  });

  it("жёлтый и красный тон велят сжать, модель остаётся", () => {
    expect(boundaryPlan({ tone: "warn", current: opus, approved: opus })).toEqual({ compact: true, model: null });
    expect(boundaryPlan({ tone: "alert", current: opus, approved: null })).toEqual({ compact: true, model: null });
  });

  it("другая модель при обычном тоне — только смена модели вместе с effort", () => {
    expect(boundaryPlan({ tone: "normal", current: opus, approved: sonnet })).toEqual({ compact: false, model: sonnet });
  });

  it("та же модель с другим effort — смена effort", () => {
    expect(boundaryPlan({ tone: "normal", current: opus, approved: { model: "opus", reasoningLevel: "medium" } })).toEqual({ compact: false, model: { model: "opus", reasoningLevel: "medium" } });
  });

  it("модель треда неизвестна, а утверждённая есть — ставится", () => {
    expect(boundaryPlan({ tone: "normal", current: null, approved: sonnet })).toEqual({ compact: false, model: sonnet });
  });

  it("жёлтый тон и другая модель — и сжатие, и модель", () => {
    expect(boundaryPlan({ tone: "warn", current: opus, approved: sonnet })).toEqual({ compact: true, model: sonnet });
  });

  it("план есть ровно тогда, когда тон не обычный или утверждённое отличается от стоящего", () => {
    const tones = fc.constantFrom<ContextTone>("normal", "warn", "alert");
    const models = fc.constantFrom(null, opus, sonnet, { model: "opus", reasoningLevel: "low" } as const);
    fc.assert(
      fc.property(tones, models, models, (tone, current, approved) => {
        const plan = boundaryPlan({ tone, current, approved });
        const differs = approved !== null && (current === null || approved.model !== current.model || approved.reasoningLevel !== current.reasoningLevel);
        return (plan !== null) === (tone !== "normal" || differs) && (plan === null || (plan.model === null) === !differs);
      }),
    );
  });
});

describe("совет о субагенте в отчётах брифа", () => {
  const agent = { id: "agent:implementer", kind: "agent", name: "implementer" } as const;
  const workflow = { id: "workflow:lead", kind: "workflow", name: "lead" } as const;
  const stages = [
    stage("implement", { skill: "code-standards-fp", executors: [agent] }),
    stage("testing", { skill: "testing-tdd", executors: [workflow, agent] }),
    stage("spec", { skill: "spec", executors: [agent] }),
    stage("bare", { skill: "code-standards-fp" }),
    stage("flowonly", { skill: "code-standards-fp", executors: [workflow] }),
  ];
  const report = (id: string, patch: Record<string, unknown> = {}) => ({ id, state: "todo", executor: "self", ...patch });
  const reports = [report("implement"), report("testing"), report("spec"), report("bare"), report("flowonly")];
  const warn = DEFAULT_CONTEXT_THRESHOLDS;

  it("ниже порога отчёты не меняются", () => {
    expect(withSubagents(reports, stages, contextTone(149_999, warn))).toEqual(reports);
  });

  it("на пороге ровно реализация и тесты получают первого агента этапа и его множитель", () => {
    const out = withSubagents(reports, stages, contextTone(150_000, warn));
    expect(out[0]).toMatchObject({ executor: "agent:implementer", factors: { "agent:implementer": SUBAGENT_FACTOR } });
    expect(out[1]).toMatchObject({ executor: "agent:implementer", factors: { "agent:implementer": { factor: 0.7, risk: 0 } } });
  });

  it("этап с другой ролью, без агента-исполнителя или только с workflow не трогается", () => {
    const out = withSubagents(reports, stages, "alert");
    expect(out.slice(2)).toEqual(reports.slice(2));
  });

  it("этап, где уже выбран исполнитель или сделан, не трогается; свой множитель агента сохраняется", () => {
    const chosen = [report("implement", { executor: "agent:implementer" }), report("testing", { state: "done" })];
    expect(withSubagents(chosen, stages, "warn")).toEqual(chosen);
    const own = [report("implement", { factors: { "agent:implementer": { factor: 1.2, risk: 1 } } })];
    expect(withSubagents(own, stages, "warn")[0]).toMatchObject({ executor: "agent:implementer", factors: { "agent:implementer": { factor: 1.2, risk: 1 } } });
  });
});
