// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { LoadedDoc, RevealResult, SaveResult } from "./MdDocView";
import { MdDocView } from "./test-support/libraries";

afterEach(cleanup);

// The real KasimovEditor mounts a vanilla engine into contenteditable — jsdom
// doesn't reproduce that. The mock parses markdown links out of value and
// calls linkResolver on each one (like the real editor), rendering a
// clickable link as a button with class .mde-link, and an external one as a
// non-clickable span. An editable mock also offers a textarea: Write promises
// that typing lands in the one draft the three modes share, and that is not
// observable without something to type into.
vi.mock("./KasimovEditor", () => ({
  KasimovEditor: ({
    value,
    editable,
    onChange,
    linkResolver,
    vars,
    followLinks,
    atLinks,
    frontmatter,
    mermaidNodes,
  }: {
    value: string;
    editable?: boolean;
    onChange?: (v: string) => void;
    linkResolver?: (href: string) => { onClick: () => void } | null;
    vars?: Record<string, string>;
    followLinks?: boolean;
    atLinks?: boolean;
    frontmatter?: boolean;
    mermaidNodes?: "soft" | "contrast";
  }) => {
    const hrefs = [...String(value).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(
      (m) => m[1],
    );
    return (
      <div
        data-testid="mde"
        data-vars={JSON.stringify(vars ?? null)}
        data-editable={String(editable)}
        data-follow={String(followLinks)}
        data-atlinks={String(atLinks)}
        data-frontmatter={String(frontmatter)}
        data-mermaid={String(mermaidNodes)}
      >
        <div data-testid="mde-value">{value}</div>
        {editable && (
          <textarea
            data-testid="mde-input"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
          />
        )}
        {hrefs.map((href, i) => {
          const r = linkResolver?.(href);
          return r ? (
            <button
              key={i}
              className="mde-link"
              data-testid={`link-${href}`}
              onClick={r.onClick}
            >
              {href}
            </button>
          ) : (
            <span key={i} data-testid={`plain-${href}`}>
              {href}
            </span>
          );
        })}
      </div>
    );
  },
}));

// CodeMirror draws over a real DOM — in jsdom it is as opaque as the Kasimov
// engine, and mocked at the same boundary for the same reason: this suite is
// about which text MdDocView hands to Raw and what it does with what comes
// back, not about how CodeMirror renders it. `languageOf` stays the real one —
// it is a pure function, and a mocked grammar table would let a wrong file
// type through unnoticed.
vi.mock("../code-editor", async (importActual) => ({
  ...(await importActual<typeof import("../code-editor")>()),
  CodeEditor: ({
    text,
    language,
    line,
    onChange,
    onSave,
  }: {
    text: string;
    language: string | null;
    line?: number | null;
    onChange?: (t: string) => void;
    onSave?: () => void;
  }) => (
    <div
      data-testid="raw"
      data-language={String(language)}
      data-line={String(line)}
    >
      <textarea
        data-testid="raw-input"
        value={text}
        onChange={(e) => onChange?.(e.target.value)}
      />
      <button type="button" onClick={() => onSave?.()}>
        raw-mod-s
      </button>
    </div>
  ),
}));

// The diff viewer highlights into its own shadow root with shiki — nothing
// jsdom can draw. The mock shows the two texts it was handed, which is the
// whole of what MdDocView owes it.
vi.mock("@pierre/diffs/react", () => ({
  MultiFileDiff: ({
    oldFile,
    newFile,
  }: {
    oldFile: { name: string; contents: string };
    newFile: { name: string; contents: string };
  }) => (
    <div data-testid="draft-diff" data-name={newFile.name}>
      <pre data-testid="draft-diff-old">{oldFile.contents}</pre>
      <pre data-testid="draft-diff-new">{newFile.contents}</pre>
    </div>
  ),
}));

const DOCS: Record<string, LoadedDoc> = {
  "/a.md": {
    path: "/a.md",
    content: "[neighbor](b.md) and [external](https://x.dev)",
    sha256: "sha-a",
  },
  "/b.md": { path: "/b.md", content: "# neighbor", sha256: "sha-b" },
  "/err.md": {
    path: "/err.md",
    content: null,
    sha256: null,
    error: "file not found",
  },
  "/script.sh": { path: "/script.sh", content: "echo hi", sha256: "sha-s" },
};

function makeLoad() {
  return vi.fn(async (path: string): Promise<LoadedDoc> => {
    return DOCS[path] ?? { path, content: "x", sha256: "s" };
  });
}

// In-tab links resolve to abs; http/https — null (not clickable).
const resolveLinkTarget = (href: string): string | null =>
  /^https?:/.test(href) ? null : href === "b.md" ? "/b.md" : `/${href}`;

const written = (): SaveResult => ({ outcome: "written", sha256: "sha-new" });

function renderView(overrides: Partial<Parameters<typeof MdDocView>[0]> = {}) {
  const load = overrides.load ?? makeLoad();
  const save = overrides.save ?? vi.fn(async () => written());
  return {
    load,
    save,
    ...render(
      <MdDocView
        initialPath="/a.md"
        load={load}
        save={save}
        resolveLinkTarget={resolveLinkTarget}
        {...overrides}
      />,
    ),
  };
}

// Radix's Tabs trigger switches on mousedown, not on click.
const switchTo = (name: "Read" | "Write" | "Raw") => {
  const segment = screen.getByRole("tab", { name });
  fireEvent.mouseDown(segment);
  fireEvent.click(segment);
};

const typeInto = (testId: "mde-input" | "raw-input", text: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value: text } });

