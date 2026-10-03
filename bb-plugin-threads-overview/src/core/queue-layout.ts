// Which way the queue runs. On a phone the composer sits at the foot of the
// screen, and a setting turns the section over so that what the thumb wants
// first — the count, the filters, the projects, the first thread — stands
// nearest to it. Layer 1, no effects and no SDK.

/** `top-down` reads from the top bar down; `bottom-up` from the composer up. */
export type QueueLayout = "top-down" | "bottom-up";

/** The layout for the `invertOnPhone` setting, read raw off the settings, on a phone-wide screen or not. */
export function queueLayout(invertOnPhone: unknown, compact: boolean): QueueLayout {
  return invertOnPhone === true && compact ? "bottom-up" : "top-down";
}
