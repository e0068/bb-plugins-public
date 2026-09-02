// Shared layer: the presentational experience of MD Opener (the Kasimov editor)
// with inverted dependencies. The component owns the jump stack, edit mode, and
// the CAS note, while effects (reading/writing the file, resolving link targets)
// arrive as function props — the consuming plugin supplies its own RPC. The core
// itself knows nothing about bb or the tab's source.
//
// Ported from bb-plugin-md-opener/app.tsx (DocOpener), where useRpc/source were
// replaced with load/save/resolveLinkTarget. Any file — markdown or not — is
// edited as raw text; there is no separate "read-only" mode for non-md, per the
// owner's decision (memory/decisions/claude-config-opener-setting.md).
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { KasimovEditor } from "./KasimovEditor";
import "./md-doc-view.css";

export interface LoadedDoc {
  path: string;
  content: string | null;
  sha256: string | null;
  error?: string | null;
}

export interface SaveResult {
  outcome: "written" | "conflict" | "denied" | "not-found";
  sha256?: string | null;
  message?: string | null;
}

export interface MdDocViewProps {
  /** Absolute (or relative initial) path to show first. */
  initialPath: string;
  load: (path: string) => Promise<LoadedDoc>;
  save: (
    path: string,
    content: string,
    expectedSha256: string | null,
  ) => Promise<SaveResult>;
  /** Absolute target of an in-tab link, or null (link is not clickable). */
  resolveLinkTarget: (href: string, fromPath: string) => string | null;
  /** CSS custom properties (`--kasi-*`) for the editor's appearance. */
  vars?: Record<string, string>;
  /** Clicking a live link follows it. default true. */
  followLinks?: boolean;
  /** `@path` (Claude @import) is clickable. default true. */
  atLinks?: boolean;
  /** Show the frontmatter block as a grid. default true. */
  frontmatter?: boolean;
  /** Mermaid node style: "contrast" — filled chip; "soft" — soft (default). */
  mermaidNodes?: "soft" | "contrast";
  /**
   * Extra element at the start of the header, before the internal back arrow
   * (e.g. a button that returns to the host tab's outer list). Doesn't own its
   * own navigation — it renders whatever the consumer passed. The package isn't
   * tied to its behavior, so the header also shows without a file to edit (just
   * for leading), see showHeader below.
   */
  leading?: ReactNode;
  /**
   * Replacement for the "Edit" button in view mode — e.g. an icon without text.
   * The package doesn't know the host's icon set, so rendering is handed to the
   * consumer; the component itself only passes the callback that enters edit
   * mode. Default (not passed) — the previous text button.
   */
  editButton?: (onClick: () => void) => ReactNode;
}

