import { describe, expect, it } from "vitest";

import { runJournal, type JournalEntry } from "./run-journal";

const DIR = "docs/flows";
const WINDOW = { startedAt: "2026-09-30T06:00:00.000Z", finishedAt: "2026-09-30T14:00:00.000Z" };

const entry = (briefId: string, title: string, answeredAt: string, path?: string): JournalEntry => ({ briefId, title, answeredAt, ...(path === undefined ? {} : { path }) });

describe("файлы журнала прогона", () => {
  it("записанный путь идёт как есть, по порядку ответов", () => {
    const entries = [entry("b2", "Демо", "2026-09-30T13:00:00.000Z", "docs/flows/demo.md"), entry("b1", "Запуск", "2026-09-30T07:00:00.000Z", "docs/flows/zapusk.md")];
    expect(runJournal(entries, WINDOW, DIR)).toEqual(["docs/flows/zapusk.md", "docs/flows/demo.md"]);
  });

  it("у ответа без записанного пути имя выводится из названия брифа, повтор названия — суффиксом, как при записи", () => {
    const entries = [
      entry("b1", "Механизм функций — волна 0", "2026-09-30T06:23:47.912Z"),
      entry("b2", "Механизм функций — волна 0: демонстрация", "2026-09-30T12:11:15.188Z"),
      entry("b3", "Механизм функций — волна 0: демонстрация", "2026-09-30T12:16:40.237Z"),
      entry("b4", "Механизм функций — волна 0: демонстрация", "2026-09-30T13:49:10.000Z"),
    ];
    expect(runJournal(entries, WINDOW, DIR)).toEqual([
      "docs/flows/mehanizm-funkcii-volna-0.md",
      "docs/flows/mehanizm-funkcii-volna-0-demonstraciya.md",
      "docs/flows/mehanizm-funkcii-volna-0-demonstraciya-2.md",
      "docs/flows/mehanizm-funkcii-volna-0-demonstraciya-3.md",
    ]);
  });

  it("ответ вне окна прогона в журнал прогона не входит, но имя с тем же названием уже занял", () => {
    const entries = [entry("b0", "Демо", "2026-09-29T20:00:00.000Z"), entry("b1", "Демо", "2026-09-30T08:00:00.000Z"), entry("b9", "Демо", "2026-09-30T15:00:00.000Z")];
    expect(runJournal(entries, WINDOW, DIR)).toEqual(["docs/flows/demo-2.md"]);
  });

  it("записанный путь тоже занимает имя: следующий без пути получает суффикс", () => {
    const entries = [entry("b1", "Демо", "2026-09-30T07:00:00.000Z", "docs/flows/demo.md"), entry("b2", "Демо", "2026-09-30T08:00:00.000Z")];
    expect(runJournal(entries, WINDOW, DIR)).toEqual(["docs/flows/demo.md", "docs/flows/demo-2.md"]);
  });

  it("границы окна включены", () => {
    const entries = [entry("b1", "А", WINDOW.startedAt), entry("b2", "Б", WINDOW.finishedAt)];
    expect(runJournal(entries, WINDOW, DIR)).toEqual(["docs/flows/a.md", "docs/flows/b.md"]);
  });

  it("без ответов журнал пуст", () => {
    expect(runJournal([], WINDOW, DIR)).toEqual([]);
  });
});
