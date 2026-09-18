// Pure keyboard rule for the queue: where a key pressed on a row leads.
// Layer 1: depends on nothing.

/** What a key on a queue row does. */
export type KeyMove =
  | { readonly kind: "focus"; readonly index: number }
  | { readonly kind: "composer" }
  | { readonly kind: "open" }
  | { readonly kind: "none" };

/** The move for `key` pressed on row `index` of a list `count` rows long. */
export function queueKeyMove(key: string, index: number, count: number): KeyMove {
  switch (key) {
    case "ArrowDown":
      return index + 1 < count ? { kind: "focus", index: index + 1 } : { kind: "none" };
    case "ArrowUp":
      return index > 0 ? { kind: "focus", index: index - 1 } : { kind: "composer" };
    case "Escape":
      return { kind: "composer" };
    case "Enter":
    case "ArrowRight":
      return { kind: "open" };
    default:
      return { kind: "none" };
  }
}

/** What the section knows about a key pressed in a composer. */
export interface ComposerKeyFacts {
  readonly key: string;
  /** Shift, Alt, Ctrl or Meta held: the key edits or selects, it does not navigate. */
  readonly modified: boolean;
  /** The composer is the home screen's own, not the one of a thread in another pane. */
  readonly ownComposer: boolean;
  readonly empty: boolean;
  readonly caretAtStart: boolean;
}

/** What a composer key does to the queue. */
export type ComposerMove = "enter-queue" | "back-to-queue" | "none";

/**
 * The down arrow in the home screen's empty composer enters the queue; the
 * left arrow at the very start of another pane's composer — the thread opened
 * beside the home screen — comes back to it.
 */
export function composerKeyMove(facts: ComposerKeyFacts): ComposerMove {
  if (facts.modified) return "none";
  if (facts.key === "ArrowDown" && facts.ownComposer && facts.empty) return "enter-queue";
  if (facts.key === "ArrowLeft" && !facts.ownComposer && facts.caretAtStart) return "back-to-queue";
  return "none";
}
