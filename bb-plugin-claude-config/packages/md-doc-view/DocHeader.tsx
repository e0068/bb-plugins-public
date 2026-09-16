// Layer 2 — the document's header, and nothing else: it holds no state, reads
// no file and decides nothing. Everything it shows arrives as a prop, so the
// three surfaces that render a document (the MD Opener tab, the Cloud Config
// column, the Projects file panel) get the same header by construction rather
// than by three plugins agreeing to draw the same thing.
//
// Two rows, and the second one exists only while the draft differs from the
// file. Keeping Save and Cancel out of the first row is what lets the switcher
// stay in one place: a control that moves sideways when you start typing is a
// control you have to look for again.
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
  mode: DocMode;
  /** What the switcher offers — see availableModes in doc-mode.ts. */
  modes: readonly DocMode[];
  onModeChange: (next: DocMode) => void;
  /** The draft differs from the file: the second row appears. */
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

export function DocHeader({
  tabs,
  path,
  onReveal,
  leading,
  trailing,
  note,
  canGoBack,
  onBack,
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
    <>
      <div className="mdo-header">
        {leading}
        {canGoBack && (
          <button
            type="button"
            onClick={onBack}
            className="mdo-back"
            aria-label="Back"
          >
            ←
          </button>
        )}
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
        {/* Disabled rather than hidden while dirty: a re-read would drop the
            draft without asking, and a control that disappears reads as "this
            document cannot be re-read" instead of "not while unsaved". This
            guards the draft against THIS control and no other — following a
            link, or the host switching files, still drops an unsaved draft the
            way it always has. Whether that should change is the owner's call,
            and a task of its own. */}
        <button
          type="button"
          onClick={onReload}
          disabled={dirty}
          className="mdo-btn mdo-btn-icon mdo-reload"
          aria-label="Reload"
          title={dirty ? "Save or cancel first" : "Reload from disk"}
        >
          <ReloadGlyph />
        </button>
        <SegmentedControl
          tabs={tabs}
          value={mode}
          onChange={onModeChange}
          options={modes.map((value) => ({ value, label: LABELS[value] }))}
          aria-label="Document mode"
        />
        {trailing}
      </div>

      {dirty && (
        <div className="mdo-row2">
          <span className="mdo-diff" aria-label="Draft difference">
            <span className="mdo-diff-add">+{diff.added}</span>{" "}
            <span className="mdo-diff-del">−{diff.removed}</span>
          </span>
          <div className="mdo-actions">
            <button
              type="button"
              onClick={onSave}
              className="mdo-btn mdo-btn-primary"
            >
              Save
            </button>
            <button type="button" onClick={onCancel} className="mdo-btn">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
