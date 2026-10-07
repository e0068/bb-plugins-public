// @vitest-environment node
// Папка синхронизации — одна плоская папка: каждый flow файлом `<Имя>.flow.json` в корне, вложенный — рядом с тем, кто на
// него ссылается. Старая раскладка папками читается в ту же коллекцию, а запись поверх неё убирает вложенные файлы.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { Flow, FlowSettings, WorkStage } from "../shared/contract";
import { SETTINGS_FILE, fromFlowFiles, planWrite, toFlowFiles, type CollectionFile, type FolderFlow } from "./flow-files";

const skill = (id: string): WorkStage => ({ id, kind: "skill", skill: "code", name: id, executors: [] });
const nested = (id: string, flowId: string): WorkStage => ({ id, kind: "skill", skill: "", name: "Nested", executors: [], flowId });
const flow = (id: string, name: string, stages: WorkStage[] = [skill("work")]): Flow => ({ id, name, stages: [builtinStage("questions", []), ...stages] });
const collection = (flows: Flow[]): FlowSettings => ({ version: 2, flows, minButtonWidth: 160 });
/** Flow с иконкой: поле `icon` появляется в схеме этой подзадачей. */
const withIcon = (f: Flow, icon: string) => ({ ...f, icon }) as Flow;

const paths = (settings: FlowSettings) => toFlowFiles(settings).map((f) => f.path);
const settingsFile = (settings: FlowSettings): CollectionFile => JSON.parse(toFlowFiles(settings).find((f) => f.path === SETTINGS_FILE)!.text);
/** Текст файла flow по имени — где бы его ни положила раскладка. */
const flowText = (settings: FlowSettings, name: string): string => toFlowFiles(settings).find((f) => f.path.split("/").at(-1) === `${name}.flow.json`)!.text;

const code = flow("flow-code", "Code", [skill("work"), nested("review-row", "flow-review")]);
const review = flow("flow-review", "Review", [skill("check"), nested("lint-row", "flow-lint")]);
const lint = flow("flow-lint", "Lint");
const settings = collection([code, review, lint]);

/** Та же коллекция, разложенная старой раскладкой: вложенный flow — папкой рядом с тем, кто ссылается. */
const OLD_LAYOUT: ReadonlyArray<[string, string]> = [
  ["Code", "Code.flow.json"],
  ["Review", "Review/Review.flow.json"],
  ["Lint", "Review/Lint/Lint.flow.json"],
];
const oldFiles = (): Map<string, string> =>
  new Map([[SETTINGS_FILE, toFlowFiles(settings).find((f) => f.path === SETTINGS_FILE)!.text], ...OLD_LAYOUT.map(([name, path]): [string, string] => [path, flowText(settings, name)])]);

describe("плоская папка синхронизации", () => {
  it("вложенный flow ложится файлом в корень, рядом с тем, кто на него ссылается", () => {
    expect(paths(settings)).toEqual([SETTINGS_FILE, "Code.flow.json", "Review.flow.json", "Lint.flow.json"]);
  });

  it("ни один путь не содержит `/`, кроме `settings.json`-уровня", () => {
    const arb = fc
      .uniqueArray(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,7}$/), { minLength: 1, maxLength: 5, selector: (s) => s.toLowerCase() })
      .chain((names) => fc.tuple(fc.constant(names), fc.array(fc.tuple(fc.nat(names.length - 1), fc.nat(names.length - 1)), { maxLength: 8 })))
      .map(([names, links]) => {
        // Ссылки в любую сторону, циклы тоже: раскладка плоская при любой вложенности.
        const refs = (i: number) => [...new Set(links.filter(([from, to]) => from === i && to !== i).map(([, to]) => to))];
        return collection(names.map((name, i) => flow(`id-${i}`, name, [skill("work"), ...refs(i).map((to) => nested(`row-${to}`, `id-${to}`))])));
      });
    fc.assert(
      fc.property(arb, (generated) => {
        const written = paths(generated);
        expect(written.filter((path) => path.includes("/"))).toEqual([]);
        expect(written).toHaveLength(generated.flows.length + 1);
      }),
    );
  });

  it("иконка flow переживает запись и чтение", () => {
    const withIcons = collection([withIcon(code, "Rocket"), review, withIcon(lint, "Bug01")]);
    const files = toFlowFiles(withIcons);
    const flows: FolderFlow[] = files.filter((f) => f.path !== SETTINGS_FILE).map((f) => ({ path: f.path, flow: JSON.parse(f.text) }));
    expect(fromFlowFiles(flows, settingsFile(withIcons), withIcons)).toEqual({ kind: "ok", settings: withIcons });
  });

  it("старая вложенная раскладка читается в ту же коллекцию", () => {
    const old = oldFiles();
    const flows: FolderFlow[] = OLD_LAYOUT.map(([, path]) => ({ path, flow: JSON.parse(old.get(path)!) }));
    const result = fromFlowFiles(flows, JSON.parse(old.get(SETTINGS_FILE)!), settings);
    expect(result).toEqual({ kind: "ok", settings });
    // Прочитанная коллекция ложится обратно уже плоско.
    if (result.kind === "ok") expect(paths(result.settings).filter((path) => path.includes("/"))).toEqual([]);
  });

  it("запись поверх старой вложенной раскладки убирает вложенные файлы", () => {
    const old = oldFiles();
    const wanted = new Map(toFlowFiles(settings).map((f): [string, string] => [f.path, f.text]));
    const plan = planWrite(wanted, old, old);
    expect(plan.removes).toEqual(["Review/Lint/Lint.flow.json", "Review/Review.flow.json"]);
    expect(plan.writes).toEqual([
      ["Lint.flow.json", flowText(settings, "Lint")],
      ["Review.flow.json", flowText(settings, "Review")],
    ]);
    expect(plan.kept).toEqual([]);
  });

  it("копии одного flow в старой и новой раскладке разошлись — ошибка с путями копий", () => {
    const lintFile = (description: string) => ({ name: "Lint", description, stages: [] });
    const files: FolderFlow[] = [
      { path: "Lint/Lint.flow.json", flow: lintFile("one") },
      { path: "Review/Lint/Lint.flow.json", flow: lintFile("two") },
    ];
    expect(fromFlowFiles(files, null, settings)).toEqual({ kind: "error", message: expect.stringContaining("Lint/Lint.flow.json") });
  });
});
