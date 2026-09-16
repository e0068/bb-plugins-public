import { describe, expect, it, vi } from "vitest";

const mermaidMock = { initialize: vi.fn(), render: vi.fn() };
vi.mock("mermaid", () => ({ default: mermaidMock }));

describe("installMermaid", () => {
  it("sets the library on the given target's Mermaid — capital M, Kasimov's own contract", async () => {
    const { installMermaid } = await import("./mermaid-bootstrap");
    const target: { Mermaid?: typeof mermaidMock } = {};
    installMermaid(target);
    expect(target.Mermaid).toBe(mermaidMock);
  });
});
