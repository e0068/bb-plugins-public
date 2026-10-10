// Коллекция flow ⇄ файлы папки синхронизации: раскладка по ссылкам, обратная
// сборка, имена файлов и свободные имена.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { Flow, FlowSettings, WorkStage } from "../shared/contract";
import {
  SETTINGS_FILE,
  duplicateFlowName,
  flowFileName,
  freeFlowName,
  fromFlowFiles,
  planWrite,
  toFlowFiles,
  withLocalFlows,
  withUniqueNames,
  type CollectionFile,
  type FolderFlow,
} from "./flow-files";

const skill = (id: string): WorkStage => ({ id, kind: "skill", skill: "code", name: id, executors: [] });
const nested = (id: string, flowId: string): WorkStage => ({ id, kind: "skill", skill: "", name: "Nested", executors: [], flowId });
const flow = (id: string, name: string, stages: WorkStage[] = [skill("work")]): Flow => ({ id, name, stages: [builtinStage("questions", []), ...stages] });
const collection = (flows: Flow[], rest: Partial<FlowSettings> = {}): FlowSettings => ({ version: 2, flows, minButtonWidth: 160, ...rest });

/** Файлы папки так, как их прочла бы оболочка: JSON разобран, `settings.json` отдельно. */
const read = (settings: FlowSettings): { flows: FolderFlow[]; collection: CollectionFile } => {
  const files = toFlowFiles(settings);
  return {
    flows: files.filter((f) => f.path !== SETTINGS_FILE).map((f) => ({ path: f.path, flow: JSON.parse(f.text) })),
    collection: JSON.parse(files.find((f) => f.path === SETTINGS_FILE)!.text),
  };
};

const assemble = (settings: FlowSettings, local: FlowSettings = settings) => {
  const { flows, collection: c } = read(settings);
  return fromFlowFiles(flows, c, local);
};

const paths = (settings: FlowSettings) => toFlowFiles(settings).map((f) => f.path);

const code = flow("flow-code", "Code", [skill("work"), nested("review-row", "flow-review")]);
const review = flow("flow-review", "Review", [skill("check"), nested("lint-row", "flow-lint")]);
const lint = flow("flow-lint", "Lint");

describe("раскладка коллекции по файлам", () => {
  it("flow без ссылок на него — файл в корне, общее — settings.json", () => {
    expect(paths(collection([flow("a", "General"), flow("b", "Bug")]))).toEqual([SETTINGS_FILE, "General.flow.json", "Bug.flow.json"]);
  });

  it("ссылка в файле — по имени, id flow в файл не пишутся", () => {
    const text = toFlowFiles(collection([code, review, lint])).find((f) => f.path === "Code.flow.json")!.text;
    expect(text).toContain('"flow": "Review"');
    expect(text).not.toContain("flow-review");
    expect(text).not.toContain("flow-code");
  });

  it("порядок flow и общее на коллекцию — в settings.json", () => {
    const { collection: c } = read(collection([lint, code, review], { retryInSeconds: 30 }));
    expect(c.order).toEqual(["Lint", "Code", "Review"]);
    expect(c.retryInSeconds).toBe(30);
  });

  it("одна и та же коллекция даёт те же байты, в каком бы порядке ни шли ключи", () => {
    const shuffled: Flow = { stages: code.stages.map((s) => Object.fromEntries(Object.entries(s).reverse()) as WorkStage), name: code.name, id: code.id };
    expect(toFlowFiles(collection([shuffled, review, lint]))).toEqual(toFlowFiles(collection([code, review, lint])));
  });

  it("цикл ссылок не вешает раскладку, и каждый flow попадает в папку", () => {
    const a = flow("a", "A", [nested("to-b", "b")]);
    const b = flow("b", "B", [nested("to-a", "a")]);
    const files = paths(collection([a, b]));
    expect(files.some((p) => p.endsWith("A.flow.json"))).toBe(true);
    expect(files.some((p) => p.endsWith("B.flow.json"))).toBe(true);
  });
});

