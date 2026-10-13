// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  attachmentDownloadUrl,
  attachmentDownloadUrls,
  attachmentUrlInThread,
  attachmentUrlWithoutThread,
  removeAttachmentDescriptionReferences,
} from "./attachment-url.js";

const attachmentId = fc.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const threadId = fc.stringMatching(/^thr_[a-z0-9]{1,12}$/);
const foreignUrl = fc.webUrl();

describe("адрес вложения", () => {
  it("совпадает с тем, что сервер пишет в описание", () => {
    expect(attachmentDownloadUrl("01JIMAGE0000000000000000AA")).toBe(
      "/api/v1/plugins/tasks-plus/http/attachments/download?attachmentId=01JIMAGE0000000000000000AA",
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

  it("картинка из описания, написанного под прежним id плагина, читается нынешним адресом", () => {
    fc.assert(
      fc.property(attachmentId, fc.option(threadId, { nil: null }), (id, thread) => {
        const legacy = `/api/v1/plugins/tasks/http/attachments/download?attachmentId=${id}`;
        expect(attachmentDownloadUrls(id)).toContain(legacy);
        expect(attachmentUrlWithoutThread(attachmentUrlInThread(legacy, thread))).toBe(attachmentDownloadUrl(id));
      }),
    );
  });
});

describe("a removed attachment's images", () => {
  it("leave the description under either address, and the other images stay", () => {
    fc.assert(
      fc.property(attachmentId, attachmentId, (gone, kept) => {
        fc.pre(gone !== kept);
        const [current, legacy] = attachmentDownloadUrls(gone);
        const other = `![kept.png](${attachmentDownloadUrl(kept)})`;
        const markdown = `Intro ![a.png](${current}) ${other} ![b.svg](${legacy})`;
        expect(removeAttachmentDescriptionReferences(markdown, gone)).toBe(`Intro  ${other} `);
      }),
    );
  });
});
