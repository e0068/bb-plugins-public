import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Hugeicons from "@hugeicons/core-free-icons";
import { describe, expect, it } from "vitest";
import { ICON_CATALOG } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here).filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && name !== "vitest.config.ts");

describe("the icon catalog builds in a checkout where nobody ran npm in the package", () => {
  it("imports nothing at run time: a plugin bundle resolves the package's imports from the package's folder", () => {
    for (const name of sources) {
      const statements = readFileSync(join(here, name), "utf8").match(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["'][^"']+["']/gm) ?? [];
      const valueImports = statements.filter((statement) => !/^\s*(?:import|export)\s+type\b/.test(statement) && !/from\s+["']\./.test(statement));
      expect(valueImports, name).toEqual([]);
    }
  });

  it("draws every icon exactly as Hugeicons does", () => {
    const hugeicons = Hugeicons as unknown as Record<string, unknown>;
    for (const [name, glyph] of ICON_CATALOG) {
      expect(glyph, name).toEqual(hugeicons[`${name}Icon`]);
    }
  });
});
