// @vitest-environment node
import { describe, expect, it } from "vitest";

import { failureWakeText } from "./automation-run";
import { stage } from "./stages-fixtures";

const land = stage("land", { name: "Commit, PR" });

describe("реплика агенту после последней неудачной попытки", () => {
  it("называет шаг, этап и ошибку и говорит, что шаг ждёт владельца", () => {
    const text = failureWakeText(land, "git.create-pr", "gh: rate limited");
    expect(text.split("\n")[0]).toBe('Flow: step git.create-pr of stage land "Commit, PR" failed after the last attempt: gh: rate limited');
    expect(text).toContain("Retry or Skip");
  });

  it("говорит, что починивший причину агент повторяет шаг сам, и называет инструмент с этапом", () => {
    expect(failureWakeText(land, "git.create-pr", "gh: rate limited")).toContain('retry the step yourself with retry_automation { "stage": "land" }');
  });

  it("свой наказ владельца не стирает сведение об инструменте", () => {
    expect(failureWakeText(land, "git.create-pr", "gh: rate limited", "Сообщи мне.")).toContain("retry_automation");
  });
});
