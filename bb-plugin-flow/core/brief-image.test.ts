// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { BRIEF_IMAGE_PATH, briefImageUrl, imageType, workspaceImage } from "./brief-image";

describe("картинка в тексте брифа", () => {
  it("снимок по пути от корня дерева треда грузится с маршрута Flow, тред и путь — в адресе", () => {
    const url = briefImageUrl("thr_wtzf3eqyxe", "docs/prototypes/SHA-315/1-variables-tabbar.jpg");
    expect(url).toBe(`/api/v1/plugins/flow/http${BRIEF_IMAGE_PATH}?thread=thr_wtzf3eqyxe&src=docs%2Fprototypes%2FSHA-315%2F1-variables-tabbar.jpg`);
  });

  it("путь с пробелами и кириллицей доходит до сервера целым", () => {
    const url = new URL(briefImageUrl("thr_1", "docs/снимки/экран 1.png")!, "http://bb.local");
    expect(url.searchParams.get("src")).toBe("docs/снимки/экран 1.png");
  });

  it("не картинку маршрут не адресует: текст, html и svg остаются плашкой", () => {
    expect(briefImageUrl("thr_1", "docs/spec.md")).toBeNull();
    expect(briefImageUrl("thr_1", "docs/prototype.html")).toBeNull();
    expect(briefImageUrl("thr_1", "docs/icon.svg")).toBeNull();
  });

  it("растровые форматы узнаются по расширению в любом регистре", () => {
    expect(imageType("a.PNG")).toBe("image/png");
    expect(imageType("a.jpg")).toBe("image/jpeg");
    expect(imageType("a.jpeg")).toBe("image/jpeg");
    expect(imageType("a.gif")).toBe("image/gif");
    expect(imageType("a.webp")).toBe("image/webp");
    expect(imageType("a.avif")).toBe("image/avif");
    expect(imageType("a.svg")).toBeNull();
    expect(imageType("png")).toBeNull();
  });
});

describe("файл снимка в дереве треда", () => {
  const root = "/w/thr_1/Shapeshift";

  it("путь от корня дерева — файл внутри дерева, `./` и `a/../` схлопываются", () => {
    expect(workspaceImage(root, "docs/a.jpg")).toBe("/w/thr_1/Shapeshift/docs/a.jpg");
    expect(workspaceImage(root, "./docs/a.jpg")).toBe("/w/thr_1/Shapeshift/docs/a.jpg");
    expect(workspaceImage(`${root}/`, "docs/x/../a.jpg")).toBe("/w/thr_1/Shapeshift/docs/a.jpg");
  });

  it("путь, уходящий из дерева, абсолютный путь и не картинка — не отдаются", () => {
    expect(workspaceImage(root, "../secret.png")).toBeNull();
    expect(workspaceImage(root, "docs/../../thr_2/a.png")).toBeNull();
    expect(workspaceImage(root, "/etc/a.png")).toBeNull();
    expect(workspaceImage(root, "docs/.env")).toBeNull();
  });

  it("любой отданный файл лежит внутри дерева", () => {
    const segment = fc.constantFrom("docs", "a", "..", ".", "", "b c", "снимки");
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 6 }), (parts) => {
        const file = workspaceImage(root, `${parts.join("/")}/x.png`);
        return file === null || file.startsWith(`${root}/`);
      }),
    );
  });
});

describe("снимок, как его отдаёт движок текста", () => {
  it("путь в угловых скобках и с пробелами вокруг — тот же снимок", () => {
    expect(briefImageUrl("thr_1", " <docs/экран 1.png> ")).toBe(briefImageUrl("thr_1", "docs/экран 1.png"));
  });

  it("путь без выхода наверх — всегда файл корня с теми же сегментами", () => {
    const root = "/w/thr_1/Shapeshift";
    const segment = fc.constantFrom("docs", "a", "b c", "снимки", "SHA-315");
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 6 }), (parts) => {
        expect(workspaceImage(root, [...parts, "x.png"].join("/"))).toBe([root, ...parts, "x.png"].join("/"));
      }),
    );
  });

  it("пустой корень дерева — файла нет, а не путь от корня диска", () => {
    expect(workspaceImage("", "docs/a.png")).toBeNull();
  });
});
