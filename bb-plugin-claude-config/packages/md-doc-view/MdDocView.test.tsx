// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { MdDocView, type LoadedDoc, type SaveResult } from "./MdDocView";

afterEach(cleanup);

// Настоящий KasimovEditor монтирует vanilla-движок в contenteditable — jsdom его
// не воспроизводит. Мок парсит markdown-ссылки из value и зовёт linkResolver на
// каждую (как настоящий редактор), рендеря кликабельную ссылку кнопкой с классом
// .mde-link (его onDocClick пропускает), внешнюю — некликабельным span.
vi.mock("./KasimovEditor", () => ({
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

const DOCS: Record<string, LoadedDoc> = {
  "/a.md": {
    path: "/a.md",
    content: "[сосед](b.md) и [внешняя](https://x.dev)",
    sha256: "sha-a",
  },
  "/b.md": { path: "/b.md", content: "# сосед", sha256: "sha-b" },
  "/err.md": {
    path: "/err.md",
    content: null,
    sha256: null,
    error: "нет файла",
  },
  "/script.sh": { path: "/script.sh", content: "echo hi", sha256: "sha-s" },
};

function makeLoad() {
  return vi.fn(async (path: string): Promise<LoadedDoc> => {
    return DOCS[path] ?? { path, content: "x", sha256: "s" };
  });
}

// Внутривкладочные ссылки резолвятся в abs; http/https — null (некликабельны).
const resolveLinkTarget = (href: string): string | null =>
  /^https?:/.test(href) ? null : href === "b.md" ? "/b.md" : `/${href}`;

const written = (): SaveResult => ({ outcome: "written", sha256: "sha-new" });

function renderView(overrides: Partial<Parameters<typeof MdDocView>[0]> = {}) {
  const load = overrides.load ?? makeLoad();
  const save = overrides.save ?? vi.fn(async () => written());
  return {
    load,
    save,
    ...render(
      <MdDocView
        initialPath="/a.md"
        load={load}
        save={save}
        resolveLinkTarget={resolveLinkTarget}
        {...overrides}
      />,
    ),
  };
}

describe("MdDocView", () => {
  it("показывает содержимое первого файла", async () => {
    const view = renderView();
    await view.findByText("[сосед](b.md) и [внешняя](https://x.dev)");
  });

  it("внутривкладочная ссылка кликабельна, внешняя (http) — нет", async () => {
    const view = renderView();
    await view.findByTestId("link-b.md");
    expect(view.getByTestId("plain-https://x.dev")).toBeInTheDocument();
    expect(view.queryByTestId("link-https://x.dev")).toBeNull();
  });

  it("клик по ссылке проваливается в файл, назад — возврат по стеку", async () => {
    const view = renderView();

    fireEvent.click(await view.findByTestId("link-b.md"));
    await view.findByText("# сосед");
    expect(view.load).toHaveBeenLastCalledWith("/b.md");

    fireEvent.click(await view.findByLabelText("Назад"));
    await view.findByTestId("link-b.md");
    expect(view.load).toHaveBeenLastCalledWith("/a.md");
  });

  it("клик по тексту входит в правку, Сохранить пишет с CAS и выходит", async () => {
    const save = vi.fn(async () => written());
    const view = renderView({ save });

    fireEvent.click(await view.findByTestId("mde-value"));
    fireEvent.click(await view.findByText("Сохранить"));

    expect(save).toHaveBeenCalledWith(
      "/a.md",
      "[сосед](b.md) и [внешняя](https://x.dev)",
      "sha-a",
    );
    await view.findByText("[сосед](b.md) и [внешняя](https://x.dev)");
    expect(view.queryByText("Сохранить")).toBeNull();
  });

  it("конфликт CAS показывает сообщение и не выходит из правки", async () => {
    const save = vi.fn(
      async (): Promise<SaveResult> => ({
        outcome: "conflict",
        message: "Файл изменился",
      }),
    );
    const view = renderView({ save });

    fireEvent.click(await view.findByTestId("mde-value"));
    fireEvent.click(await view.findByText("Сохранить"));

    await view.findByText("Файл изменился");
    expect(view.getByText("Сохранить")).toBeInTheDocument();
  });

  it("не-markdown файл открывается сырым текстом и правится", async () => {
    const save = vi.fn(async () => written());
    const view = renderView({ initialPath: "/script.sh", save });

    await view.findByText("echo hi");
    fireEvent.click(view.getByTestId("mde-value"));
    fireEvent.click(await view.findByText("Сохранить"));
    expect(save).toHaveBeenCalledWith("/script.sh", "echo hi", "sha-s");
  });

  it("ошибка чтения показывается, правка недоступна", async () => {
    const view = renderView({ initialPath: "/err.md" });

    await view.findByText("нет файла");
    expect(view.queryByTestId("mde-value")).toBeNull();
    // Кнопки «Редактировать» на нечитаемом файле нет.
    expect(view.queryByText("Редактировать")).toBeNull();
  });

  it("в просмотре видна кнопка «Редактировать» и входит в правку", async () => {
    const view = renderView();
    // В просмотре — кнопка входа в правку (не Сохранить/Отмена).
    const editBtn = await view.findByText("Редактировать");
    expect(view.queryByText("Сохранить")).toBeNull();

    fireEvent.click(editBtn);
    // В правке — Сохранить/Отмена, кнопки «Редактировать» больше нет.
    await view.findByText("Сохранить");
    expect(view.getByText("Отмена")).toBeInTheDocument();
    expect(view.queryByText("Редактировать")).toBeNull();
  });

  it("vars и флаги долетают до KasimovEditor", async () => {
    const vars = { "--kasi-size": "18px", "--kasi-accent": "#0af" };
    const view = renderView({ vars, followLinks: false, frontmatter: false });
    const mde = await view.findByTestId("mde");
    expect(mde.getAttribute("data-vars")).toBe(JSON.stringify(vars));
    expect(mde.getAttribute("data-follow")).toBe("false");
    expect(mde.getAttribute("data-frontmatter")).toBe("false");
  });
});
