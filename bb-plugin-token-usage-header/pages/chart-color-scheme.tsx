// Shell — hands the chosen chart colour scheme to every chart below it.
//
// Loaded once per mounted root, like Reduced Colors (packages/reduced-colors):
// the feed draws one card per thread, and a hook that fetched for itself would
// multiply the request by the number of rows. Until the answer comes, and when
// it fails, charts keep their palette.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { parseChartColorScheme, type ChartColorScheme } from "../src/core";

const ChartColorSchemeContext = createContext<ChartColorScheme>("palette");

export interface ChartColorSchemeProviderProps {
  /** Reads the stored scheme — raw, the provider parses it. */
  load: () => Promise<unknown>;
  children: ReactNode;
}

export function ChartColorSchemeProvider({ load, children }: ChartColorSchemeProviderProps) {
  const [scheme, setScheme] = useState<ChartColorScheme>("palette");
  // Once per mount: callers pass an inline arrow, a new function on every render.
  const loadOnMount = useRef(load);

  useEffect(() => {
    let live = true;
    loadOnMount.current().then(
      (raw) => live && setScheme(parseChartColorScheme(raw, false)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  return <ChartColorSchemeContext.Provider value={scheme}>{children}</ChartColorSchemeContext.Provider>;
}

/** The scheme the charts below colour agents by — the palette when no provider is above. */
export function useChartColorScheme(): ChartColorScheme {
  return useContext(ChartColorSchemeContext);
}
