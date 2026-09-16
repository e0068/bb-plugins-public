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
import type { CSSProperties, ReactNode } from "react";

import { CodeEditor, languageOf } from "../code-editor";
import { DocHeader } from "./DocHeader";
import { DraftGuard } from "./DraftGuard";
import type { DocLibraries } from "./libraries";
import { KasimovEditor } from "./KasimovEditor";
import {
  availableModes,
  initialMode,
  settleMode,
  type DocMode,
} from "./doc-mode";
import { lineDiff } from "./line-diff";
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

const ZERO_DIFF = { added: 0, removed: 0 } as const;

export interface RevealResult {
  revealed: boolean;
  error: string | null;
}

export interface MdDocViewProps {
  /**
   * CodeMirror and Radix Tabs, imported by the plugin (see libraries.ts). Pass
   * one module-level constant: the editor rebuilds when it changes identity.
   */
  libraries: DocLibraries;
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
   * A document shows up ready to edit instead of in read mode. default false.
   * Applies to every document the tab shows — the initial one AND the target
   * of a jump: the mode is a property of "how this tab opens documents", not
   * of one particular file. An unreadable file (error / no content) stays an
   * error: there is nothing to draft from.
   */
  startInEdit?: boolean;
  /**
   * Nothing in this tab can be edited: no "Edit" button, no click-to-edit, and
   * startInEdit is refused. Like startInEdit, it is a property of HOW THE TAB
   * OPENS DOCUMENTS, not of one of them — the target of a jump is read-only
   * too. Written for a document the host ASSEMBLED rather than read — a node
   * passport, a generated report — which has no file a save could land on, and
   * whose links lead into code the reader came to read, not to edit.
   * This is not the "read-only for non-markdown" mode the owner rejected (see
   * the note at the top): a real file stays editable as raw text whatever its
   * name, in any tab that did not ask for this. default false.
   */
  readOnly?: boolean;
  /**
   * Extra element at the start of the header, before the internal back arrow
   * (e.g. a button that returns to the host tab's outer list). Doesn't own its
   * own navigation — it renders whatever the consumer passed. The header shows
   * whether or not there is a file behind it, so a document that failed to
   * load still has the host's way out of it.
   */
  leading?: ReactNode;
  /**
   * The line the FIRST document opens on, counted from one — a jump from a
   * symbol in the host's code map. A document opened this way starts in Raw:
   * a line number is an address in the source, and the rendering has no lines
   * to point at. Applies to that first document only; following a link from
   * it opens the target the way any other document opens.
   */
  initialLine?: number | null;
  /**
   * Reveals the current file in Finder (on the machine running bb's server).
   * Not passed — the path in the header still shows, but isn't clickable.
   * Failure is surfaced in the same note slot as a save error.
   */
  onReveal?: (path: string) => Promise<RevealResult>;
  /**
   * Extra element at the END of the header, after the mode switcher — e.g.
   * the host panel's own buttons, which have to sit in the same place as they
   * do outside MdDocView so that switching modes doesn't move them.
   */
  trailing?: ReactNode;
  /**
   * While the draft differs from the file, everything on screen except this
   * view is shaded, and a click on the shade opens a dialog with the draft's
   * diff and Discard / Save. Escape or a click beside the dialog closes the
   * dialog alone. For a view that owns its surface — the MD Opener tab — and
   * not for one embedded among the host's own controls. default false.
   */
  guardDraft?: boolean;
}

