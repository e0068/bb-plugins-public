// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DocHeader, type DocHeaderProps } from "./DocHeader";
import { testTabsKit } from "../segmented-control/test-support/tabs-kit";

afterEach(cleanup);

const base: DocHeaderProps = {
  tabs: testTabsKit,
  path: "/tmp/doc.md",
  note: null,
  canGoBack: false,
  onBack: () => {},
  mode: "read",
  modes: ["read", "write", "raw"],
  onModeChange: () => {},
  dirty: false,
  diff: { added: 0, removed: 0 },
  onReload: () => {},
  onSave: () => {},
  onCancel: () => {},
};

const show = (props: Partial<DocHeaderProps> = {}) =>
  render(<DocHeader {...base} {...props} />);

// Radix's Tabs trigger switches on mousedown, not on click — the same pair of
// events the control's own tests send (packages/segmented-control).
const pressSegment = (name: string) => {
  const segment = screen.getByRole("tab", { name });
  fireEvent.mouseDown(segment);
  fireEvent.click(segment);
};

describe("DocHeader — the switcher", () => {
  it("shows exactly the modes it was given", () => {
    show();
    expect(screen.getByRole("tab", { name: "Read" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Write" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Raw" })).toBeInTheDocument();
  });

  it("a document with one mode shows one segment and no other", () => {
    show({ modes: ["read"] });
    expect(screen.getByRole("tab", { name: "Read" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Write" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Raw" })).toBeNull();
  });

  it("clicking a segment reports its value", () => {
    const onModeChange = vi.fn();
    show({ onModeChange });
    pressSegment("Raw");
    expect(onModeChange).toHaveBeenCalledWith("raw");
  });

  it("the current mode is the selected segment", () => {
    show({ mode: "write" });
    expect(screen.getByRole("tab", { name: "Write" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });
});

describe("DocHeader — reloading the file", () => {
  const reload = () => screen.getByRole("button", { name: "Reload" });

  it("the reload control is there whatever the mode", () => {
    for (const mode of ["read", "write", "raw"] as const) {
      cleanup();
      show({ mode });
      expect(reload()).toBeInTheDocument();
    }
  });

  it("clicking it re-reads the file", () => {
    const onReload = vi.fn();
    show({ onReload });
    fireEvent.click(reload());
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("DocHeader — the second row", () => {
  it("is absent while the draft matches the file", () => {
    show();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("shows the line counts once the draft has drifted", () => {
    show({ dirty: true, diff: { added: 3, removed: 12 } });
    const counter = screen.getByLabelText("Draft difference");
    expect(counter).toHaveTextContent("+3");
    expect(counter).toHaveTextContent("−12");
  });

  it("Save and Cancel report to the callbacks they were given", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    show({ dirty: true, diff: { added: 1, removed: 1 }, onSave, onCancel });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("the switcher stays reachable while the draft is unsaved", () => {
    const onModeChange = vi.fn();
    show({ dirty: true, diff: { added: 1, removed: 0 }, onModeChange });
    pressSegment("Raw");
    expect(onModeChange).toHaveBeenCalledWith("raw");
  });
});

describe("DocHeader — path, note and the host's own chrome", () => {
  it("a path without onReveal shows but is not clickable", () => {
    show();
    expect(screen.getByText("/tmp/doc.md")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /doc\.md/ })).toBeNull();
  });

  it("a path with onReveal reveals the file it currently shows", () => {
    const onReveal = vi.fn();
    show({ onReveal });
    fireEvent.click(screen.getByRole("button", { name: "/tmp/doc.md" }));
    expect(onReveal).toHaveBeenCalledWith("/tmp/doc.md");
  });

  it("a note is shown next to the path", () => {
    show({ note: "Save failed: the file changed on disk." });
    expect(
      screen.getByText("Save failed: the file changed on disk."),
    ).toBeInTheDocument();
  });

  it("leading and trailing are rendered as given", () => {
    show({
      leading: <button type="button">Close</button>,
      trailing: <button type="button">Ask</button>,
    });
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();
  });
});

describe("DocHeader — walking the history", () => {
  const back = () => screen.getByRole("button", { name: "Back" });

  it("back stands before the path even with nowhere to go, and is disabled then", () => {
    const onBack = vi.fn();
    show({ onBack });
    expect(back()).toBeDisabled();
    fireEvent.click(back());
    expect(onBack).not.toHaveBeenCalled();
    expect(back().compareDocumentPosition(screen.getByText("/tmp/doc.md"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("back with somewhere to go reports the step", () => {
    const onBack = vi.fn();
    show({ canGoBack: true, onBack });
    fireEvent.click(back());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("forward is absent until there is something ahead", () => {
    show();
    expect(screen.queryByRole("button", { name: "Forward" })).toBeNull();
  });

  it("forward appears just before reload and reports the step", () => {
    const onForward = vi.fn();
    show({ canGoForward: true, onForward });
    const forward = screen.getByRole("button", { name: "Forward" });
    expect(forward.nextElementSibling).toBe(screen.getByRole("button", { name: "Reload" }));
    fireEvent.click(forward);
    expect(onForward).toHaveBeenCalledTimes(1);
  });
});

describe("DocHeader — an unsaved draft takes the left of the row", () => {
  const dirty = { dirty: true, diff: { added: 2, removed: 1 } } as const;

  it("path, back, forward and reload give way to the diff, Save and Cancel", () => {
    show({ ...dirty, canGoBack: true, canGoForward: true });
    expect(screen.queryByText("/tmp/doc.md")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Forward" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    expect(screen.getByLabelText("Draft difference")).toHaveTextContent("+2");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("the draft's controls sit in the same row as the switcher and the actions", () => {
    show({ ...dirty, actions: <button type="button">More</button> });
    const row = screen.getByRole("tablist").closest(".mdo-header");
    expect(row).toContainElement(screen.getByRole("button", { name: "Save" }));
    expect(row).toContainElement(screen.getByRole("button", { name: "More" }));
  });
});

describe("DocHeader — the file's actions", () => {
  it("actions stand after the switcher and before trailing", () => {
    show({
      actions: <button type="button">More</button>,
      trailing: <button type="button">Close</button>,
    });
    const more = screen.getByRole("button", { name: "More" });
    expect(screen.getByRole("tablist").compareDocumentPosition(more)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(more.compareDocumentPosition(screen.getByRole("button", { name: "Close" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
