// @vitest-environment jsdom
import { loadPluginApp, mountPluginContentScripts } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { PIE_MARK_ATTR, diagramPaletteCss } from "./diagram-palette";
import { FLOWCHART_SVG, pieSvg } from "./pie-fixture";
import { DIAGRAM_PALETTE_MARKER } from "./diagram-palette-content";

const app = await loadPluginApp(() => import("../app"));
const sheets = () => document.head.querySelectorAll(`style[${DIAGRAM_PALETTE_MARKER}]`);
const markOf = (id: string) => document.getElementById(id)?.getAttribute(PIE_MARK_ATTR) ?? null;
/** MutationObserver отдаёт записи микрозадачей — дождаться её. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const append = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("палитра пирогов в странице", () => {
  it("пока плагин включён, в странице ровно одна таблица палитры, а выключение её убирает", async () => {
    const mounted = await mountPluginContentScripts(app, { pluginId: "md-opener" });
    expect(Array.from(sheets(), (s) => s.textContent)).toEqual([diagramPaletteCss()]);

    await mounted.lifecycle.dispose();
    expect(sheets()).toHaveLength(0);
  });

  it("пирог, который был в чате до включения и который пришёл после, получают отметку сверки", async () => {
    append(pieSvg(["a", "b"], { id: "bb-mermaid-before" }));
    const mounted = await mountPluginContentScripts(app, { pluginId: "md-opener" });
    expect(markOf("bb-mermaid-before")).toBe("aligned");

    append(pieSvg(["passed", "failed", "skipped"], { id: "bb-mermaid-after", drawn: ["passed", "skipped"] }));
    await settle();
    expect(markOf("bb-mermaid-after")).toBe("skewed");

    await mounted.lifecycle.dispose();
  });

  it("чужие пироги и другие диаграммы bb отметку не получают", async () => {
    const mounted = await mountPluginContentScripts(app, { pluginId: "md-opener" });
    append(FLOWCHART_SVG + pieSvg(["x"], { id: "mermaid-1" }));
    await settle();
    expect(markOf("bb-mermaid-msg-2")).toBeNull();
    expect(markOf("mermaid-1")).toBeNull();

    await mounted.lifecycle.dispose();
  });

  it("выключение плагина снимает отметки, и новые пироги их больше не получают", async () => {
    append(pieSvg(["a"], { id: "bb-mermaid-on" }));
    const mounted = await mountPluginContentScripts(app, { pluginId: "md-opener" });
    await mounted.lifecycle.dispose();
    expect(markOf("bb-mermaid-on")).toBeNull();

    append(pieSvg(["b"], { id: "bb-mermaid-off" }));
    await settle();
    expect(markOf("bb-mermaid-off")).toBeNull();
  });
});
