// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../shared/contract.js";
import { AttachmentsGrid } from "./attachments.js";

const fileAttachment = (fileName: string, mime = "application/octet-stream"): Attachment => ({
  id: "01JFILE00000000000000000A1",
  taskId: "01JTASK00000000000000000AA",
  commentId: null,
  fileName,
  mime,
  sizeBytes: 2048,
  isImage: false,
  createdAt: "2026-10-20T00:00:00.000Z",
});

/** The server answers every attachment download with this text. */
const serveText = (text: string) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(text, { status: 200 })));

beforeEach(() => serveText(""));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openCard = (fileName: string) => fireEvent.click(screen.getByText(fileName));

describe("a markdown attachment", () => {
  it("opens to its rendered text instead of downloading", async () => {
    serveText("# Founder's brief\n\n- first point\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
    render(<AttachmentsGrid attachments={[fileAttachment("NobuFX — Founder's Brief.md")]} />);

    openCard("NobuFX — Founder's Brief.md");

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: "Founder's brief" })).toBeTruthy();
    expect(within(dialog).getByText("first point").closest("li")).toBeTruthy();
    expect(within(dialog).getByRole("table")).toBeTruthy();
  });

  it("is recognised by its name even when the browser sent no markdown type", async () => {
    serveText("## Glossary");
    render(<AttachmentsGrid attachments={[fileAttachment("glossary.markdown", "application/octet-stream")]} />);

    openCard("glossary.markdown");

    expect(await screen.findByRole("heading", { name: "Glossary" })).toBeTruthy();
  });

  it("offers a download from the preview", async () => {
    render(<AttachmentsGrid attachments={[fileAttachment("notes.md")]} />);

    openCard("notes.md");

    const download = await screen.findByRole("link", { name: "Download" });
    expect(download.getAttribute("download")).toBe("notes.md");
    expect(download.getAttribute("href")).toContain("01JFILE00000000000000000A1");
  });
});

describe("links in a markdown preview", () => {
  it("open as they do in the task description: a web page in bb's browser, a task over the preview", async () => {
    serveText("See [the site](https://example.com) and [the parent](TSK-7).");
    const onOpenLink = vi.fn();
    const onOpenTask = vi.fn();
    render(<AttachmentsGrid attachments={[fileAttachment("notes.md")]} links={{ onOpenLink, onOpenTask }} />);

    openCard("notes.md");
    fireEvent.click(await screen.findByText("the site"));
    expect(onOpenLink).toHaveBeenCalledWith("https://example.com");

    fireEvent.click(screen.getByText("the parent"));
    expect(onOpenTask).toHaveBeenCalledWith("TSK-7");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Escape in a preview", () => {
  it("reaches the window already handled, so the task behind stays open", async () => {
    const seen: boolean[] = [];
    const behind = (event: KeyboardEvent) => seen.push(event.defaultPrevented);
    window.addEventListener("keydown", behind);
    render(<AttachmentsGrid attachments={[fileAttachment("notes.md")]} />);

    openCard("notes.md");
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(seen).toEqual([true]);
    window.removeEventListener("keydown", behind);
  });
});

describe("a plain-text attachment", () => {
  it.each([
    ["server.log", "text/plain"],
    ["data.json", "application/json"],
    ["table.csv", "text/csv"],
    ["readme.txt", "application/octet-stream"],
    ["main.ts", "application/octet-stream"],
  ])("%s opens as monospaced text, kept as written", async (fileName, mime) => {
    serveText("# not a heading\n  indented line");
    render(<AttachmentsGrid attachments={[fileAttachment(fileName, mime)]} />);

    openCard(fileName);

    const dialog = await screen.findByRole("dialog");
    const text = await waitFor(() => {
      const pre = dialog.querySelector("pre");
      expect(pre?.textContent).toBe("# not a heading\n  indented line");
      return pre!;
    });
    expect(text.className).toContain("font-mono");
    expect(within(dialog).queryByRole("heading", { name: "not a heading" })).toBeNull();
  });
});

describe("a text attachment whose file never reached this machine", () => {
  it("says so and asks to attach it again, instead of a bare status code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "attachment not found" }, { status: 404 })));
    render(<AttachmentsGrid attachments={[fileAttachment("decisions.md")]} />);

    openCard("decisions.md");

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/not on this machine.*attach it again/i)).toBeTruthy();
    expect(within(dialog).queryByText(/HTTP 404/)).toBeNull();
  });
});

describe("any other attachment", () => {
  it("still downloads on click", () => {
    render(<AttachmentsGrid attachments={[fileAttachment("report.pdf", "application/pdf")]} />);

    const link = screen.getByText("report.pdf").closest("a");
    expect(link?.getAttribute("download")).toBe("report.pdf");
    fireEvent.click(screen.getByText("report.pdf"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
