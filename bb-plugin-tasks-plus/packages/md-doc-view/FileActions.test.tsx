// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FileActions, type FileActionsProps } from "./FileActions";

afterEach(cleanup);

const show = (props: Partial<FileActionsProps> = {}) =>
  render(
    <FileActions
      path="/docs/a.md"
      disabled={false}
      onRename={vi.fn(async () => null)}
      onDelete={vi.fn(async () => null)}
      {...props}
    />,
  );

const more = () => screen.getByRole("button", { name: "More actions" });

const pick = (item: "Rename" | "Delete") => {
  fireEvent.click(more());
  fireEvent.click(screen.getByRole("button", { name: item }));
};

const nameField = () => screen.getByRole("dialog").querySelector("input") as HTMLInputElement;

const typeName = (name: string) => {
  const field = nameField();
  field.value = name;
  fireEvent.keyDown(field, { key: "Enter" });
};

describe("FileActions — the menu", () => {
  it("the button opens a menu with Rename and Delete", () => {
    show();
    fireEvent.click(more());
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("an action the host did not pass is not offered", () => {
    show({ onDelete: undefined });
    fireEvent.click(more());
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("a disabled button opens nothing", () => {
    show({ disabled: true });
    expect(more()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(more());
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });
});

describe("FileActions — renaming", () => {
  it("Rename opens a dialog with the file's name in the field", () => {
    show();
    pick("Rename");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(nameField().value).toBe("a.md");
  });

  it("a name that can't be used shows why and never reaches the host", () => {
    const onRename = vi.fn(async () => null);
    show({ onRename });
    pick("Rename");
    typeName("sub/b.md");
    expect(screen.getByText("Name can't contain a slash.")).toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("a fine name goes to the host, and the dialog closes when the host agrees", async () => {
    const onRename = vi.fn(async () => null);
    show({ onRename });
    pick("Rename");
    await act(async () => typeName("b.md"));
    expect(onRename).toHaveBeenCalledWith("b.md");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a refusal from the host stays in the dialog under the field", async () => {
    show({ onRename: vi.fn(async () => "A file with that name already exists.") });
    pick("Rename");
    await act(async () => typeName("b.md"));
    expect(await screen.findByText("A file with that name already exists.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("FileActions — deleting", () => {
  it("Delete asks first, naming the file", () => {
    const onDelete = vi.fn(async () => null);
    show({ onDelete });
    pick("Delete");
    expect(screen.getByRole("dialog")).toHaveTextContent("a.md");
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("confirming deletes once and closes the dialog", async () => {
    const onDelete = vi.fn(async () => null);
    show({ onDelete });
    pick("Delete");
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(
        [...dialog.querySelectorAll('[role="button"]')].find((b) => b.textContent === "Delete")!,
      );
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cancelling deletes nothing", () => {
    const onDelete = vi.fn(async () => null);
    show({ onDelete });
    pick("Delete");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refusal from the host stays in the dialog", async () => {
    show({ onDelete: vi.fn(async () => "Path is outside the source root.") });
    pick("Delete");
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(
        [...dialog.querySelectorAll('[role="button"]')].find((b) => b.textContent === "Delete")!,
      );
    });
    expect(await screen.findByText("Path is outside the source root.")).toBeInTheDocument();
  });
});

describe("FileActions — the dialogs hold up", () => {
  it("a click inside the rename dialog does not close it", () => {
    show();
    pick("Rename");
    fireEvent.blur(nameField());
    fireEvent.click(screen.getByText("Rename file"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Escape in the name field closes the rename dialog", () => {
    show();
    pick("Rename");
    fireEvent.keyDown(nameField(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the Rename button sends what is in the field", async () => {
    const onRename = vi.fn(async () => null);
    show({ onRename });
    pick("Rename");
    nameField().value = "c.md";
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(
        [...dialog.querySelectorAll('[role="button"]')].find((b) => b.textContent === "Rename")!,
      );
    });
    expect(onRename).toHaveBeenCalledWith("c.md");
  });

  it("a host that throws leaves its message and the actions still work", async () => {
    const onDelete = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("plugin server restarted"))
      .mockResolvedValueOnce(null);
    show({ onDelete });
    pick("Delete");
    const confirm = () =>
      fireEvent.click(
        [...screen.getByRole("dialog").querySelectorAll('[role="button"]')].find(
          (b) => b.textContent === "Delete",
        )!,
      );
    await act(async () => confirm());
    expect(await screen.findByText(/plugin server restarted/)).toBeInTheDocument();
    await act(async () => confirm());
    expect(onDelete).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the button says it opens a menu", () => {
    show();
    expect(more()).toHaveAttribute("aria-haspopup", "menu");
  });
});
