// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isLiveResult, liveIssues } from "./outcome";

const file = { label: "spec.md", target: "memory/specs/spec.md" };
const page = { label: "страница", target: "https://host--5173.getbb.app/" };
const local = { label: "localhost", target: "http://localhost:5173/" };
const launch = { label: "Приложение", command: "open -a Calculator" };

describe("живой результат Демонстрации", () => {
  it("живой — адрес http(s) или команда запуска; файл и путь — нет", () => {
    expect(isLiveResult(page)).toBe(true);
    expect(isLiveResult(local)).toBe(true);
    expect(isLiveResult(launch)).toBe(true);
    expect(isLiveResult(file)).toBe(false);
    expect(isLiveResult({ label: "схема", target: "file:///tmp/x.html" })).toBe(false);
  });

  it("итог только с файлами отбивается одной строкой: что добавить и когда хватит documentsOnly", () => {
    const issues = liveIssues({ results: [file] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("bb connect expose");
    expect(issues[0]).toContain("command");
    expect(issues[0]).toContain("documentsOnly");
    expect(issues[0]).not.toMatch(/[А-Яа-яЁё]/);
  });

  it("хватает одного живого результата среди файлов или отметки documentsOnly", () => {
    expect(liveIssues({ results: [file, page] })).toEqual([]);
    expect(liveIssues({ results: [launch] })).toEqual([]);
    expect(liveIssues({ results: [file], documentsOnly: true })).toEqual([]);
  });
});
