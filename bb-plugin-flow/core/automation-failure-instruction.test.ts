// Наказ агенту в реплике после последней попытки: факты падения Flow ставит сам, наказ — из настроек владельца.
import { describe, expect, it } from "vitest";

import { MAX_WAKE_INSTRUCTION_CHARS } from "../lib/stage-constants";
import { DEFAULT_FAILURE_INSTRUCTION, failureInstructionOf, failureWakeText, withFailureInstruction } from "./automation-run";
import { stage } from "./stages-fixtures";

const land = stage("land");

describe("наказ агенту после последней попытки", () => {
  it("наказа в настройках нет — реплика несёт наказ по умолчанию", () => {
    expect(failureInstructionOf({})).toBe(DEFAULT_FAILURE_INSTRUCTION);
    expect(failureWakeText(land, "git.merge", "timed out")).toContain(DEFAULT_FAILURE_INSTRUCTION);
  });

  it("пустой или из одних пробелов наказ — снова по умолчанию", () => {
    expect(failureInstructionOf({ wakeAgentInstruction: "" })).toBe(DEFAULT_FAILURE_INSTRUCTION);
    expect(failureInstructionOf({ wakeAgentInstruction: "  \n " })).toBe(DEFAULT_FAILURE_INSTRUCTION);
  });

  it("наказ владельца берётся без краевых пробелов", () => {
    expect(failureInstructionOf({ wakeAgentInstruction: "  Почини сам, если понятно, что делать.\n" })).toBe("Почини сам, если понятно, что делать.");
  });

  it("свой наказ заменяет наказ по умолчанию, а шаг, этап и ошибка остаются в реплике", () => {
    const text = failureWakeText(land, "git.merge", "timed out after 75 seconds", "Пойми, в чём проблема, и сообщи мне.");
    expect(text).toContain("Пойми, в чём проблема, и сообщи мне.");
    expect(text).not.toContain(DEFAULT_FAILURE_INSTRUCTION);
    expect(text).toContain("git.merge");
    expect(text).toContain('"land"');
    expect(text).toContain("timed out after 75 seconds");
  });

  it("наказ длиннее предела схемы обрезается до предела — настройки с ним сохраняются", () => {
    const long = "а".repeat(MAX_WAKE_INSTRUCTION_CHARS + 10);
    expect(withFailureInstruction<{ wakeAgentInstruction?: string }>({}, long).wakeAgentInstruction).toHaveLength(MAX_WAKE_INSTRUCTION_CHARS);
  });
});
