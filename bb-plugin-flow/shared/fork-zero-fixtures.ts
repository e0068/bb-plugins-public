// Тестовая заготовка BBPL-531: развилки четырёх брифов 02.10, которые инструмент отклонил за минус, и они же по правилу —
// самый простой ответ стоит 0 и лежит в базе, у остальных цена своих пунктов от нуля, заменённые пункты простого ответа в removes.

type Add = { target: number; max: number; risk: number; minutes?: number };

export const option = (id: string, add: Add, extra: Record<string, unknown> = {}) => ({ id, action: id, description: "Что будет", add, ...extra });
export const fork = (id: string, options: unknown[]) => ({ id, question: `${id}?`, kind: "fork", options });
const zero: Add = { target: 0, max: 0, risk: 0 };

/** База брифа: общая работа и пункт самого простого ответа развилки — его отменяет через removes ответ, который его заменяет. */
export const BASE_CRITERIA = ["Общая работа", "Фильтр графика сужает и таблицу"] as const;
const SIMPLE_ITEM = 1;

/** Как агенты прислали их 02.10: рекомендованный ответ в базе за 0, более простой — разницей с минусом. */
export const REJECTED_FORKS = {
  "thr_9wd652pchg — фильтр таблицы": fork("filter", [option("Только таблицу", zero, { recommended: true }), option("Один фильтр на график и таблицу", { target: -2, max: -4, risk: 0 })]),
  "thr_gtmet5i54n — закрыть ревью": fork("review", [
    option("Третий круг", { target: 0.5, max: 1, risk: -1, minutes: 3 }, { recommended: true }),
    option("Принять как есть", { target: -0.5, max: -1, risk: 1, minutes: -3 }),
    option("Вернуть на пересмотр", { target: 2, max: 4, risk: -1, minutes: 20 }),
  ]),
  "thr_9mzhriczxr — полоса прогресса": fork("bar", [
    option("Сегменты с зазором", zero, { recommended: true }),
    option("Сегмент на группу", { target: 1, max: 2, risk: 0, minutes: 5 }),
    option("Как сейчас", { target: -4, max: -6, risk: 0, minutes: -20 }),
  ]),
  "thr_di73hd6ytc — префикс у досок из папок": fork("folders", [option("И у досок из папок", zero, { recommended: true }), option("Только у досок в базе", { target: -1, max: -2, risk: -1 })]),
};

/**
 * Те же развилки по правилу. Ответ, который заменяет пункт простого ответа, стоит целиком свою работу и отменяет пункт
 * через removes — его цену вычтет плагин; ответ, который достраивает простой, стоит только свою добавку.
 */
export const REWRITTEN_FORKS = {
  "thr_9wd652pchg — фильтр таблицы": fork("filter", [
    option("Только таблицу", { target: 2, max: 4, risk: 0, minutes: 10 }, { recommended: true, criteria: ["У таблицы свой фильтр, график его не видит"], removes: [SIMPLE_ITEM] }),
    option("Один фильтр на график и таблицу", zero),
  ]),
  "thr_gtmet5i54n — закрыть ревью": fork("review", [
    option("Третий круг", { target: 0.5, max: 1, risk: -2, minutes: 3 }, { recommended: true, criteria: ["Проверяющий дал SATISFIED по правке writeDoc"] }),
    option("Принять как есть", zero),
    option("Вернуть на пересмотр", { target: 2, max: 4, risk: -2, minutes: 20 }, { criteria: ["Ссылки на запись не открываются, показываются только для чтения"] }),
  ]),
  "thr_9mzhriczxr — полоса прогресса": fork("bar", [
    option("Сегменты с зазором", { target: 4, max: 6, risk: 0, minutes: 20 }, { recommended: true, criteria: ["Между группами зазор, рядом со счётом имя группы"] }),
    option("Сегмент на группу", { target: 5, max: 8, risk: 0, minutes: 25 }, { criteria: ["По сегменту на группу, заливка по пройденным шагам"] }),
    option("Как сейчас", zero),
  ]),
  "thr_di73hd6ytc — префикс у досок из папок": fork("folders", [
    option("И у досок из папок", { target: 1, max: 2, risk: 1 }, { recommended: true, criteria: ["У доски из папки поле префикса есть, подтверждение просит закоммитить файлы"] }),
    option("Только у досок в базе", zero),
  ]),
};
