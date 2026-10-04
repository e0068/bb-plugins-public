import { describe, expect, it } from "vitest";

import { demoVerdict, ownWords } from "./outcome";

const own = (text: string) => [{ questionId: "fix", optionIds: [], own: text }];

describe("свой ответ в строке вопроса Демонстрации", () => {
  it("делает отправку комментарием, даже нажатой как приёмка", () => {
    expect(demoVerdict({ answers: own("Что значит собрать документом системы?"), outcome: { accepted: true } })).toBe("comment");
    expect(demoVerdict({ answers: own("а почему так?"), outcome: { accepted: false } })).toBe("comment");
  });

  it("из одних пробелов — не слово владельца: приёмка остаётся приёмкой", () => {
    expect(ownWords({ answers: own("   ") })).toBe(false);
    expect(demoVerdict({ answers: own("  \n "), outcome: { accepted: true } })).toBe("continue");
  });

  it("переход в другой flow главнее своего ответа", () => {
    expect(demoVerdict({ answers: own("вопрос"), outcome: { accepted: false, flow: { id: "f", name: "Bug" } } })).toBe("switch");
  });
});
