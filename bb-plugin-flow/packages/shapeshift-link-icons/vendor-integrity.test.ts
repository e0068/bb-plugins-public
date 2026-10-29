// Обещание пакета shapeshift-link-icons: копия файла стилей не правится руками —
// она совпадает с манифестом байт в байт — и остаётся самодостаточной: ни
// импортов, ни внешних адресов, только глифы данными.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { FILE, MANIFEST, SOURCE, hashOf, manifestOf } from "./update.mjs";

const vendor = new URL("./vendor/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL(MANIFEST, vendor), "utf8")) as {
  commit: string;
  files: Record<string, string>;
};
const css = readFileSync(new URL(FILE, vendor), "utf8");

describe("вендоренная копия значков ссылок Shapeshift", () => {
  it("состоит ровно из файлов манифеста", () => {
    const files = readdirSync(vendor).filter((f) => f !== MANIFEST).sort();
    expect(files).toEqual(Object.keys(manifest.files).sort());
  });

  it("каждый файл совпадает с манифестом по sha256 — копию не правили руками", () => {
    const mismatched = Object.entries(manifest.files)
      .filter(([name, hash]) => hashOf(readFileSync(new URL(name, vendor))) !== hash)
      .map(([name]) => name);
    expect(mismatched).toEqual([]);
  });

  it("манифест называет полный коммит Shapeshift", () => {
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("манифест называет источник, путь, коммит и sha256 текста", () => {
    expect(manifestOf("c0ffee", "a { }")).toEqual({
      source: "Shapeshift",
      path: SOURCE,
      commit: "c0ffee",
      files: { [FILE]: hashOf("a { }") },
    });
  });

  it("стили самодостаточны: без @import и без адресов, кроме data:", () => {
    expect(css).not.toMatch(/@import/);
    const urls = [...css.matchAll(/url\(\s*["']?([^"')]*)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => !u.startsWith("data:"))).toEqual([]);
  });
});
