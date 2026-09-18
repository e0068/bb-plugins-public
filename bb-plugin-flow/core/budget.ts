// Прогноз бюджета, риска и времени брифа — сумма добавок того, что владелец
// оставил и выбрал. В брифе с этапами цена работы — этапы в прогоне, а добавка
// пункта «Готово, когда» — его доля внутри них: снятый пункт её вычитает. Старый
// бриф без этапов складывает пункты, артефакты, исполнителя, ревью и
// тестирование. Варианты вопросов прибавляются в обоих. Считается по брифу и
// ответу, поэтому одинаково и в кнопке виджета, и в реплике агенту.
import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import type { Add, Checker, Criterion, DecisionAnswer, DecisionBrief } from "../shared/contract";
import { SETUP_ROW, rowsOf } from "./rows";
import { sumAdds } from "./adds";
import { removedCriteria } from "./option-criteria";
import { answeredStageChoice, executorLabel, stageAdd, stageItems, stagePhase } from "./stages";

/** Строка разбивки; `null` — величина неизвестна: у планирования без цены модели нет денег, у добавок без `minutes` — времени. */
export type ForecastLine = { label: string; note: string; minutes: number | null; risk: number; target: number | null; max: number | null };

/** Итог складывает известное; время `null`, если ни у одной строки его нет; `spent` — сколько первых строк уже потрачено. */
export type Forecast = { lines: readonly ForecastLine[]; minutes: number | null; risk: number; target: number; max: number; spent?: number };

/** Заголовок пункта — то, чем пункт назван в разбивке и в реплике агенту. */
export const criterionTitle = (item: Criterion): string => (typeof item === "string" ? item : item.text);

/** Пункт-изменение: у него есть «было» и «стало». */
export const changeOf = (item: Criterion): { text: string; before: string; after: string } | undefined =>
  typeof item !== "string" && "before" in item ? item : undefined;

/** Текст, который правит владелец: у пункта-изменения — «стало», у остальных — сам пункт. */
export const criterionEditable = (item: Criterion): string => changeOf(item)?.after ?? criterionTitle(item);

const addOf = (item: Criterion): Add | undefined => (typeof item === "string" ? undefined : item.add);

const round = (n: number): number => Math.round(n * 100) / 100;

export const money = (n: number): string => `$${round(n)}`;

const sign = (n: number): string => (n < 0 ? "–" : "+");

/** «+$3–5», «+$3», экономия «–$2–4» — меньшая по модулю граница первой; разные знаки — «–$2…+$3». */
const moneyRange = (target: number, max: number): string => {
  if (target === max) return `${sign(target)}${money(Math.abs(target))}`;
  if (target < 0 && max > 0) return `–${money(-target)}…+${money(max)}`;
  const [low, high] = target < 0 ? [-max, -target] : [target, max];
  return `${sign(target)}${money(low)}–${round(high)}`;
};

export const signed = (risk: number): string => (risk === 0 ? "0" : risk > 0 ? `+${risk}` : `−${Math.abs(risk)}`);

/** Риск добавки: «+1r», «–2r»; нулевой риск не пишется. */
export const riskText = (risk: number): string => (risk === 0 ? "" : `${sign(risk)}${Math.abs(risk)}r`);

export const minutesText = (minutes: number, locale?: Locale): string => messages(locale).budget.minutes(minutes);

export type AddParts = { money: string; risk: { text: string; sign: -1 | 0 | 1 }; time: string };

/** Части подписи добавки по отдельности — виджет красит риск по знаку; часть, которая ничего не меняет, пустая. */
export const addParts = (add: Add, locale?: Locale): AddParts => ({
  money: add.target === 0 && add.max === 0 ? "" : moneyRange(add.target, add.max),
  risk: { text: riskText(add.risk), sign: add.risk === 0 ? 0 : add.risk > 0 ? 1 : -1 },
  time: add.minutes === undefined || add.minutes === 0 ? "" : `${sign(add.minutes)}${minutesText(Math.abs(add.minutes), locale)}`,
});

/** Мелкая подпись добавки: «+$3–5 –2r +20 мин»; пустая добавка — пустая строка. */
export const addText = (add: Add, locale?: Locale): string => {
  const parts = addParts(add, locale);
  return [parts.money, parts.risk.text, parts.time].filter((part) => part !== "").join(" ");
};

const sumOf = (values: ReadonlyArray<number | undefined>): number | null => {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length === 0 ? null : known.reduce((s, v) => s + v, 0);
};

const line = (label: string, note: string, adds: ReadonlyArray<Add | undefined>): ForecastLine[] => {
  const sum = sumAdds(adds);
  return sum === undefined ? [] : [{ label, note, minutes: sum.minutes ?? null, risk: sum.risk, target: sum.target, max: sum.max }];
};

const chosen = (answer: DecisionAnswer, rowId: string): readonly string[] =>
  answer.answers.find((a) => a.questionId === rowId)?.optionIds ?? [];

