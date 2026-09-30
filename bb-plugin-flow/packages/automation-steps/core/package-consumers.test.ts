import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseImportOutput, touchedPlugins, type ImportEdge } from "./package-consumers";

const plugin = (name: string, to: string): ImportEdge => ({ from: { kind: "plugin", name }, to });
const pkg = (name: string, to: string): ImportEdge => ({ from: { kind: "package", name }, to });

/** Вывод `git grep -z -o`: путь, NUL, найденный спецификатор; строки через перевод строки. */
const grepOutput = (...hits: readonly (readonly [string, string])[]): string => hits.map(([path, match]) => `${path}\0${match}`).join("\n") + "\n";

describe("parseImportOutput", () => {
  it("импорт пакета из кода плагина — ребро «плагин → пакет», в обоих видах пути", () => {
    expect(
      parseImportOutput(grepOutput(
        ["bb-plugin-flow/server/steps.ts", `"@bb-plugins/automation-steps`],
        ["bb-plugin-mail/app/view.tsx", `'../../packages/md-doc-view`],
        ["bb-plugin-mail/app/theme.css", `"../../packages/reduced-colors`],
      )),
    ).toEqual([plugin("flow", "automation-steps"), plugin("mail", "md-doc-view"), plugin("mail", "reduced-colors")]);
  });

  it("импорт пакета из кода другого пакета — ребро «пакет → пакет»", () => {
    expect(parseImportOutput(grepOutput(["packages/md-editor/index.ts", `"@bb-plugins/link-navigation`]))).toEqual([
      pkg("md-editor", "link-navigation"),
    ]);
  });

  it("путь с двоеточием и не из ASCII разбирается по NUL, а не по двоеточию", () => {
    expect(
      parseImportOutput(grepOutput(
        ["bb-plugin-flow/app/вид.tsx", `"@bb-plugins/viewport-clamp`],
        ["bb-plugin-flow/app/a:b.test.ts", `"@bb-plugins/layer-guard`],
      )),
    ).toEqual([plugin("flow", "viewport-clamp")]);
  });

  it("тесты, фикстуры, конфиги сборки, node_modules и dist не подключают пакет к бандлу", () => {
    expect(
      parseImportOutput(grepOutput(
        ["bb-plugin-flow/architecture.test.ts", `"../packages/layer-guard`],
        ["bb-plugin-flow/app/view.test.tsx", `"@bb-plugins/viewport-clamp`],
        ["bb-plugin-flow/test/helpers.ts", `"@bb-plugins/viewport-clamp`],
        ["bb-plugin-projects/src/core/__tests__/fixtures/graph.json", `"../packages/kasimov`],
        ["bb-plugin-projects/src/fixtures/graph.ts", `"@bb-plugins/kasimov`],
        ["bb-plugin-flow/vitest.config.ts", `"../packages/plugin-base`],
        ["bb-plugin-flow/tsconfig.json", `"../packages/plugin-base`],
        ["bb-plugin-md-opener/tsconfig.app.json", `"../packages/cellular-kit`],
        ["bb-plugin-flow/package.json", `"../packages/automation-steps`],
        ["bb-plugin-flow/node_modules/x/index.js", `"@bb-plugins/automation-steps`],
        ["bb-plugin-flow/dist/server.js", `"@bb-plugins/automation-steps`],
      )),
    ).toEqual([]);
  });

  it("строка вне плагина и пакета, пакет в себя, строка без NUL и пустой вывод отбрасываются", () => {
    expect(
      parseImportOutput(
        grepOutput(["docs/wiki/a.ts", `"@bb-plugins/automation-steps`], ["packages/automation-steps/steps.ts", `"@bb-plugins/automation-steps`]) +
          `bb-plugin-flow/server.ts:"@bb-plugins/automation-steps\n`,
      ),
    ).toEqual([]);
    expect(parseImportOutput("")).toEqual([]);
  });

  it("одно и то же ребро из разных файлов — одно ребро", () => {
    expect(
      parseImportOutput(grepOutput(
        ["bb-plugin-flow/server/a.ts", `"@bb-plugins/automation-steps`],
        ["bb-plugin-flow/server/b.ts", `"../packages/automation-steps`],
      )),
    ).toEqual([plugin("flow", "automation-steps")]);
  });
});

