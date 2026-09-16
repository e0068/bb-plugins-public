// Shared layer — the code surface itself: CodeMirror 6, reading the file
// with its own grammar and painted in the host's palette.
//
// CodeMirror and not Monaco: Monaco wants web workers the plugin bundle does
// not ship, and weighs several times more for a panel that reads one file at
// a time. The chrome (background, gutters, selection) comes from bb's design
// tokens so the editor lives in either theme without a palette of its own;
// only the token colours of the syntax are a stock set — the default one in
// light, One Dark's in dark — because bb has no tokens for «a keyword».
//
// Every CodeMirror module arrives in `kit` from the plugin — see
// codemirror-kit.ts for why this package imports none of them itself.
import { useEffect, useMemo, useRef } from "react";
import type { Extension } from "@uiw/react-codemirror";
import type { EditorView } from "@codemirror/view";
import type { CodeMirrorKit } from "./codemirror-kit";
import type { EditorLanguage } from "./editor-language";
import { useHostColorMode } from "./use-host-color-mode";

/** The grammar for a language; none when the name said nothing — plain text, as before. */
function grammar(kit: CodeMirrorKit, language: EditorLanguage | null): readonly Extension[] {
  switch (language) {
    case "javascript":
      return [kit.javascript()];
    case "jsx":
      return [kit.javascript({ jsx: true })];
    case "typescript":
      return [kit.javascript({ typescript: true })];
    case "tsx":
      return [kit.javascript({ jsx: true, typescript: true })];
    case "json":
      return [kit.json()];
    case "css":
      return [kit.css()];
    case "html":
      return [kit.html()];
    case "markdown":
      return [kit.markdown()];
    case "yaml":
      return [kit.yaml()];
    case "shell":
      return [kit.StreamLanguage.define(kit.shell)];
    case null:
      return [];
  }
}

/** bb's tokens on CodeMirror's chrome. Same font size and leading as the plain text viewer had. */
const CHROME = {
  "&": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontSize: "11.5px",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-content": { caretColor: "var(--foreground)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLine": { backgroundColor: "var(--state-active)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--state-active)",
  },
  "&.cm-focused": { outline: "none" },
};

// A theme mints a CSS class per call, and nothing removes one — so it is built
// once per kit for the life of the page, not once per editor that mounts.
const chromes = new WeakMap<CodeMirrorKit, Extension>();

function chromeOf(kit: CodeMirrorKit): Extension {
  const cached = chromes.get(kit);
  if (cached !== undefined) return cached;
  const chrome = kit.EditorView.theme(CHROME);
  chromes.set(kit, chrome);
  return chrome;
}

export interface CodeEditorProps {
  /**
   * The CodeMirror modules to build from, imported by the plugin. Pass one
   * module-level constant: the editor rebuilds its extensions when the kit
   * changes identity.
   */
  kit: CodeMirrorKit;
  text: string;
  language: EditorLanguage | null;
  readOnly: boolean;
  /** A line to open on, counted from one — a jump from a symbol. */
  line?: number | null;
  onChange?: (text: string) => void;
  /**
   * Save from the keyboard (Mod-S). The keymap is built once and reaches the
   * current callback through a ref, so a consumer that recreates its handler
   * every render does not reconfigure the editor on every keystroke.
   */
  onSave?: () => void;
}

/** Puts the cursor on `line` and scrolls it to the middle. Out-of-range lines land on the nearest end. */
function revealLine(kit: CodeMirrorKit, view: EditorView, line: number): void {
  const clamped = Math.min(Math.max(line, 1), view.state.doc.lines);
  const position = view.state.doc.line(clamped).from;
  view.dispatch({
    selection: { anchor: position },
    effects: kit.EditorView.scrollIntoView(position, { y: "center" }),
  });
}

export function CodeEditor({
  kit,
  text,
  language,
  readOnly,
  line = null,
  onChange,
  onSave,
}: CodeEditorProps) {
  const mode = useHostColorMode();
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  // A line is revealed twice over: once when the editor is created, and again
  // whenever the line changes under an editor already on screen. The second
  // case is the ordinary one — the reader walks from one use of a symbol to
  // the next inside the same file, and nothing remounts in between. The effect
  // fires on the value, not on every render, so it never fights the cursor of
  // a reader who has scrolled away on their own.
  const viewRef = useRef<EditorView | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    if (view !== null && line !== null) revealLine(kit, view, line);
  }, [kit, line]);
  const all = useMemo(
    () => [
      chromeOf(kit),
      kit.syntaxHighlighting(mode === "dark" ? kit.oneDarkHighlightStyle : kit.defaultHighlightStyle, {
        fallback: true,
      }),
      ...grammar(kit, language),
      kit.keymap.of([
        {
          key: "Mod-s",
          run: () => {
            const handler = onSaveRef.current;
            if (handler === undefined) return false;
            handler();
            return true;
          },
        },
      ]),
    ],
    [kit, mode, language],
  );
  const { CodeMirror } = kit;

  return (
    <CodeMirror
      value={text}
      theme="none"
      readOnly={readOnly}
      editable={!readOnly}
      height="100%"
      className="h-full min-h-0 [&_.cm-editor]:h-full"
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        autocompletion: false,
        // Ours, above — with the host's palette rather than the setup's default.
        syntaxHighlighting: false,
      }}
      extensions={all}
      {...(onChange === undefined ? {} : { onChange: (value: string) => onChange(value) })}
      onCreateEditor={(view) => {
        viewRef.current = view;
        if (line !== null) revealLine(kit, view, line);
      }}
    />
  );
}
