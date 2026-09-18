import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { choosePrTitle, type TitleSources } from "./pr-title";

const nothing: TitleSources = {
  task: null,
  threadName: null,
  commitSubjects: [],
  branch: "bb/thr_5mq92u8px2",
};

describe("choosePrTitle", () => {
  it("a linked task wins over everything else: key then title", () => {
    expect(
      choosePrTitle({
        ...nothing,
        task: { key: "BP-189", title: "Pull Request — осмысленные названия" },
        threadName: "Хочу, чтобы коммиты назывались...",
        commitSubjects: ["release: команда релиза"],
      }),
    ).toBe("BP-189 Pull Request — осмысленные названия");
  });

  it("a task with no title degrades to its key alone, without a dangling space", () => {
    expect(choosePrTitle({ ...nothing, task: { key: "BP-189", title: "" } })).toBe("BP-189");
  });

  it("a task with neither key nor title is not a source at all — the next one is used", () => {
    expect(choosePrTitle({ ...nothing, task: { key: "", title: " " }, threadName: "Тред" })).toBe(
      "Тред",
    );
  });

  it("no task → the thread's name", () => {
    expect(
      choosePrTitle({ ...nothing, threadName: "Тред", commitSubjects: ["release: релиз"] }),
    ).toBe("Тред");
  });

  it("a blank thread name is not a name — the single commit's subject is used", () => {
    expect(
      choosePrTitle({ ...nothing, threadName: "   ", commitSubjects: ["release: релиз"] }),
    ).toBe("release: релиз");
  });

  it("several commits name nothing on their own — the branch is used", () => {
    expect(choosePrTitle({ ...nothing, commitSubjects: ["первый", "второй"] })).toBe(
      "bb/thr_5mq92u8px2",
    );
  });

  it("no source at all → the branch, as before", () => {
    expect(choosePrTitle(nothing)).toBe("bb/thr_5mq92u8px2");
  });

  it("the title is one line: newlines and runs of spaces collapse", () => {
    expect(choosePrTitle({ ...nothing, threadName: " Панель\nформатирования \t треда " })).toBe(
      "Панель форматирования треда",
    );
  });

  it("law: with a non-blank branch the title is never blank and never multi-line", () => {
    const blankable = fc.oneof(fc.constant(null), fc.string());
    fc.assert(
      fc.property(
        fc.record({
          task: fc.oneof(
            fc.constant(null),
            fc.record({ key: fc.string(), title: fc.string() }),
          ),
          threadName: blankable,
          commitSubjects: fc.array(fc.string(), { maxLength: 4 }),
          branch: fc.string({ minLength: 1 }).filter((s) => s.trim() !== ""),
        }),
        (sources) => {
          const title = choosePrTitle(sources);
          expect(title.trim()).toBe(title);
          expect(title).not.toBe("");
          expect(title).not.toMatch(/[\n\r]/);
        },
      ),
    );
  });

  it("law: when every richer source is blank, the branch decides", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9/_-]{0,30}$/),
        fc.array(fc.constantFrom("", " ", "\n"), { maxLength: 3 }),
        (branch, blankSubjects) => {
          expect(
            choosePrTitle({
              task: { key: " ", title: "" },
              threadName: "  ",
              commitSubjects: blankSubjects,
              branch,
            }),
          ).toBe(branch);
        },
      ),
    );
  });
});