describe("touchedPlugins", () => {
  const edges = [
    plugin("flow", "automation-steps"),
    plugin("automations-builder", "automation-steps"),
    plugin("mail", "md-doc-view"),
    pkg("md-doc-view", "link-navigation"),
    plugin("tasks-plus", "link-navigation"),
  ];

  it("правка в каталоге плагина — сам плагин, как раньше", () => {
    expect(touchedPlugins(["bb-plugin-mail/app.tsx", "bb-plugin-flow/server.ts"], edges)).toEqual({
      direct: ["mail", "flow"],
      viaPackage: [],
    });
  });

  it("правка кода пакета — плагины, которые его собирают", () => {
    expect(touchedPlugins(["packages/automation-steps/core/catch-up.ts"], edges)).toEqual({
      direct: [],
      viaPackage: ["flow", "automations-builder"],
    });
  });

  it("пакет через другой пакет — его правка доходит до плагинов обоих", () => {
    expect(touchedPlugins(["packages/link-navigation/index.ts"], edges)).toEqual({
      direct: [],
      viaPackage: ["mail", "tasks-plus"],
    });
  });

  it("плагин, тронутый и напрямую, и через пакет, назван один раз — среди прямых", () => {
    expect(touchedPlugins(["bb-plugin-flow/app.tsx", "packages/automation-steps/steps.ts"], edges)).toEqual({
      direct: ["flow"],
      viaPackage: ["automations-builder"],
    });
  });

  it("документы, README и тесты пакета не трогают ни одного плагина", () => {
    expect(
      touchedPlugins(
        ["docs/INDEX.md", "packages/automation-steps/README.md", "packages/automation-steps/core/catch-up.test.ts", "packages/automation-steps/test/fixtures.ts"],
        edges,
      ),
    ).toEqual({ direct: [], viaPackage: [] });
  });

  it("правка тестового помощника, фикстуры или манифеста пакета не трогает ни одного плагина", () => {
    expect(
      touchedPlugins(
        [
          "packages/automation-steps/package.json",
          "packages/automation-steps/package-lock.json",
          "packages/automation-steps/tsconfig.json",
          "packages/automation-steps/__tests__/x.ts",
          "packages/automation-steps/fixtures/pr.json",
        ],
        edges,
      ),
    ).toEqual({ direct: [], viaPackage: [] });
  });

  it("пакет, который никто не собирает, не трогает ни одного плагина", () => {
    expect(touchedPlugins(["packages/layer-guard/index.ts"], edges)).toEqual({ direct: [], viaPackage: [] });
  });

  it("цикл импортов между пакетами не зацикливает расчёт", () => {
    const cyclic = [pkg("a", "b"), pkg("b", "a"), plugin("p", "a")];
    expect(touchedPlugins(["packages/b/x.ts"], cyclic)).toEqual({ direct: [], viaPackage: ["p"] });
  });

  it("плагины через пакет — ровно те, что достижимы по рёбрам, без повторов и без прямых", () => {
    const name = fc.constantFrom("a", "b", "c", "d");
    const edge = fc.oneof(
      fc.tuple(name, name).map(([from, to]) => pkg(from, to)),
      fc.tuple(fc.constantFrom("p", "q", "r"), name).map(([from, to]) => plugin(from, to)),
    );
    fc.assert(
      fc.property(fc.array(edge), fc.subarray(["a", "b", "c", "d"]), fc.subarray(["p", "q", "r"]), (graph, changed, own) => {
        const paths = [...changed.map((p) => `packages/${p}/index.ts`), ...own.map((p) => `bb-plugin-${p}/app.tsx`)];
        const { direct, viaPackage } = touchedPlugins(paths, graph);
        expect(direct).toEqual(own);
        expect(new Set(viaPackage).size).toBe(viaPackage.length);
        expect(viaPackage.filter((id) => direct.includes(id))).toEqual([]);
        const reach = new Set(changed);
        for (let grown = true; grown; ) {
          grown = false;
          for (const e of graph) if (e.from.kind === "package" && reach.has(e.to) && !reach.has(e.from.name)) (reach.add(e.from.name), (grown = true));
        }
        const expected = [...new Set(graph.filter((e) => e.from.kind === "plugin" && reach.has(e.to)).map((e) => e.from.name))].filter((id) => !own.includes(id));
        expect([...viaPackage].sort()).toEqual(expected.sort());
      }),
    );
  });
});
