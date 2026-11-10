// Layer 1 — what the picture's "⋯" menu offers, as a value. The engine draws
// no menu of its own: it hands the host the picture it parsed and five actions
// that rewrite that one line of markdown, and asks for a menu to be put on the
// screen. This module turns that pair into a kit MenuSpec and nothing else — no
// DOM, no React, no clock: the wait the width slider needs arrives as a
// `Schedule`, like the five actions arrive as `actions`.
//
// The settings are the markdown's own: the tail after `|` inside the alt text,
// written with no separators — size, then `c` or `r`, then `h`:
// `![caption|600ch](img.png)`, `![caption|600x400c](img.png)`, `![caption|x400h](img.png)`.
// Nothing is stored beside the file.
import type { MenuSpec } from "../cellular-kit";
import { alignCenter, alignLeft, alignRight } from "../kasimov/kasimov.js";
import type {
  KasimovAlign,
  KasimovImage,
  KasimovImageActions,
  KasimovMax,
} from "../kasimov/kasimov.js";

/** The alignments the engine's tail knows, in the order the segment shows them. */
const ALIGN_OPTIONS: readonly { readonly align: KasimovAlign; readonly label: string }[] = [
  { align: alignLeft, label: "Left" },
  { align: alignCenter, label: "Center" },
  { align: alignRight, label: "Right" },
];

// Keyed by the tag, not matched by a chain of ternaries: a new alignment in the
// engine's union then fails to compile here instead of quietly meaning "left".
const ALIGN_INDEX: Record<KasimovAlign["tag"], number> = { left: 0, center: 1, right: 2 };

/** Widest cap the slider offers; 0 is its left end and means "no cap". */
export const MAX_WIDTH = 1200;
export const WIDTH_STEP = 20;

/**
 * How long the width slider waits before the engine hears it. Every action
 * rebuilds the whole document — mermaid diagrams included — so a slider
 * reporting each step straight through would rebuild it dozens of times per
 * drag.
 */
export const WIDTH_DELAY_MS = 150;

/** Puts `fn` off by `ms` and gives back the way to call it off. */
export type Schedule = (fn: () => void, ms: number) => () => void;

export interface Trailing<A> {
  run: (a: A) => void;
  /** Drops a pending call. Nothing pending — nothing happens. */
  cancel: () => void;
}

/** The width cap the picture carries, 0 when it carries none. */
export const widthOfMax = (max: KasimovMax): number =>
  max.tag === "w" || max.tag === "wh" ? max.w : 0;

/**
 * Runs `run` once the calls stop, with the last argument seen. `cancel` is not
 * a nicety: a pending call carries an edit into a document, and the editor it
 * would edit can be gone by then — a switch from Write to Read mid-drag
 * destroys it inside the wait.
 */
export function trailing<A>(schedule: Schedule, ms: number, run: (a: A) => void): Trailing<A> {
  let drop: (() => void) | null = null;
  let last: A;
  return {
    run: (a: A) => {
      last = a;
      drop?.();
      drop = schedule(() => {
        drop = null;
        run(last);
      }, ms);
    },
    cancel: () => {
      drop?.();
      drop = null;
    },
  };
}

export interface ImageMenu {
  spec: MenuSpec;
  /** Drops the width the slider has not handed over yet. Call when the editor goes away. */
  cancel: () => void;
}

/**
 * The menu for one picture. The caption's TEXT is not here: the engine's patch
 * carries width, height, alignment and the hide flag and takes `alt` from the
 * current value, so the words are edited where the rest of the words are.
 */
export function imageMenuSpec(
  image: KasimovImage,
  actions: KasimovImageActions,
  schedule: Schedule,
): ImageMenu {
  const width = trailing<number>(schedule, WIDTH_DELAY_MS, (w) => actions.setWidth(w));
  return {
    cancel: width.cancel,
    spec: {
      title: "Image",
      cols: 1,
      items: [
        {
          type: "segment",
          options: ALIGN_OPTIONS.map(({ label }) => ({ text: label, title: label })),
          current: ALIGN_INDEX[image.align.tag],
          onSelect: (index) =>
            actions.setAlign((ALIGN_OPTIONS[index] ?? ALIGN_OPTIONS[0]).align),
        },
        {
          type: "slider",
          label: "Width",
          min: 0,
          max: MAX_WIDTH,
          step: WIDTH_STEP,
          int: true,
          value: widthOfMax(image.max),
          onInput: width.run,
        },
        {
          type: "switch",
          label: "Hide caption",
          value: image.hideCaption,
          onSelect: (on) => actions.setHideCaption(on),
        },
        { label: "Delete", onSelect: () => actions.remove() },
      ],
    },
  };
}
