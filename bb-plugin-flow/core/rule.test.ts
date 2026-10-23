// @vitest-environment node
import { describe, expect, it } from "vitest";

import * as fc from "fast-check";

import { appended, editedRule, occurrences, placeLabelOf, proposalIssues, replaced, ruleDiff, ruleTargetIssue, skillNameOf } from "./rule";

const HOME = "/Users/me";
const MEMORY = `${HOME}/.claude/projects/-Users-me-repo/memory`;

describe("куда можно писать правило", () => {
  it("память — файл .md в папке memory проекта", () => {
    expect(ruleTargetIssue({ kind: "memory", path: `${MEMORY}/rule.md` }, HOME)).toBeNull();
    expect(ruleTargetIssue({ kind: "memory", path: `${HOME}/.claude/projects/x/rule.md` }, HOME)).toMatch(/memory/);
    expect(ruleTargetIssue({ kind: "memory", path: `${MEMORY}/rule.txt` }, HOME)).toMatch(/\.md/);
  });

  it("навык — файл .md внутри папки навыка, где бы она ни лежала в домашней папке", () => {
    expect(ruleTargetIssue({ kind: "skill", path: `${HOME}/.claude/skills/prototype/SKILL.md` }, HOME)).toBeNull();
    expect(ruleTargetIssue({ kind: "skill", path: `${HOME}/repo/bb-plugin-flow/skills/flow-demo/ru.md` }, HOME)).toBeNull();
    expect(ruleTargetIssue({ kind: "skill", path: `${HOME}/repo/skills/README.md` }, HOME)).toMatch(/skills/);
  });

  it("выход наверх, относительный путь и чужая домашняя папка отбиваются", () => {
    expect(ruleTargetIssue({ kind: "memory", path: `${MEMORY}/../../../../.zshrc.md` }, HOME)).toMatch(/clean/);
    expect(ruleTargetIssue({ kind: "skill", path: "skills/x/SKILL.md" }, HOME)).toMatch(/clean/);
    expect(ruleTargetIssue({ kind: "skill", path: "/Users/other/.claude/skills/x/SKILL.md" }, HOME)).toMatch(/home/);
  });
});

describe("предложение", () => {
  const base = { text: "Правило", why: "потому", target: { kind: "memory" as const, path: `${MEMORY}/rule.md` }, mode: "create" as const, content: "# Правило\n", similar: [] };

  it("текст обязан стоять в записи дословно, оглавление — только у нового файла памяти, MEMORY.md — не цель", () => {
    expect(proposalIssues(base, HOME)).toEqual([]);
    expect(proposalIssues({ ...base, content: "другое" }, HOME)).toHaveLength(1);
    expect(proposalIssues({ ...base, mode: "append", index: "- [x](x.md)" }, HOME)).toHaveLength(1);
    expect(proposalIssues({ ...base, target: { kind: "memory", path: `${MEMORY}/MEMORY.md` }, content: "Правило" }, HOME)).toHaveLength(1);
  });

  it("кусок для замены — только у замены и обязателен у неё", () => {
    expect(proposalIssues({ ...base, mode: "replace", replaces: "старое" }, HOME)).toEqual([]);
    expect(proposalIssues({ ...base, mode: "replace", replaces: "  " }, HOME)).toHaveLength(1);
    expect(proposalIssues({ ...base, mode: "append", replaces: "старое" }, HOME)).toHaveLength(1);
  });
});

describe("запись", () => {
  it("правка владельца меняет текст правила в записи и в оглавлении", () => {
    expect(editedRule({ text: "А", content: "x А y А", index: "- А" }, "Б")).toEqual({ content: "x Б y Б", index: "- Б" });
    expect(editedRule({ text: "А", content: "А" }, "Б")).toEqual({ content: "Б", index: undefined });
  });

  it("дописанное встаёт с новой строки и кончается переводом строки", () => {
    expect(appended("a", "b")).toBe("a\nb\n");
    expect(appended("a\n", "b\n")).toBe("a\nb\n");
    expect(appended("", "b")).toBe("b\n");
  });

  it("дифф нового файла памяти — сам файл и строка оглавления рядом", () => {
    const diff = ruleDiff({ target: { kind: "memory", path: `${MEMORY}/rule.md` }, mode: "create", content: "a\nb\n", index: "- [r](rule.md)" });
    expect(diff).toEqual([
      { path: `${MEMORY}/rule.md`, isNew: true, removed: [], lines: ["a", "b"] },
      { path: `${MEMORY}/MEMORY.md`, isNew: false, removed: [], lines: ["- [r](rule.md)"] },
    ]);
  });

  it("дифф замены — строки, которые уйдут, и строки, которые встанут", () => {
    expect(ruleDiff({ target: { kind: "skill", path: `${HOME}/.claude/skills/x/SKILL.md` }, mode: "replace", replaces: "старое\nещё\n", content: "новое" })).toEqual([
      { path: `${HOME}/.claude/skills/x/SKILL.md`, isNew: false, removed: ["старое", "ещё"], lines: ["новое"] },
    ]);
  });

  it("замена меняет ровно один кусок и не трогает остальное; кусок не один или его нет — null", () => {
    expect(replaced("a\nстарое\nb\n", "старое\n", "новое")).toBe("a\nновое\nb\n");
    expect(replaced("x $& y", "$&", "$'")).toBe("x $' y");
    expect(replaced("aa", "a", "b")).toBeNull();
    expect(replaced("a", "", "b")).toBeNull();
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), fc.string(), fc.string(), (head, fragment, tail, content) => {
        const source = `${head}${fragment}${tail}`;
        const result = replaced(source, fragment, content);
        if (occurrences(source, fragment) !== 1) return result === null;
        return result !== null && result.startsWith(head) && result.endsWith(tail) && result.includes(content);
      }),
    );
  });
});

describe("подпись места", () => {
  it("у навыка — папка навыка и путь внутри, у памяти — имя файла", () => {
    expect(placeLabelOf(`${HOME}/.claude/skills/prototype/SKILL.md`)).toBe("prototype/SKILL.md");
    expect(placeLabelOf(`${HOME}/repo/bb-plugin-flow/skills/flow-demo/ru.md`)).toBe("flow-demo/ru.md");
    expect(placeLabelOf(`${MEMORY}/demo-links.md`)).toBe("demo-links.md");
    expect(skillNameOf(`${HOME}/.claude/skills/prototype/SKILL.md`)).toBe("prototype");
    expect(skillNameOf(`${MEMORY}/demo-links.md`)).toBeUndefined();
  });
});
