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

  it("an unsaved draft disables it — a re-read would silently drop the draft", () => {
    const onReload = vi.fn();
    show({ dirty: true, diff: { added: 1, removed: 0 }, onReload });
    expect(reload()).toBeDisabled();
    fireEvent.click(reload());
    expect(onReload).not.toHaveBeenCalled();
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
  it("the back arrow shows only when there is somewhere to go back to", () => {
    show();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    cleanup();
    const onBack = vi.fn();
    show({ canGoBack: true, onBack });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

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
