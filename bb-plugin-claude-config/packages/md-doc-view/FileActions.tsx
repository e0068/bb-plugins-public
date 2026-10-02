// Layer 2 — what can be done to the file on screen: the header's "⋯" button,
// its menu, and the two dialogs behind it. It reads and writes nothing; the
// host's rename and delete arrive as props and answer with null (done) or the
// reason they refused, which stays in the dialog.
//
// The button and the name field are Cellular's (packages/cellular-react), the
// dialogs Radix's — the split the design system draws: kit for the plaques,
// Radix for dialog primitives (docs/wiki/plugin-dependency-stack.md).
import * as Dialog from "@radix-ui/react-dialog";
import { useLayoutEffect, useRef, useState } from "react";

import { EditField, Kit, button, uiMenu, type MenuController, type MenuSpec } from "../cellular-react";
import "../cellular-react/styles.css";
import { fileNameOf, renameProblem } from "./file-name";
import { portalScope } from "./portal-scope";

export interface FileActionsProps {
  /** The file the actions apply to. */
  path: string;
  /** An unsaved draft: the button stays in place but opens nothing. */
  disabled: boolean;
  /** Renames the file within its folder; null — done, a string — why not. Absent — no Rename. */
  onRename?: (name: string) => Promise<string | null>;
  /** Deletes the file; null — done, a string — why not. Absent — no Delete. */
  onDelete?: () => Promise<string | null>;
}

type Open = "rename" | "delete" | null;

// Drawn here, like the header's other glyphs: kit takes an icon as markup.
const MORE_GLYPH =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

export function FileActions({ path, disabled, onRename, onDelete }: FileActionsProps) {
  const [open, setOpen] = useState<Open>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const holder = useRef<HTMLSpanElement>(null);
  const menu = useRef<MenuController | null>(null);
  const name = fileNameOf(path);

  const show = (next: Open) => {
    setProblem(null);
    setOpen(next);
  };
  const close = () => show(null);

  // kit reads the items when the menu opens, so the spec object stays the same
  // and only its items follow the props.
  const spec = useRef<MenuSpec>({ items: [] });
  spec.current.items = [
    ...(onRename ? [{ label: "Rename", onSelect: () => show("rename") }] : []),
    ...(onDelete ? [{ label: "Delete", onSelect: () => show("delete") }] : []),
  ];

  // kit's button has no disabled state, and a menu given to it through
  // `hasMenu` is fixed when the button is made — so the menu is opened here,
  // on a click the disabled flag can refuse.
  const cell = () => holder.current?.querySelector<HTMLElement>(".uicell") ?? null;
  useLayoutEffect(() => {
    cell()?.setAttribute("aria-haspopup", "menu");
    cell()?.setAttribute("aria-disabled", String(disabled));
    if (disabled) menu.current?.close();
  });
  // The menu hangs on document.body, outside anything React removes.
  useLayoutEffect(() => () => menu.current?.close(), []);
  const toggleMenu = () => {
    const anchor = cell();
    if (disabled || anchor === null) return;
    menu.current ??= uiMenu(anchor, spec.current);
    menu.current.toggle();
  };

  // One request at a time: a second Enter or click while the host is still
  // answering would rename or delete twice. A request that throws — the plugin
  // server restarting, a remote host gone — is a refusal like any other, and
  // never leaves the actions locked.
  const settle = async (request: () => Promise<string | null>) => {
    if (busy.current) return;
    busy.current = true;
    let refusal: string | null;
    try {
      refusal = await request();
    } catch (err) {
      refusal = err instanceof Error ? err.message : String(err);
    } finally {
      busy.current = false;
    }
    if (refusal === null) close();
    else setProblem(refusal);
  };

  // EditField reports Escape and blur alike as a cancel. Only Escape closes the
  // dialog: a blur is a click on the dialog's own text or buttons, or the
  // window losing focus. The capture handler runs before the field's own.
  const escaping = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const fieldValue = () => content.current?.querySelector("input")?.value ?? "";

  const commitRename = (next: string) => {
    const local = renameProblem(next, path);
    if (local !== null) setProblem(local);
    else if (onRename) void settle(() => onRename(next));
  };

  const dialogProps = {
    ...portalScope,
    className: "mdo-dialog mdo-file-dialog",
    "aria-describedby": undefined,
  };

  return (
    <span ref={holder} className="mdo-more">
      <Kit make={button} props={{ title: "More actions", leftIcon: MORE_GLYPH, onClick: toggleMenu }} />

      <Dialog.Root open={open === "rename"} onOpenChange={(isOpen) => !isOpen && close()}>
        <Dialog.Portal>
          <Dialog.Overlay {...portalScope} className="mdo-dialog-overlay" />
          <Dialog.Content
            {...dialogProps}
            ref={content}
            // The name field takes focus itself and selects the name.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onKeyDownCapture={(event) => {
              escaping.current = event.key === "Escape";
            }}
          >
            <Dialog.Title className="mdo-dialog-title">Rename file</Dialog.Title>
            <EditField
              value={name}
              onCommit={commitRename}
              onCancel={() => escaping.current && close()}
            />
            {problem === null ? (
              <p className="mdo-dialog-description">Enter to rename, Esc to cancel.</p>
            ) : (
              <p className="mdo-dialog-problem" role="alert">
                {problem}
              </p>
            )}
            <div className="mdo-dialog-actions">
              <Kit make={button} props={{ label: "Cancel", onClick: close }} />
              <Kit make={button} props={{ label: "Rename", onClick: () => commitRename(fieldValue()) }} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={open === "delete"} onOpenChange={(isOpen) => !isOpen && close()}>
        <Dialog.Portal>
          <Dialog.Overlay {...portalScope} className="mdo-dialog-overlay" />
          <Dialog.Content {...dialogProps}>
            <Dialog.Title className="mdo-dialog-title">Delete file</Dialog.Title>
            <p className="mdo-dialog-description">Delete {name}? This can't be undone.</p>
            {problem !== null && (
              <p className="mdo-dialog-problem" role="alert">
                {problem}
              </p>
            )}
            <div className="mdo-dialog-actions">
              <Kit make={button} props={{ label: "Cancel", onClick: close }} />
              <Kit
                make={button}
                props={{ label: "Delete", onClick: () => onDelete && void settle(onDelete) }}
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </span>
  );
}
