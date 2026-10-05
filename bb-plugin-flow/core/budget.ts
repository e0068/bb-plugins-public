// Прогноз бюджета, риска и времени брифа. Объём работы — цены оставленных
// пунктов Definition of Done (база) плюс цены выбранных вариантов; этап — доля
// объёма с множителем исполнителя, итог — сумма долей этапов в прогоне, а у
// брифа без этапов — сам объём. Бриф-уточнение запущенной работы — утверждённый
// бюджет прогона плюс выбранные варианты по цене прогона. Брифы, записанные раньше, считаются как были:
// этапы в долларах с долей пунктов внутри них, а совсем старые — пункты,
// артефакты, исполнитель, ревью и тестирование. Считается по брифу и ответу,
// поэтому одинаково и в кнопке виджета, и в реплике агенту.
import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import type { Add, Checker, Criterion, DecisionAnswer, DecisionBrief, Planned, StagePlan } from "../shared/contract";
import { SETUP_ROW, rowsOf } from "./rows";
import { sumAdds } from "./adds";
import { removedCriteria } from "./option-criteria";
import { answeredStageChoice, executorLabel, stageAdd, stageItems, stagePhase } from "./stages";

/**
 * Строка разбивки; `null` — величина неизвестна: у планирования без цены модели нет денег, у добавок без `minutes` — времени.
 * `base` — строка не добавка, а основа итога: утверждённый бюджет прогона. `stage` — id этапа, чья это цена: таблица брифа ставит её в строку этапа.
 * `criterion` — номер пункта Definition of Done с нуля: таблица ставит цену в строку пункта.
 */
export type ForecastLine = { label: string; note: string; minutes: number | null; risk: number; target: number | null; max: number | null; base?: true; stage?: string; criterion?: number };

/** Итог складывает известное; время `null`, если ни у одной строки его нет; риск не ниже нуля; `spent` — сколько первых строк уже потрачено. */
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

/** Цена пункта Definition of Done строкой с его номером. */
const criterionLine = (item: Criterion, index: number, locale?: Locale): ForecastLine[] =>
  line(messages(locale).budget.item(index + 1), criterionTitle(item), [addOf(item)]).map((l) => ({ ...l, criterion: index }));

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

/** Этап в прогоне, ещё не сделанный, — строка «название · исполнитель» с ценой от объёма; сделанный работы не добавляет. */
const stageLines = (brief: DecisionBrief, answer: DecisionAnswer, scope: Add | undefined, locale?: Locale): ForecastLine[] =>
  stageItems(brief).flatMap((item) => {
    const choice = answeredStageChoice(brief, answer, item);
    return stagePhase(item) !== "todo" || !choice.run ? [] : line(item.stage.name, executorLabel(item.stage, choice.executor, locale), [stageAdd(item, choice.executor, scope)]).map((l) => ({ ...l, stage: item.stage.id }));
  });

/** Бриф, записанный до цены от объёма: этапы в долларах или строки исполнителя, ревью и документов вместо этапов. */
export const legacyPricing = (brief: DecisionBrief): boolean => {
  const s = brief.setup;
  return (s?.stages ?? []).some((r) => r.add !== undefined || r.adds !== undefined) || [s?.artifacts, s?.executor, s?.checker, s?.testing].some((row) => row !== undefined);
};

/** Доля этапа самой работы — весь объём: такой этап и несёт базу. */
export const WORK_PERCENT = 100;

/** Есть ли в брифе этап самой работы; без него — тред без flow или flow из одних встроенных этапов — объём считается сам. */
const hasWorkStage = (brief: DecisionBrief): boolean => (brief.setup?.stages ?? []).some((r) => (r.share?.percent ?? 0) >= WORK_PERCENT);

/** Выбранные варианты вопросов по порядку брифа, с номером вопроса. */
const chosenOptions = (brief: DecisionBrief, answer: DecisionAnswer) =>
  brief.questions.flatMap((q, i) => {
    const ids = chosen(answer, q.id);
    return q.options.filter((o) => ids.includes(o.id)).map((option) => ({ number: i + 1, option }));
  });

/**
 * Объём работы: база — цены оставленных пунктов Definition of Done, а у брифа без своих пунктов посреди работы — утверждённый
 * объём треда, — плюс цены выбранных вариантов; `undefined`, если цен нет.
 */
