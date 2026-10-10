// Window Chrome, оболочка: content-скрипт кладёт таблицу стилей ядра в <head>
// и убирает её при выгрузке плагина.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";

import { windowChromeCss } from "../core/chrome-css";

/** Атрибут, по которому таблицу плагина видно в <head>. */
export const STYLE_MARKER = "data-bb-window-chrome";

export function registerWindowChrome(app: PluginAppBuilder): void {
  app.contentScripts.register({
    id: "window-chrome",
    mount() {
      const style = document.createElement("style");
      style.setAttribute(STYLE_MARKER, "");
      style.textContent = windowChromeCss();
      document.head.append(style);
      return () => style.remove();
    },
  });
}
