// @vitest-environment node
import { describe, expect, it } from "vitest";

import { choicePrompt, parseChoice } from "./auto-choice";
import { NO_FLOW } from "./flows";

const ids = ["quick", "bug"];

describe("ответ модели, выбирающей flow", () => {
  it("id из списка — он", () => expect(parseChoice("quick\n", ids)).toBe("quick"));
  it("«без flow» — none", () => expect(parseChoice(NO_FLOW, ids)).toBe(NO_FLOW));
  it("пустой вывод — не выбор", () => expect(parseChoice("  \n\n", ids)).toBeNull());
  it("рассуждение до id не мешает: берётся последняя непустая строка", () => expect(parseChoice("The request is a bug report.\n\nbug\n", ids)).toBe("bug"));
  it("id в бэктиках или кавычках — он же", () => {
    expect(parseChoice("`quick`", ids)).toBe("quick");
    expect(parseChoice('"bug"', ids)).toBe("bug");
  });
  it("неизвестный id — не выбор", () => expect(parseChoice("gone", ids)).toBeNull());
});

describe("вход модели", () => {
  const prompt = choicePrompt("RULES", { flows: [{ id: "quick", name: "Quick", description: "Small edits" }, { id: "bug", name: "Bug", description: undefined }], noFlowDescription: "Just questions" }, "Почини кнопку");

  it("навык первым, сообщение владельца последним", () => {
    expect(prompt.startsWith("RULES")).toBe(true);
    expect(prompt.trimEnd().endsWith("Почини кнопку")).toBe(true);
  });

  it("«Без flow» с описанием перед flow, flow по порядку с id", () => {
    const order = ["Just questions", "id: `none`", "id: `quick`", "Small edits", "id: `bug`", "No description."].map((part) => prompt.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(prompt.indexOf("id: `none`")).toBeLessThan(prompt.indexOf("id: `quick`"));
    expect(prompt.indexOf("id: `quick`")).toBeLessThan(prompt.indexOf("id: `bug`"));
  });
});
