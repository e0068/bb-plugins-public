// Pure side-panel rule: how to open a thread so the side panel is reused
// instead of a new one being split off on every click.
//
// The host offers no "open in pane X". What it does offer: opening an already
// open thread with `split` only focuses its pane, and a plain open puts the
// thread into whichever pane holds the focus. So the pane the previous thread
// sits in is focused first, and the new thread then replaces it. Layer 1:
// depends on nothing.

/** One call to the host's thread `open`. */
export interface OpenStep {
  readonly threadId: string;
  readonly split: boolean;
}

/** The thread last opened in the side panel, and whether a pane still holds it. */
export interface PreviousSidePane {
  readonly threadId: string;
  readonly open: boolean;
}

/** The opens that show `threadId` in the side panel, reusing it when it is still there. */
export function sidePaneSteps(
  threadId: string,
  previous: PreviousSidePane | null,
): readonly OpenStep[] {
  if (previous === null || !previous.open || previous.threadId === threadId) {
    return [{ threadId, split: true }];
  }
  return [
    { threadId: previous.threadId, split: true },
    { threadId, split: false },
  ];
}
