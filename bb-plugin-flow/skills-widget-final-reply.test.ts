// @vitest-environment node
// Демо и уточнение не останавливают ход, а bb после хода сворачивает реплики между вызовами инструментов в «Worked for».
// Навыки велят повторить строку виджета в последнем ответе хода — карточка встаёт у последней копии и остаётся на виду.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("навыки: виджет, присланный посреди хода, остаётся на виду после хода", () => {
  it("корневой навык: строку уточнения повторяют в последнем ответе хода, строку прошлого хода — нет; решённое закрывают resolves", () => {
    const skill = read("./skills/flow/SKILL.md");
    expect(skill).toMatch(/paste the line once more in the final reply of the turn/);
    expect(skill).toMatch(/Never repeat the line of a widget from an earlier turn/);
    expect(skill).toMatch(/close it with `resolves: \["dec_…"\]`/);
  });

  it("навык демонстрации: строку демо повторяют в последнем ответе хода, над строкой утверждения", () => {
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/paste the line once more in the final reply of the turn, above the approval line/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/вставь ту же строку ещё раз в последний ответ хода, над строкой утверждения/);
  });

  it("навык демонстрации: ход кончается брифом — строку демо повторяют над ним", () => {
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/above the approval line or the brief line that ends the turn/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/над строкой утверждения или брифа, которой кончается ход/);
  });

  it("навык утверждения: над строкой утверждения повторяют строки демо и уточнений этого хода", () => {
    expect(read("./skills/flow-approve/SKILL.md")).toMatch(/paste again above it the lines of demos and clarifies you sent earlier in this turn/);
    expect(read("./skills/flow-approve/ru.md")).toMatch(/над ней ещё раз строки демонстраций и уточнений, присланных раньше в этом ходе/);
  });
});
