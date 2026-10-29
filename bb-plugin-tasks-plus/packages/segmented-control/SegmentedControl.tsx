// Shared layer — the design system's "one of N, exactly one active" control:
// ghost chrome like bb's own "Show right Panel" toggle, no border on the
// track, a filled pill only on the active option.
//
// Extracted from bb-plugin-projects, which drew it first for the folder's
// section tabs and the file's mode switch. A second consumer — the
// Read/Write/Raw switch in packages/md-doc-view — is a reason to depend
// downward on one control rather than to draw a third one by hand.
//
// One difference from the plugin's own version: the icon arrives as a
// ReactNode instead of a name from the plugin's Hugeicons registry. The
// registry belongs to the plugin, this package sits below it, and a shared
// layer that reached up into it would not be shared. The plugin keeps its
// IconName interface in a thin wrapper of its own.
//
// Radix's Tabs primitives are used directly rather than through a plugin's
// `components/ui/tabs` for the same reason. TabsContent is not used at all:
// the control is a switch, not a tab set — what it switches is drawn by
// whoever owns it.
//
// Those primitives arrive in `tabs` from the plugin, not from an import here.
// A plugin installed from git gets `node_modules` in its own folder only, the
// bundler resolves a package from the importing file up, and bb does not shim
// @radix-ui/react-tabs — an import written in this folder would find nothing.
// `import type` is erased by the bundler and never resolved.
//
// The look lives in segmented-control.css, in plain CSS on bb's tokens, and
// not in Tailwind utilities: `bb plugin build` runs its Tailwind pass over the
// PLUGIN's own tree, so a utility written down here reaches a consumer's
// stylesheet only if that consumer happens to use the same one somewhere else.
// See the note at the top of that file.
import { Fragment, type ReactNode } from "react";
import type * as TabsPrimitive from "@radix-ui/react-tabs";

import "./segmented-control.css";

export interface SegmentedControlOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
  /** A number after the label — how many items the option holds. */
  readonly count?: number;
}

/** The three Radix Tabs primitives the control is drawn with, imported by the plugin. */
export type TabsKit = Pick<typeof TabsPrimitive, "Root" | "List" | "Trigger">;

export interface SegmentedControlProps<T extends string> {
  readonly tabs: TabsKit;
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly options: readonly SegmentedControlOption<T>[];
  readonly "aria-label"?: string;
  /** Segments show only their icons; the label stays as each segment's accessible name. */
  readonly iconOnly?: boolean;
  readonly disabled?: boolean;
  /**
   * Wraps each segment — for a tooltip on an icon-only segment. The wrapper
   * gets the segment itself and must pass its props and ref down to it
   * (Radix `asChild` does).
   */
  readonly wrapSegment?: (segment: ReactNode, option: { readonly value: T; readonly label: string }) => ReactNode;
}

export function SegmentedControl<T extends string>({
  tabs: { Root, List, Trigger },
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  iconOnly = false,
  disabled = false,
  wrapSegment = (segment) => segment,
}: SegmentedControlProps<T>) {
  return (
    <Root value={value} onValueChange={(next) => onChange(next as T)}>
      <List aria-label={ariaLabel} className="sgc-track">
        {options.map((option) => (
          <Fragment key={option.value}>
            {wrapSegment(
              <Trigger
                value={option.value}
                disabled={disabled}
                aria-label={iconOnly ? option.label : undefined}
                // No TabsContent ever follows: the id Radix points at would dangle.
                aria-controls={undefined}
                className={iconOnly ? "sgc-segment sgc-segment-icon" : "sgc-segment"}
              >
                {option.icon}
                {!iconOnly && option.label}
                {!iconOnly && option.count !== undefined && <span className="sgc-count">{option.count}</span>}
              </Trigger>,
              option,
            )}
          </Fragment>
        ))}
      </List>
    </Root>
  );
}
