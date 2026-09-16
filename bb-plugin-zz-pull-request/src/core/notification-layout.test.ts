import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { notificationLayout } from "./notification-layout";
import type { Notification } from "./notification";

const link = { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/293" };
const threadLink = { label: "Open thread", threadId: "thr_abc" };
const repoint = {
  pluginId: "tasks-plus",
  from: "path:/Users/x/bb-plugin-tasks-plus",
  source: "git:https://github.com/e0068/bb-plugins.git@main",
  subdirectory: "bb-plugin-tasks-plus",
};
const bare: Notification = { tone: "error", title: "boom", details: [], link: null };

describe("notificationLayout", () => {
  it("nothing to act on: no button, no link line", () => {
    expect(notificationLayout(bare)).toEqual({ action: null, linkLines: [] });
  });

  it("a lone link takes the button", () => {
    expect(notificationLayout({ ...bare, link })).toEqual({
      action: { kind: "url", label: "View on GitHub", url: link.url },
      linkLines: [],
    });
  });

  it("a thread jump takes the button, and the link stays reachable as a line", () => {
    expect(notificationLayout({ ...bare, link, threadLink })).toEqual({
      action: { kind: "thread", label: "Open thread", threadId: "thr_abc" },
      linkLines: [link],
    });
  });

  it("a prompt takes the button before anything else", () => {
    const prompt = { confirmLabel: "Repoint to git", cancelLabel: "Keep as is", repoint };
    expect(notificationLayout({ ...bare, link, threadLink, prompt })).toEqual({
      action: { kind: "repoint", label: "Repoint to git", repoint },
      linkLines: [link],
    });
  });

  it("never drops a link: whatever the notification carries is either the button or a line", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasLink, hasThread) => {
        const layout = notificationLayout({
          ...bare,
          link: hasLink ? link : null,
          ...(hasThread ? { threadLink } : {}),
        });
        const shown =
          layout.linkLines.length + (layout.action?.kind === "url" ? 1 : 0) > 0;
        expect(shown).toBe(hasLink);
      }),
    );
  });
});
