// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);

// Real installMermaid is covered on its own in src/mermaid-bootstrap.test.ts
// (too heavy — real mermaid — to load here); this sentinel only guards that
// app.tsx actually calls it, so a later import cleanup can't silently drop
// the wiring while every test here stays green.
const { installMermaid } = vi.hoisted(() => ({ installMermaid: vi.fn() }));
vi.mock("./src/mermaid-bootstrap", () => ({ installMermaid }));

// The real KasimovEditor mounts a vanilla engine into a contenteditable —
// jsdom can't reproduce that, so we mock the shared-layer wrapper instead: the
// mock parses markdown links out of value and calls linkResolver on each one
// (like the real editor), rendering a clickable link as a button with the
// .mde-link class (its onDocClick skips those).
vi.mock("./packages/md-doc-view/KasimovEditor", () => ({
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

// Raw mode renders CodeMirror, which jsdom cannot drive either. Mocked at the
// same boundary as the engine above: what this suite checks is that the tab
// hands the file's source to Raw, not how CodeMirror paints it.
vi.mock("./packages/code-editor", async (importActual) => ({
  ...(await importActual<typeof import("./packages/code-editor")>()),
  CodeEditor: ({
    text,
    language,
    onChange,
  }: {
    text: string;
    language: string | null;
    onChange?: (t: string) => void;
  }) => (
    <div data-testid="raw" data-language={String(language)}>
      {text}
      <textarea data-testid="raw-input" onChange={(e) => onChange?.(e.target.value)} />
    </div>
  ),
}));

const source = {
  kind: "workspace" as const,
  threadId: null,
  environmentId: "e1",
  projectId: null,
};

const props = { path: "notes/doc.md", source, experimental_Original: () => null };

function makeRpc() {
  const readDoc = vi.fn(async ({ path }: { path: string }) => {
    if (path === "notes/doc.md" || path === "/env/notes/doc.md") {
      return {
        path: "/env/notes/doc.md",
        content: "[neighbor](sub.md) and [external](https://x.dev)",
        error: null,
        sha256: "sha-doc",
        links: [{ href: "sub.md", abs: "/env/notes/sub.md", exists: true }],
      };
    }
    return {
      path: "/env/notes/sub.md",
      content: "# neighbor",
      error: null,
      sha256: "sha-sub",
      links: [],
    };
  });
  const revealDoc = vi.fn(async () => ({ revealed: true, error: null }));
  return { readDoc, revealDoc };
}

describe("bb-plugin-md-opener app", () => {
  it("registers the fileOpener slot for .md", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.fileOpeners[0]?.title).toBe("Kasimov");
    expect(app.fileOpeners[0]?.extensions).toContain("md");
  });

  it("installs mermaid on window before the app registers its slots", async () => {
    await loadPluginApp(() => import("./app"));
    expect(installMermaid).toHaveBeenCalledWith(window);
  });

  it("in-tab link is clickable, external (http) link is not", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc: makeRpc() });

    await slot.findByTestId("link-sub.md");
    expect(slot.getByTestId("plain-https://x.dev")).toBeInTheDocument();
    expect(slot.queryByTestId("link-https://x.dev")).toBeNull();
  });

  it("clicking a link drills into the file (abs from the server), back returns", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const rpc = makeRpc();
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc });

    fireEvent.click(await slot.findByTestId("link-sub.md"));

    await slot.findByText("# neighbor");
    expect(rpc.readDoc).toHaveBeenLastCalledWith({
      path: "/env/notes/sub.md",
      source,
    });

    fireEvent.click(await slot.findByLabelText("Back"));
    await slot.findByTestId("link-sub.md");
  });

  it("the tab shows the switcher, and Raw hands over the file's own source", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc: makeRpc() });

    await slot.findByTestId("mde");
    const raw = slot.getByRole("tab", { name: "Raw" });
    fireEvent.mouseDown(raw);
    fireEvent.click(raw);

    const source = await slot.findByTestId("raw");
    expect(source).toHaveTextContent(
      "[neighbor](sub.md) and [external](https://x.dev)",
    );
    expect(source.getAttribute("data-language")).toBe("markdown");
  });

  it("an unsaved draft shades the rest of the app", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc: makeRpc() });
    const shades = () => document.querySelectorAll("[data-draft-shade]");

    await slot.findByTestId("mde");
    const raw = slot.getByRole("tab", { name: "Raw" });
    fireEvent.mouseDown(raw);
    fireEvent.click(raw);
    expect(shades()).toHaveLength(0);

    fireEvent.change(await slot.findByTestId("raw-input"), { target: { value: "draft" } });

    expect(shades().length).toBeGreaterThan(0);
  });

  it("clicking the path in the header reveals it via RPC with the tab's source", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const rpc = makeRpc();
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc });

    fireEvent.click(await slot.findByText("/env/notes/doc.md"));

    expect(rpc.revealDoc).toHaveBeenCalledWith({
      path: "/env/notes/doc.md",
      source,
    });
  });

  // Replaces "plugin settings reach the editor (own, separate)", deleted whole
  // rather than trimmed: it promised, among the three below, that the accent
  // COLOUR field reaches the editor on its own. That promise is false — a
  // colour has a preset above it, and this plugin registers the presets at the
  // theme's tokens, so the text field is inert until the preset says "custom".
  // The size and the engine flags have no preset above them, and those three
  // promises live on here.
  it("the size and the engine flags reach the editor (own settings, separate)", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, {
      rpc: makeRpc(),
      settings: {
        kasimovFontSize: "18px",
        kasimovFollowLinks: false,
        kasimovFrontmatter: false,
      },
    });

    const mde = await slot.findByTestId("mde");
    const vars = JSON.parse(mde.getAttribute("data-vars") ?? "null");
    expect(vars["--kasi-size"]).toBe("18px");
    expect(mde.getAttribute("data-follow")).toBe("false");
    expect(mde.getAttribute("data-frontmatter")).toBe("false");
  });

  // A colour has two settings, not one: a preset (select) and a text field,
  // and the preset wins while it is anything but "custom" — its own
  // description says so ("custom" — use the field below). This plugin
  // registers the presets at the native viewer's theme tokens, so the text
  // field is inert until the owner picks "custom" deliberately. Worth a test
  // of its own: the rule is invisible from the field alone, and a colour that
  // silently does nothing reads as a broken setting.
  it("a colour field is inert while its preset holds a theme token", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, {
      rpc: makeRpc(),
      settings: { kasimovAccent: "#0af" },
    });

    const vars = JSON.parse((await slot.findByTestId("mde")).getAttribute("data-vars") ?? "null");
    expect(vars["--kasi-accent"]).toBe("var(--timeline-accent)");
  });

  it("a colour field reaches the editor once its preset is custom", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, {
      rpc: makeRpc(),
      settings: { kasimovAccent: "#0af", kasimovAccentToken: "custom" },
    });

    const vars = JSON.parse((await slot.findByTestId("mde")).getAttribute("data-vars") ?? "null");
    expect(vars["--kasi-accent"]).toBe("#0af");
  });

  // The defect this whole change is about: before useSettings() answers, the
  // panel used to fall back to the ENGINE's own defaults (black #0e0e0e) while
  // the settings board was registered with the theme's var(--background). The
  // document was therefore black on the first frame and on every remount that
  // received no values, and the theme's colour after a page reload. Both
  // states must now read the same.
  it("shows the theme's colours before the settings arrive, not the engine's black", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc: makeRpc() });

    const vars = JSON.parse((await slot.findByTestId("mde")).getAttribute("data-vars") ?? "null");
    expect(vars["--kasi-bg"]).toBe("var(--background)");
    expect(vars["--kasi-cell-bg"]).toBe("var(--muted)");
    expect(vars["--kasi-fg"]).toBe("var(--foreground)");
  });

  it("with no settings set — defaults apply (14px size, flags on)", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc: makeRpc() });

    const mde = await slot.findByTestId("mde");
    const vars = JSON.parse(mde.getAttribute("data-vars") ?? "null");
    expect(vars["--kasi-size"]).toBe("14px");
    expect(mde.getAttribute("data-follow")).toBe("true");
    expect(mde.getAttribute("data-frontmatter")).toBe("true");
  });
});
