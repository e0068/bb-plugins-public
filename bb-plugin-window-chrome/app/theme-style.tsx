// Window Chrome, фронт: значения темы окна с сервера и их живое применение.
// Значения общие для всех окон: читаются по RPC при монтировании и заново по
// сигналу сервера, поэтому правка в одном окне сразу видна во всех.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";

import { THEME_CHANGED, themeCss, type ThemeValues } from "../core/theme";
import type { themeRpcContract } from "../shared/contract";

/** Атрибут, по которому таблицу темы окна видно в <head>. */
export const THEME_STYLE_MARKER = "data-bb-window-chrome-theme";

/** Значения темы окна; `null` — ещё не прочитаны. */
export function useThemeValues(): ThemeValues | null {
  const rpc = useRpc<typeof themeRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [values, setValues] = useState<ThemeValues | null>(null);
  // Сигналы идут подряд, ответы могут прийти не по порядку: в силе только ответ на последний запрос.
  const latest = useRef(0);
  const reload = useCallback(() => {
    const request = ++latest.current;
    rpcRef.current.call("get", null).then(
      (next) => request === latest.current && setValues(next),
      () => undefined,
    );
  }, []);
  useEffect(reload, [reload]);
  useRealtime(THEME_CHANGED, reload);
  return values;
}

/** Невидимый оверлей: держит в конце <head> одну таблицу темы окна, пока плагин включён. */
export function ThemeStyle() {
  const values = useThemeValues();
  const css = values === null ? "" : themeCss(values, "live");
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute(THEME_STYLE_MARKER, "");
    style.textContent = css;
    document.head.append(style);
    return () => style.remove();
  }, [css]);
  return null;
}
