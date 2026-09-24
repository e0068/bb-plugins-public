import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { backfillFiles } from "./journal-backfill";

const brief = (id: string, title: string): DecisionBrief => ({
  id,
  threadId: "thr_1",
  title,
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
});

const answer = (id: string): DecisionAnswer => ({ briefId: id, answers: [{ questionId: "priority", optionIds: ["speed"] }] });

const record = (id: string, title: string, decidedAt: string) => ({ brief: brief(id, title), answer: answer(id), decidedAt });

describe("backfillFiles", () => {
  it("имя файла — из заголовка брифа, содержимое — тот же документ, что пишет журнал", () => {
    const [file] = backfillFiles([record("dec_a", "Как вести работу", "2026-09-15T12:00:00.000Z")], "ru");
    expect(file).toMatchObject({ name: "kak-vesti-rabotu.md" });
    expect(file?.content.startsWith("---\ndecided_at: 2026-09-15T12:00:00.000Z\n---\n\n")).toBe(true);
    expect(file?.content).toContain("Бриф «Как вести работу» — ответ:");
  });

  it("одинаковые заголовки разводятся суффиксом, как при живой записи", () => {
    const files = backfillFiles(
      [record("dec_a", "Как вести работу", "2026-09-15T12:00:00.000Z"), record("dec_b", "Как вести работу", "2026-09-16T12:00:00.000Z")],
      "ru",
    );
    expect(files.map((f) => f.name)).toEqual(["kak-vesti-rabotu.md", "kak-vesti-rabotu-2.md"]);
  });

  it("порядок — по времени ответа, а не по порядку записей", () => {
    const files = backfillFiles(
      [record("dec_b", "Второй", "2026-09-16T12:00:00.000Z"), record("dec_a", "Первый", "2026-09-15T12:00:00.000Z")],
      "ru",
    );
    expect(files.map((f) => f.name)).toEqual(["pervyi.md", "vtoroi.md"]);
  });
});

describe("backfillFiles поверх уже лежащих файлов", () => {
  const already = (title: string, decidedAt: string) => backfillFiles([record("dec_x", title, decidedAt)], "ru")[0]!;

  it("та же запись уже восстановлена — второй раз не пишется", () => {
    const lying = already("Как вести работу", "2026-09-15T12:00:00.000Z");
    expect(backfillFiles([record("dec_a", "Как вести работу", "2026-09-15T12:00:00.000Z")], "ru", [lying])).toEqual([]);
  });

  it("другое решение с тем же заголовком — суффикс, а не перезапись", () => {
    const lying = already("Как вести работу", "2026-09-15T12:00:00.000Z");
    const files = backfillFiles([record("dec_b", "Как вести работу", "2026-09-16T12:00:00.000Z")], "ru", [lying]);
    expect(files.map((f) => f.name)).toEqual(["kak-vesti-rabotu-2.md"]);
  });

  it("занятые имена с суффиксами тоже считаются занятыми", () => {
    const lying = already("Как вести работу", "2026-09-15T12:00:00.000Z");
    const files = backfillFiles([record("dec_b", "Как вести работу", "2026-09-16T12:00:00.000Z")], "ru", [
      lying,
      { name: "kak-vesti-rabotu-2.md", content: "чужой файл" },
    ]);
    expect(files.map((f) => f.name)).toEqual(["kak-vesti-rabotu-3.md"]);
  });
});
