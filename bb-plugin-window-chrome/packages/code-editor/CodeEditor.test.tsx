import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { CodeEditor } from "./test-support/codemirror-kit";
import type { EditorLanguage } from "./editor-language";

const LANGUAGES: readonly (EditorLanguage | null)[] = [
  "javascript", "typescript", "jsx", "tsx", "json", "css", "html", "markdown", "yaml", "shell", null,
];

describe("CodeEditor", () => {
  it.each(LANGUAGES)("mounts an editor reading %s", (language) => {
    const { container } = render(<CodeEditor text="const a = 1;\nlet b;" language={language} readOnly />);
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain("const a = 1;");
  });

  it("opens on the line it was asked for, and on the last one when asked past the end", () => {
    const text = "one\ntwo\nthree";
    const { container: first } = render(<CodeEditor text={text} language={null} readOnly line={2} />);
    expect(first.querySelector(".cm-editor")).not.toBeNull();
    expect(() =>
      render(<CodeEditor text={text} language={null} readOnly line={40} />),
    ).not.toThrow();
    expect(() => render(<CodeEditor text={text} language={null} readOnly line={0} />)).not.toThrow();
  });

  // A line is not only where the editor opened: the reader jumps from one use
  // of a symbol to the next one inside the SAME file, and the editor is never
  // remounted in between. Revealing only on creation makes every jump after
  // the first one do nothing at all.
  it("moves to the line when it changes under an editor already on screen", () => {
    const text = "one\ntwo\nthree\nfour";
    const { container, rerender } = render(
      <CodeEditor text={text} language={null} readOnly={false} line={1} />,
    );
    expect(container.querySelector(".cm-activeLine")?.textContent).toBe("one");

    rerender(<CodeEditor text={text} language={null} readOnly={false} line={3} />);
    expect(container.querySelector(".cm-activeLine")?.textContent).toBe("three");
  });
});

// The save keystroke belongs to the editor, not to the pane around it. It used
// to arrive as a ready-made CodeMirror extension built by the consumer — which
// worked only while the consumer and the editor shared one copy of CodeMirror
// on disk. Once the editor moved down into this package it got its own copy,
// and a facet built by the other one is not recognised by this one: CodeMirror
// answers "Unrecognized extension value in extension set … multiple instances
// of @codemirror/state are loaded" and the pane throws on render. So the
// callback crosses the boundary now, and the keymap is built on this side.
describe("CodeEditor · сохранение с клавиатуры", () => {
  // `Mod` is Cmd on a Mac and Ctrl everywhere else, and CodeMirror decides
  // which by the platform it is running on. Under jsdom that platform is not
  // a Mac whatever the developer's machine is, so the test presses Ctrl — the
  // promise is "the save keystroke reaches onSave", not "this exact key does".
  it("зовёт onSave по Mod-S и не даёт браузеру сохранить страницу", () => {
    const onSave = vi.fn();
    const { container } = render(
      <CodeEditor text="const a = 1;" language="typescript" readOnly={false} onSave={onSave} />,
    );

    const content = container.querySelector(".cm-content");
    expect(content).not.toBeNull();
    const handled = !fireEvent.keyDown(content!, { key: "s", ctrlKey: true, code: "KeyS" });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(handled).toBe(true);
  });

  // Replaces "без onSave нажатие ничего не ломает", which only promised the
  // editor does not throw — true of an editor that swallows the keystroke too.
  // The real promise is that a consumer who wants no save leaves the key to
  // the browser: the handler must report "not handled" so the event is not
  // cancelled, exactly the mirror of the test above.
  it("без onSave нажатие остаётся браузеру", () => {
    const { container } = render(
      <CodeEditor text="const a = 1;" language="typescript" readOnly={false} />,
    );

    const content = container.querySelector(".cm-content");
    const notCancelled = fireEvent.keyDown(content!, { key: "s", ctrlKey: true, code: "KeyS" });

    expect(notCancelled).toBe(true);
  });
});

// The chrome theme mints a CSS class on every call, and nothing ever removes
// one. Built per editor instance, every file opened in Raw would leave another
// set of rules in the document; the promise is one theme per kit.
describe("CodeEditor · тема хрома", () => {
  it("строит тему один раз на набор, сколько бы редакторов ни открылось", async () => {
    const { CodeEditor: KitCodeEditor } = await import("./CodeEditor");
    const { testCodeMirrorKit } = await import("./test-support/codemirror-kit");
    const kit = { ...testCodeMirrorKit };
    const theme = vi.spyOn(kit.EditorView, "theme");
    try {
      const first = render(<KitCodeEditor kit={kit} text="a" language={null} readOnly />);
      first.unmount();
      render(<KitCodeEditor kit={kit} text="b" language="json" readOnly />);
      expect(theme).toHaveBeenCalledTimes(1);
    } finally {
      theme.mockRestore();
    }
  });
});
