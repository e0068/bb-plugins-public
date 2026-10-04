// Shared layer — which palette the host is currently painting in.
//
// React Flow insists on stamping its own `light`/`dark` class onto the canvas,
// and bb's design tokens are scoped by exactly such a class. Left at its
// default the diagram therefore rendered in the *light* palette inside a dark
// panel: white cards, and edges drawn in a light-theme border colour that
// vanished against the dark background.
//
// The question is answered by `color-scheme` rather than by guessing at bb's
// class names. A host that themes itself has to declare it anyway — native
// scrollbars, form controls and the canvas background all read it — so it is
// the one signal that does not depend on how bb spells «dark» this month.
//
// The media query is subscribed to here rather than through a design-system
// hook: this package sits below every plugin, and a plugin's `components/ui`
// is above it. Ten lines of `matchMedia` are the price of not depending
// upward; the design-system hook stays where it is, for the consumers that
// are not this one.
import { useEffect, useState, useSyncExternalStore } from "react";

const DARK_COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function subscribeDark(notify: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(DARK_COLOR_SCHEME_QUERY);
  mql.addEventListener("change", notify);
  return () => mql.removeEventListener("change", notify);
}

function prefersDarkNow(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_COLOR_SCHEME_QUERY).matches;
}

export type HostColorMode = "light" | "dark";

/** What the root element declares, or `null` when it declares nothing. */
function declaredColorScheme(): HostColorMode | null {
  if (typeof document === "undefined") return null;
  const declared = getComputedStyle(document.documentElement).colorScheme;
  if (declared === "dark") return "dark";
  return declared === "light" ? "light" : null;
}

export function useHostColorMode(): HostColorMode {
  const prefersDark = useSyncExternalStore(subscribeDark, prefersDarkNow, () => false);
  const [declared, setDeclared] = useState<HostColorMode | null>(null);

  useEffect(() => {
    const read = () => setDeclared(declaredColorScheme());
    read();

    // A theme switch in bb is an attribute change on the root, not an event
    // this plugin is told about.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return declared ?? (prefersDark ? "dark" : "light");
}