/** Подписи строки планирования на всех языках; по ним снимки ответов, записанные до `spent`, узнают уже потраченное. */
const PLANNING_LABELS: readonly string[] = [messages("ru").budget.planning, messages("en").budget.planning];

/** Уже потраченное на планирование — первая строка разбивки, риска не добавляет; без цены модели — только минуты. */
const planningLines = (brief: DecisionBrief, locale?: Locale): ForecastLine[] => {
  const p = brief.planning;
  if (p === undefined) return [];
  const cost = p.cost ?? null;
  return [{ label: messages(locale).budget.planning, note: minutesText(p.minutes, locale), minutes: p.minutes, risk: 0, target: cost, max: cost }];
};

/** Сколько первых строк разбивки — уже потраченное; снимок без пометки узнаёт планирование по подписи первой строки. */
export const spentLines = (f: Pick<Forecast, "lines" | "spent">): number => f.spent ?? (PLANNING_LABELS.includes(f.lines[0]?.label ?? "") ? 1 : 0);

/** Запланированное время работы: минуты разбивки без уже потраченного, не меньше нуля; `null`, если ни у одной строки времени нет. */
export const plannedMinutes = (f: Pick<Forecast, "lines" | "spent">): number | null => {
  const sum = sumOf(f.lines.slice(spentLines(f)).map((l) => l.minutes ?? undefined));
  return sum === null ? null : Math.max(0, sum);
};

/** Этап в прогоне, ещё не сделанный, — строка «название · исполнитель»; сделанный работы не добавляет. */
const stageLines = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): ForecastLine[] =>
  stageItems(brief).flatMap((item) => {
    const choice = answeredStageChoice(brief, answer, item);
    return stagePhase(item) !== "todo" || !choice.run ? [] : line(item.stage.name, executorLabel(item.stage, choice.executor, locale), [stageAdd(item, choice.executor)]);
  });

/** Планирование в треде одной строкой: «42 мин, $4.2», без цены — только минуты; `null`, если планирования нет. */
export const planningNote = (brief: DecisionBrief, locale?: Locale): string | null => {
  const p = brief.planning;
  return p === undefined ? null : `${minutesText(p.minutes, locale)}${p.cost === undefined ? "" : `, ${money(p.cost)}`}`;
};

/** Снятые пункты вычитают свою долю из этапов в прогоне; без этапов в прогоне вычитать не из чего. */
const removedShareLines = (brief: DecisionBrief, removed: readonly number[], stages: readonly ForecastLine[], locale?: Locale): ForecastLine[] => {
  if (stages.length === 0) return [];
  const m = messages(locale).budget;
  return (brief.setup?.criteria ?? []).flatMap((item, i) => {
    const add = removed.includes(i) ? addOf(item) : undefined;
    return add === undefined ? [] : [{ label: m.removedItem(i + 1), note: criterionTitle(item), minutes: add.minutes === undefined ? null : -add.minutes, risk: -add.risk, target: -add.target, max: -add.max }];
  });
};

const setupLines = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): ForecastLine[] => {
  const m = messages(locale).budget;
  const setup = brief.setup;
  if (setup === undefined) return [];
  const removed = removedCriteria(brief, answer);
  if (setup.stages !== undefined) {
    const stages = stageLines(brief, answer, locale);
    return [...stages, ...removedShareLines(brief, removed, stages, locale)];
  }
  const criteria = (setup.criteria ?? []).flatMap((item, i) =>
    removed.includes(i) ? [] : line(m.item(i + 1), criterionTitle(item), [addOf(item)]),
  );
  // Утверждённый и оставленный артефакт работы не добавляет.
  const artifactIds = chosen(answer, SETUP_ROW.artifacts);
  const artifacts = (setup.artifacts ?? []).filter((a) => a.state !== "approved" && artifactIds.includes(a.id));
  const rows = new Map(rowsOf(brief, locale).map((r) => [r.id, r]));
  const actionOf = (rowId: string, id: string) => rows.get(rowId)?.options.find((o) => o.id === id)?.action ?? id;
  const executorId = chosen(answer, SETUP_ROW.executor)[0];
  const byKey = (adds: Partial<Record<string, Add>> | undefined, id: string): Add | undefined => adds?.[id];
  const reviewLine = (rowId: string, label: string, review: Checker | undefined): ForecastLine[] => {
    const id = chosen(answer, rowId)[0];
    if (id === undefined) return [];
    const reviewAdd = id.startsWith("agent:") ? review?.models?.find((m) => `agent:${m.name}` === id)?.add : byKey(review?.adds, id);
    return line(label, actionOf(rowId, id), [reviewAdd]);
  };
  return [
    ...criteria,
    ...line(m.artifacts, artifacts.map((a) => a.name.toLowerCase()).join(", "), artifacts.map((a) => a.add)),
    ...(executorId === undefined ? [] : line(m.executor, actionOf(SETUP_ROW.executor, executorId), [byKey(setup.executor?.adds, executorId)])),
    ...reviewLine(SETUP_ROW.checker, m.review, setup.checker),
    ...reviewLine(SETUP_ROW.testing, m.testing, setup.testing),
  ];
};

