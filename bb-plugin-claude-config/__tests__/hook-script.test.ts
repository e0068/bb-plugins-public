import { describe, expect, it } from "vitest";

import { extractCommandFile } from "../src/hook-script";

describe("extractCommandFile", () => {
  it("берёт файл, который читает команда (не только скрипт по расширению)", () => {
    expect(
      extractCommandFile("cat /Users/e0068/.claude/output-checklist.json"),
    ).toBe("/Users/e0068/.claude/output-checklist.json");
  });

  it("берёт путь скрипта, отсекая интерпретатор и флаги", () => {
    expect(extractCommandFile("bash ~/.claude/hooks/foo.sh --flag")).toBe(
      "~/.claude/hooks/foo.sh",
    );
    expect(extractCommandFile("node ./scripts/hook.mjs")).toBe(
      "./scripts/hook.mjs",
    );
  });

  it("сохраняет плейсхолдеры окружения в пути", () => {
    expect(
      extractCommandFile('$CLAUDE_PROJECT_DIR/.claude/hooks/x.py "$1"'),
    ).toBe("$CLAUDE_PROJECT_DIR/.claude/hooks/x.py");
  });

  it("прямой запуск файла без интерпретатора", () => {
    expect(extractCommandFile("/abs/path/check.py")).toBe("/abs/path/check.py");
  });

  it("снимает кавычки с токена-пути", () => {
    expect(extractCommandFile("bash '~/hooks/check.sh'")).toBe(
      "~/hooks/check.sh",
    );
  });

  it("инлайновая команда без файлового аргумента → null", () => {
    expect(extractCommandFile("jq -r '.tool_input.command'")).toBeNull();
    expect(extractCommandFile('echo "hello"')).toBeNull();
    expect(extractCommandFile("bash -c 'exit 0'")).toBeNull();
  });

  it("голое имя файла без пути не считается файлом (нет разделителя)", () => {
    expect(extractCommandFile("echo build.sh done")).toBeNull();
  });
});
