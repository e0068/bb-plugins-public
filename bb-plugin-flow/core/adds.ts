// Сумма добавок к бюджету, риску и времени — одна для строк прогноза и для
// добавки этапа с исполнителем.
import type { Add } from "../shared/contract";

const round = (n: number): number => Math.round(n * 100) / 100;

/** Сумма добавок; `undefined`, если добавок нет; минуты — только если они есть хоть у одной. */
export const sumAdds = (adds: ReadonlyArray<Add | undefined>): Add | undefined => {
  const present = adds.filter((a): a is Add => a !== undefined);
  if (present.length === 0) return undefined;
  const timed = present.filter((a) => a.minutes !== undefined);
  return {
    target: round(present.reduce((s, a) => s + a.target, 0)),
    max: round(present.reduce((s, a) => s + a.max, 0)),
    risk: present.reduce((s, a) => s + a.risk, 0),
    ...(timed.length === 0 ? {} : { minutes: timed.reduce((s, a) => s + (a.minutes ?? 0), 0) }),
  };
};
