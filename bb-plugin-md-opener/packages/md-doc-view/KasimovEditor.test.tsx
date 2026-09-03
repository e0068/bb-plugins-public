// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// The Kasimov engine is vanilla DOM, jsdom doesn't reproduce it. We mock the
// factory: capture the passed options and return a stub instance, to check
// the wrapper's wiring (CSS variables on the host, flags in createEditor).
const created: Array<{ opts: Record<string, unknown> }> = [];
vi.mock("../kasimov/kasimov.js", () => ({
  createEditor: (_host: HTMLElement, opts: Record<string, unknown>) => {
    created.push({ opts });
    return {
      getValue: () => String(opts.value ?? ""),
      setValue: () => {},
      focus: () => {},
      undo: () => false,
      destroy: () => {},
    };
  },
}));

import { KasimovEditor } from "./KasimovEditor";

afterEach(() => {
  created.length = 0;
  cleanup();
});

describe("KasimovEditor", () => {
  it("default flags: followLinks/atLinks/frontmatter on, mermaidNodes soft", () => {
    render(<KasimovEditor value="x" />);
    expect(created).toHaveLength(1);
    expect(created[0].opts.followLinks).toBe(true);
    expect(created[0].opts.atLinks).toBe(true);
    expect(created[0].opts.frontmatter).toBe(true);
    expect(created[0].opts.mermaidNodes).toBe("soft");
  });

  it("flags are threaded through to createEditor", () => {
    render(
      <KasimovEditor
        value="x"
        followLinks={false}
        atLinks={false}
        frontmatter={false}
        mermaidNodes="contrast"
      />,
    );
    expect(created[0].opts.followLinks).toBe(false);
    expect(created[0].opts.atLinks).toBe(false);
    expect(created[0].opts.frontmatter).toBe(false);
    expect(created[0].opts.mermaidNodes).toBe("contrast");
  });

  // Kasimov recreates .mde-root on every keystroke and redeclares its own
  // --kasi-* defaults on it; a declaration on the element itself always beats
  // one inherited from the host regardless of ancestor specificity (the
  // upstream contract, memory/wiki/kasi-css-contract.md). So instead of
  // host.style the wrapper keeps a rule in document.head with an ID selector
  // keyed to the host, targeting `.mde-root` specifically — these tests check that rule.
  const styleRuleFor = (hostId: string) =>
    Array.from(document.head.querySelectorAll("style")).find((s) =>
      s.textContent?.includes(`#${hostId} .mde-root`),
    );

  it("vars produce a CSS rule in document.head, targeting the host's .mde-root", () => {
    const { container } = render(
      <KasimovEditor
        value="x"
        vars={{ "--kasi-size": "18px", "--kasi-accent": "#0af" }}
      />,
    );
    const host = container.firstElementChild as HTMLElement;
    const rule = styleRuleFor(host.id);
    expect(rule?.textContent).toContain("--kasi-size: 18px;");
    expect(rule?.textContent).toContain("--kasi-accent: #0af;");
    // not an inline style on the host — the contract requires specificity higher than .mde-root
    expect(host.style.getPropertyValue("--kasi-size")).toBe("");
  });

  it("changing vars removes the old rule and sets a new one", () => {
    const { container, rerender } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(styleRuleFor(host.id)?.textContent).toContain("--kasi-size: 18px;");

    rerender(<KasimovEditor value="x" vars={{ "--kasi-gap": "8px" }} />);
    expect(styleRuleFor(host.id)?.textContent).toContain("--kasi-gap: 8px;");
    expect(styleRuleFor(host.id)?.textContent).not.toContain("--kasi-size");
  });

  it("unmounting removes the rule from document.head", () => {
    const { container, unmount } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(styleRuleFor(host.id)).toBeDefined();
    unmount();
    expect(styleRuleFor(host.id)).toBeUndefined();
  });

  it("no rule is created without vars / with empty vars", () => {
    const { container: c1 } = render(<KasimovEditor value="x" />);
    const host1 = c1.firstElementChild as HTMLElement;
    expect(styleRuleFor(host1.id)).toBeUndefined();

    const { container: c2 } = render(<KasimovEditor value="x" vars={{}} />);
    const host2 = c2.firstElementChild as HTMLElement;
    expect(styleRuleFor(host2.id)).toBeUndefined();
  });

  it("two instances get different ids and independent rules", () => {
    const { container: c1 } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />,
    );
    const { container: c2 } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "22px" }} />,
    );
    const host1 = c1.firstElementChild as HTMLElement;
    const host2 = c2.firstElementChild as HTMLElement;
    expect(host1.id).not.toBe(host2.id);
    expect(styleRuleFor(host1.id)?.textContent).toContain("--kasi-size: 18px;");
    expect(styleRuleFor(host2.id)?.textContent).toContain("--kasi-size: 22px;");
  });

  it("exactly one <style> tag per instance, no duplicates", () => {
    const { container } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />,
    );
    const host = container.firstElementChild as HTMLElement;
    const matches = Array.from(
      document.head.querySelectorAll("style"),
    ).filter((s) => s.textContent?.includes(`#${host.id} `));
    expect(matches).toHaveLength(1);
  });

  it("a re-render with a new but content-equal vars doesn't recreate the tag", () => {
    const { container, rerender } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />,
    );
    const host = container.firstElementChild as HTMLElement;
    const before = styleRuleFor(host.id);

    // A new object literal with the same content — the callers (md-opener/
    // claude-config) call toCssVars() again on every render, without memoization.
    rerender(<KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />);
    const after = styleRuleFor(host.id);
    expect(after).toBe(before);
  });

  it("changing a flag recreates the editor", () => {
    const { rerender } = render(<KasimovEditor value="x" followLinks />);
    expect(created).toHaveLength(1);
    rerender(<KasimovEditor value="x" followLinks={false} />);
    expect(created).toHaveLength(2);
    expect(created[1].opts.followLinks).toBe(false);
  });

  it("changing mermaidNodes recreates the editor", () => {
    const { rerender } = render(<KasimovEditor value="x" mermaidNodes="soft" />);
    expect(created).toHaveLength(1);
    rerender(<KasimovEditor value="x" mermaidNodes="contrast" />);
    expect(created).toHaveLength(2);
    expect(created[1].opts.mermaidNodes).toBe("contrast");
  });
});
