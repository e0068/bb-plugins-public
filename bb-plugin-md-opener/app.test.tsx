// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);

// Настоящий KasimovEditor монтирует vanilla-движок в contenteditable — jsdom его
// не воспроизводит, поэтому мокаем обёртку общего слоя: мок парсит markdown-ссылки
// из value и зовёт linkResolver на каждую (как настоящий редактор), рендеря
// кликабельную ссылку кнопкой с классом .mde-link (его onDocClick пропускает).
vi.mock("./packages/md-doc-view/KasimovEditor", () => ({
  KasimovEditor: ({
    value,
    linkResolver,
    vars,
    followLinks,
    frontmatter,
  }: {
    value: string;
    linkResolver?: (href: string) => { onClick: () => void } | null;
    vars?: Record<string, string>;
    followLinks?: boolean;
    frontmatter?: boolean;
  }) => {
    const hrefs = [...String(value).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(
      (m) => m[1],
    );
    return (
      <div
        data-testid="mde"
        data-vars={JSON.stringify(vars ?? null)}
        data-follow={String(followLinks)}
        data-frontmatter={String(frontmatter)}
      >
        <div data-testid="mde-value">{value}</div>
        {hrefs.map((href, i) => {
          const r = linkResolver?.(href);
          return r ? (
            <button
              key={i}
              className="mde-link"
              data-testid={`link-${href}`}
              onClick={r.onClick}
            >
              {href}
            </button>
          ) : (
            <span key={i} data-testid={`plain-${href}`}>
              {href}
            </span>
          );
        })}
      </div>
    );
  },
}));

const source = {
  kind: "workspace" as const,
  threadId: null,
  environmentId: "e1",
  projectId: null,
};

const props = { path: "notes/doc.md", source, experimental_Original: () => null };

function makeRpc() {
  const readDoc = vi.fn(async ({ path }: { path: string }) => {
    if (path === "notes/doc.md" || path === "/env/notes/doc.md") {
      return {
        path: "/env/notes/doc.md",
        content: "[сосед](sub.md) и [внешняя](https://x.dev)",
        error: null,
        sha256: "sha-doc",
        links: [{ href: "sub.md", abs: "/env/notes/sub.md", exists: true }],
      };
    }
    return {
      path: "/env/notes/sub.md",
      content: "# сосед",
      error: null,
      sha256: "sha-sub",
      links: [],
    };
  });
  return { readDoc };
}

describe("bb-plugin-md-opener app", () => {
  it("регистрирует слот fileOpener для .md", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.fileOpeners[0]?.title).toBe("Kasimov");
    expect(app.fileOpeners[0]?.extensions).toContain("md");
  });

  it("внутривкладочная ссылка кликабельна, внешняя (http) — нет", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc: makeRpc() });

    await slot.findByTestId("link-sub.md");
    expect(slot.getByTestId("plain-https://x.dev")).toBeInTheDocument();
    expect(slot.queryByTestId("link-https://x.dev")).toBeNull();
  });

  it("клик по ссылке проваливается в файл (abs с сервера), назад — возврат", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const rpc = makeRpc();
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc });

    fireEvent.click(await slot.findByTestId("link-sub.md"));

    await slot.findByText("# сосед");
    expect(rpc.readDoc).toHaveBeenLastCalledWith({
      path: "/env/notes/sub.md",
      source,
    });

    fireEvent.click(await slot.findByLabelText("Назад"));
    await slot.findByTestId("link-sub.md");
  });

  it("настройки плагина долетают до редактора (свои, раздельные)", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, {
      rpc: makeRpc(),
      settings: {
        kasimovFontSize: "18px",
        kasimovAccent: "#0af",
        kasimovFollowLinks: false,
        kasimovFrontmatter: false,
      },
    });

    const mde = await slot.findByTestId("mde");
    const vars = JSON.parse(mde.getAttribute("data-vars") ?? "null");
    expect(vars["--kasi-size"]).toBe("18px");
    expect(vars["--kasi-accent"]).toBe("#0af");
    expect(mde.getAttribute("data-follow")).toBe("false");
    expect(mde.getAttribute("data-frontmatter")).toBe("false");
  });

  it("без заданных настроек — дефолты (кегль 14px, флаги включены)", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc: makeRpc() });

    const mde = await slot.findByTestId("mde");
    const vars = JSON.parse(mde.getAttribute("data-vars") ?? "null");
    expect(vars["--kasi-size"]).toBe("14px");
    expect(mde.getAttribute("data-follow")).toBe("true");
    expect(mde.getAttribute("data-frontmatter")).toBe("true");
  });
});
