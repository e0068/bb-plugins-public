import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pathsOf } from "./generate-phosphor.mjs";
import { PHOSPHOR_FILL, PHOSPHOR_LINE } from "./index";

const assets = join(dirname(fileURLToPath(import.meta.url)), "node_modules/@phosphor-icons/core/assets");

describe.skipIf(!existsSync(assets))("Phosphor's signs as the package draws them", () => {
  it("are every path of every sign's SVG, in both weights", () => {
    for (const [name, paths] of PHOSPHOR_LINE) expect(paths, name).toEqual(pathsOf(readFileSync(join(assets, "regular", `${name}.svg`), "utf8")));
    for (const [name, paths] of PHOSPHOR_FILL) expect(paths, name).toEqual(pathsOf(readFileSync(join(assets, "fill", `${name}-fill.svg`), "utf8")));
  });
});