export const scopeOf = (brief: DecisionBrief, answer: DecisionAnswer): Add | undefined => {
  const removed = removedCriteria(brief, answer);
  const criteria = brief.setup?.criteria;
  const base = criteria === undefined ? [brief.approvedScope] : criteria.map((item, i) => (removed.includes(i) ? undefined : addOf(item)));
  return sumAdds([...base, ...chosenOptions(brief, answer).map((c) => c.option.add)]);
};

/** Цена варианта уже внутри объёма, а значит и внутри этапов; отдельной строкой идёт только его риск. */
const optionRiskLines = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): ForecastLine[] =>
  chosenOptions(brief, answer).flatMap(({ number, option }) =>
    option.add === undefined || option.add.risk === 0 ? [] : [{ label: messages(locale).budget.question(number), note: option.action, minutes: null, risk: option.add.risk, target: 0, max: 0 }],
  );

/** Пункты базы и выбранные варианты строками — объём, когда его не несёт этап работы. */
const scopeLines = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): ForecastLine[] => {
  const removed = removedCriteria(brief, answer);
  const items = (brief.setup?.criteria ?? []).flatMap((item, i) => (removed.includes(i) ? [] : criterionLine(item, i, locale)));
  return [...items, ...questionLines(brief, answer, locale)];
};

/**
 * Цена от объёма. Этап работы (доля 100%) несёт базу сам: снят из прогона — работы в прогоне нет. Без такого этапа объём —
 * отдельные строки пунктов и вариантов, а этапы — надбавки сверху. Цена варианта уже внутри объёма, поэтому при этапе работы
 * вариант даёт строкой только свой риск.
 */
const scopePricedLines = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): ForecastLine[] => {
  const stages = stageLines(brief, answer, scopeOf(brief, answer), locale);
  return hasWorkStage(brief) ? [...stages, ...optionRiskLines(brief, answer, locale)] : [...scopeLines(brief, answer, locale), ...stages];
};

/** План этапов, взятых ответом в прогон: минуты и доллары цены этапа с исполнителем — от объёма работы; этап без цены плана не получает. */
export const stagePlans = (brief: DecisionBrief, answer: DecisionAnswer): Record<string, StagePlan> => {
  const scope = scopeOf(brief, answer);
  return Object.fromEntries(
    stageItems(brief).flatMap((item) => {
      const choice = answeredStageChoice(brief, answer, item);
      const add = stagePhase(item) === "todo" && choice.run ? stageAdd(item, choice.executor, scope) : undefined;
      // Пустая цена — доля от объёма без цены — плана не даёт: «~$0» в контейнере ничего не обещает.
      const empty = add === undefined || (add.minutes === undefined && add.target === 0);
      return empty ? [] : [[item.stage.id, { minutes: add.minutes ?? null, target: add.target }]];
    }),
  );
};

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
    const stages = stageLines(brief, answer, undefined, locale);
    return [...stages, ...removedShareLines(brief, removed, stages, locale)];
  }
  const criteria = (setup.criteria ?? []).flatMap((item, i) => (removed.includes(i) ? [] : criterionLine(item, i, locale)));
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

/** Во сколько раз прогон дороже объёма: доли этапов и множители исполнителей уже внутри утверждённого бюджета; без объёма — один к одному. */
const runFactor = (budget: number, scope: number | undefined): number => (scope === undefined || scope <= 0 ? 1 : budget / scope);

/**
 * Бриф-уточнение запущенной работы: первая строка — утверждённый бюджет прогона, за ней выбранные варианты.
 * Вариант дорожает так же, как дорожал объём при запуске: его цена умножена на отношение бюджета к утверждённому объёму.
 * План без времени не даёт времени и вариантам: иначе время прогона свелось бы к минутам одного варианта.
 */
const midWorkLines = (brief: DecisionBrief, answer: DecisionAnswer, approved: Planned, locale?: Locale): ForecastLine[] => {
  const m = messages(locale).budget;
  const scope = brief.approvedScope;
  const factor = { target: runFactor(approved.target, scope?.target), max: runFactor(approved.max, scope?.max) };
  const base: ForecastLine = { label: m.approved, note: "", minutes: approved.minutes, risk: 0, target: approved.target, max: approved.max, base: true };
  const options = chosenOptions(brief, answer).flatMap(({ number, option }) => {
    const add = option.add;
    if (add === undefined) return [];
    const minutes = add.minutes === undefined || approved.minutes === null ? null : Math.round(add.minutes * runFactor(approved.minutes, scope?.minutes));
    return [{ label: m.question(number), note: option.action, minutes, risk: add.risk, target: round(add.target * factor.target), max: round(add.max * factor.max) }];
  });
  return [base, ...options];
};

