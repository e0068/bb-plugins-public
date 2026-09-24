import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { decisionDocument, decisionFileName, journalPaths, suffixedName } from "./journal-doc";

describe("decisionFileName", () => {
  it("транслитерирует кириллицу в слаг", () => {
    expect(decisionFileName("Как вести работу")).toBe("kak-vesti-rabotu");
  });

  it("падает на «decision», если от заголовка ничего не осталось", () => {
    expect(decisionFileName("???")).toBe("decision");
    expect(decisionFileName("")).toBe("decision");
  });

  it("режет длинный заголовок, не обрывая слово чёрточкой", () => {
    const long = "слово ".repeat(60).trim();
    const name = decisionFileName(long);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith("-")).toBe(false);
  });
});

describe("suffixedName", () => {
  it("нулевая попытка — имя как есть", () => {
    expect(suffixedName("plan", 0)).toBe("plan");
  });

  it("дальше — -2, -3, …", () => {
    expect(suffixedName("plan", 1)).toBe("plan-2");
    expect(suffixedName("plan", 2)).toBe("plan-3");
  });
});

const brief: DecisionBrief = {
  id: "dec_b",
  threadId: "thr_1",
  title: "Как вести работу",
  createdAt: "2026-09-12T12:00:00.000Z",
  kind: "brief",
  questions: [
    {
      id: "priority",
      question: "Приоритет?",
      kind: "choice",
      allowOwn: false,
      options: [
        { id: "speed", action: "Скорость", recommended: false },
        { id: "quality", action: "Качество", recommended: true },
      ],
    },
  ],
};

const answer: DecisionAnswer = {
  briefId: "dec_b",
  answers: [{ questionId: "priority", optionIds: ["speed"] }],
};

describe("decisionDocument", () => {
  it("кладёт decided_at шапкой и тело ответа агенту следом", () => {
    const doc = decisionDocument({ brief, answer, decidedAt: "2026-09-15T12:00:00.000Z" });
    expect(doc.startsWith("---\ndecided_at: 2026-09-15T12:00:00.000Z\n---\n\n")).toBe(true);
    expect(doc).toContain("Приоритет?");
    expect(doc).toContain("Скорость");
  });

  it("тело на языке владельца — том же, что ушёл в тред", () => {
    const ru = decisionDocument({ brief, answer, decidedAt: "2026-09-15T12:00:00.000Z", locale: "ru" });
    const en = decisionDocument({ brief, answer, decidedAt: "2026-09-15T12:00:00.000Z", locale: "en" });
    expect(ru).toContain("Бриф «Как вести работу» — ответ:");
    expect(en).toContain('Brief "Как вести работу" — answer:');
  });
});

describe("journalPaths", () => {
  it("хосту — абсолютный путь внутри дерева, владельцу — относительный", () => {
    expect(journalPaths("/work/tree", "docs/flows", "kak-vesti-rabotu.md")).toEqual({
      relative: "docs/flows/kak-vesti-rabotu.md",
      absolute: "/work/tree/docs/flows/kak-vesti-rabotu.md",
    });
  });

  it("хвостовой слеш в корне дерева не задваивается", () => {
    expect(journalPaths("/work/tree/", "docs/flows", "x.md").absolute).toBe("/work/tree/docs/flows/x.md");
  });

  it("корень дерева — сам слеш", () => {
    expect(journalPaths("/", "docs/flows", "x.md").absolute).toBe("/docs/flows/x.md");
  });
});
