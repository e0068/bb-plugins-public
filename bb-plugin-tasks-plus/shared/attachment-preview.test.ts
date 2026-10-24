import { describe, expect, it } from "vitest";
import { attachmentPreviewKind } from "./attachment-preview.js";

describe("how an attachment opens", () => {
  it.each([
    ["notes.md", "application/octet-stream", "markdown"],
    ["NOTES.MD", "", "markdown"],
    ["brief.markdown", "text/plain", "markdown"],
    ["untitled", "text/markdown; charset=utf-8", "markdown"],
    ["server.log", "application/octet-stream", "text"],
    ["data.json", "application/json", "text"],
    ["main.ts", "video/mp2t", "text"],
    ["untitled", "text/plain", "text"],
    ["untitled", "application/json", "text"],
  ] as const)("%s (%s) opens as %s", (fileName, mime, kind) => {
    expect(attachmentPreviewKind(fileName, mime)).toBe(kind);
  });

  it.each([
    ["report.pdf", "application/pdf"],
    ["archive.zip", "application/zip"],
    ["Makefile", "application/octet-stream"],
    ["photo.heic", "image/heic"],
  ])("%s (%s) downloads", (fileName, mime) => {
    expect(attachmentPreviewKind(fileName, mime)).toBeUndefined();
  });
});
