import { describe, expect, it } from "vitest";

import { baselineOf, compareBaseline, formatReport, styleViolations, type Violation } from "./core.js";

const rules = (path: string, source: string) => styleViolations({ path, source }).map((v) => [v.line, v.rule]);

describe("свои стили в исходнике", () => {
  it("инлайн-стиль, тег style и самодельные контролы в .tsx — с номером строки", () => {
    const source = ['<div style={{ width: 4 }} />', "<style>{css}</style>", "<button onClick={go}>Да</button>", '<input value={v} />', "<select>", "<textarea />"].join("\n");
    expect(rules("app/a.tsx", source)).toEqual([
      [1, "inline-style"],
      [2, "style-tag"],
      [3, "raw-control"],
      [4, "raw-control"],
      [5, "raw-control"],
      [6, "raw-control"],
    ]);
  });

  it("тег на отдельной строке, как его ставит форматтер, — тоже самодельный контрол", () => {
    expect(rules("app/e.tsx", ["<button", '  type="button"', ">", "<input", "  value={v}", "/>"].join("\n"))).toEqual([
      [1, "raw-control"],
      [4, "raw-control"],
    ]);
  });

  it("произвольное значение Tailwind в квадратных скобках — и значение, и свойство, и вариант", () => {
    const source = ['className="w-[13px] px-2"', 'const WIDE = "[&_.sgc-track]:w-full!";', 'cn("max-h-36 [field-sizing:content]")', 'className="hover:bg-[#fff]"'].join("\n");
    expect(rules("app/b.tsx", source)).toEqual([
      [1, "arbitrary-value"],
      [2, "arbitrary-value"],
      [3, "arbitrary-value"],
      [4, "arbitrary-value"],
    ]);
  });

  it("готовые классы, типы-массивы, индексы и комментарии не нарушение", () => {
    const source = [
      'className="flex gap-2 rounded-md bg-secondary text-xs"',
      "const list: string[] = items[0];",
      "type R = { [key: string]: number };",
      "// пример: style={{ width: 4 }} и w-[13px]",
      " * <button> в комментарии",
      '<Button variant="ghost" size="icon" />',
    ].join("\n");
    expect(rules("app/c.tsx", source)).toEqual([]);
  });

  it("в .ts проверяются только классы: разметки там нет", () => {
    expect(rules("app/d.ts", 'const a = "<button"; const b = "w-[2px]";')).toEqual([[1, "arbitrary-value"]]);
  });

  it("каждый блок правил в .css — нарушение", () => {
    expect(rules("app/theme.css", "/* токены */\n.a { color: red; }\n.dark .a {\n  color: blue;\n}")).toEqual([
      [2, "css-rule"],
      [3, "css-rule"],
    ]);
  });
});

const found: Violation[] = [
  { path: "app/a.tsx", line: 3, rule: "raw-control", text: "<button>" },
  { path: "app/a.tsx", line: 9, rule: "raw-control", text: "<button>" },
  { path: "app/b.tsx", line: 1, rule: "inline-style", text: "style={" },
];

describe("сравнение со списком нынешних нарушений", () => {
  it("список, снятый с находок, с ними сходится", () => {
    expect(compareBaseline(found, baselineOf(found))).toEqual({ added: [], stale: [] });
  });

  it("нарушений больше записанного — новые названы со строками", () => {
    const { added } = compareBaseline(found, { "app/a.tsx": { "raw-control": 1 }, "app/b.tsx": { "inline-style": 1 } });
    expect(added).toEqual([{ path: "app/a.tsx", rule: "raw-control", allowed: 1, found: [found[0], found[1]] }]);
  });

  it("нарушений меньше записанного или их нет совсем — запись пора уменьшить", () => {
    const { stale } = compareBaseline(found.slice(0, 1), { "app/a.tsx": { "raw-control": 2 }, "app/gone.tsx": { "css-rule": 1 } });
    expect(stale).toEqual([
      { path: "app/a.tsx", rule: "raw-control", allowed: 2, count: 1 },
      { path: "app/gone.tsx", rule: "css-rule", allowed: 1, count: 0 },
    ]);
  });

  it("отчёт пуст без расхождений и называет файл, строку и правило, когда они есть", () => {
    expect(formatReport({ added: [], stale: [] })).toBe("");
    const report = formatReport(compareBaseline(found, {}));
    expect(report).toContain("app/a.tsx:3 raw-control");
    expect(report).toContain("app/b.tsx:1 inline-style");
  });
});
