/**
 * Purely presentational horizontal row of project-picker buttons, shared
 * between plugins that each keep their own selection semantics (single-scope
 * pick vs multi-select filter) and their own source of the option list — see
 * README.md. No host-specific imports (no `@/…`, no RPC): react + a literal
 * Tailwind class string only, so this package stays a plain workspace
 * dependency any plugin can pull in.
 */
// Explicit default import (not just the JSX type): this file lives outside
// any tsconfig.json's directory tree, so esbuild/vite's per-file tsconfig
// lookup finds none and falls back to the classic JSX transform (React.
// createElement calls needing `React` in scope) rather than the automatic
// runtime. Consuming a shared ../packages/* module that itself imports
// "react" also needs the consumer's vitest config to `dedupe: ["react", …]`
// — see bb-plugin-token-usage-header/vitest.config.ts and the same pattern
// already used by bb-plugin-workflow-composer/tasks-plus for packages/resizable-pane.
import React, { type JSX } from "react";

export interface ProjectSwitcherOption {
  key: string | null;
  label: string;
}

export interface ProjectSwitcherProps {
  options: ProjectSwitcherOption[];
  isSelected: (key: string | null) => boolean;
  onSelect: (key: string | null) => void;
  className?: string;
}

/**
 * Base/size/variant classes mirror this repo's shadcn-derived `Button`
 * primitive at `variant="default" | "outline"`, `size="sm"` — copied as a
 * literal string (not imported) so this package carries no dependency on any
 * host plugin's `components/ui/button.tsx` or `cn`/`cva` helpers.
 */
const BASE_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium h-8 px-3 transition-colors duration-150 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const SELECTED_BUTTON_CLASS = "bg-foreground text-background hover:bg-foreground/90";
const UNSELECTED_BUTTON_CLASS = "border border-input bg-transparent hover:bg-state-hover hover:text-foreground";

/**
 * Horizontal, wrapping row of option buttons — one per `options` entry, the
 * selected one(s) highlighted via `isSelected`. Selection semantics (single
 * pick, multi-filter, "all" reset, …) live entirely in the caller's
 * `isSelected`/`onSelect`; this component only renders and dispatches clicks.
 */
export function ProjectSwitcher({ options, isSelected, onSelect, className }: ProjectSwitcherProps): JSX.Element {
  return (
    <div className={`flex flex-wrap items-center gap-2${className ? ` ${className}` : ""}`}>
      {options.map((option) => {
        const selected = isSelected(option.key);
        return (
          <button
            key={`k:${String(option.key)}`}
            type="button"
            aria-pressed={selected}
            className={`${BASE_BUTTON_CLASS} ${selected ? SELECTED_BUTTON_CLASS : UNSELECTED_BUTTON_CLASS}`}
            onClick={() => onSelect(option.key)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
