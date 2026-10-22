import { describe, expect, it } from "vitest";
import { depsStale } from "./plugin-homecoming";

// Время правки package-lock.json и отметки установки node_modules/.package-lock.json; нет файла — null.
describe("зависимости основной копии ставятся заново, только когда устарели", () => {
  it("установки нет, а lock есть — ставить", () => expect(depsStale(100, null)).toBe(true));
  it("lock новее установки — ставить", () => expect(depsStale(200, 100)).toBe(true));
  it("установка не старше lock — не ставить", () => {
    expect(depsStale(100, 100)).toBe(false);
    expect(depsStale(100, 200)).toBe(false);
  });
  it("без lock ставить нечем — не ставить", () => expect(depsStale(null, null)).toBe(false));
});
