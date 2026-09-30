// Layer 2 — the document's header, and nothing else: it holds no state, reads
// no file and decides nothing. Everything it shows arrives as a prop, so the
// three surfaces that render a document (the MD Opener tab, the Cloud Config
// column, the Projects file panel) get the same header by construction rather
// than by three plugins agreeing to draw the same thing.
//
// One row. While the draft differs from the file, its left part — back, the
// path, forward and reload — gives way to the diff, Save and Cancel: the draft
// cannot be walked away from, and the switcher and the file's actions to the
// right stay where they are, so a control never moves when you start typing.
import type { ReactNode } from "react";

import { SegmentedControl, type TabsKit } from "../segmented-control";
import type { DocMode } from "./doc-mode";
import type { LineDiffCount } from "./line-diff";

export interface DocHeaderProps {
  /** Radix Tabs for the mode switch, imported by the plugin. */
  tabs: TabsKit;
  /** Path of the document on screen, or null while nothing is loaded. */
  path: string | null;
  /** Reveals that path in Finder. Not passed — the path is plain text. */
  onReveal?: (path: string) => void;
  /** The host tab's own chrome, before everything else. */
  leading?: ReactNode;
  /** The host tab's own chrome, after everything else. */
  trailing?: ReactNode;
  /** A save/reveal failure, shown under the path. */
  note: string | null;
  canGoBack: boolean;
  onBack: () => void;
  /** Something lies ahead after a step back: forward shows. default false. */
  canGoForward?: boolean;
  onForward?: () => void;
  mode: DocMode;
  /** What the switcher offers — see availableModes in doc-mode.ts. */
  modes: readonly DocMode[];
  onModeChange: (next: DocMode) => void;
  /** The file's own actions (the "⋯" menu), after the switcher and before trailing. */
  actions?: ReactNode;
  /** The draft differs from the file: the diff, Save and Cancel take the left of the row. */
  dirty: boolean;
  diff: LineDiffCount;
  onReload: () => void;
  onSave: () => void;
  onCancel: () => void;
}

const LABELS: Record<DocMode, string> = {
  read: "Read",
  write: "Write",
  raw: "Raw",
};

// Drawn here rather than taken from an icon set: the package sits below every
// plugin and has no registry to reach into (the same reason SegmentedControl
// takes its icons as ReactNode). currentColor keeps it on the token the button
// is coloured with.
const ReloadGlyph = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

const ArrowGlyph = ({ flip }: { flip?: boolean }) => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={flip ? { transform: "scaleX(-1)" } : undefined}
  >
    <path d="M19 12H5" />
    <path d="M12 19l-7-7 7-7" />
  </svg>
);

export function DocHeader({
  tabs,
  path,
  onReveal,
  leading,
  trailing,
  actions,
  note,
  canGoBack,
  onBack,
  canGoForward = false,
  onForward,
  mode,
  modes,
  onModeChange,
  dirty,
  diff,
  onReload,
  onSave,
  onCancel,
}: DocHeaderProps) {
  return (
    <div className="mdo-header">
      {leading}
      {dirty ? (
        <div className="mdo-draft">
          <span className="mdo-diff" aria-label="Draft difference">
            <span className="mdo-diff-add">+{diff.added}</span>{" "}
            <span className="mdo-diff-del">−{diff.removed}</span>
          </span>
          <button type="button" onClick={onSave} className="mdo-btn mdo-btn-primary">
            Save
          </button>
          <button type="button" onClick={onCancel} className="mdo-btn">
            Cancel
          </button>
          {/* A save that failed belongs to the draft still on screen. */}
          {note && <div className="mdo-note">{note}</div>}
        </div>
      ) : (
        <>
          {/* Always there, so the path never shifts when a first jump makes
              somewhere to go back to. */}
          <button
            type="button"
            onClick={onBack}
            disabled={!canGoBack}
            className="mdo-btn mdo-btn-icon mdo-nav"
            aria-label="Back"
            title="Back"
          >
            <ArrowGlyph />
          </button>
          <div className="mdo-heading">
            {path &&
              (onReveal ? (
                <button
                  type="button"
                  onClick={() => onReveal(path)}
                  className="mdo-path mdo-path-clickable"
                  title="Reveal in Finder"
                >
                  {path}
                </button>
              ) : (
                <div className="mdo-path">{path}</div>
              ))}
            {note && <div className="mdo-note">{note}</div>}
          </div>
          {canGoForward && (
            <button
              type="button"
              onClick={onForward}
              className="mdo-btn mdo-btn-icon mdo-nav"
              aria-label="Forward"
              title="Forward"
            >
              <ArrowGlyph flip />
            </button>
          )}
          <button
            type="button"
            onClick={onReload}
            className="mdo-btn mdo-btn-icon mdo-reload"
            aria-label="Reload"
            title="Reload from disk"
          >
            <ReloadGlyph />
          </button>
        </>
      )}
      <SegmentedControl
        tabs={tabs}
        value={mode}
        onChange={onModeChange}
        options={modes.map((value) => ({ value, label: LABELS[value] }))}
        aria-label="Document mode"
      />
      {actions}
      {trailing}
    </div>
  );
}
