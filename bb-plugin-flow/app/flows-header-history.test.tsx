// @vitest-environment jsdom
// История прогонов открывается иконкой часов в шапке страницы Flow, левее шестерёнки настроек; открытая история — текущая.
import type { ComponentType } from "react";
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const header = (subPath: string) => {
  const content = app.navPanels.find((p) => p.id === "flows")!.headerContent as ComponentType<PluginNavPanelProps>;
  return renderSlot<PluginNavPanelProps, never>({ component: content }, { subPath }, { settings: { language: "Русский" } });
};

describe("История в шапке страницы Flow", () => {
  it("кнопка Истории в шапке открывает историю", async () => {
    const slot = header("quick");
    const settings = await slot.findByRole("link", { name: "Настройки Flow" });
    const history = slot.queryByRole("button", { name: "История" });
    expect(history, "кнопка «История» в шапке").not.toBeNull();
    expect(history!.getAttribute("title")).toBe("История");
    expect(history!.querySelector('[data-icon="Clock"]')).not.toBeNull();
    expect(history!.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(history!.getAttribute("aria-current")).toBeNull();
    fireEvent.click(history!);
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: "history" } });
    cleanup();

    const open = header("history");
    const current = await open.findByRole("button", { name: "История" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.getAttribute("class")?.split(/\s+/)).toContain("text-foreground");
  });
});
