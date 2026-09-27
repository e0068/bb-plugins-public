import { describe, expect, it } from "vitest";

import { frontmatter } from "./frontmatter";
import { stampFlow } from "./task-flow";

const CODE = { id: "flow-code", name: "Code" };

describe("stampFlow — блок flow в шапке файла задачи", () => {
  it("дописывает блок последним полем шапки, тело не трогает", () => {
    const file = "---\ntitle: Задача\nslug: zadacha\n---\n\n## Проблема\n\nТекст.\n";
    expect(stampFlow(file, CODE)).toBe('---\ntitle: Задача\nslug: zadacha\nflow:\n  id: flow-code\n  name: "Code"\n---\n\n## Проблема\n\nТекст.\n');
  });

  it("заменяет блок другого flow, где бы он ни стоял в шапке", () => {
    const file = '---\ntitle: Задача\nflow:\n  id: flow-old\n  name: "Old"\nslug: zadacha\n---\nТело\n';
    expect(stampFlow(file, CODE)).toBe('---\ntitle: Задача\nslug: zadacha\nflow:\n  id: flow-code\n  name: "Code"\n---\nТело\n');
  });

  it("повторный штамп тем же flow возвращает тот же текст", () => {
    const once = stampFlow("---\ntitle: Задача\n---\nТело\n", CODE);
    expect(stampFlow(once, CODE)).toBe(once);
  });

  it("тот же flow, переписанный Tasks+ без кавычек и не последним полем, оставляет файл как есть", () => {
    const file = "---\ntitle: Задача\nflow:\n  id: flow-code\n  name: Code\ndue: 2026-10-01\n---\nТело\n";
    expect(stampFlow(file, CODE)).toBe(file);
  });

  it("тот же id под другим названием — блок переписывается", () => {
    const file = "---\ntitle: Задача\nflow:\n  id: flow-code\n  name: Old\ndue: 2026-10-01\n---\nТело\n";
    expect(stampFlow(file, CODE)).toBe('---\ntitle: Задача\ndue: 2026-10-01\nflow:\n  id: flow-code\n  name: "Code"\n---\nТело\n');
  });

  it("шапку после BOM штампует и BOM сохраняет", () => {
    expect(stampFlow("\uFEFF---\ntitle: Задача\n---\nТело", CODE)).toBe('\uFEFF---\ntitle: Задача\nflow:\n  id: flow-code\n  name: "Code"\n---\nТело');
  });

  it("файл без шапки возвращает как есть", () => {
    expect(stampFlow("## Проблема\n\nТекст.\n", CODE)).toBe("## Проблема\n\nТекст.\n");
  });

  it("название с двоеточием и кавычками остаётся одной строкой шапки", () => {
    const stamped = stampFlow("---\ntitle: Задача\n---\n", { id: "flow-x", name: 'Bug: "срочно"' });
    expect(stamped).toContain('  name: "Bug: \\"срочно\\""\n');
    expect(frontmatter(stamped)?.title).toBe("Задача");
  });

  it("в шапке с переводами строк \\r\\n пишет блок теми же переводами", () => {
    expect(stampFlow("---\r\ntitle: Задача\r\n---\r\nТело", CODE)).toBe('---\r\ntitle: Задача\r\nflow:\r\n  id: flow-code\r\n  name: "Code"\r\n---\r\nТело');
  });
});
