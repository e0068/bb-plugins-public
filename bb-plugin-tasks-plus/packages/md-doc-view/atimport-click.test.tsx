// @vitest-environment jsdom
// Seam test: MdDocView against the REAL Kasimov engine's DOM. The suite in
// MdDocView.test.tsx mocks the editor, so it can only ever see the class names
// the mock invents — and what is asserted here is the engine's own markup:
// Kasimov marks an `@import` token as `.mde-atlink` WITHOUT `.mde-link`
// (unlike packages/md-editor, where the span carries both), so a consumer that
// only knows `.mde-link` silently loses half the links a Claude document is
// made of.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import type { LoadedDoc, SaveResult } from "./MdDocView";
import { MdDocView } from "./test-support/libraries";

afterEach(cleanup);

const FROM = "/home/u/.claude/CLAUDE.md";
const TO = "/home/u/.claude/skills/x/SKILL.md";

const DOCS: Record<string, string> = {
  [FROM]:
    "# Practice\n\n@~/.claude/skills/x/SKILL.md\n\nSee [the skill](skills/x/SKILL.md).\n",
  [TO]: "# The skill\n\nSkill body.\n",
};

const load = async (path: string): Promise<LoadedDoc> => ({
  path,
  content: DOCS[path] ?? null,
  sha256: "sha-" + path,
  error: DOCS[path] ? null : "not found",
});

const save = async (): Promise<SaveResult> => ({ outcome: "written" });

// Both spellings of the same target: `@~/...` (import) and a relative
// `[..](..)` href — that's all the consumer's resolver does here
// (claude-config passes `~/` through to its server).
const resolveLinkTarget = (href: string) =>
  href === "~/.claude/skills/x/SKILL.md" || href === "skills/x/SKILL.md"
    ? TO
    : null;

const renderView = (startInEdit = false) =>
  render(
    <MdDocView
      initialPath={FROM}
      load={load}
      save={save}
      resolveLinkTarget={resolveLinkTarget}
      startInEdit={startInEdit}
    />,
  );

// One promise per token kind, in each of the two modes the engine draws. The
// document arrives asynchronously, so every case waits for the first file to
// be on screen before it looks for a token in it.
const jumps = async (selector: string, startInEdit: boolean) => {
  const view = renderView(startInEdit);
  await waitFor(() =>
    expect(view.container.textContent).toContain("Practice"),
  );

  const token = view.container.querySelector(selector) as HTMLElement;
  expect(token).toBeTruthy();
  fireEvent.click(token);

  await waitFor(() => expect(view.getByText(TO)).toBeInTheDocument());
  await waitFor(() =>
    expect(view.container.textContent).toContain("Skill body."),
  );
  expect(view.container.textContent).not.toContain("Practice");
};

describe("MdDocView + real Kasimov: following a link in Read", () => {
  it("an @import opens the imported file", () => jumps(".mde-atlink", false));

  it("a [..](..) link opens the file", () => jumps(".mde-link", false));
});

// BBPL-249/250: the same click with the document already open for editing —
// the state the "open documents in edit mode" setting puts every document
// into. Kasimov follows links in Write too (deliberately leaving an unsaved
// draft behind), and this pins that: with the setting on, a dead @import would
// mean the panel's links only work in a mode the user never sees.
describe("MdDocView + real Kasimov: following a link in Write", () => {
  it("an @import opens the imported file", () => jumps(".mde-atlink", true));

  it("a [..](..) link opens the file", () => jumps(".mde-link", true));
});

// The token markup itself, stated once: `@import` carries .mde-atlink and NOT
// .mde-link. Every consumer that treats "a link in a Claude document" as one
// thing has to know it — the guard in packages/md-doc-view/link-tokens.ts
// exists for exactly this.
describe("MdDocView + real Kasimov: the engine's token markup", () => {
  it("an @import is not marked as an ordinary link", async () => {
    const view = renderView();
    await waitFor(() =>
      expect(view.container.textContent).toContain("Practice"),
    );

    const atlink = view.container.querySelector(".mde-atlink");
    expect(atlink).toBeTruthy();
    expect(atlink?.classList.contains("mde-link")).toBe(false);
  });
});
