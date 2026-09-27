// Момент прогона в колонках «Начало» и «Конец» истории: чем ближе к сегодня, тем короче запись.

const two = (value: number): string => String(value).padStart(2, "0");

const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Сегодня — «17:41», раньше в этом году — «25.09 17:41», в прошлые годы — «25.09.25 17:41». День и час — местные,
 * «сегодня» задаёт `now`: время функция из мира не берёт.
 */
export const historyMoment = (iso: string, now: Date): string => {
  const then = new Date(iso);
  const time = `${two(then.getHours())}:${two(then.getMinutes())}`;
  const date = `${two(then.getDate())}.${two(then.getMonth() + 1)}`;
  if (sameDay(then, now)) return time;
  return then.getFullYear() === now.getFullYear() ? `${date} ${time}` : `${date}.${two(then.getFullYear() % 100)} ${time}`;
};
