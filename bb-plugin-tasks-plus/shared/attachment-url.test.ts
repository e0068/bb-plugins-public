// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  attachmentDownloadUrl,
  attachmentUrlInThread,
  attachmentUrlWithoutThread,
} from "./attachment-url.js";

const attachmentId = fc.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const threadId = fc.stringMatching(/^thr_[a-z0-9]{1,12}$/);
const foreignUrl = fc.webUrl();

describe("адрес вложения", () => {
  it("совпадает с тем, что сервер пишет в описание", () => {
    expect(attachmentDownloadUrl("01JIMAGE0000000000000000AA")).toBe(
      "/api/v1/plugins/tasks/http/attachments/download?attachmentId=01JIMAGE0000000000000000AA",
    );
  });

  it("из треда несёт его имя", () => {
    fc.assert(
      fc.property(attachmentId, threadId, (id, thread) => {
        const url = new URL(attachmentUrlInThread(attachmentDownloadUrl(id), thread), "http://bb.test");
        expect(url.searchParams.get("attachmentId")).toBe(id);
        expect(url.searchParams.get("callerThreadId")).toBe(thread);
      }),
    );
  });

  it("с доски остаётся прежним", () => {
    fc.assert(
      fc.property(attachmentId, (id) => {
        expect(attachmentUrlInThread(attachmentDownloadUrl(id), null)).toBe(attachmentDownloadUrl(id));
      }),
    );
  });

  it("снятие треда возвращает исходный адрес", () => {
    fc.assert(
      fc.property(attachmentId, threadId, (id, thread) => {
        const clean = attachmentDownloadUrl(id);
        expect(attachmentUrlWithoutThread(attachmentUrlInThread(clean, thread))).toBe(clean);
        expect(attachmentUrlWithoutThread(clean)).toBe(clean);
      }),
    );
  });

  it("чужие картинки не трогает", () => {
    fc.assert(
      fc.property(foreignUrl, threadId, (url, thread) => {
        expect(attachmentUrlInThread(url, thread)).toBe(url);
        expect(attachmentUrlWithoutThread(url)).toBe(url);
      }),
    );
  });
});
