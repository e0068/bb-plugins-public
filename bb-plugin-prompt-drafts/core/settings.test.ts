// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CARD_TEXT_OPTIONS, DEFAULT_SETTINGS, SETTING_BOUNDS, parseSettings } from "./settings";

describe("настройки плагина", () => {
  it("без значений — шесть строк, 240 px, черновики в тредах, автосохранение и нынешний размер текста", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      cardLines: 6,
      cardWidth: 240,
      showInThreads: true,
      autosave: true,
      cardTextSize: "default",
    });
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("выставленные значения доезжают каждое своим полем", () => {
    expect(parseSettings({ cardLines: 4, cardWidth: 300, showInThreads: false })).toMatchObject({
      cardLines: 4,
      cardWidth: 300,
      showInThreads: false,
    });
  });

  it("числа за границами зажимаются в границы", () => {
    const { cardLines, cardWidth } = SETTING_BOUNDS;
    expect(parseSettings({ cardLines: 0, cardWidth: 10 })).toMatchObject({ cardLines: cardLines.min, cardWidth: cardWidth.min });
    expect(parseSettings({ cardLines: 999, cardWidth: 9999 })).toMatchObject({
      cardLines: cardLines.max,
      cardWidth: cardWidth.max,
    });
  });

  it("дробные числа округляются, мусор заменяется значением по умолчанию", () => {
    expect(parseSettings({ cardLines: 5.6 })).toMatchObject({ cardLines: 6 });
    expect(parseSettings({ cardLines: "7", cardWidth: Number.NaN, showInThreads: "no" })).toEqual(DEFAULT_SETTINGS);
  });

  it("автосохранение выключается булевым значением, мусор оставляет включённым", () => {
    expect(parseSettings({ autosave: false })).toMatchObject({ autosave: false });
    expect(parseSettings({ autosave: "off" })).toMatchObject({ autosave: true });
  });

  it("подписи размеров текста идут от крупного к мелкому и выбирают свой размер", () => {
    expect(CARD_TEXT_OPTIONS).toHaveLength(3);
    expect(parseSettings({ cardTextSize: CARD_TEXT_OPTIONS[0] })).toMatchObject({ cardTextSize: "default" });
    expect(parseSettings({ cardTextSize: CARD_TEXT_OPTIONS[1] })).toMatchObject({ cardTextSize: "small" });
    expect(parseSettings({ cardTextSize: CARD_TEXT_OPTIONS[2] })).toMatchObject({ cardTextSize: "smallest" });
  });

  it("неизвестная подпись размера и не-строка дают нынешний размер", () => {
    expect(parseSettings({ cardTextSize: "Huge" })).toMatchObject({ cardTextSize: "default" });
    expect(parseSettings({ cardTextSize: 11 })).toMatchObject({ cardTextSize: "default" });
  });
});