describe("MdDocView", () => {
  it("shows the first file's content", async () => {
    const view = renderView();
    await view.findByText("[neighbor](b.md) and [external](https://x.dev)");
  });

  it("an in-tab link is clickable, an external (http) one is not", async () => {
    const view = renderView();
    await view.findByTestId("link-b.md");
    expect(view.getByTestId("plain-https://x.dev")).toBeInTheDocument();
  });

  it("clicking a link jumps into the file, back returns via the stack", async () => {
    const view = renderView();

    fireEvent.click(await view.findByTestId("link-b.md"));
    await view.findByText("# neighbor");

    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await view.findByText("[neighbor](b.md) and [external](https://x.dev)");
  });

  it("shows the file's path in the header, not clickable without onReveal", async () => {
    const view = renderView();
    const path = await view.findByText("/a.md");
    expect(path.tagName).toBe("DIV");
  });

  it("the file name isn't shown separately from the path", async () => {
    const view = renderView();
    await view.findByText("/a.md");
    expect(view.container.querySelector(".mdo-title")).toBeNull();
  });

  it("clicking the path calls onReveal; a failure shows the error as a note", async () => {
    const onReveal = vi.fn(
      async (): Promise<RevealResult> => ({
        revealed: false,
        error: "Only a local source can be revealed in Finder",
      }),
    );
    const view = renderView({ onReveal });

    fireEvent.click(await view.findByText("/a.md"));

    expect(onReveal).toHaveBeenCalledWith("/a.md");
    await view.findByText("Only a local source can be revealed in Finder");
  });

  it("a successful reveal shows no note", async () => {
    const onReveal = vi.fn(
      async (): Promise<RevealResult> => ({ revealed: true, error: null }),
    );
    const view = renderView({ onReveal });

    fireEvent.click(await view.findByText("/a.md"));
    expect(onReveal).toHaveBeenCalledWith("/a.md");
    // Await the exact promise MdDocView's click handler is chained on: since
    // its .then was attached before this one, its state update is guaranteed
    // to have run by the time this resolves (not just "onReveal returned",
    // which is true the instant the async call starts, before it settles).
    await onReveal.mock.results[0]!.value;

    expect(view.container.querySelector(".mdo-note")).toBeNull();
  });

  it("trailing renders after the switcher", async () => {
    const view = renderView({ trailing: <button>Close</button> });

    await view.findByText("Close");
    const header = view.container.querySelector(".mdo-header");
    // Array.from, not a spread: HTMLCollection has no iterator in the DOM
    // types this package compiles against, and the spread is a type error.
    const children = Array.from(header?.children ?? []);
    const switcherIdx = children.findIndex(
      (el) => el.querySelector('[role="tablist"]') !== null,
    );
    const trailingIdx = children.findIndex((el) => el.textContent === "Close");
    expect(trailingIdx).toBeGreaterThan(switcherIdx);
  });

  // Every flag is asserted, not just a couple: a prop missing from the
  // pass-through is exactly the defect this suite exists to catch — the
  // setting then silently does nothing, with no crash and no red test.
  it("vars and flags reach KasimovEditor", async () => {
    const vars = { "--kasi-size": "18px", "--kasi-accent": "var(--primary)" };
    const view = renderView({
      vars,
      followLinks: false,
      atLinks: false,
      frontmatter: false,
      mermaidNodes: "contrast",
    });
    const mde = await view.findByTestId("mde");
    expect(mde.getAttribute("data-vars")).toBe(JSON.stringify(vars));
    expect(mde.getAttribute("data-follow")).toBe("false");
    expect(mde.getAttribute("data-atlinks")).toBe("false");
    expect(mde.getAttribute("data-frontmatter")).toBe("false");
    expect(mde.getAttribute("data-mermaid")).toBe("contrast");
  });
});

