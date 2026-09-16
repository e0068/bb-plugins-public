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
import type { ReactNode } from "react";
import type * as TabsPrimitive from "@radix-ui/react-tabs";

import "./segmented-control.css";

export interface SegmentedControlOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
}

/** The three Radix Tabs primitives the control is drawn with, imported by the plugin. */
export type TabsKit = Pick<typeof TabsPrimitive, "Root" | "List" | "Trigger">;

export interface SegmentedControlProps<T extends string> {
  readonly tabs: TabsKit;
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly options: readonly SegmentedControlOption<T>[];
  readonly "aria-label"?: string;
}

export function SegmentedControl<T extends string>({
  tabs: { Root, List, Trigger },
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <Root value={value} onValueChange={(next) => onChange(next as T)}>
      <List aria-label={ariaLabel} className="sgc-track">
        {options.map((option) => (
          <Trigger key={option.value} value={option.value} className="sgc-segment">
            {option.icon}
            {option.label}
          </Trigger>
        ))}
      </List>
    </Root>
  );
}
