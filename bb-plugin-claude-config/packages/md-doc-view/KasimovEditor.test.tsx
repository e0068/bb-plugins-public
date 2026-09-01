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
  it("флаги по умолчанию: followLinks/atLinks/frontmatter вкл, mermaidNodes soft", () => {
    render(<KasimovEditor value="x" />);
    expect(created).toHaveLength(1);
    expect(created[0].opts.followLinks).toBe(true);
    expect(created[0].opts.atLinks).toBe(true);
    expect(created[0].opts.frontmatter).toBe(true);
    expect(created[0].opts.mermaidNodes).toBe("soft");
  });

  it("флаги пробрасываются в createEditor", () => {
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

  // Kasimov пересоздаёт .mde-root на каждый ввод и заново объявляет на нём
  // свои дефолты --kasi-*; собственное объявление на элементе всегда бьёт
  // унаследованное от host независимо от специфичности предка (контракт
  // апстрима, memory/wiki/kasi-css-contract.md). Поэтому вместо host.style
  // обёртка держит правило в document.head с ID-селектором по host,
  // целящееся именно в `.mde-root` — эти тесты проверяют это правило.
  const styleRuleFor = (hostId: string) =>
    Array.from(document.head.querySelectorAll("style")).find((s) =>
      s.textContent?.includes(`#${hostId} .mde-root`),
    );

  it("vars дают CSS-правило в document.head, целящееся в host .mde-root", () => {
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
    // не инлайн-стиль на host — контракт требует специфичности выше .mde-root
    expect(host.style.getPropertyValue("--kasi-size")).toBe("");
  });

  it("смена vars снимает прежнее правило и ставит новое", () => {
    const { container, rerender } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(styleRuleFor(host.id)?.textContent).toContain("--kasi-size: 18px;");

    rerender(<KasimovEditor value="x" vars={{ "--kasi-gap": "8px" }} />);
    expect(styleRuleFor(host.id)?.textContent).toContain("--kasi-gap: 8px;");
    expect(styleRuleFor(host.id)?.textContent).not.toContain("--kasi-size");
  });

  it("размонтирование убирает правило из document.head", () => {
    const { container, unmount } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(styleRuleFor(host.id)).toBeDefined();
    unmount();
    expect(styleRuleFor(host.id)).toBeUndefined();
  });

  it("без vars / с пустым vars правило не создаётся", () => {
    const { container: c1 } = render(<KasimovEditor value="x" />);
    const host1 = c1.firstElementChild as HTMLElement;
    expect(styleRuleFor(host1.id)).toBeUndefined();

    const { container: c2 } = render(<KasimovEditor value="x" vars={{}} />);
    const host2 = c2.firstElementChild as HTMLElement;
    expect(styleRuleFor(host2.id)).toBeUndefined();
  });

  it("два инстанса получают разные id и независимые правила", () => {
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

  it("ровно один <style>-тег на инстанс, без дублей", () => {
    const { container } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />,
    );
    const host = container.firstElementChild as HTMLElement;
    const matches = Array.from(
      document.head.querySelectorAll("style"),
    ).filter((s) => s.textContent?.includes(`#${host.id} `));
    expect(matches).toHaveLength(1);
  });

  it("ререндер с новым, но равным по содержимому vars не пересоздаёт тег", () => {
    const { container, rerender } = render(
      <KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />,
    );
    const host = container.firstElementChild as HTMLElement;
    const before = styleRuleFor(host.id);

    // Новый объект-литерал с тем же содержимым — вызывающие (md-opener/
    // claude-config) зовут toCssVars() заново на каждый рендер, без мемоизации.
    rerender(<KasimovEditor value="x" vars={{ "--kasi-size": "18px" }} />);
    const after = styleRuleFor(host.id);
    expect(after).toBe(before);
  });

  it("смена флага пересоздаёт редактор", () => {
    const { rerender } = render(<KasimovEditor value="x" followLinks />);
    expect(created).toHaveLength(1);
    rerender(<KasimovEditor value="x" followLinks={false} />);
    expect(created).toHaveLength(2);
    expect(created[1].opts.followLinks).toBe(false);
  });

  it("смена mermaidNodes пересоздаёт редактор", () => {
    const { rerender } = render(<KasimovEditor value="x" mermaidNodes="soft" />);
    expect(created).toHaveLength(1);
    rerender(<KasimovEditor value="x" mermaidNodes="contrast" />);
    expect(created).toHaveLength(2);
    expect(created[1].opts.mermaidNodes).toBe("contrast");
  });
});
