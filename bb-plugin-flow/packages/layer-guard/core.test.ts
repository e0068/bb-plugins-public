import { describe, expect, it } from "vitest";
import {
  HOST_SHIMMED,
  bundledImports,
  crossUnitEdges,
  formatViolations,
  importSpecifiers,
  layerViolations,
  moduleUnit,
  resolveSpecifier,
  type Layers,
  type UnitEdge,
} from "./core";

describe("importSpecifiers", () => {
  it("reads static, side-effect, re-export and dynamic imports in order", () => {
    const source = [
      'import a from "./a.js";',
      'import { b, c } from "../b";',
      'import * as ns from "@/lib/ns";',
      'import "./side-effect.css";',
      'export { d } from "./d.js";',
      'export * from "./e.js";',
      'const lazy = () => import("./lazy.js");',
    ].join("\n");
    expect(importSpecifiers(source).map((s) => s.specifier)).toEqual([
      "./a.js",
      "../b",
      "@/lib/ns",
      "./side-effect.css",
      "./d.js",
      "./e.js",
      "./lazy.js",
    ]);
  });

  it("marks `import type` and `export type` as type-only, value imports as not", () => {
    const source = [
      'import type { T } from "./t.js";',
      'export type { U } from "./u.js";',
      'import { v } from "./v.js";',
    ].join("\n");
    expect(importSpecifiers(source).map((s) => s.typeOnly)).toEqual([true, true, false]);
  });

  it("handles a multi-line import list", () => {
    const source = 'import {\n  one,\n  two,\n} from "./many.js";';
    expect(importSpecifiers(source)).toEqual([{ specifier: "./many.js", typeOnly: false }]);
  });

  it("ignores the word import inside strings that carry no specifier", () => {
    expect(importSpecifiers('const word = "import"; const n = 1;')).toEqual([]);
  });

  it("does not read an import written inside a comment", () => {
    const source = '// import gone from "./gone.js";\n/* export * from "./also-gone.js"; */\nimport kept from "./kept.js";';
    expect(importSpecifiers(source)).toEqual([{ specifier: "./kept.js", typeOnly: false }]);
  });

  it("keeps an import after a string that holds two slashes", () => {
    const source = 'const url = "https://x.dev/a"; import a from "./a.js";';
    expect(importSpecifiers(source).map((s) => s.specifier)).toEqual(["./a.js"]);
  });
});

describe("moduleUnit", () => {
  it("is the top-level folder for nested files and the bare name for root files", () => {
    expect(moduleUnit("views/list/row.tsx")).toBe("views");
    expect(moduleUnit("shared/contract.ts")).toBe("shared");
    expect(moduleUnit("app.tsx")).toBe("app");
    expect(moduleUnit("server.ts")).toBe("server");
  });
});

describe("resolveSpecifier", () => {
  it("resolves sibling and parent relative paths against the importer", () => {
    expect(resolveSpecifier("views/list/row.tsx", "./data.js")).toBe("views/list/data.js");
    expect(resolveSpecifier("views/list/row.tsx", "../../shell/data.js")).toBe("shell/data.js");
    expect(resolveSpecifier("app.tsx", "./shell/app-shell.js")).toBe("shell/app-shell.js");
  });

  it("maps an alias prefix onto the root", () => {
    expect(resolveSpecifier("views/x.tsx", "@/lib/utils", { "@/": "" })).toBe("lib/utils");
    expect(resolveSpecifier("views/x.tsx", "#src/a", { "#src/": "src/" })).toBe("src/a");
  });

  it("treats bare packages and paths escaping the root as external", () => {
    expect(resolveSpecifier("views/x.tsx", "react")).toBeNull();
    expect(resolveSpecifier("views/x.tsx", "../../../packages/other")).toBeNull();
  });
});

describe("crossUnitEdges", () => {
  it("keeps only imports that leave their unit", () => {
    const edges = crossUnitEdges(
      [
        {
          path: "views/list/row.tsx",
          source: 'import { a } from "./lib.js";\nimport { b } from "../../shell/data.js";\nimport type { C } from "@/shared/contract";\nimport react from "react";',
        },
      ],
      { aliases: { "@/": "" } },
    );
    expect(edges).toEqual<UnitEdge[]>([
      { importer: "views/list/row.tsx", specifier: "../../shell/data.js", from: "views", to: "shell", typeOnly: false },
      { importer: "views/list/row.tsx", specifier: "@/shared/contract", from: "views", to: "shared", typeOnly: true },
    ]);
  });
});