/** Утверждённый бюджет прогона, от которого считает бриф-уточнение; у брифа до запуска и у записанного без бюджета — `undefined`. */
export const midWorkBudget = (brief: DecisionBrief): Planned | undefined => (brief.launched === true ? brief.approvedBudget : undefined);

/**
 * Итог прогона: сумма запланированного, не меньше нуля — и деньги, и риск; уже потраченное — справочные первые строки разбивки, в итог не входит; потолок не ниже цели.
 * У брифа-уточнения планирования в разбивке нет: время треда после запуска — уже сама работа, и оно внутри утверждённого бюджета.
 */
export const forecast = (brief: DecisionBrief, answer: DecisionAnswer, locale?: Locale): Forecast => {
  const approved = midWorkBudget(brief);
  const spent = approved === undefined ? planningLines(brief, locale) : [];
  const planned =
    approved !== undefined
      ? midWorkLines(brief, answer, approved, locale)
      : legacyPricing(brief)
        ? [...setupLines(brief, answer, locale), ...questionLines(brief, answer, locale)]
        : scopePricedLines(brief, answer, locale);
  const lines = [...spent, ...planned];
  const minutes = sumOf(lines.map((l) => l.minutes ?? undefined)) === null ? null : Math.max(0, sumOf(planned.map((l) => l.minutes ?? undefined)) ?? 0);
  const total = (key: "target" | "max") => round(Math.max(0, planned.reduce((s, l) => s + (l[key] ?? 0), 0)));
  const target = total("target");
  return {
    lines,
    minutes,
    risk: Math.max(0, planned.reduce((s, l) => s + l.risk, 0)),
    target,
    max: Math.max(target, total("max")),
    spent: spent.length,
  };
};

/** Прогноз по рекомендациям агента: рекомендованные варианты и этапы, пункты без правок — то, что увидит владелец, ничего не трогая. */
export const recommendedForecast = (brief: DecisionBrief): Forecast =>
  forecast(brief, { briefId: brief.id, answers: brief.questions.map((q) => ({ questionId: q.id, optionIds: q.options.filter((o) => o.recommended).map((o) => o.id) })) });

/**
 * Держит ли бриф прогноз: хоть у одного пункта, артефакта, способа или варианта есть добавка.
 * Бриф запущенной работы держит его, только когда знает утверждённый бюджет прогона: считать итог больше не от чего.
 */
export const hasForecast = (brief: DecisionBrief): boolean => {
  if (brief.launched === true) return brief.approvedBudget !== undefined;
  const s = brief.setup;
  // Доли этапов без базы дали бы «$0»: прогноз — только когда есть объём, от которого их считать.
  if (!legacyPricing(brief) && (s?.stages ?? []).some((r) => r.share !== undefined))
    return (s?.criteria ?? []).some((c) => addOf(c) !== undefined) || brief.approvedScope !== undefined;
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

export const hasOwnBudget = (answer: DecisionAnswer): boolean => !blank(answer.budget?.target) || !blank(answer.budget?.max) || !blank(answer.budget?.minutes);

/** Своя цена владельца: время в минутах, цель и потолок в долларах — как набраны в полях. */
export type OwnBudget = { minutes?: string | undefined; target?: string | undefined; max?: string | undefined };

/** Сумма своей цены без знака доллара: ответы и черновики до маски хранят набранное как есть, иногда со «$». */
export const ownDollars = (value: string): string => value.trim().replace(/^\$/, "");

/** Своя цена одной строкой: «$15 · до $30, 120 мин»; пустое денежное поле — прочерк, пустое время не пишется; `null`, если своей цены нет. */
export const ownBudgetText = (budget: OwnBudget, locale?: Locale): string | null => {
  if (blank(budget.target) && blank(budget.max) && blank(budget.minutes)) return null;
  const dollars = (value: string | undefined) => (blank(value) ? "—" : `$${ownDollars(value ?? "")}`);
  const time = blank(budget.minutes) ? "" : minutesText(Number((budget.minutes ?? "").trim()), locale);
  if (blank(budget.target) && blank(budget.max)) return time;
  const price = `${dollars(budget.target)} · ${messages(locale).budget.upTo} ${dollars(budget.max)}`;
  return time === "" ? price : `${price}, ${time}`;
};

/** Сумма добавок оставленных пунктов Definition of Done; `null`, если добавок нет. */
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

/** Подпись у заголовка Definition of Done строкой; `null`, если добавок нет или они ничего не меняют. */
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
