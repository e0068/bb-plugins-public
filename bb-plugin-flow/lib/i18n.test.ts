// @vitest-environment node
import { describe, expect, it } from "vitest";

import { LANGUAGE_OPTIONS, LANGUAGE_SYSTEM, resolveLocale } from "./i18n";
import { messages } from "./messages";

/** Каждый лист словаря строкой: функции вызываются с подстановками-заглушками. */
const leaves = (node: unknown, path = ""): Array<[string, string]> => {
  if (typeof node === "string") return [[path, node]];
  if (typeof node === "function") {
    const call = node as (...args: unknown[]) => unknown;
    return [[path, `${String(call("x", "y", "z", "w"))} ${String(call(true, true, true, true))}`]];
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => leaves(value, path === "" ? key : `${path}.${key}`));
};

describe("язык интерфейса", () => {
  it("выбранный в настройках язык стоит поверх языка системы", () => {
    expect(resolveLocale("English", ["ru-RU"])).toBe("en");
    expect(resolveLocale("Русский", ["en-US"])).toBe("ru");
  });

  it("System и незаданная настройка берут первый язык системы: русский — ru, любой другой — en", () => {
    expect(resolveLocale(LANGUAGE_SYSTEM, ["ru-RU", "en-US"])).toBe("ru");
    expect(resolveLocale(LANGUAGE_SYSTEM, ["en-GB", "ru-RU"])).toBe("en");
    expect(resolveLocale(undefined, ["ru"])).toBe("ru");
    expect(resolveLocale(undefined, ["de-DE"])).toBe("en");
    expect(resolveLocale("чужое значение", ["ru-RU"])).toBe("ru");
    expect(resolveLocale(undefined, [])).toBe("en");
  });

  it("в списке настройки первым идёт System, он же значение по умолчанию", () => {
    expect(LANGUAGE_OPTIONS[0]).toBe(LANGUAGE_SYSTEM);
    expect(LANGUAGE_OPTIONS).toEqual(["System", "English", "Русский"]);
  });
});

describe("словари", () => {
  it("у английского и русского одни и те же ключи", () => {
    expect(leaves(messages("en")).map(([path]) => path)).toEqual(leaves(messages("ru")).map(([path]) => path));
  });

  it("в английском словаре нет кириллицы", () => {
    const cyrillic = leaves(messages("en")).filter(([, text]) => /[А-Яа-яЁё]/.test(text));
    expect(cyrillic).toEqual([]);
  });

});
