// Layer 1 — picks which of the "Done & Archive" button's three faces to
// render. Zero effects.
//
// The button has to say two things at once: what pressing it does, and that
// one of its preconditions could not be checked. The design system's Button
// drops `title`, so a native tooltip is not available — instead the badge
// idiom already used by the main-pull button applies: at rest the label states
// the condition, hovering swaps it for the action.
import type { ArchiveReason } from "./archive-readiness";

/**
 * - `submitting` — the click is in flight;
 * - `warning` — the work landed, but the working copy could not be read;
 * - `action` — the plain, pressable state.
 */
export type ArchiveButtonFace = "action" | "submitting" | "warning";

export interface ArchiveButtonFaceInput {
  /** The reason from `archiveState`; a plain string, since the RPC widens it. */
  reason: string;
  hovering: boolean;
  submitting: boolean;
}

export function archiveButtonFace({
  reason,
  hovering,
  submitting,
}: ArchiveButtonFaceInput): ArchiveButtonFace {
  // An in-flight click outranks everything: the spinner has to stay visible
  // even if the pointer wanders off the button.
  if (submitting) return "submitting";
  // Hovering the warning reveals what pressing it will do. Getting this sign
  // backwards would freeze the button on the warning label forever, and
  // `aria-label` — which does not depend on hovering — would not reveal it.
  if (hovering) return "action";
  return reason === ("tree-unverified" satisfies ArchiveReason) ? "warning" : "action";
}
