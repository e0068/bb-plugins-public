import { describe, expect, it } from "vitest";
import { crossUnitEdges, moduleUnit } from "./core.js";

describe("moduleUnit with nested roots", () => {
  it("without nested roots the unit is the top folder, as before", () => {
    expect(moduleUnit("src/core/x.ts")).toBe("src");
    expect(moduleUnit("src/core/x.ts", [])).toBe("src");
  });

  it("a nested root splits into its subfolders; a file right in it is its own unit", () => {
    expect(moduleUnit("src/core/deep/x.ts", ["src"])).toBe("src/core");
    expect(moduleUnit("src/x.ts", ["src"])).toBe("src/x");
    expect(moduleUnit("lib/utils.ts", ["src"])).toBe("lib");
    expect(moduleUnit("app.tsx", ["src"])).toBe("app");
  });
});

describe("crossUnitEdges with nested roots", () => {
  it("tells src/engine and src/core apart, through aliases too", () => {
    const edges = crossUnitEdges(
      [
        { path: "src/core/a.ts", source: 'import { x } from "../engine/run";\nimport { y } from "./b";' },
        { path: "src/ui/c.tsx", source: 'import { a } from "@/src/core/a";' },
      ],
      { aliases: { "@/": "" }, nested: ["src"] },
    );
    expect(edges.map((e) => `${e.from}->${e.to}`)).toEqual(["src/core->src/engine", "src/ui->src/core"]);
  });
});
