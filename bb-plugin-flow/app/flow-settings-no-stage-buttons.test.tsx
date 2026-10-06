// @vitest-environment jsdom
// Кнопок этапов в брифе больше нет — нет и раздела их ширины на странице настроек.
// Выбор flow агентом живёт в кнопке композера, а этапы — на странице Flow в левом меню.
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it } from "vitest";

const app = await loadPluginApp(() => import("../app"));

describe("разделы страницы настроек Flow", () => {
  it("раздела «Кнопки этапов в брифе» нет", () => {
    expect(app.settingsSections.map((s) => s.id)).not.toContain("stage-buttons");
  });

  it("журнал и автоповтор — разделы настроек плагина", () => {
    expect(app.settingsSections.map((s) => s.id)).toEqual(expect.arrayContaining(["journal-dirs", "automation-retry"]));
  });

  it("Flow — пункт левого меню", () => {
    expect(app.navPanels.map((p) => [p.id, p.title, p.path])).toEqual([["flows", "Flow", "flows"]]);
  });
});
