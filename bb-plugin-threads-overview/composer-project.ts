// The project of the home composer as the plugin last knew it: the one the
// section put there, or the one bb's new-thread composer on Home reported
// after it was set from outside the section. The section and the home-swipe
// overlay are two mounts that share no React tree, and the section remounts on
// every visit to Home, so it lives here, kept across reloads: the section opens
// its slides on it again and the overlay's composer shows it under the card.
import { useCallback, useEffect, useRef, useSyncExternalStore, createElement } from "react";
import { experimental_useSidebarThreadActions, useComposerView } from "@get-bb/plugin-sdk/app";

const STORAGE_KEY = "bb-plugin-attention:composer-project";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readProject(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeProject(projectId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, projectId);
  } catch {
    // A blocked or full store only costs the memory, not the choice itself.
  }
  listeners.forEach((listener) => listener());
}

/** The home composer's project as last known; null until one is. */
export function useComposerProject(): string | null {
  return useSyncExternalStore(subscribe, readProject, readProject);
}

/** How a slide came into view: picked outright, or scrolled to. */
export type SlideArrival = "picked" | "scrolled";

/**
 * Put a project into the home composer through bb's own action, which also
 * makes it the composer's selection. A slide picked outright — a pill, a
 * click, grouping switched on — always asks: the composer may have changed
 * since in a way the plugin did not hear, on a bb without composer surfaces.
 * A slide scrolled to asks only for a project not already asked for, so a
 * re-snap after layout never becomes a request. `enabled` false leaves the
 * composer alone: with threads opening in a side panel beside Home, going to
 * the new-thread screen would disturb the split.
 */
export function useChooseComposerProject(
  enabled: boolean,
): (projectId: string, arrival: SlideArrival) => void {
  const threadActions = experimental_useSidebarThreadActions();
  return useCallback(
    (projectId: string, arrival: SlideArrival) => {
      if (!enabled || (arrival === "scrolled" && projectId === readProject())) return;
      writeProject(projectId);
      threadActions.openNewThread({ projectId, focusPrompt: false });
    },
    [enabled, threadActions],
  );
}

/**
 * Stands inside bb's new-thread composer and hears its project, whatever set
 * it — New thread on a project in the sidebar, the composer's own picker — so
 * the section's slides follow the composer and not only the other way round.
 * Only the composer on Home is heard: it finds where it stands by a mark it
 * draws hidden, which takes no room above the composer. A project the section
 * put there itself is already the one kept, and a composer with no project
 * leaves the kept one alone.
 */
export function ComposerProjectWatch() {
  const { scope } = useComposerView();
  const projectId = scope.kind === "new-thread" ? scope.projectId : null;
  const markRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const onHome = markRef.current?.closest(HOME_PANEL) != null;
    if (onHome && projectId !== null && projectId !== readProject()) writeProject(projectId);
  }, [projectId]);
  return createElement("span", { ref: markRef, hidden: true, style: { display: "none" } });
}

// bb's panel of the new-thread screen, Home. A new-thread composer a plugin
// embeds elsewhere — a chat on the Projects page — stands outside it, and its
// project is not the home composer's.
const HOME_PANEL = '[data-panel-id="root-compose-main-panel"]';
