// @vitest-environment node
//
// Обещания скрытого слота: адрес слота, запись без лишних правок, всплытие
// слотов чужого запуска и возврат карточки тому композеру, который её родил.
import { describe, expect, it } from "vitest";
import { composerKey, promoteStale, reclaimAuto, writeSlot, type Slot, type SlotMap } from "./autosave";
import type { Draft, Place } from "./drafts";

const HOME: Place = { threadId: null, threadTitle: null, projectId: "p_1", projectName: "bb-plugins", worktree: null, branch: null };
const NO_PROJECT: Place = { ...HOME, projectId: null, projectName: null };
const THREAD: Place = { ...HOME, threadId: "thr_1", threadTitle: "Тред", worktree: "thr_k2", branch: "bb/x" };

const slot = (text: string, place: Place, savedAt: number, session: string): Slot => ({ text, place, savedAt, session });

const draft = (id: string, text: string, place: Place, auto?: boolean): Draft =>
  auto === undefined ? { id, text, createdAt: 1, place } : { id, text, createdAt: 1, place, auto };

const mint = (item: Slot): Draft => ({ id: `mint-${item.savedAt}`, text: item.text, createdAt: item.savedAt, place: item.place, auto: true });

describe("адрес слота", () => {
  it("у черновика треда — тред, у черновика Home — проект", () => {
    expect(composerKey(THREAD)).toBe("thread:thr_1");
    expect(composerKey(HOME)).toBe("home:p_1");
  });

  it("композер Home без проекта имеет свой адрес, а не адрес проекта", () => {
    expect(composerKey(NO_PROJECT)).not.toBe(composerKey(HOME));
  });
});

describe("запись слота", () => {
  it("непустой текст кладётся по адресу композера", () => {
    const next = writeSlot({}, "thread:thr_1", slot("набираю", THREAD, 10, "s1"));
    expect(next["thread:thr_1"]).toEqual(slot("набираю", THREAD, 10, "s1"));
  });

  it("тот же текст того же запуска не даёт новой карты — писать в хранилище нечего", () => {
    const before: SlotMap = { "thread:thr_1": slot("набираю", THREAD, 10, "s1") };
    expect(writeSlot(before, "thread:thr_1", slot("набираю", THREAD, 99, "s1"))).toBe(before);
  });

  it("тот же текст чужого запуска карту меняет — слот переходит в текущий запуск", () => {
    const before: SlotMap = { "thread:thr_1": slot("набираю", THREAD, 10, "s0") };
    const next = writeSlot(before, "thread:thr_1", slot("набираю", THREAD, 20, "s1"));
    expect(next).not.toBe(before);
    expect(next["thread:thr_1"]!.session).toBe("s1");
  });

  it("null гасит слот и не трогает чужие", () => {
    const before: SlotMap = { "thread:thr_1": slot("а", THREAD, 10, "s1"), "home:p_1": slot("б", HOME, 11, "s1") };
    expect(writeSlot(before, "thread:thr_1", null)).toEqual({ "home:p_1": slot("б", HOME, 11, "s1") });
  });

  it("гашение несуществующего слота карту не меняет", () => {
    const before: SlotMap = { "home:p_1": slot("б", HOME, 11, "s1") };
    expect(writeSlot(before, "thread:thr_1", null)).toBe(before);
  });
});

describe("всплытие слотов чужого запуска", () => {
  it("слот прошлого запуска становится авто-черновиком в начале списка", () => {
    const before: SlotMap = { "thread:thr_1": slot("пережил вылет", THREAD, 10, "s0") };
    const { slots, drafts } = promoteStale(before, [draft("d1", "старый", HOME)], "s1", mint);
    expect(slots).toEqual({});
    expect(drafts.map((item) => item.text)).toEqual(["пережил вылет", "старый"]);
    expect(drafts[0]!.auto).toBe(true);
    expect(drafts[0]!.place).toEqual(THREAD);
  });

  it("слоты текущего запуска остаются скрытыми", () => {
    const before: SlotMap = { "thread:thr_1": slot("живой", THREAD, 10, "s1") };
    const { slots, drafts } = promoteStale(before, [], "s1", mint);
    expect(slots).toBe(before);
    expect(drafts).toEqual([]);
  });

  it("несколько слотов всплывают новыми вперёд", () => {
    const before: SlotMap = {
      "home:p_1": slot("ранний", HOME, 10, "s0"),
      "thread:thr_1": slot("поздний", THREAD, 20, "s0"),
    };
    const { drafts } = promoteStale(before, [], "s1", mint);
    expect(drafts.map((item) => item.text)).toEqual(["поздний", "ранний"]);
  });

  it("пустая карта оставляет список той же ссылкой", () => {
    const list = [draft("d1", "старый", HOME)];
    const { drafts } = promoteStale({}, list, "s1", mint);
    expect(drafts).toBe(list);
  });
});

describe("возврат карточки композеру", () => {
  const list = [
    draft("auto-1", "тот самый текст", THREAD, true),
    draft("hand-1", "тот самый текст", THREAD),
    draft("auto-2", "тот самый текст", HOME, true),
  ];

  it("авто-черновик своего композера с тем же текстом уходит из списка", () => {
    expect(reclaimAuto(list, "thread:thr_1", "тот самый текст").map((item) => item.id)).toEqual(["hand-1", "auto-2"]);
  });

  it("черновик, сохранённый рукой, не трогается даже при совпадении текста", () => {
    const onlyHand = [draft("hand-1", "тот самый текст", THREAD)];
    expect(reclaimAuto(onlyHand, "thread:thr_1", "тот самый текст")).toBe(onlyHand);
  });

  it("другой текст того же композера не трогается", () => {
    expect(reclaimAuto(list, "thread:thr_1", "другой текст")).toBe(list);
  });

  it("авто-черновик чужого композера не трогается", () => {
    expect(reclaimAuto(list, "home:p_2", "тот самый текст")).toBe(list);
  });
});
