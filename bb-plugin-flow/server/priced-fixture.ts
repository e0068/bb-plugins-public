// Тестовая заготовка: бриф до запуска работы с базой бюджета. Нужна тестам, чей предмет — не цена (прогресс,
// история, уведомления): инструмент не принимает бриф без «Что я понял», без цен пунктов и без долей этапов.
import type { Add } from "../shared/contract";

export const ITEM_PRICE: Add = { target: 1, max: 2, risk: 0, minutes: 10 };

type Loose = Record<string, unknown>;

const pricedItem = (item: unknown): unknown =>
  typeof item === "string" ? { text: item, add: ITEM_PRICE } : (item as Loose).add === undefined ? { ...(item as Loose), add: ITEM_PRICE } : item;

/** Доллары этапа — доля, разница исполнителя — множитель ×1: новый бриф не принимает долларов на этапах. */
const sharedStage = ({ add, adds, ...report }: Loose): Loose => ({
  ...report,
  ...(report.state === "todo" && report.share === undefined ? { share: { percent: 10, risk: 0 } } : {}),
  ...(adds === undefined ? {} : { factors: Object.fromEntries(Object.keys(adds as Loose).map((id) => [id, { factor: 1, risk: 0 }])) }),
});

/** Тот же бриф с базой: «Что я понял», цена у каждого пункта (или один пункт), доля у несделанных этапов вместо долларов. */
export const priced = (brief: Loose): Loose => {
  if (brief.kind === "clarify" || brief.outcome !== undefined) return brief;
  const setup = (brief.setup ?? {}) as Loose;
  const criteria = (setup.criteria as unknown[] | undefined) ?? ["Работа сделана"];
  const stages = setup.stages as Loose[] | undefined;
  return {
    scope: "- работа",
    ...brief,
    setup: { ...setup, criteria: criteria.map(pricedItem), ...(stages === undefined ? {} : { stages: stages.map(sharedStage) }) },
  };
};
