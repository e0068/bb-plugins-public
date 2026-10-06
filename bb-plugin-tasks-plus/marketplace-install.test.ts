// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOST_SHIMMED, reachableImports, readSourceFiles, uninstalledImports } from "@bb-plugins/layer-guard/index.js";

/**
 * Установка из маркетплейса ставит только `dependencies`: пакет из
 * `devDependencies`, до которого фронтенд дотянулся импортом значения, ломает
 * сборку `bb plugin build` у пользователя — «Could not resolve».
 */
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const { dependencies } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };

describe("marketplace install", () => {
  it("the frontend imports values only from packages the install puts on disk", () => {
    const imports = reachableImports(readSourceFiles(ROOT), "app.tsx", { "@/": "", "@bb-plugins/": "./packages/" });
    expect(uninstalledImports(imports, Object.keys(dependencies), HOST_SHIMMED)).toEqual([]);
  });
});