describe("сборка коллекции из файлов", () => {
  it("папка, записанная из коллекции, собирается обратно в неё же", () => {
    const settings = collection([code, review, lint], { retryInSeconds: 30, retryAttempts: 2 });
    expect(assemble(settings)).toEqual({ kind: "ok", settings });
  });

  it("описание «Без flow» живёт в settings.json и возвращается из папки", () => {
    const settings = collection([code, review, lint], { noFlowDescription: "Вопросы без правок" });
    expect(read(settings).collection.noFlowDescription).toBe("Вопросы без правок");
    expect(assemble(settings)).toEqual({ kind: "ok", settings });
  });

  it("свойство: любая коллекция без циклов возвращается из своих файлов", () => {
    const arb = fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim() === s && s !== "" && !/[./\\:*?"<>|\u0000-\u001f]/.test(s)), { minLength: 1, maxLength: 5, selector: (s) => s.toLowerCase() })
      .chain((names) =>
        fc.tuple(fc.constant(names), fc.array(fc.tuple(fc.nat(names.length - 1), fc.nat(names.length - 1)), { maxLength: 6 })),
      )
      .map(([names, links]) => {
        // Ссылка только вперёд по списку — циклов нет.
        const refs = (i: number) => [...new Set(links.filter(([from, to]) => from === i && to > i).map(([, to]) => to))];
        return collection(names.map((name, i) => flow(`id-${i}`, name, [skill("work"), ...refs(i).map((to) => nested(`row-${to}`, `id-${to}`))])));
      });
    fc.assert(fc.property(arb, (settings) => {
      expect(assemble(settings)).toEqual({ kind: "ok", settings });
    }));
  });

  it("flow с именем местного flow получает его id, новое имя — id из имени, один и тот же на любом компе", () => {
    const local = collection([flow("local-review", "review")]);
    const result = assemble(collection([code, review, lint]), local);
    if (result.kind !== "ok") throw new Error(result.message);
    const ids = Object.fromEntries(result.settings.flows.map((f) => [f.name, f.id]));
    expect(ids.Review).toBe("local-review");
    expect(ids.Code).toMatch(/^flow-/);
    const again = assemble(collection([code, review, lint]), collection([flow("x", "X")]));
    if (again.kind !== "ok") throw new Error(again.message);
    expect(again.settings.flows.find((f) => f.name === "Code")!.id).toBe(ids.Code);
  });

  it("ссылка на flow, файла которого нет, — ошибка, а не неполная коллекция", () => {
    const { flows, collection: c } = read(collection([code, review, lint]));
    const result = fromFlowFiles(flows.filter((f) => !f.path.endsWith("Lint.flow.json")), c, collection([lint]));
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toContain("Lint");
  });

  it("без settings.json порядок — по путям, общее — местное", () => {
    const { flows } = read(collection([flow("b", "Bug"), flow("a", "Answer")]));
    const result = fromFlowFiles(flows, null, collection([flow("z", "Z")], { retryInSeconds: 5 }));
    if (result.kind !== "ok") throw new Error(result.message);
    expect(result.settings.flows.map((f) => f.name)).toEqual(["Answer", "Bug"]);
    expect(result.settings.retryInSeconds).toBe(5);
  });

  it("flow, которого нет в порядке settings.json, встаёт в конец", () => {
    const { flows, collection: c } = read(collection([flow("a", "A"), flow("b", "B")]));
    const result = fromFlowFiles([...flows, { path: "Shared.flow.json", flow: { name: "Shared", stages: [] } }], c, collection([flow("a", "A")]));
    if (result.kind !== "ok") throw new Error(result.message);
    expect(result.settings.flows.map((f) => f.name)).toEqual(["A", "B", "Shared"]);
  });

  it("шаблон этапа со строкой «Flow» ссылается по имени и собирается обратно", () => {
    const settings = collection([code, review, lint], { stageTemplates: [{ kind: "skill", skill: "", name: "Review", executors: [], flowId: "flow-review" }] });
    expect(read(settings).collection.stageTemplates).toEqual([{ executors: [], flow: "Review", kind: "skill", name: "Review", skill: "" }]);
    expect(assemble(settings)).toEqual({ kind: "ok", settings });
  });

  it("пустая папка — ошибка: собирать нечего", () => {
    expect(fromFlowFiles([], null, collection([lint])).kind).toBe("error");
  });
});

describe("первая встреча с папкой", () => {
  it("местные flow с именами, которых в папке нет, дописываются в конец; одноимённые берутся из папки", () => {
    const disk = collection([flow("d-code", "Code", [skill("from-disk")])]);
    const local = collection([flow("l-code", "Code", [skill("local")]), flow("l-mine", "Mine")]);
    const merged = withLocalFlows(disk, local);
    expect(merged.flows.map((f) => [f.id, f.name])).toEqual([["d-code", "Code"], ["l-mine", "Mine"]]);
    expect(merged.flows[0]!.stages.map((s) => s.id)).toContain("from-disk");
  });
});

describe("имена flow", () => {
  it("имя файла — без символов, недопустимых в файловой системе, и без краевых точек и пробелов", () => {
    expect(flowFileName("A/B: C?")).toBe("A-B- C-");
    expect(flowFileName(" .Hidden. ")).toBe("Hidden");
    expect(flowFileName("...")).toBe("flow");
  });

  it("свободное имя — следующее по номеру", () => {
    expect(freeFlowName([flow("a", "Новый flow")], "Новый flow")).toBe("Новый flow 2");
    expect(freeFlowName([flow("a", "Новый flow"), flow("b", "новый flow 2")], "Новый flow")).toBe("Новый flow 3");
    expect(freeFlowName([flow("a", "Other")], "Новый flow")).toBe("Новый flow");
  });

  it("повтор имени без учёта регистра и после замены символов найден", () => {
    expect(duplicateFlowName([flow("a", "Code"), flow("b", "code")])).toBe("code");
    expect(duplicateFlowName([flow("a", "A/B"), flow("b", "A:B")])).toBe("A:B");
    expect(duplicateFlowName([flow("a", "A"), flow("b", "B")])).toBeNull();
  });

  it("повторы имён в коллекции получают номера, уникальные имена не трогаются", () => {
    const fixed = withUniqueNames(collection([flow("a", "Code"), flow("b", "code"), flow("c", "Bug")]));
    expect(fixed.flows.map((f) => f.name)).toEqual(["Code", "code 2", "Bug"]);
    const clean = collection([flow("a", "A")]);
    expect(withUniqueNames(clean)).toBe(clean);
  });
});

describe("запись в папку против последней сверки", () => {
  const m = (entries: Record<string, string>) => new Map(Object.entries(entries));

  it("папка не менялась с последней сверки — пишется своё, лишнее убирается", () => {
    expect(planWrite(m({ "A.flow.json": "a2", "B.flow.json": "b" }), m({ "A.flow.json": "a1", "Old.flow.json": "o" }), m({ "A.flow.json": "a1", "Old.flow.json": "o" }))).toEqual({
      writes: [["A.flow.json", "a2"], ["B.flow.json", "b"]],
      removes: ["Old.flow.json"],
      kept: [],
    });
  });

  it("файл, которого не было при последней сверке, — чужой: не убирается и не переписывается", () => {
    const plan = planWrite(m({ "A.flow.json": "a" }), m({ "A.flow.json": "a", "New.flow.json": "n", "settings.json": "чужой" }), m({ "A.flow.json": "a" }));
    expect(plan.removes).toEqual([]);
    expect(plan.writes).toEqual([]);
    expect(plan.kept).toEqual(["New.flow.json", "settings.json"]);
  });

  it("файл поменял другой комп, а своя коллекция его не меняла, — остаётся чужая правка", () => {
    expect(planWrite(m({ "A.flow.json": "a1" }), m({ "A.flow.json": "theirs" }), m({ "A.flow.json": "a1" }))).toEqual({ writes: [], removes: [], kept: ["A.flow.json"] });
  });

  it("правка с обеих сторон — выигрывает своё последнее сохранение; правка сильнее удаления с любой стороны", () => {
    expect(planWrite(m({ "A.flow.json": "mine" }), m({ "A.flow.json": "theirs" }), m({ "A.flow.json": "a1" })).writes).toEqual([["A.flow.json", "mine"]]);
    expect(planWrite(m({}), m({ "A.flow.json": "theirs" }), m({ "A.flow.json": "a1" }))).toEqual({ writes: [], removes: [], kept: ["A.flow.json"] });
    expect(planWrite(m({ "A.flow.json": "mine" }), m({}), m({ "A.flow.json": "a1" })).writes).toEqual([["A.flow.json", "mine"]]);
  });

  it("переименование только регистром — старое имя убирается, новое пишется", () => {
    expect(planWrite(m({ "Code.flow.json": "c" }), m({ "code.flow.json": "c" }), m({ "code.flow.json": "c" }))).toEqual({ writes: [["Code.flow.json", "c"]], removes: ["code.flow.json"], kept: [] });
  });
});
