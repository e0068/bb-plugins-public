// A record of a section opened by Kasimov — the document view MD Opener shows a
// .md file with (docs/specs/BBPL-901-…). The record lives in a database, not
// in a file, so the view's load and save go through readTaskText and
// writeTaskText; the hash it saves against keeps a colleague's edit from being
// written over unseen.
//
// The one file of this plugin that imports CodeMirror and Radix Tabs for the
// shared view: the packages under ../packages import neither by value, and a
// plugin installed from git resolves them from its own `dependencies` only.
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { List, Root, Trigger } from "@radix-ui/react-tabs";
import { MdDocView, type DocLibraries, type LoadedDoc, type SaveResult } from "@bb-plugins/md-doc-view";
import type { Task } from "../../shared/contract.js";
import { useTasksRpc } from "../../client/data.js";

const docLibraries: DocLibraries = {
  codeMirror: {
    CodeMirror,
    EditorView,
    keymap,
    StreamLanguage,
    defaultHighlightStyle,
    syntaxHighlighting,
    oneDarkHighlightStyle,
    javascript,
    json,
    css,
    html,
    markdown,
    yaml,
    shell,
  },
  tabs: { Root, List, Trigger },
};

type RecordText = { content: string; sha256: string } | null;
type TextWrite = { outcome: "written"; sha256: string } | { outcome: "conflict" | "not-found" | "denied" | "invalid" };

/** The record's text as the view loads it; a record that is gone is the view's error. */
export const loadedDoc = (path: string, text: RecordText): LoadedDoc =>
  text === null
    ? { path, content: null, sha256: null, error: "This record is no longer in the section." }
    : { path, content: text.content, sha256: text.sha256, error: null };

/** The server's answer to a save, as the view tells it. */
export function saveResult(written: TextWrite): SaveResult {
  switch (written.outcome) {
    case "written":
      return { outcome: "written", sha256: written.sha256 };
    case "conflict":
      return { outcome: "conflict", message: "Someone changed this record after you opened it. Reload to see their edit." };
    case "not-found":
      return { outcome: "not-found", message: "This record is no longer in the section." };
    case "denied":
      return { outcome: "denied", message: "This record is not kept in a database." };
    case "invalid":
      return { outcome: "denied", message: "The fields at the top do not read. Check the lines between the two ---." };
  }
}

/** The name the view's header shows: the record's key, as a file of the mirror is named. */
const recordPath = (task: Task): string => `${task.key ?? task.title}.md`;

export function RecordDoc({ task }: { task: Task }) {
  const rpc = useTasksRpc();
  const path = recordPath(task);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MdDocView
        key={task.id}
        libraries={docLibraries}
        initialPath={path}
        load={async (asked) => loadedDoc(asked, (await rpc.call("readTaskText", { taskId: task.id })).text)}
        save={async (_, content, expectedSha256) => saveResult(await rpc.call("writeTaskText", { taskId: task.id, content, expectedSha256 }))}
        // A record has no neighbours on disk for a link to lead to.
        resolveLinkTarget={() => null}
      />
    </div>
  );
}
