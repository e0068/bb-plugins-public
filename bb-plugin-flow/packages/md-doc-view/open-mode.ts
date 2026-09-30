// Layer 1, zero imports: the single rule for "does a freshly loaded document
// show up ready to edit". Both renderers of the same panel ask it — the
// Kasimov column through MdDocView, the older one through the plugin's
// open-action — so the "open documents in edit mode" setting can't mean one
// thing in one mode and another in the other.
//
// A server module imports THIS file directly, not the package's index: the
// barrel pulls in the React component and its CSS.

/**
 * `startInEdit` — the setting itself. A document with nothing to draft from
 * (no content, or a read error) stays a read: an empty editor over a failed
 * load looks like an empty file, and saving it would write that emptiness back.
 */
export function opensInEditMode(
  startInEdit: boolean,
  doc: { content: string | null; error?: string | null },
): boolean {
  return startInEdit && doc.content != null && !doc.error;
}
