import * as React from "react";

/**
 * Where menus, popovers, selects and dialogs hang their content; null — on
 * <body>, as Radix does. bb drops a node React made into a parent React does not own while a
 * plugin's async work is in flight, and <body> is such a parent: a surface
 * whose menus must always open gives them an element it renders itself.
 */
const OverlayContainerContext = React.createContext<HTMLElement | null>(null);

export function useOverlayContainer(): HTMLElement | undefined {
  return React.useContext(OverlayContainerContext) ?? undefined;
}

/** A surface's own element for the overlays under it, laid out as nothing. */
export function OverlayContainerRoot({ children }: { children: React.ReactNode }) {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  return (
    <OverlayContainerContext.Provider value={container}>
      <div ref={setContainer} data-overlay-container className="contents" />
      {children}
    </OverlayContainerContext.Provider>
  );
}
