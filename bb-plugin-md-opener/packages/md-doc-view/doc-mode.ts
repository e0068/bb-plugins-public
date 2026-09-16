// Layer 1, zero imports: which of the three modes a document can be in, and
// which one it opens in. Read is the rendered document, Write is Kasimov's
// WYSIWYG editing, Raw is the markdown source in a code editor. Write and Raw
// are two views of ONE draft, so a document either offers both of them or
// neither — there is no state where the source is editable but the rendering
// is not.
//
// A server module imports THIS file directly, not the package's index: the
// barrel pulls in the React component and its CSS.

export type DocMode = "read" | "write" | "raw";

/** A loaded document, or nothing loaded yet. */
type Doc = { content: string | null; error?: string | null } | null;

/**
 * A document with nothing to draft from (not loaded, no content, or a read
 * error) offers reading only: an empty editor over a failed load looks like an
 * empty file, and saving it would write that emptiness back. An empty STRING
 * is content — an empty file is editable like any other.
 */
const editable = (doc: Doc): boolean =>
  doc != null && doc.content != null && !doc.error;

const READ_ONLY_MODES: readonly DocMode[] = ["read"];
const ALL_MODES: readonly DocMode[] = ["read", "write", "raw"];

/**
 * The modes the switcher shows, in the order it shows them. One segment means
 * the switcher has nothing to switch between — the caller renders it anyway,
 * so the header keeps its shape across documents.
 */
export function availableModes(
  readOnly: boolean,
  doc: Doc,
): readonly DocMode[] {
  return readOnly || !editable(doc) ? READ_ONLY_MODES : ALL_MODES;
}

/**
 * `startInEdit` — the "open documents in edit mode" setting. It asks for Write
 * and gets it only where Write exists; everywhere else the document opens in
 * Read rather than in a mode the switcher does not offer.
 */
export function initialMode(
  startInEdit: boolean,
  readOnly: boolean,
  doc: Doc,
): DocMode {
  return startInEdit && availableModes(readOnly, doc).includes("write")
    ? "write"
    : "read";
}

/**
 * Brings a mode picked earlier back to the set the document offers now. A
 * re-read can turn a readable file into an error while the reader is sitting
 * in Raw, and a mode outside the set leaves the switcher with no active
 * segment at all — a control that looks broken rather than one that changed.
 * Reading is the fallback because it is the one mode every document offers.
 */
export function settleMode(mode: DocMode, modes: readonly DocMode[]): DocMode {
  return modes.includes(mode) ? mode : "read";
}
