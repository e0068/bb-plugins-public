// @vitest-environment jsdom
import { loadPluginApp, mountPluginContentScripts } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it } from "vitest";

import { windowChromeCss } from "../core/chrome-css";
import { STYLE_MARKER } from "./content";

const app = await loadPluginApp(() => import("../app"));
const sheets = () => document.head.querySelectorAll(`style[${STYLE_MARKER}]`);

describe("content-скрипт Window Chrome", () => {
  it("пока плагин включён, в странице ровно одна его таблица, а выключение её убирает", async () => {
    const mounted = await mountPluginContentScripts(app, { pluginId: "window-chrome" });
    expect([...sheets()].map((s) => s.textContent)).toEqual([windowChromeCss()]);

    await mounted.lifecycle.dispose();
    expect(sheets()).toHaveLength(0);
  });
});
