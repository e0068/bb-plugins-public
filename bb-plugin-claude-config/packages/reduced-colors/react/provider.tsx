// Shell — hands the stored Reduced Colors setting to every chart below it.
//
// Loaded once per mounted root, not per chart: the threads feed draws one
// card per thread, and a hook that fetched for itself would multiply the
// request by the number of rows. The loader comes in as a function because
// this package knows no plugin's RPC — each plugin passes its own call.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useHostColorMode } from "../../code-editor/use-host-color-mode";
import {
  DEFAULT_REDUCED_COLORS,
  parseReducedColors,
  seriesColors,
  seriesPainting,
  type ReducedColors,
  type SeriesPainting,
} from "../core/settings";

const ReducedColorsContext = createContext<ReducedColors>(DEFAULT_REDUCED_COLORS);

export interface ReducedColorsProviderProps {
  /** Reads the stored setting — raw, the provider parses it. */
  load: () => Promise<unknown>;
  children: ReactNode;
}

/** Until `load` answers, and when it fails, charts keep their own palette: the defaults are switched off. */
export function ReducedColorsProvider({ load, children }: ReducedColorsProviderProps) {
  const [settings, setSettings] = useState<ReducedColors>(DEFAULT_REDUCED_COLORS);
  // Once per mount: callers pass an inline arrow, a new function on every render.
  const loadOnMount = useRef(load);

  useEffect(() => {
    let live = true;
    loadOnMount.current().then(
      (raw) => live && setSettings(parseReducedColors(raw)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  return <ReducedColorsContext.Provider value={settings}>{children}</ReducedColorsContext.Provider>;
}

/**
 * A chart's own series colours, in legend order → the colours to paint with:
 * the same list while Reduced Colors is off or no provider is above, ramp
 * steps of the host theme's pair while it is on.
 */
export function useSeriesColors(palette: readonly string[]): readonly string[] {
  const settings = useContext(ReducedColorsContext);
  return seriesColors(settings, useHostColorMode(), palette);
}

/** How to paint right now — for charts that mix ramp series with colours of their own (see `SeriesPainting`). */
export function useSeriesPainting(): SeriesPainting {
  const settings = useContext(ReducedColorsContext);
  const mode = useHostColorMode();
  // Stable between renders, so a consumer can memoise on it; the theme is a dependency, a switch repaints.
  return useMemo(() => seriesPainting(settings, mode), [settings, mode]);
}
