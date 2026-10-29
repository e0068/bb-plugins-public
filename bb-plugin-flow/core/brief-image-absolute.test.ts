// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { absoluteImage, briefImageUrl, underRoot } from "./brief-image";

describe("абсолютный путь снимка", () => {
  it("`.` и `a/..` схлопываются, тип — по расширению", () => {
    expect(absoluteImage("/a/./b/../c.PNG")).toEqual({ path: "/a/c.PNG", type: "image/png" });
  });

  it("не абсолютный путь, адрес, выход выше корня диска и не картинка — не снимок", () => {
    for (const src of ["docs/a.png", "//host/a.png", "/a.png?x=1", "/a.png#top", "/../a.png", "/a/notes.md", "/a/icon.svg", "/"]) expect(absoluteImage(src), src).toBeNull();
  });

  it("абсолютный путь маршрут адресует, адрес самого маршрута — нет", () => {
    const url = new URL(briefImageUrl("thr_1", "/Users/me/.bb/thread-storage/thr_1/a.png")!, "http://bb.local");
    expect(url.searchParams.get("src")).toBe("/Users/me/.bb/thread-storage/thr_1/a.png");
    expect(briefImageUrl("thr_1", "/api/v1/plugins/flow/http/brief-image?thread=thr_1&src=a.png")).toBeNull();
  });
});

describe("снимок внутри корня", () => {
  const root = "/w/thr_1/Shapeshift";
  const image = (path: string) => ({ path, type: "image/png" });

  it("внутри корня — путь от корня, лишние косые на конце корня не мешают", () => {
    expect(underRoot(root, image(`${root}/docs/a.png`))).toEqual(image("docs/a.png"));
    expect(underRoot(`${root}//`, image(`${root}/a.png`))).toEqual(image("a.png"));
  });

  it("сосед с тем же началом имени, сам корень и пустой корень — вне корня", () => {
    expect(underRoot(root, image(`${root}-evil/a.png`))).toBeNull();
    expect(underRoot(root, image(root))).toBeNull();
    expect(underRoot("", image("/etc/a.png"))).toBeNull();
    expect(underRoot("/", image("/etc/a.png"))).toBeNull();
  });

  it("любой отданный путь не содержит `..` и не выходит из корня", () => {
    const segment = fc.constantFrom("docs", "a", "..", ".", "", "b c", "снимки");
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 8 }), (parts) => {
        const abs = absoluteImage(`${root}/${parts.join("/")}/x.png`);
        const inside = abs === null ? null : underRoot(root, abs);
        return inside === null || (!inside.path.split("/").includes("..") && !inside.path.startsWith("/"));
      }),
    );
  });
});
