// @vitest-environment node
import { describe, expect, it } from "vitest";

import { failureWakeText } from "./automation-run";
import { stage } from "./stages-fixtures";

const land = stage("land", { name: "Commit, PR" });

describe("реплика агенту после последней неудачной попытки", () => {
  it("называет шаг, этап и ошибку и говорит, что шаг ждёт владельца", () => {
    const text = failureWakeText(land, "git.create-pr", "gh: rate limited", []);
    expect(text.split("\n")[0]).toBe('Flow: step git.create-pr of stage land "Commit, PR" failed after the last attempt: gh: rate limited');
    expect(text).toContain("Retry or Skip");
  });

  it("несёт простой по этапам, когда он был, и молчит о нём, когда не было", () => {
    expect(failureWakeText(land, "git.create-pr", "x", [{ name: "Commit, PR", minutes: 12 }])).toContain("12");
    expect(failureWakeText(land, "git.create-pr", "x", [])).not.toContain("\n\n\n");
  });
});
