// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// Движок Kasimov — vanilla-DOM, jsdom его не воспроизводит. Мокаем фабрику:
// ловим переданные опции и отдаём заглушку-инстанс, чтобы проверить проводку
// обёртки (CSS-переменные на host, флаги в createEditor).
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
  it("флаги по умолчанию: followLinks и frontmatter включены", () => {
    render(<KasimovEditor value="x" />);
    expect(created).toHaveLength(1);
    expect(created[0].opts.followLinks).toBe(true);
    expect(created[0].opts.frontmatter).toBe(true);
  });

  it("флаги пробрасываются в createEditor", () => {
    render(
      <KasimovEditor value="x" followLinks={false} frontmatter={false} />,
    );
    expect(created[0].opts.followLinks).toBe(false);
    expect(created[0].opts.frontmatter).toBe(false);
  });

  it("vars навешиваются на host как CSS custom properties", () => {
    const { container } = render(
      <KasimovEditor
        value="x"
        vars={{ "--kasi-size": "18px", "--kasi-accent": "#0af" }}
      />,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.getPropertyValue("--kasi-size")).toBe("18px");
    expect(host.style.getPropertyValue("--kasi-accent")).toBe("#0af");
  });

  it("смена vars снимает прежние переменные и ставит новые", () => {
    const { container, rerender } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.getPropertyValue("--kasi-size")).toBe("18px");

    rerender(<KasimovEditor value="x" vars={{ "--kasi-gap": "8px" }} />);
    expect(host.style.getPropertyValue("--kasi-size")).toBe("");
    expect(host.style.getPropertyValue("--kasi-gap")).toBe("8px");
  });

  it("смена флага пересоздаёт редактор", () => {
    const { rerender } = render(<KasimovEditor value="x" followLinks />);
    expect(created).toHaveLength(1);
    rerender(<KasimovEditor value="x" followLinks={false} />);
    expect(created).toHaveLength(2);
    expect(created[1].opts.followLinks).toBe(false);
  });
});