export function MdDocView({
  libraries,
  initialPath,
  load,
  save,
  resolveLinkTarget,
  vars,
  followLinks,
  atLinks,
  frontmatter,
  mermaidNodes,
  startInEdit = false,
  readOnly = false,
  initialLine = null,
  leading,
  onReveal,
  trailing,
  guardDraft = false,
}: MdDocViewProps) {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [stack, setStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickedMode, setMode] = useState<DocMode>("read");
  const [draft, setDraft] = useState("");
  const [headerNote, setHeaderNote] = useState<string | null>(null);
  // The line Raw opens on. Belongs to the document that arrived with it and to
  // no other: a jump away from that document has nothing to do with line 42.
  const [line, setLine] = useState<number | null>(initialLine);
  // The document the line effect below reasons about. A ref, not the state
  // itself: the effect must fire when the LINE changes and at no other time,
  // and a document in its dependencies would fire it on every re-read too.
  const docRef = useRef<LoadedDoc | null>(null);
  docRef.current = doc;
  // The hole the draft guard leaves in its shade.
  const rootRef = useRef<HTMLDivElement>(null);

  // Showing a freshly loaded document. The draft is seeded from THIS
  // document's content in the same step that commits it — never from whatever
  // was on screen before, or Save would write the previous file's text into
  // the new path. There is one draft for Write and Raw, and Read shows it too:
  // the three modes are three views of the same text, not three documents.
  //
  // `keepMode` — a re-read of the document already on screen (the reload
  // control), which must not throw the reader back into another mode.
  const present = (res: LoadedDoc, keepMode = false) => {
    setDoc(res);
    setLoading(false);
    setDraft(res.content ?? "");
    if (!keepMode) setMode(initialMode(startInEdit, readOnly, res));
  };

  // Single load resolver. push=true — a jump (pushed onto the stack), false —
  // a return (the caller already trimmed the stack) or the initial load.
  const runLoad = (target: string, push: boolean) => {
    setLoading(true);
    setHeaderNote(null);
    setLine(null);
    void load(target).then((res) => {
      setStack((s) => (push ? [...s, res.path || target] : s));
      present(res);
    });
  };
  const loadRef = useRef(runLoad);
  loadRef.current = runLoad;

  // Initial load — by initialPath. Changing the path resets the tab/draft.
  useEffect(() => {
    setStack([]);
    setLoading(true);
    setHeaderNote(null);
    setLine(initialLine);
    void load(initialPath).then((res) => {
      setStack([res.path || initialPath]);
      setDoc(res);
      setLoading(false);
      setDraft(res.content ?? "");
      // A line number is an address in the source: a document opened on one
      // opens in Raw, where the lines it counts actually exist.
      setMode(
        initialLine != null && availableModes(readOnly, res).includes("raw")
          ? "raw"
          : initialMode(startInEdit, readOnly, res),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  // A new line for the document already on screen: the reader walked from one
  // use of a symbol to the next one inside the same file. Nothing is re-read —
  // it is the same document, the same draft and the same jump stack; only the
  // line moves, and Raw is where lines exist. Skipped on the first pass, where
  // the load effect above has already settled both.
  const firstLine = useRef(true);
  useEffect(() => {
    if (firstLine.current) {
      firstLine.current = false;
      return;
    }
    if (initialLine == null) return;
    setLine(initialLine);
    if (availableModes(readOnly, docRef.current).includes("raw")) setMode("raw");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLine]);

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

  const modes = availableModes(readOnly, doc);
  // The mode survives a re-read, but the document it survived into may offer
  // fewer modes than the one before it — an unreadable file offers Read alone.
  // Settling here rather than in the setter keeps the reader's choice: come
  // back to a readable document and Raw is still Raw.
  const mode = settleMode(pickedMode, modes);
  // The draft has drifted from the file. Measured against the content of the
  // last READ, not against the last save: a save that came back with a
  // conflict left the file as it was, and the draft is still unsaved.
  const dirty = doc?.content != null && draft !== doc.content;
  const diff = dirty ? lineDiff(doc?.content ?? "", draft) : ZERO_DIFF;

  // CAS save: sha from the last read. Conflict — show a message, don't lose
  // the draft; success — the file now holds the draft, so the second row goes
  // away on its own and the mode does not change under the hand that typed.
  const runSave = (content: string) => {
    if (!doc || doc.content == null) return;
    setHeaderNote(null);
    void save(doc.path, content, doc.sha256).then((res) => {
      if (res.outcome === "written") {
        setDoc({ ...doc, content, sha256: res.sha256 ?? null });
      } else {
        setHeaderNote(res.message ?? "Failed to save.");
      }
    });
  };

  // Back to the file's text: the header's Cancel and the guard's Discard.
  const discard = () => {
    setDraft(doc?.content ?? "");
    setHeaderNote(null);
  };

  // Re-reading the file the header currently shows. Only reachable while the
  // draft matches it (the control is disabled otherwise), so nothing typed is
  // at stake here.
  const reload = () => {
    setLoading(true);
    setHeaderNote(null);
    void load(current).then((res) => present(res, true));
  };

  return (
    <div className="mdo-root" ref={rootRef}>
      {/* The header is not conditional any more: it carries the mode switcher
          and the reload control, and both have to be in the same place on
          every document — including one that failed to load, which is exactly
          the document a reader wants to re-read. */}
      <DocHeader
        tabs={libraries.tabs}
        path={doc?.path ?? null}
        onReveal={
          onReveal &&
          ((path) => {
            void onReveal(path).then((res) => {
              if (!res.revealed) {
                setHeaderNote(res.error ?? "Failed to reveal in Finder.");
              }
            });
          })
        }
        leading={leading}
        trailing={trailing}
        note={headerNote}
        canGoBack={stack.length > 1}
        onBack={back}
        mode={mode}
        modes={modes}
        onModeChange={setMode}
        dirty={dirty}
        diff={diff}
        onReload={reload}
        onSave={() => runSave(draft)}
        onCancel={discard}
      />

      {guardDraft && dirty && doc?.content != null && (
        <DraftGuard
          anchor={rootRef}
          path={doc.path}
          before={doc.content}
          after={draft}
          onSave={() => runSave(draft)}
          onDiscard={discard}
        />
      )}

      <div className="mdo-body">
        {loading && <p className="mdo-msg">Loading…</p>}
        {!loading && doc?.error && <p className="mdo-msg mdo-err">{doc.error}</p>}
        {!loading && doc?.content != null && mode === "raw" && (
          // The engine's --kasi-* live on .mde-root, which Raw does not have,
          // so the same values are hung on the raw container instead — the
          // side margin is the one thing that has to match across modes, or
          // the text steps sideways on every switch.
          <div className="mdo-raw" style={vars as CSSProperties | undefined}>
            <CodeEditor
              kit={libraries.codeMirror}
              text={draft}
              language={languageOf(doc.path)}
              readOnly={false}
              line={line}
              onChange={setDraft}
              onSave={() => runSave(draft)}
            />
          </div>
        )}
        {!loading && doc?.content != null && mode !== "raw" && (
          <div className="mdo-doc">
            <KasimovEditor
              editable={mode === "write"}
              followLinks={followLinks}
              atLinks={atLinks}
              frontmatter={frontmatter}
              mermaidNodes={mermaidNodes}
              vars={vars}
              value={draft}
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