const questionLines = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): ForecastLine[] =>
  brief.questions.flatMap((q, i) => {
    const ids = chosen(answer, q.id);
    return q.options.filter((o) => ids.includes(o.id)).flatMap((o) => line(messages(locale).budget.question(i + 1), o.action, [o.add]));
  });

/** Итог прогона: сумма запланированного, не меньше нуля; уже потраченное — справочные первые строки разбивки, в итог не входит; потолок не ниже цели. */
export const forecast = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): Forecast => {
  const spent = planningLines(brief, locale);
  const planned = [...setupLines(brief, answer, locale), ...questionLines(brief, answer, locale)];
  const lines = [...spent, ...planned];
  const minutes = sumOf(lines.map((l) => l.minutes ?? undefined)) === null ? null : Math.max(0, sumOf(planned.map((l) => l.minutes ?? undefined)) ?? 0);
  const total = (key: "target" | "max") => round(Math.max(0, planned.reduce((s, l) => s + (l[key] ?? 0), 0)));
  const target = total("target");
  return {
    lines,
    minutes,
    risk: planned.reduce((s, l) => s + l.risk, 0),
    target,
    max: Math.max(target, total("max")),
    spent: spent.length,
  };
};

/**
 * Держит ли бриф прогноз: хоть у одного пункта, артефакта, способа или варианта есть добавка.
 * У брифа запущенной работы прогноза нет: деньги в нём уже не решаются.
 */
export const hasForecast = (brief: DecisionBrief): boolean => {
  if (brief.launched === true) return false;
  const s = brief.setup;
  return (
    brief.planning !== undefined ||
    (s?.criteria ?? []).some((c) => addOf(c) !== undefined) ||
    (s?.artifacts ?? []).some((a) => a.add !== undefined) ||
    (s?.stages ?? []).some((r) => r.add !== undefined || Object.keys(r.adds ?? {}).length > 0) ||
    Object.values(s?.executor?.adds ?? {}).some((a) => a !== undefined) ||
    [s?.checker, s?.testing].some((r) => Object.values(r?.adds ?? {}).some((a) => a !== undefined) || (r?.models ?? []).some((m) => m.add !== undefined)) ||
    brief.questions.some((q) => q.options.some((o) => o.add !== undefined))
  );
};

const blank = (value: string | undefined): boolean => (value ?? "").trim() === "";

export const hasOwnBudget = (answer: DecisionAnswer): boolean => !blank(answer.budget?.target) || !blank(answer.budget?.max);

/** Своя цена одной строкой: пустое поле — прочерк; `null`, если своей цены нет. */
export const ownBudgetText = (budget: { target?: string | undefined; max?: string | undefined }, locale?: Locale): string | null =>
  blank(budget.target) && blank(budget.max) ? null : `${blank(budget.target) ? "—" : (budget.target ?? "").trim()} · ${messages(locale).budget.upTo} ${blank(budget.max) ? "—" : (budget.max ?? "").trim()}`;

/** Сумма добавок оставленных пунктов «Готово, когда»; `null`, если добавок нет. */
export const criteriaSum = (brief: DecisionBrief, removed: readonly number[]): Add | null => {
  const adds = (brief.setup?.criteria ?? []).flatMap((item, i) => {
    const add = removed.includes(i) ? undefined : addOf(item);
    return add === undefined ? [] : [add];
  });
  if (adds.length === 0) return null;
  const sum = (key: "target" | "max" | "risk") => round(adds.reduce((s, a) => s + a[key], 0));
  const minutes = sumOf(adds.map((a) => a.minutes));
  return { target: sum("target"), max: sum("max"), risk: sum("risk"), ...(minutes === null ? {} : { minutes }) };
};

/** Подпись у заголовка «Готово, когда» строкой; `null`, если добавок нет или они ничего не меняют. */
export const criteriaSummary = (brief: DecisionBrief, removed: readonly number[], locale?: Locale): string | null => {
  const sum = criteriaSum(brief, removed);
  const text = sum === null ? "" : addText(sum, locale);
  return text === "" ? null : text;
};

/** Строка «Бюджет» реплики агенту; своя цена названа рядом с прогнозом. */
export const budgetLine = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): string[] => {
  if (!hasForecast(brief)) return [];
  const m = messages(locale).budget;
  const f = forecast(brief, answer, locale);
  const predicted = m.predicted(money(f.target), money(f.max), signed(f.risk), f.minutes === null ? "" : minutesText(f.minutes, locale));
  const own = ownBudgetText(answer.budget ?? {}, locale);
  return [own === null ? m.line(predicted) : m.ownLine(own, predicted)];
};
