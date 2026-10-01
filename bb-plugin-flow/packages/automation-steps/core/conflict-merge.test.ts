import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { conflictClass, mergeChangelog, mergeTaskFile, parseUnmerged, taskFolder } from "./conflict-merge";

const task = (header: string, body: string, comments: string[]) =>
  `---\n${header}\n---\n\n${body}\n\n## Comments\n${comments.map((c) => `\n${c}\n`).join("")}`;
const comment = (id: string, at: string, text: string) => `<!-- comment id="${id}" kind="agent" author="claude" at="${at}" -->\n${text}`;

describe("какие файлы слияние оставило в конфликте", () => {
  it("каждый код git status — свой вид, прочие строки пропущены", () => {
    const porcelain = ["UU a.ts", "AA b.md", "DU c.md", "UD d.md", "AU e.md", "UA f.md", "DD g.md", "M  h.ts", "?? i.ts"].join("\n");
    expect(parseUnmerged(porcelain)).toEqual([
      { path: "a.ts", kind: "both-modified" },
      { path: "b.md", kind: "both-added" },
      { path: "c.md", kind: "deleted-by-us" },
      { path: "d.md", kind: "deleted-by-them" },
      { path: "e.md", kind: "added-by-us" },
      { path: "f.md", kind: "added-by-them" },
      { path: "g.md", kind: "both-deleted" },
    ]);
  });

  it("файл задачи, пункт ченж-лога и остальное различаются по пути", () => {
    expect(conflictClass("docs/tasks/backlog/x.md")).toBe("task");
    expect(conflictClass("docs/tasks/in_progress/y.md")).toBe("task");
    expect(conflictClass("bb-plugin-flow/changelog/z.md")).toBe("changelog");
    expect(conflictClass("docs/architecture/bb-plugin-flow.md")).toBe("other");
    expect(conflictClass("docs/tasks/README.md")).toBe("other");
    expect(conflictClass("packages/x/changelog/z.md")).toBe("other");
  });
});

describe("сведение файла задачи", () => {
  const ours = task(
    "title: Старое название\nslug: x\ntype: feature\nestimate: l\ntaken_by:\n  machine: Mac\n  thread: thr_1\ntaken_by:\n  machine: Mac\n  thread: thr_1",
    "## Проблема\n\nТело ветки.",
    [comment("c1", "2026-10-01T10:00:00Z", "Первый"), comment("c3", "2026-10-01T12:00:00Z", "Ветка")],
  );
  const theirs = task("title: Новое название\nslug: x\ntype: feature\nestimate: m\nkey: BBPL-1\nparent: BBPL-0", "## Проблема\n\nТело main.", [
    comment("c1", "2026-10-01T10:00:00Z", "Первый"),
    comment("c2", "2026-10-01T11:00:00Z", "Main"),
  ]);
  const merged = mergeTaskFile({ ours, theirs });

  it("поля владельца и доски — из main, остальная шапка — из ветки", () => {
    expect(merged).toContain("title: Новое название");
    expect(merged).toContain("key: BBPL-1");
    expect(merged).toContain("parent: BBPL-0");
    expect(merged).toContain("estimate: l");
  });

  it("повторы ключей шапки схлопываются", () => {
    expect(merged.match(/^taken_by:/gm)).toHaveLength(1);
    expect(merged.match(/^slug:/gm)).toHaveLength(1);
  });

  it("тело — из ветки, комментарии обеих сторон по одному разу и по времени", () => {
    expect(merged).toContain("Тело ветки.");
    expect(merged).not.toContain("Тело main.");
    const ids = [...merged.matchAll(/comment id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });

  it("свойство: ни один комментарий не теряется, ни один ключ шапки не повторяется", () => {
    const id = fc.stringMatching(/^[a-z0-9]{1,6}$/);
    fc.assert(
      fc.property(fc.uniqueArray(id, { maxLength: 5 }), fc.uniqueArray(id, { maxLength: 5 }), (left, right) => {
        const at = (i: number) => `2026-10-01T10:00:${String(i).padStart(2, "0")}Z`;
        const result = mergeTaskFile({
          ours: task("slug: x\nslug: x\ntype: feature", "Тело.", left.map((c, i) => comment(c, at(i), c))),
          theirs: task("slug: x\nkey: K-1", "Тело.", right.map((c, i) => comment(c, at(i), c))),
        });
        const ids = [...result.matchAll(/comment id="([^"]+)"/g)].map((m) => m[1]);
        expect(new Set(ids)).toEqual(new Set([...left, ...right]));
        expect(ids).toHaveLength(new Set([...left, ...right]).size);
        const keys = [...result.split("---")[1]!.matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
        expect(keys).toHaveLength(new Set(keys).size);
      }),
    );
  });
});

describe("папка сведённой задачи", () => {
  it("папка — из ветки", () => {
    expect(taskFolder({ oursFolder: "in_progress", theirsFolder: "backlog" })).toBe("in_progress");
  });

  it("отмена в main побеждает", () => {
    expect(taskFolder({ oursFolder: "in_progress", theirsFolder: "canceled" })).toBe("canceled");
  });
});

describe("сведение пункта ченж-лога", () => {
  const entry = (version: string, items: string[]) => `---\nversion: ${version}\n---\n\n${items.join("\n")}\n`;
  const a = "- ru: Первое\n  en: First";
  const b = "- ru: Второе\n  en: Second";

  it("проставленный в main файл остаётся, новый пункт ветки уходит в новый файл", () => {
    const result = mergeChangelog({ base: entry("coming-soon", [a]), ours: entry("coming-soon", [a, b]), theirs: "---\nversion: 0.6.70\ndate: 2026-10-01\npr: 600\n---\n\n- ru: Первое\n  en: First\n" });
    expect(result.keep).toContain("version: 0.6.70");
    expect(result.keep).not.toContain("Второе");
    expect(result.extra).toBe(entry("coming-soon", [b]));
  });

  it("нового в ветке нет — нового файла нет", () => {
    const result = mergeChangelog({ base: entry("coming-soon", [a]), ours: entry("coming-soon", [a]), theirs: entry("0.6.70", [a]) });
    expect(result.extra).toBeNull();
  });

  it("обе стороны без версии — один файл с пунктами обеих", () => {
    const result = mergeChangelog({ base: entry("coming-soon", [a]), ours: entry("coming-soon", [a, b]), theirs: entry("coming-soon", [a, "- ru: Третье\n  en: Third"]) });
    expect(result.keep).toBe(entry("coming-soon", [a, b, "- ru: Третье\n  en: Third"]));
    expect(result.extra).toBeNull();
  });

  it("проставлена ветка, а main без версии — история ветки остаётся, пункт main уходит в новый файл", () => {
    const result = mergeChangelog({ base: null, ours: entry("0.6.71", [a]), theirs: entry("coming-soon", [b]) });
    expect(result.keep).toBe(entry("0.6.71", [a]));
    expect(result.extra).toBe(entry("coming-soon", [b]));
  });
});
