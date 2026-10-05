// @vitest-environment jsdom
import type { ComponentType } from "react";
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.history.replaceState(null, "", "/plugins/flow/flows"));
afterEach(cleanup);

const header = () => {
  const content = app.navPanels.find((p) => p.id === "flows")!.headerContent as ComponentType<PluginNavPanelProps>;
  return renderSlot<PluginNavPanelProps, never>({ component: content }, { subPath: "" }, { settings: { language: "Русский" } });
};

describe("шестерёнка настроек в шапке страницы Flow", () => {
  it("кнопка «Настройки Flow» — ссылка на страницу настроек плагина", async () => {
    const link = await header().findByRole("link", { name: "Настройки Flow" });
    expect(link.getAttribute("href")).toBe("/settings/plugins/flow");
    expect(link.querySelector('[data-icon="Settings"]')).not.toBeNull();
  });

  it("клик открывает настройки без перезагрузки: адрес меняется, и роутер получает popstate", async () => {
    const popstate = vi.fn();
    window.addEventListener("popstate", popstate);
    fireEvent.click(await header().findByRole("link", { name: "Настройки Flow" }));
    window.removeEventListener("popstate", popstate);
    expect(window.location.pathname).toBe("/settings/plugins/flow");
    expect(popstate).toHaveBeenCalledTimes(1);
  });

  it("запись истории продолжает индекс роутера bb — переход читается как шаг вперёд", async () => {
    window.history.replaceState({ __TSR_index: 3, key: "a" }, "", "/plugins/flow/flows");
    const states: unknown[] = [];
    const popstate = (event: PopStateEvent) => states.push(event.state);
    window.addEventListener("popstate", popstate);
    fireEvent.click(await header().findByRole("link", { name: "Настройки Flow" }));
    window.removeEventListener("popstate", popstate);
    expect(window.history.state).toEqual({ __TSR_index: 4, key: "a" });
    expect(states).toEqual([{ __TSR_index: 4, key: "a" }]);
  });

  it("клик с Cmd оставлен браузеру — адрес страницы не трогается", async () => {
    fireEvent.click(await header().findByRole("link", { name: "Настройки Flow" }), { metaKey: true });
    expect(window.location.pathname).toBe("/plugins/flow/flows");
  });
});
