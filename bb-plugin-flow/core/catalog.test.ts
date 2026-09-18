// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseAgentFile, parseWorkflowFile } from "./catalog";

describe("разбор файлов агентов и workflow", () => {
  it("агент — имя, описание и модель из фронтматтера; поставщик — claude-code", () => {
    const file = "---\nname: reviewer\ndescription: Код-ревьюер: читает дифф\ntools: Read, Grep\nmodel: opus\n---\n\nТело";
    expect(parseAgentFile(file)).toEqual({ id: "agent:reviewer", kind: "agent", name: "reviewer", description: "Код-ревьюер: читает дифф", model: "opus", provider: "claude-code" });
  });

  it("агент без модели — без поля модели; без фронтматтера или имени — не агент", () => {
    expect(parseAgentFile("---\nname: scout\n---\n")).toEqual({ id: "agent:scout", kind: "agent", name: "scout", provider: "claude-code" });
    expect(parseAgentFile("Просто текст")).toBeNull();
    expect(parseAgentFile("---\ndescription: без имени\n---\n")).toBeNull();
  });

  it("workflow — имя и описание из export const meta", () => {
    const file = 'export const meta = {\n  name: "DEV2",\n  description: "scout→plan→impl",\n  phases: [],\n}\n\nconst x = 1';
    expect(parseWorkflowFile(file)).toEqual({ id: "workflow:DEV2", kind: "workflow", name: "DEV2", description: "scout→plan→impl" });
    expect(parseWorkflowFile("const meta = 1")).toBeNull();
  });
});
