import { describe, expect, it } from "vitest";

import { rankCandidates, type Candidate } from "../src/suggest";

describe("rankCandidates", () => {
  it("code-standards матчит code-st выше, code-review не матчит", () => {
    const result = rankCandidates(
      [{ value: "code-review" }, { value: "code-standards" }, { value: "git" }],
      "code-st",
      8,
    );
    expect(result.map((c) => c.value)).toEqual(["code-standards"]);
  });

  it("точный префикс ранжируется раньше вхождения в середине", () => {
    const result = rankCandidates(
      [{ value: "my-preflight" }, { value: "preflight" }],
      "pre",
      8,
    );
    expect(result.map((c) => c.value)).toEqual(["preflight", "my-preflight"]);
  });

  it("ограничивает результат limit", () => {
    const candidates: Candidate[] = [
      { value: "a1" },
      { value: "a2" },
      { value: "a3" },
    ];
    expect(rankCandidates(candidates, "a", 2)).toHaveLength(2);
  });

  it("пустой query возвращает первые limit в исходном порядке без фильтра", () => {
    const candidates: Candidate[] = [{ value: "z" }, { value: "a" }, { value: "m" }];
    expect(rankCandidates(candidates, "", 2).map((c) => c.value)).toEqual(["z", "a"]);
  });

  it("дедуп по value — побеждает первый", () => {
    const candidates: Candidate[] = [
      { value: "git", label: "первый" },
      { value: "git", label: "второй" },
    ];
    const result = rankCandidates(candidates, "git", 8);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("первый");
  });

  it("label тоже участвует в матче", () => {
    const candidates: Candidate[] = [
      { value: "id-1", label: "Обзор кода" },
      { value: "id-2", label: "Git-гигиена" },
    ];
    const result = rankCandidates(candidates, "обзор", 8);
    expect(result.map((c) => c.value)).toEqual(["id-1"]);
  });

  it("регистронезависимо", () => {
    expect(
      rankCandidates([{ value: "AGENTS.md" }], "agents", 8).map((c) => c.value),
    ).toEqual(["AGENTS.md"]);
  });

  it("сегментный prefix ранжируется между точным prefix и substring", () => {
    const result = rankCandidates(
      [
        { value: "barcode" }, // substring (2) — "code" не с начала сегмента
        { value: "code" }, // точный prefix (0)
        { value: "auto-code" }, // сегментный prefix (1)
      ],
      "code",
      8,
    );
    expect(result.map((c) => c.value)).toEqual(["code", "auto-code", "barcode"]);
  });

  it("ничего не матчит — пустой результат", () => {
    expect(rankCandidates([{ value: "git" }], "zzz", 8)).toEqual([]);
  });
});
