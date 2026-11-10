// Kasimov (MD Opener), оболочка палитры диаграмм: кладёт таблицу палитры в <head>,
// ставит пирогам bb отметку сверки и убирает и то и другое при выгрузке плагина.
// Чистые части — таблица и сама сверка — в ./diagram-palette.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";

import { BB_PIE_SELECTOR, PIE_MARK_ATTR, diagramPaletteCss, pieMark } from "./diagram-palette";

/** Атрибут, по которому таблицу палитры видно в <head>. */
export const DIAGRAM_PALETTE_MARKER = "data-bb-md-opener-diagrams";

/** Ещё не сверенные пироги bb: SVG пирога bb не меняет, а заменяет целиком, так что сверка одна на узел. */
const UNMARKED_PIES = `${BB_PIE_SELECTOR}:not([${PIE_MARK_ATTR}])`;

const markPies = (): void =>
  document.querySelectorAll(UNMARKED_PIES).forEach((svg) => {
    svg.setAttribute(PIE_MARK_ATTR, pieMark(svg.querySelectorAll("path.pieCircle").length, svg.querySelectorAll("g.legend").length));
  });

/** Палитра пирогов в странице: таблица в <head> и отметки сверки на пирогах, пока плагин включён. */
export function registerDiagramPalette(app: PluginAppBuilder): void {
  app.contentScripts.register({
    id: "diagram-palette",
    mount() {
      const style = document.createElement("style");
      style.setAttribute(DIAGRAM_PALETTE_MARKER, "");
      style.textContent = diagramPaletteCss();
      document.head.append(style);
      markPies();
      const observer = new MutationObserver(markPies);
      observer.observe(document.body, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
        document.querySelectorAll(`[${PIE_MARK_ATTR}]`).forEach((svg) => svg.removeAttribute(PIE_MARK_ATTR));
        style.remove();
      };
    },
  });
}