export function MdDocView({
  initialPath,
  load,
  save,
  resolveLinkTarget,
  vars,
  followLinks,
  atLinks,
  frontmatter,
  mermaidNodes,
  leading,
  editButton,
}: MdDocViewProps) {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [stack, setStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveNote, setSaveNote] = useState<string | null>(null);

  // Single load resolver. push=true — a jump (pushed onto the stack), false —
  // a return (the caller already trimmed the stack) or the initial load.
  const runLoad = (target: string, push: boolean) => {
    setLoading(true);
    setEditing(false);
    setSaveNote(null);
    void load(target).then((res) => {
      setDoc(res);
      setStack((s) => (push ? [...s, res.path || target] : s));
      setLoading(false);
    });
  };
  const loadRef = useRef(runLoad);
  loadRef.current = runLoad;

  // Initial load — by initialPath. Changing the path resets the tab/draft.
  useEffect(() => {
    setStack([]);
    setLoading(true);
    setEditing(false);
    setSaveNote(null);
    void load(initialPath).then((res) => {
      setDoc(res);
      setStack([res.path || initialPath]);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  const openAbs = (abs: string) => loadRef.current(abs, true);

  const back = () => {
    if (stack.length < 2) return;
    const prev = stack[stack.length - 2];
    setStack((s) => s.slice(0, -1));
    runLoad(prev, false);
  };

  const current = stack[stack.length - 1] ?? doc?.path ?? initialPath;

  // An in-tab link is clickable if resolveLinkTarget returned an absolute
  // target; clicking a missing one will surface an error from load.
  const linkResolver = (href: string) => {
    const abs = resolveLinkTarget(href, current);
    return abs ? { onClick: () => openAbs(abs) } : null;
  };

  const canEdit = !!doc && doc.content != null && !doc.error;

  const startEdit = () => {
    if (!canEdit) return;
    setDraft(doc?.content ?? "");
    setSaveNote(null);
    setEditing(true);
  };

  // CAS save: sha from the last read. Conflict — show a message, don't lose the
  // edit; success — update the content and fresh sha, exit edit mode.
  const runSave = (content: string) => {
    if (!doc || doc.content == null) return;
    setSaveNote(null);
    void save(doc.path, content, doc.sha256).then((res) => {
      if (res.outcome === "written") {
        setDoc({ ...doc, content, sha256: res.sha256 ?? null });
        setEditing(false);
      } else {
        setSaveNote(res.message ?? "Failed to save.");
      }
    });
  };

  // Clicking the text in view mode enters edit mode. The editor itself follows
  // links via linkResolver (class .mde-link) — clicking one shouldn't open edit mode.
  const onDocClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (editing) return;
    const el = event.target as HTMLElement;
    if (el.closest(".mde-link")) return;
    if (canEdit) startEdit();
  };

  const fileName = (doc?.path || initialPath).split("/").pop() ?? "";
  // The header also shows when the file is editable: it hosts a visible "Edit"
  // button — entering edit mode is otherwise not discoverable (clicking the
  // text isn't visible as an affordance). leading is the host tab's navigation
  // (unrelated to editing), so it too keeps the header visible even when the
  // file itself isn't loaded yet or isn't being edited.
  const showHeader =
    editing || stack.length > 1 || !!saveNote || (canEdit && !editing) || !!leading;

  return (
    <div className="mdo-root">
      {/* No header by default — matching the native experience. It appears on
          return after a jump, in edit mode, on a save error, or when the host
          tab passed leading. */}
      {showHeader && (
        <div className="mdo-header">
          {leading}
          {!editing && stack.length > 1 && (
            <button
              type="button"
              onClick={back}
              className="mdo-back"
              aria-label="Back"
            >
              ←
            </button>
          )}
          <div className="mdo-heading">
            <div className="mdo-title">{fileName}</div>
            {saveNote && <div className="mdo-note">{saveNote}</div>}
          </div>
          {editing ? (
            <div className="mdo-actions">
              <button
                type="button"
                onClick={() => runSave(draft)}
                className="mdo-btn mdo-btn-primary"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setSaveNote(null);
                }}
                className="mdo-btn"
              >
                Cancel
              </button>
            </div>
          ) : (
            canEdit &&
            (editButton ? (
              editButton(startEdit)
            ) : (
              <div className="mdo-actions">
                <button
                  type="button"
                  onClick={startEdit}
                  className="mdo-btn mdo-btn-primary"
                >
                  Edit
                </button>
              </div>
            ))
          )}
        </div>
      )}

      <div className="mdo-body">
        {loading && <p className="mdo-msg">Loading…</p>}
        {!loading && doc?.error && <p className="mdo-msg mdo-err">{doc.error}</p>}
        {!loading && doc?.content != null && (
          <div className="mdo-doc" onClick={onDocClick}>
            <KasimovEditor
              editable={editing}
              followLinks={followLinks}
              atLinks={atLinks}
              frontmatter={frontmatter}
              mermaidNodes={mermaidNodes}
              vars={vars}
              value={editing ? draft : doc.content}
              onChange={setDraft}
              linkResolver={linkResolver}
              onSave={(md) => {
                setDraft(md);
                runSave(md);
              }}
              className="mdo-mde"
            />
          </div>
        )}
      </div>
    </div>
  );
}
