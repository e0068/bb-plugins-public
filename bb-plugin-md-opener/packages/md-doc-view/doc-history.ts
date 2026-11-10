// Layer 1 — the tab's walk through documents, as a value. Nothing here reads a
// file: it only says which path is on screen and where back and forward lead.
//
// Three parts rather than a list and an index: stepping moves one path from
// one side to the other, so no step can leave an index pointing past the end,
// and a file that was deleted from under the reader can leave `current` empty
// while back still knows where to go.

export interface DocHistory {
  /** Opened before the current one, oldest first. */
  readonly back: readonly string[];
  /** The path on screen; null once that file was deleted. */
  readonly current: string | null;
  /** Stepped back over, nearest first. */
  readonly forward: readonly string[];
}

export const startAt = (path: string): DocHistory => ({ back: [], current: path, forward: [] });

const behind = (h: DocHistory): readonly string[] =>
  h.current === null ? h.back : [...h.back, h.current];

/** A jump: the current path goes behind, whatever lay ahead is gone. */
export const visit = (h: DocHistory, path: string): DocHistory =>
  path === h.current ? h : { back: behind(h), current: path, forward: [] };

export const canGoBack = (h: DocHistory): boolean => h.back.length > 0;

export const canGoForward = (h: DocHistory): boolean => h.forward.length > 0;

export const goBack = (h: DocHistory): DocHistory =>
  canGoBack(h)
    ? {
        back: h.back.slice(0, -1),
        current: h.back[h.back.length - 1],
        forward: h.current === null ? h.forward : [h.current, ...h.forward],
      }
    : h;

export const goForward = (h: DocHistory): DocHistory =>
  canGoForward(h)
    ? { back: behind(h), current: h.forward[0], forward: h.forward.slice(1) }
    : h;

const swap = (from: string, to: string) => (p: string) => (p === from ? to : p);

/** The file was renamed: every entry of it now names the new path. */
export const renamePath = (h: DocHistory, from: string, to: string): DocHistory => ({
  back: h.back.map(swap(from, to)),
  current: h.current === from ? to : h.current,
  forward: h.forward.map(swap(from, to)),
});

// Neighbours that became equal once a path between them went away.
const collapse = (paths: readonly string[]): string[] =>
  paths.filter((p, i) => p !== paths[i - 1]);

/**
 * The file was deleted: it is gone from every part. A current path equal to
 * it becomes null, and no two neighbouring entries — across all three parts —
 * are left naming the same file.
 */
export const removePath = (h: DocHistory, path: string): DocHistory => {
  const current = h.current === path ? null : h.current;
  const back = collapse(h.back.filter((p) => p !== path));
  const forward = collapse(h.forward.filter((p) => p !== path));
  // What the first path ahead must not repeat: the one on screen, or — with
  // nothing on screen — the one back leads to.
  const anchor = current ?? back[back.length - 1];
  return {
    back: current !== null && back[back.length - 1] === current ? back.slice(0, -1) : back,
    current,
    forward: forward[0] === anchor ? forward.slice(1) : forward,
  };
};
