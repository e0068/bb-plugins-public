// @vitest-environment jsdom
//
// Promises of the provider mark at the left of a row: which provider it names,
// which host logo it masks, which color it takes, and that an unresolved
// provider still holds its place so titles line up.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProviderLogo, type ProviderBrand } from "./provider-logo";

afterEach(cleanup);

const CLAUDE: ProviderBrand = {
  name: "Claude Code",
  logoUrl: "/api/v1/system/providers/claude-code/logo?h=1",
  tint: { light: "#D97757", dark: "#D97757" },
};
const CODEX: ProviderBrand = {
  name: "Codex",
  logoUrl: "/api/v1/system/providers/codex/logo?h=2",
  tint: null,
};

describe("ProviderLogo", () => {
  it("labels a provider's logo with its name as an image", () => {
    render(<ProviderLogo provider={CODEX} />);
    expect(screen.getByRole("img", { name: "Codex" })).toBeTruthy();
  });

  it("masks the host logo url and records it on the element", () => {
    render(<ProviderLogo provider={CLAUDE} />);
    expect(screen.getByRole("img", { name: "Claude Code" }).dataset.logoUrl).toBe(CLAUDE.logoUrl);
  });

  it("paints a tinted provider with light-dark of its tint", () => {
    render(<ProviderLogo provider={CLAUDE} />);
    expect(screen.getByRole("img").dataset.tint).toBe("light-dark(#D97757, #D97757)");
  });

  it("leaves an untinted provider in the row's text color", () => {
    render(<ProviderLogo provider={CODEX} />);
    expect(screen.getByRole("img").dataset.tint).toBeUndefined();
  });

  it("keeps an empty unlabelled slot for an unknown provider so titles stay aligned", () => {
    const { container } = render(<ProviderLogo provider={null} />);
    expect(screen.queryByRole("img")).toBeNull();
    const slot = container.firstElementChild as HTMLElement;
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(slot.className).toContain("size-4");
  });

  it("keeps the empty slot for a provider with no logo url", () => {
    const { container } = render(<ProviderLogo provider={{ ...CODEX, logoUrl: null }} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect((container.firstElementChild as HTMLElement).className).toContain("size-4");
  });
});