// The three modes. What holds them together is the draft: one text shown
// rendered, edited in place, or edited as source — never three texts that have
// to be kept in step.
describe("MdDocView: read, write and raw", () => {
  it("a document opens in the mode initialMode picked", async () => {
    const view = renderView();
    await view.findByTestId("mde");
    expect(screen.getByRole("tab", { name: "Read" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(view.getByTestId("mde").getAttribute("data-editable")).toBe("false");
  });

  it("write renders the same document editable, raw renders its source", async () => {
    const view = renderView();
    await view.findByTestId("mde");

    switchTo("Write");
    expect(view.getByTestId("mde").getAttribute("data-editable")).toBe("true");

    switchTo("Raw");
    expect(view.getByTestId("raw")).toBeInTheDocument();
    expect(view.getByTestId("raw").getAttribute("data-language")).toBe(
      "markdown",
    );
    expect(view.queryByTestId("mde")).toBeNull();
  });

  it("switching read to write to raw keeps the draft", async () => {
    const view = renderView();
    await view.findByTestId("mde");

    switchTo("Write");
    typeInto("mde-input", "drafted in write");
    switchTo("Read");
    expect(view.getByTestId("mde-value")).toHaveTextContent("drafted in write");

    switchTo("Raw");
    expect(view.getByTestId("raw-input")).toHaveValue("drafted in write");
  });

  it("an edit made in raw is what read shows", async () => {
    const view = renderView();
    await view.findByTestId("mde");

    switchTo("Raw");
    typeInto("raw-input", "# rewritten as source");
    switchTo("Read");

    expect(view.getByTestId("mde-value")).toHaveTextContent(
      "# rewritten as source",
    );
    expect(view.getByTestId("mde").getAttribute("data-editable")).toBe("false");
  });

  it("a file that is not markdown gets its own grammar in raw", async () => {
    const view = renderView({ initialPath: "/script.sh" });
    await view.findByText("echo hi");

    switchTo("Raw");
    expect(view.getByTestId("raw").getAttribute("data-language")).toBe("shell");
  });

  it("an unreadable document offers the read segment and nothing else", async () => {
    const view = renderView({ initialPath: "/err.md" });

    await view.findByText("file not found");
    expect(screen.getByRole("tab", { name: "Read" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Write" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Raw" })).toBeNull();
    expect(view.queryByTestId("mde-value")).toBeNull();
  });
});

describe("MdDocView: the unsaved draft", () => {
  it("the second row appears as soon as the draft leaves the file", async () => {
    const view = renderView();
    await view.findByTestId("mde");
    expect(view.queryByText("Save")).toBeNull();

    switchTo("Write");
    typeInto("mde-input", "one\ntwo");

    expect(view.getByLabelText("Draft difference")).toHaveTextContent("+2");
    expect(view.getByText("Save")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Reload" })).toBeDisabled();
  });

  it("Save writes the draft with the sha of the last read, and stays in the mode", async () => {
    const save = vi.fn(async () => written());
    const view = renderView({ save });
    await view.findByTestId("mde");

    switchTo("Raw");
    typeInto("raw-input", "saved from raw");
    fireEvent.click(view.getByText("Save"));

    expect(save).toHaveBeenCalledWith("/a.md", "saved from raw", "sha-a");
    await view.findByTestId("raw");
    expect(view.queryByText("Save")).toBeNull();
    expect(screen.getByRole("tab", { name: "Raw" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("Mod-S in raw saves the same draft", async () => {
    const save = vi.fn(async () => written());
    const view = renderView({ save });
    await view.findByTestId("mde");

    switchTo("Raw");
    typeInto("raw-input", "saved from the keyboard");
    fireEvent.click(view.getByText("raw-mod-s"));

    expect(save).toHaveBeenCalledWith(
      "/a.md",
      "saved from the keyboard",
      "sha-a",
    );
  });

  it("a conflict keeps the draft and says so", async () => {
    const save = vi.fn(
      async (): Promise<SaveResult> => ({
        outcome: "conflict",
        message: "File changed",
      }),
    );
    const view = renderView({ save });
    await view.findByTestId("mde");

    switchTo("Write");
    typeInto("mde-input", "mine");
    fireEvent.click(view.getByText("Save"));

    await view.findByText("File changed");
    expect(view.getByTestId("mde-value")).toHaveTextContent("mine");
    expect(view.getByText("Save")).toBeInTheDocument();
  });

  it("Cancel puts the file's text back and takes the second row away", async () => {
    const view = renderView();
    await view.findByTestId("mde");

    switchTo("Write");
    typeInto("mde-input", "thrown away");
    fireEvent.click(view.getByText("Cancel"));

    expect(view.getByTestId("mde-value")).toHaveTextContent(
      "[neighbor](b.md) and [external](https://x.dev)",
    );
    expect(view.queryByText("Save")).toBeNull();
    expect(view.getByRole("button", { name: "Reload" })).toBeEnabled();
  });
});

describe("MdDocView: the draft guard", () => {
  const FILE = "[neighbor](b.md) and [external](https://x.dev)";
  // The shade is portaled to the body, outside the rendered container.
  const shades = () => document.querySelectorAll("[data-draft-shade]");
  const guarded = async (overrides: Partial<Parameters<typeof MdDocView>[0]> = {}) => {
    const view = renderView({ guardDraft: true, ...overrides });
    await view.findByTestId("mde");
    switchTo("Write");
    return view;
  };
  const openDialog = () => {
    fireEvent.click(shades()[0]);
    return screen.getByRole("dialog", { name: "Unsaved changes" });
  };

  it("without the flag an unsaved draft shades nothing", async () => {
    const view = renderView();
    await view.findByTestId("mde");
    switchTo("Write");
    typeInto("mde-input", "mine");

    expect(shades()).toHaveLength(0);
  });

  it("the rest of the app is shaded exactly while the draft differs from the file", async () => {
    await guarded();
    expect(shades()).toHaveLength(0);

    typeInto("mde-input", "mine");
    expect(shades().length).toBeGreaterThan(0);

    typeInto("mde-input", FILE);
    expect(shades()).toHaveLength(0);
  });

  it("clicking the shade opens a dialog with the draft's diff against the file", async () => {
    await guarded();
    typeInto("mde-input", "mine");

    const dialog = openDialog();

    expect(screen.getByTestId("draft-diff")).toHaveAttribute("data-name", "/a.md");
    expect(screen.getByTestId("draft-diff-old")).toHaveTextContent(FILE);
    expect(screen.getByTestId("draft-diff-new")).toHaveTextContent("mine");
    expect(dialog).toContainElement(screen.getByRole("button", { name: "Discard Changes" }));
    expect(dialog).toContainElement(screen.getByRole("button", { name: "Save Changes" }));
  });

  it("the dialog opens with focus on itself, not on the Discard button", async () => {
    await guarded();
    typeInto("mde-input", "mine");

    const dialog = openDialog();

    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });

  it("the shade follows the document's box, and stops measuring once the draft is gone", async () => {
    const observers: { notify: () => void; disconnected: boolean }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly entry: { notify: () => void; disconnected: boolean };
        constructor(notify: () => void) {
          this.entry = { notify, disconnected: false };
          observers.push(this.entry);
        }
        observe() {}
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    try {
      const view = await guarded();
      const root = view.container.querySelector(".mdo-root") as HTMLElement;
      let box = { left: 600, top: 40, width: 400, height: 500 };
      let measured = 0;
      root.getBoundingClientRect = () => {
        measured++;
        return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box };
      };
      const placed = () => Array.from(shades(), (shade) => shade.getAttribute("style"));

      typeInto("mde-input", "mine");
      const first = placed();

      box = { left: 500, top: 40, width: 500, height: 500 };
      act(() => observers.at(-1)!.notify());
      const resized = placed();
      expect(resized).not.toEqual(first);

      box = { left: 450, top: 60, width: 500, height: 500 };
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      const windowResized = placed();
      expect(windowResized).not.toEqual(resized);

      // A panel moved by scrolling an ancestor keeps its size: no observer
      // fires, and scroll does not bubble — only a capturing listener hears it.
      box = { left: 450, top: 0, width: 500, height: 500 };
      act(() => {
        root.dispatchEvent(new Event("scroll"));
      });
      expect(placed()).not.toEqual(windowResized);

      typeInto("mde-input", FILE);
      expect(observers.at(-1)!.disconnected).toBe(true);
      const settled = measured;
      act(() => {
        window.dispatchEvent(new Event("resize"));
        root.dispatchEvent(new Event("scroll"));
      });
      expect(measured).toBe(settled);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Discard Changes puts the file's text back and lifts the shade", async () => {
    const view = await guarded();
    typeInto("mde-input", "thrown away");

    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));

    expect(view.getByTestId("mde-value")).toHaveTextContent(FILE);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shades()).toHaveLength(0);
  });

  it("Save Changes writes the draft with the sha of the last read and lifts the shade", async () => {
    const save = vi.fn(async () => written());
    const view = await guarded({ save });
    typeInto("mde-input", "kept");

    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(save).toHaveBeenCalledWith("/a.md", "kept", "sha-a");
    await waitFor(() => expect(shades()).toHaveLength(0));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.getByTestId("mde-value")).toHaveTextContent("kept");
  });

  it("a conflict on Save Changes keeps the draft and the shade, and says so", async () => {
    const save = vi.fn(
      async (): Promise<SaveResult> => ({ outcome: "conflict", message: "File changed" }),
    );
    const view = await guarded({ save });
    typeInto("mde-input", "mine");

    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await view.findByText("File changed");
    expect(view.getByTestId("mde-value")).toHaveTextContent("mine");
    expect(shades().length).toBeGreaterThan(0);
  });

  it("Escape closes the dialog alone — the draft and the shade stay", async () => {
    const save = vi.fn(async () => written());
    const view = await guarded({ save });
    typeInto("mde-input", "mine");

    fireEvent.keyDown(openDialog(), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(view.getByTestId("mde-value")).toHaveTextContent("mine");
    expect(shades().length).toBeGreaterThan(0);
    expect(save).not.toHaveBeenCalled();
  });

  it("a click beside the dialog closes it alone — the draft and the shade stay", async () => {
    const save = vi.fn(async () => written());
    const view = await guarded({ save });
    typeInto("mde-input", "mine");
    openDialog();

    // Radix starts listening for an outside pointer one tick after opening, so
    // the click that opened the dialog does not close it again.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const beside = document.querySelector("[data-draft-dialog-overlay]");
    expect(beside).not.toBeNull();
    fireEvent.pointerDown(beside!);
    fireEvent.click(beside!);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(view.getByTestId("mde-value")).toHaveTextContent("mine");
    expect(shades().length).toBeGreaterThan(0);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("MdDocView: re-reading the file", () => {
  it("reload asks for the path on screen and shows what came back", async () => {
    const load = vi.fn(
      async (path: string): Promise<LoadedDoc> => ({
        path,
        content:
          load.mock.calls.length > 1 ? "changed by the agent" : "first read",
        sha256: "sha-1",
      }),
    );
    const view = renderView({ load });
    await view.findByText("first read");

    fireEvent.click(view.getByRole("button", { name: "Reload" }));

    await view.findByText("changed by the agent");
    expect(load).toHaveBeenLastCalledWith("/a.md");
  });

  it("reload leaves the mode where the reader put it", async () => {
    const view = renderView();
    await view.findByTestId("mde");
    switchTo("Raw");

    fireEvent.click(view.getByRole("button", { name: "Reload" }));

    await view.findByTestId("raw");
    expect(screen.getByRole("tab", { name: "Raw" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  // The mode is kept across a re-read on purpose — but a re-read can bring
  // back a document that offers fewer modes than the one before it, and a mode
  // outside the switcher leaves it with no active segment at all.
  it("a reload that loses the file leaves the switcher on a segment it offers", async () => {
    let readable = true;
    const load = vi.fn(
      async (path: string): Promise<LoadedDoc> =>
        readable
          ? { path, content: "still here", sha256: "sha-1" }
          : { path, content: null, sha256: null, error: "file not found" },
    );
    const view = renderView({ load });
    await view.findByTestId("mde");
    switchTo("Raw");

    readable = false;
    fireEvent.click(view.getByRole("button", { name: "Reload" }));

    await view.findByText("file not found");
    expect(screen.queryByRole("tab", { name: "Raw" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Read" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("reload asks for the file a jump landed on, not the first one", async () => {
    const load = makeLoad();
    const view = renderView({ load });

    fireEvent.click(await view.findByTestId("link-b.md"));
    await view.findByText("# neighbor");
    fireEvent.click(view.getByRole("button", { name: "Reload" }));

    expect(load).toHaveBeenLastCalledWith("/b.md");
  });
});

// BBPL-250: an opened document may start in Write right away. The whole
// promise of the option is "no extra click", so the assertions are about what
// is on screen the moment the file finishes loading.
describe("MdDocView: startInEdit", () => {
  it("off (default) — the document opens in read", async () => {
    const view = renderView();
    await view.findByTestId("mde");
    expect(view.getByTestId("mde").getAttribute("data-editable")).toBe("false");
  });

  it("on — the document opens in write, with nothing to click first", async () => {
    const view = renderView({ startInEdit: true });
    await view.findByTestId("mde-input");
    expect(screen.getByRole("tab", { name: "Write" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("on — Save writes the file that is actually open", async () => {
    const save = vi.fn(async () => written());
    const view = renderView({ startInEdit: true, save });

    await view.findByTestId("mde-input");
    typeInto("mde-input", "edited right away");
    fireEvent.click(view.getByText("Save"));

    expect(save).toHaveBeenCalledWith("/a.md", "edited right away", "sha-a");
  });

  // The draft must belong to the document on screen: a jump loads a new file,
  // and if the draft still held the previous one, Save would write the WRONG
  // text into the new path.
  it("on — a jump opens the target in write with the target's own text", async () => {
    const save = vi.fn(async () => written());
    const view = renderView({ startInEdit: true, save });

    fireEvent.click(await view.findByTestId("link-b.md"));
    // In Write the mock shows the text twice — rendered and in the textarea —
    // so the draft is read off the input, the one of the two Save writes from.
    await view.findByTestId("mde-input");
    expect(screen.getByTestId("mde-input")).toHaveValue("# neighbor");

    typeInto("mde-input", "# neighbor, edited");
    fireEvent.click(view.getByText("Save"));
    expect(save).toHaveBeenCalledWith("/b.md", "# neighbor, edited", "sha-b");
  });

  it("on — an unreadable file stays an error, not an empty draft", async () => {
    const view = renderView({ startInEdit: true, initialPath: "/err.md" });

    await view.findByText("file not found");
    expect(view.queryByText("Save")).toBeNull();
    expect(view.queryByTestId("mde-value")).toBeNull();
  });
});

// A document the host assembled rather than read has no file to write back to.
// Read-only is about that case alone: not "this file type isn't editable" (any
// file is edited as raw text — see the note at the top of MdDocView), but "this
// document has no path a save could land on".
describe("MdDocView: readOnly", () => {
  it("offers the read segment only", async () => {
    const view = renderView({ readOnly: true });
    await view.findByTestId("mde-value");
    expect(screen.queryByRole("tab", { name: "Write" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Raw" })).toBeNull();
  });

  it("never opens in write, even when the host asked for it", async () => {
    const view = renderView({ readOnly: true, startInEdit: true });
    await view.findByTestId("mde-value");
    expect(view.getByTestId("mde").getAttribute("data-editable")).toBe("false");
    expect(view.queryByText("Save")).toBeNull();
  });

  it("still follows a link out of the document", async () => {
    const view = renderView({ readOnly: true });
    fireEvent.click(await view.findByTestId("link-b.md"));
    await view.findByText("# neighbor");
  });
});

// readOnly describes the tab, not the first document: the file a link leads to
// is read-only as well. Stated here so the flag's contract cannot drift.
describe("MdDocView: readOnly reaches the target of a jump", () => {
  it("the file opened from an assembled document is read-only too", async () => {
    const view = renderView({ readOnly: true });
    fireEvent.click(await view.findByTestId("link-b.md"));
    await view.findByText("# neighbor");

    expect(screen.queryByRole("tab", { name: "Write" })).toBeNull();
    expect(view.getByTestId("mde").getAttribute("data-editable")).toBe("false");
  });
});

// A line number is an address in the source. Projects opens a file this way
// when the reader jumped from a symbol in the code map.
describe("MdDocView: initialLine", () => {
  it("a document opened on a line opens in raw, on that line", async () => {
    const view = renderView({ initialLine: 42 });

    const raw = await view.findByTestId("raw");
    expect(raw.getAttribute("data-line")).toBe("42");
    expect(screen.getByRole("tab", { name: "Raw" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("the line belongs to that document only — a jump drops it", async () => {
    const view = renderView({ initialLine: 42 });
    await view.findByTestId("raw");

    switchTo("Read");
    fireEvent.click(view.getByTestId("link-b.md"));
    await view.findByText("# neighbor");

    expect(screen.getByRole("tab", { name: "Read" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  // The ordinary case, not the exotic one: JumpsBlock lists the uses of a
  // symbol, and the next use is as likely to be in this file as in another.
  // Nothing remounts between two such jumps — only the line changes.
  it("a second jump into the file already open moves to the new line", async () => {
    const load = makeLoad();
    const view = render(
      <MdDocView
        initialPath="/a.md"
        initialLine={2}
        load={load}
        save={vi.fn(async () => written())}
        resolveLinkTarget={resolveLinkTarget}
      />,
    );
    expect((await view.findByTestId("raw")).getAttribute("data-line")).toBe("2");

    view.rerender(
      <MdDocView
        initialPath="/a.md"
        initialLine={9}
        load={load}
        save={vi.fn(async () => written())}
        resolveLinkTarget={resolveLinkTarget}
      />,
    );

    await waitFor(() =>
      expect(view.getByTestId("raw").getAttribute("data-line")).toBe("9"),
    );
    // The same document, not a re-read of it: one load, and the draft is intact.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a jump into the open file while reading it switches to raw", async () => {
    const load = makeLoad();
    const props = {
      initialPath: "/a.md",
      load,
      save: vi.fn(async () => written()),
      resolveLinkTarget,
    };
    const view = render(<MdDocView {...props} />);
    await view.findByTestId("mde");

    view.rerender(<MdDocView {...props} initialLine={4} />);

    const raw = await view.findByTestId("raw");
    expect(raw.getAttribute("data-line")).toBe("4");
  });

  // The pin the test above is missing: it watches the MODE after a jump, and a
  // lost line reset would keep the mode honest while carrying the old
  // document's line into the new one. Written after the code rather than
  // before it — the behaviour was already right, the promise was not there.
  it("the line of the document left behind does not follow the jump", async () => {
    const view = renderView({ initialLine: 42 });
    await view.findByTestId("raw");

    switchTo("Read");
    fireEvent.click(view.getByTestId("link-b.md"));
    await view.findByText("# neighbor");
    switchTo("Raw");

    expect(view.getByTestId("raw").getAttribute("data-line")).toBe("null");
  });

  it("a line on a document that cannot be read stays a read", async () => {
    const view = renderView({ initialPath: "/err.md", initialLine: 7 });

    await view.findByText("file not found");
    expect(view.queryByTestId("raw")).toBeNull();
  });
});
