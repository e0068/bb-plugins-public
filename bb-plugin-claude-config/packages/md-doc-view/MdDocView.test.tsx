// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { MdDocView, type LoadedDoc, type SaveResult } from "./MdDocView";

afterEach(cleanup);

// The real KasimovEditor mounts a vanilla engine into contenteditable — jsdom
// doesn't reproduce that. The mock parses markdown links out of value and
// calls linkResolver on each one (like the real editor), rendering a
// clickable link as a button with class .mde-link (its onDocClick skips it),
// and an external one as a non-clickable span.
vi.mock("./KasimovEditor", () => ({
  KasimovEditor: ({
    value,
    linkResolver,
    vars,
    followLinks,
    frontmatter,
  }: {
    value: string;
    linkResolver?: (href: string) => { onClick: () => void } | null;
    vars?: Record<string, string>;
    followLinks?: boolean;
    frontmatter?: boolean;
  }) => {
    const hrefs = [...String(value).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(
      (m) => m[1],
    );
    return (
      <div
        data-testid="mde"
        data-vars={JSON.stringify(vars ?? null)}
        data-follow={String(followLinks)}
        data-frontmatter={String(frontmatter)}
      >
        <div data-testid="mde-value">{value}</div>
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

describe("MdDocView", () => {
  it("shows the first file's content", async () => {
    const view = renderView();
    await view.findByText("[neighbor](b.md) and [external](https://x.dev)");
  });

  it("an in-tab link is clickable, an external (http) one is not", async () => {
    const view = renderView();
    await view.findByTestId("link-b.md");
    expect(view.getByTestId("plain-https://x.dev")).toBeInTheDocument();
    expect(view.queryByTestId("link-https://x.dev")).toBeNull();
  });

  it("clicking a link jumps into the file, back returns via the stack", async () => {
    const view = renderView();

    fireEvent.click(await view.findByTestId("link-b.md"));
    await view.findByText("# neighbor");
    expect(view.load).toHaveBeenLastCalledWith("/b.md");

    fireEvent.click(await view.findByLabelText("Back"));
    await view.findByTestId("link-b.md");
    expect(view.load).toHaveBeenLastCalledWith("/a.md");
  });

  it("clicking the text enters edit mode, Save writes with CAS and exits", async () => {
    const save = vi.fn(async () => written());
    const view = renderView({ save });

    fireEvent.click(await view.findByTestId("mde-value"));
    fireEvent.click(await view.findByText("Save"));

    expect(save).toHaveBeenCalledWith(
      "/a.md",
      "[neighbor](b.md) and [external](https://x.dev)",
      "sha-a",
    );
    await view.findByText("[neighbor](b.md) and [external](https://x.dev)");
    expect(view.queryByText("Save")).toBeNull();
  });

  it("a CAS conflict shows a message and doesn't exit edit mode", async () => {
    const save = vi.fn(
      async (): Promise<SaveResult> => ({
        outcome: "conflict",
        message: "File changed",
      }),
    );
    const view = renderView({ save });

    fireEvent.click(await view.findByTestId("mde-value"));
    fireEvent.click(await view.findByText("Save"));

    await view.findByText("File changed");
    expect(view.getByText("Save")).toBeInTheDocument();
  });

  it("a non-markdown file opens as raw text and can be edited", async () => {
    const save = vi.fn(async () => written());
    const view = renderView({ initialPath: "/script.sh", save });

    await view.findByText("echo hi");
    fireEvent.click(view.getByTestId("mde-value"));
    fireEvent.click(await view.findByText("Save"));
    expect(save).toHaveBeenCalledWith("/script.sh", "echo hi", "sha-s");
  });

  it("a read error is shown, editing is unavailable", async () => {
    const view = renderView({ initialPath: "/err.md" });

    await view.findByText("file not found");
    expect(view.queryByTestId("mde-value")).toBeNull();
    // No "Edit" button on an unreadable file.
    expect(view.queryByText("Edit")).toBeNull();
  });

  it("in view mode the \"Edit\" button is visible and enters edit mode", async () => {
    const view = renderView();
    // In view mode — the button that enters edit mode (not Save/Cancel).
    const editBtn = await view.findByText("Edit");
    expect(view.queryByText("Save")).toBeNull();

    fireEvent.click(editBtn);
    // In edit mode — Save/Cancel, the "Edit" button is gone.
    await view.findByText("Save");
    expect(view.getByText("Cancel")).toBeInTheDocument();
    expect(view.queryByText("Edit")).toBeNull();
  });

  it("vars and flags reach KasimovEditor", async () => {
    const vars = { "--kasi-size": "18px", "--kasi-accent": "#0af" };
    const view = renderView({ vars, followLinks: false, frontmatter: false });
    const mde = await view.findByTestId("mde");
    expect(mde.getAttribute("data-vars")).toBe(JSON.stringify(vars));
    expect(mde.getAttribute("data-follow")).toBe("false");
    expect(mde.getAttribute("data-frontmatter")).toBe("false");
  });
});
