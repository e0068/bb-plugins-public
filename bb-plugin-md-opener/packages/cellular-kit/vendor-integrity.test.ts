// @vitest-environment node
// Обещание пакета cellular-kit: копия kit не правится руками — она совпадает с
// манифестом поставки Cellular файл в файл и байт в байт, а фасад знает её версию.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { version } from "./index";

const vendor = new URL("./vendor/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", vendor), "utf8")) as {
  version: string;
  files: Record<string, string>;
};
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

describe("вендоренная копия kit", () => {
  it("состоит ровно из файлов манифеста поставки", () => {
    const files = readdirSync(vendor).filter((f) => f !== "manifest.json").sort();
    expect(files).toEqual(Object.keys(manifest.files).sort());
  });

  it("каждый файл совпадает с манифестом по sha256 — копию не правили руками", () => {
    const mismatched = Object.entries(manifest.files)
      .filter(([name, hash]) => sha256(readFileSync(new URL(name, vendor))) !== hash)
      .map(([name]) => name);
    expect(mismatched).toEqual([]);
  });

  it("фасад сообщает версию копии из манифеста", () => {
    expect(version).toBe(manifest.version);
  });
});