describe("layerViolations", () => {
  const layers: Layers = [["shared"], ["client", "components"], ["views"], ["shell"]];
  const edge = (from: string, to: string): UnitEdge => ({
    importer: `${from}/x.ts`,
    specifier: `../${to}/y.js`,
    from,
    to,
    typeOnly: false,
  });

  it("accepts imports that point strictly down, any number of layers", () => {
    expect(layerViolations([edge("shell", "views"), edge("shell", "shared"), edge("views", "client")], layers)).toEqual([]);
  });

  it("reports an import that points up", () => {
    expect(layerViolations([edge("views", "shell")], layers)).toEqual([{ kind: "upward", edge: edge("views", "shell") }]);
  });

  it("reports an import between two units of the same layer", () => {
    expect(layerViolations([edge("client", "components")], layers)).toEqual([
      { kind: "sideways", edge: edge("client", "components") },
    ]);
  });

  it("reports a unit no layer lists, naming that unit", () => {
    expect(layerViolations([edge("views", "mystery")], layers)).toEqual([
      { kind: "unlisted", unit: "mystery", edge: edge("views", "mystery") },
    ]);
    expect(layerViolations([edge("mystery", "shared")], layers)).toEqual([
      { kind: "unlisted", unit: "mystery", edge: edge("mystery", "shared") },
    ]);
  });

  it("formats one line per violation with importer, specifier and units", () => {
    const text = formatViolations(layerViolations([edge("views", "shell"), edge("views", "mystery")], layers));
    expect(text.split("\n")).toEqual([
      "views/x.ts → ../shell/y.js (views → shell): upward",
      "views/x.ts → ../mystery/y.js (views → mystery): unit not in any layer",
    ]);
  });
});

describe("bundledImports", () => {
  const file = (source: string) => [{ path: "Editor.tsx", source }];

  it("reports a value import from a third-party package", () => {
    expect(bundledImports(file('import { EditorView } from "@codemirror/view";'), HOST_SHIMMED)).toEqual([
      { file: "Editor.tsx", specifier: "@codemirror/view" },
    ]);
  });

  it("reports a side-effect and a dynamic import of a third-party package", () => {
    const source = 'import "some-lib/style.css";\nconst lazy = () => import("other-lib");';
    expect(bundledImports(file(source), HOST_SHIMMED).map((i) => i.specifier)).toEqual([
      "some-lib/style.css",
      "other-lib",
    ]);
  });

  it("a comment that says import type does not hide the value import below it", () => {
    const line = '// we use import type only here\nimport { EditorView } from "@codemirror/view";';
    const block = '/*\nimport type only\n*/\nimport { EditorView } from "@codemirror/view";';
    expect(bundledImports(file(line), HOST_SHIMMED).map((i) => i.specifier)).toEqual(["@codemirror/view"]);
    expect(bundledImports(file(block), HOST_SHIMMED).map((i) => i.specifier)).toEqual(["@codemirror/view"]);
  });

  it("does not report `import type` — the bundler erases it", () => {
    expect(bundledImports(file('import type * as Tabs from "@radix-ui/react-tabs";'), HOST_SHIMMED)).toEqual([]);
  });

  it("does not report a relative import", () => {
    expect(bundledImports(file('import { CodeEditor } from "../code-editor/index";'), HOST_SHIMMED)).toEqual([]);
  });

  it("does not report a specifier the host shims", () => {
    const source = 'import { useState } from "react";\nimport { toast } from "sonner";\nimport * as Dialog from "@radix-ui/react-dialog";\nimport { jsx } from "react/jsx-runtime";';
    expect(bundledImports(file(source), HOST_SHIMMED)).toEqual([]);
  });

  it("matches shimmed specifiers exactly — another subpath or a lookalike name is reported", () => {
    const source = 'import { renderToString } from "react-dom/server";\nimport x from "react-dom-extra";';
    expect(bundledImports(file(source), HOST_SHIMMED).map((i) => i.specifier)).toEqual([
      "react-dom/server",
      "react-dom-extra",
    ]);
  });

  it("does not know @radix-ui/react-tabs, CodeMirror or zod as shimmed", () => {
    expect(HOST_SHIMMED).not.toContain("@radix-ui/react-tabs");
    expect(HOST_SHIMMED).not.toContain("zod");
    expect(HOST_SHIMMED.some((name) => name.startsWith("@codemirror/"))).toBe(false);
  });
});
