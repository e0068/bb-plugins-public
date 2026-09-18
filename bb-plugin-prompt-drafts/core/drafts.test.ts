// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  addDraft,
  homeCards,
  isBlank,
  removeDraft,
  swapDraft,
  threadCards,
  type Draft,
  type Place,
} from "./drafts";

const HOME: Place = {
  threadId: null,
  threadTitle: null,
  projectId: "p_1",
  projectName: "bb-plugins",
  worktree: null,
  branch: null,
};

const inThread = (threadId: string): Place => ({ ...HOME, threadId, threadTitle: `Тред ${threadId}` });

const draft = (id: string, place: Place = HOME): Draft => ({ id, text: `текст ${id}`, createdAt: 1, place });

const ids = (list: readonly Draft[]) => list.map((item) => item.id);

describe("добавление и удаление", () => {
  it("новый черновик встаёт первым", () => {
    expect(ids(addDraft([draft("a"), draft("b")], draft("c")))).toEqual(["c", "a", "b"]);
  });

  it("удаление убирает только черновик с этим id", () => {
    expect(ids(removeDraft([draft("a"), draft("b"), draft("c")], "b"))).toEqual(["a", "c"]);
  });

  it("удаление неизвестного id оставляет список прежним", () => {
    expect(ids(removeDraft([draft("a")], "zz"))).toEqual(["a"]);
  });
});

describe("обмен с композером", () => {
  const list = [draft("a"), draft("b"), draft("c")];

  it("замена встаёт на место снятой карточки, длина списка не меняется", () => {
    const result = swapDraft(list, "b", draft("new"));
    expect(ids(result.list)).toEqual(["a", "new", "c"]);
    expect(result.taken?.id).toBe("b");
  });

  it("без замены карточка просто снимается", () => {
    for (const id of ["a", "b", "c"]) {
      const result = swapDraft(list, id, null);
      expect(result.list).toHaveLength(2);
      expect(ids(result.list)).not.toContain(id);
      expect(result.taken?.id).toBe(id);
    }
  });

  it("неизвестный id ничего не снимает и не вставляет замену", () => {
    const result = swapDraft(list, "zz", draft("new"));
    expect(ids(result.list)).toEqual(["a", "b", "c"]);
    expect(result.taken).toBeNull();
  });
});

describe("пустой текст", () => {
  it("пробелы и переводы строк считаются пустым текстом", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("  \n\t ")).toBe(true);
    expect(isBlank(" x ")).toBe(false);
  });
});

describe("карточки Home", () => {
  const list = [draft("home1"), draft("t1", inThread("thr_1")), draft("home2"), draft("t2", inThread("thr_2"))];

  it("при включённой настройке черновиков тредов на Home нет", () => {
    expect(ids(homeCards(list, true))).toEqual(["home1", "home2"]);
  });

  it("при выключенной настройке на Home все черновики в прежнем порядке", () => {
    expect(ids(homeCards(list, false))).toEqual(["home1", "t1", "home2", "t2"]);
  });
});

describe("карточки над композером треда", () => {
  const list = [
    draft("home1"),
    draft("mine1", inThread("thr_1")),
    draft("other", inThread("thr_2")),
    draft("mine2", inThread("thr_1")),
  ];

  it("только черновики этого треда, в прежнем порядке", () => {
    expect(ids(threadCards(list, "thr_1", true))).toEqual(["mine1", "mine2"]);
  });

  it("в треде без своих черновиков карточек нет, чужие не подмешиваются", () => {
    expect(threadCards(list, "thr_9", true)).toEqual([]);
  });

  it("при выключенной настройке в треде карточек нет", () => {
    expect(threadCards(list, "thr_1", false)).toEqual([]);
  });
});
