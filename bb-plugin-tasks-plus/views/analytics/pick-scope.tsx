// Whose a click on the analytics screen is. A tile's pick stays while the
// owner clicks its chart, its table — menus in portals included — or the
// settings panel, and goes on any other click. Each click starts unowned (a
// listener on the document's capture phase); a tile or the panel claims it
// on the way down through React's tree, which portals bubble through; on the
// way back up the document tells every tile with a pick whose click it was.
import { createContext, useContext, useEffect, useRef, type MutableRefObject, type ReactNode } from "react";

/** The click's owner: a tile's id, "panel", or null — nobody's. */
const ClickOwner = createContext<MutableRefObject<string | null> | null>(null);

/** The settings panel's claim: its clicks keep every pick. */
export const PANEL = "panel";

export function PickScope({ children }: { children: ReactNode }) {
  const owner = useRef<string | null>(null);
  useEffect(() => {
    const unown = () => {
      owner.current = null;
    };
    document.addEventListener("click", unown, true);
    return () => document.removeEventListener("click", unown, true);
  }, []);
  return <ClickOwner.Provider value={owner}>{children}</ClickOwner.Provider>;
}

/** An `onClickCapture` that claims the click for `id`. Outside a PickScope it claims nothing. */
export function useKeepClick(id: string): () => void {
  const owner = useContext(ClickOwner);
  return () => {
    if (owner !== null) owner.current = id;
  };
}

/** A box whose clicks are `owner`'s — the settings panel's, say. */
export function ClaimClicks({ owner, className, children }: { owner: string; className?: string; children: ReactNode }) {
  return (
    <div className={className} onClickCapture={useKeepClick(owner)}>
      {children}
    </div>
  );
}

/** While `active`, calls `reset` on every click neither `id` nor the panel claimed. Outside a PickScope nothing resets. */
export function useOutsideReset(id: string, active: boolean, reset: () => void): void {
  const owner = useContext(ClickOwner);
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    if (owner === null || !active) return;
    const onClick = () => {
      if (owner.current !== id && owner.current !== PANEL) resetRef.current();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [owner, id, active]);
}
