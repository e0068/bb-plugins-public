// @vitest-environment node
// Момент прогона в колонках «Начало» и «Конец» истории: чем ближе к сегодня, тем короче.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { historyMoment } from "./history-moment";

/** Местное время: колонки показывают день и час владельца, а не UTC. */
const at = (year: number, month: number, day: number, hours = 0, minutes = 0) => new Date(year, month - 1, day, hours, minutes).toISOString();
const NOW = new Date(2026, 8, 26, 19, 5);

describe("момент прогона в истории", () => {
  it("сегодня — только время", () => {
    expect(historyMoment(at(2026, 9, 26, 17, 41), NOW)).toBe("17:41");
    expect(historyMoment(at(2026, 9, 26, 0, 0), NOW)).toBe("00:00");
  });

  it("вчера и раньше в этом году — день и месяц из четырёх цифр и время", () => {
    expect(historyMoment(at(2026, 9, 25, 23, 59), NOW)).toBe("25.09 23:59");
    expect(historyMoment(at(2026, 1, 1, 9, 3), NOW)).toBe("01.01 09:03");
  });

  it("прошлый год и раньше — шесть цифр с годом и время", () => {
    expect(historyMoment(at(2025, 12, 31, 23, 59), NOW)).toBe("31.12.25 23:59");
    expect(historyMoment(at(2019, 3, 7, 8, 0), NOW)).toBe("07.03.19 08:00");
  });

  it("час в 24-часовом виде, без AM и PM", () => {
    expect(historyMoment(at(2026, 9, 26, 23, 7), NOW)).toBe("23:07");
  });

  it("любой момент — время в конце, дата вида DD.MM или DD.MM.YY перед ним", () => {
    const moment = fc.date({ min: new Date(2000, 0, 1), max: new Date(2030, 0, 1), noInvalidDate: true });
    fc.assert(
      fc.property(moment, moment, (then, now) => {
        const text = historyMoment(then.toISOString(), now);
        const sameDay = then.toDateString() === now.toDateString();
        const sameYear = then.getFullYear() === now.getFullYear();
        const shape = sameDay ? /^\d\d:\d\d$/ : sameYear ? /^\d\d\.\d\d \d\d:\d\d$/ : /^\d\d\.\d\d\.\d\d \d\d:\d\d$/;
        expect(text).toMatch(shape);
      }),
    );
  });
});
