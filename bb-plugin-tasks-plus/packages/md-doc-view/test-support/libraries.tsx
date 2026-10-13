// Test infrastructure — the libraries a plugin would hand down, built from the
// test kits of the two packages that own them. Outside test-support/ this
// package imports neither library by value (git-install.test.ts).
import { testCodeMirrorKit } from "../../code-editor/test-support/codemirror-kit";
import { testTabsKit } from "../../segmented-control/test-support/tabs-kit";
import type { DocLibraries } from "../libraries";
import { MdDocView as LibrariesMdDocView, type MdDocViewProps } from "../MdDocView";

export const testDocLibraries: DocLibraries = { codeMirror: testCodeMirrorKit, tabs: testTabsKit };

/** The view with the test libraries already in hand — tests speak about behaviour, not wiring. */
export function MdDocView(props: Omit<MdDocViewProps, "libraries">) {
  return <LibrariesMdDocView libraries={testDocLibraries} {...props} />;
}
