// Layer 2 — the guard over an unsaved draft: while it is mounted, everything
// on screen except the document is shaded, and a click on the shade asks what
// to do with the draft. It reads no file and saves nothing; MdDocView mounts it
// exactly while the draft differs from the file and hands it the two actions.
//
// Escape and a click beside the dialog close the dialog and nothing else. The
// shade stays for as long as the draft does: it is the draft's state, not the
// dialog's, so the only ways out of it are the two buttons — or the header's
// own Save and Cancel, which the hole in the shade leaves reachable.
//
// Both libraries here are shimmed by the host (see HOST_SHIMMED in
// packages/layer-guard), so this package may import them by value: a git
// install never has to find them on disk.
import * as Dialog from "@radix-ui/react-dialog";
import { MultiFileDiff } from "@pierre/diffs/react";
import { useLayoutEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";

import { useHostColorMode, type HostColorMode } from "../code-editor";
import { shadeRects, type Box } from "./shade-rects";

declare const __BB_PLUGIN_ID__: string | undefined;

export interface DraftGuardProps {
  /** The document's own box — the hole the shade leaves open. */
  anchor: RefObject<HTMLElement | null>;
  path: string;
  /** The file as last read. */
  before: string;
  /** The draft. */
  after: string;
  onSave: () => void;
  onDiscard: () => void;
}

// Portaled nodes live outside the plugin's root, so they carry the same marks
// the root does — the host scopes plugin chrome and its in-app links by them.
const portalScope = {
  "data-bb-portaled-overlay": "",
  "data-bb-plugin-root": "",
  ...(typeof __BB_PLUGIN_ID__ === "string" ? { "data-bb-plugin": __BB_PLUGIN_ID__ } : {}),
};

/**
 * The anchor's box against the viewport, re-measured when the anchor changes
 * size (a panel dragged wider), when the window does, and when anything
 * scrolls — a scrolled ancestor moves the panel without resizing it, and
 * scroll does not bubble, so only a capturing listener hears it. A panel that
 * moves for any other reason while keeping its size keeps the old hole until
 * the next of these. null until the first measure.
 */
function useShade(anchor: RefObject<HTMLElement | null>): readonly Box[] | null {
  const [shade, setShade] = useState<readonly Box[] | null>(null);
  useLayoutEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const measure = () => {
      const { left, top, width, height } = element.getBoundingClientRect();
      setShade(
        shadeRects(
          { left, top, width, height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [anchor]);
  return shade;
}

/** The library's own themes, picked by the host's scheme — as in Projects. */
const diffOptions = (mode: HostColorMode) =>
  ({
    theme: { dark: "pierre-dark", light: "pierre-light" },
    themeType: mode,
    overflow: "wrap",
    lineDiffType: "word",
    diffStyle: "unified",
  }) as const;

export function DraftGuard({ anchor, path, before, after, onSave, onDiscard }: DraftGuardProps) {
  const shade = useShade(anchor);
  const [open, setOpen] = useState(false);
  const mode = useHostColorMode();
  const options = useMemo(() => diffOptions(mode), [mode]);

  const close = (then: () => void) => () => {
    setOpen(false);
    then();
  };

  return (
    <>
      {shade &&
        createPortal(
          <div {...portalScope}>
            {shade.map((box, i) => (
              <div
                key={i}
                data-draft-shade=""
                className="mdo-shade"
                style={box}
                onClick={() => setOpen(true)}
                aria-hidden="true"
              />
            ))}
          </div>,
          document.body,
        )}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay
            {...portalScope}
            data-draft-dialog-overlay=""
            className="mdo-dialog-overlay"
          />
          <Dialog.Content
            {...portalScope}
            className="mdo-dialog"
            // Radix focuses the first button, which is Discard: an Enter
            // pressed on reflex would throw the draft away. The dialog itself
            // takes focus instead, and a choice needs a click or a Tab.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement).focus();
            }}
          >
            <Dialog.Title className="mdo-dialog-title">Unsaved changes</Dialog.Title>
            <Dialog.Description className="mdo-dialog-description">
              Save the draft to the file, or discard it.
            </Dialog.Description>
            <div className="mdo-dialog-diff">
              {/* No worker pool: a plugin bundle ships no worker script for
                  the highlighter to spawn. */}
              <MultiFileDiff
                oldFile={{ name: path, contents: before }}
                newFile={{ name: path, contents: after }}
                options={options}
                disableWorkerPool
              />
            </div>
            <div className="mdo-dialog-actions">
              <button
                type="button"
                onClick={close(onDiscard)}
                className="mdo-btn mdo-btn-destructive"
              >
                Discard Changes
              </button>
              <button
                type="button"
                onClick={close(onSave)}
                className="mdo-btn mdo-btn-solid"
              >
                Save Changes
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
