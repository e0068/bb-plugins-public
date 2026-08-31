import { describe, expect, it } from "vitest";
import {
  fileRefFromCode,
  isInTabLink,
  parseHref,
  resolveRelative,
} from "./resolve";

describe("isInTabLink", () => {
  it("отсекает схемные, протокол-относительные, якорные и пустые ссылки", () => {
    expect(isInTabLink("http://example.com/x")).toBe(false);
    expect(isInTabLink("https://example.com/x")).toBe(false);
    expect(isInTabLink("mailto:a@b.com")).toBe(false);
    expect(isInTabLink("//example.com/x")).toBe(false);
    expect(isInTabLink("#x")).toBe(false);
    expect(isInTabLink("")).toBe(false);
  });

  it("признаёт локальные пути живыми для навигации", () => {
    expect(isInTabLink("tasks/x.md")).toBe(true);
    expect(isInTabLink("./y.md")).toBe(true);
    expect(isInTabLink("/abs/z.md")).toBe(true);
  });
});

describe("parseHref", () => {
  it("сперва отрезает title, потом якорь", () => {
    expect(parseHref('path "t"#sec')).toEqual({ path: "path", anchor: "sec" });
  });

  it("без title и якоря — путь целиком, якорь null", () => {
    expect(parseHref("tasks/x.md")).toEqual({ path: "tasks/x.md", anchor: null });
  });

  it("только якорь, без title", () => {
    expect(parseHref("tasks/x.md#section")).toEqual({
      path: "tasks/x.md",
      anchor: "section",
    });
  });

  it("хвостовую пунктуацию не режет — легальная точка в имени файла цела", () => {
    expect(parseHref("notes/v1.2.md")).toEqual({
      path: "notes/v1.2.md",
      anchor: null,
    });
  });
});

describe("resolveRelative", () => {
  it("дедуплицирует хвостовой слэш абсолютной ссылки", () => {
    expect(resolveRelative("dir/a.md", "/a/b/")).toBe(
      resolveRelative("dir/a.md", "/a/b"),
    );
  });

  it("резолвит относительный путь от директории файла", () => {
    expect(resolveRelative("dir/a.md", "b.md")).toBe("/dir/b.md");
  });

  it("схлопывает ..", () => {
    expect(resolveRelative("dir/a.md", "../c.md")).toBe("/c.md");
  });

  it("абсолютный ref не зависит от fromPath", () => {
    expect(resolveRelative("dir/a.md", "/abs/z.md")).toBe("/abs/z.md");
  });
});

describe("fileRefFromCode", () => {
  it("файловую ссылку в инлайн-коде распознаёт", () => {
    expect(fileRefFromCode("references/x.md")).toBe("references/x.md");
    expect(fileRefFromCode("  references/x.md  ")).toBe("references/x.md");
  });

  it("обычный код — не ссылка", () => {
    expect(fileRefFromCode("const x")).toBe(null);
    expect(fileRefFromCode("user-scalable=no")).toBe(null);
  });
});
