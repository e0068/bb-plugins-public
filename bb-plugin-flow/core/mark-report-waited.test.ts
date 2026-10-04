import { describe, expect, it } from "vitest";

import { waitedReply } from "./mark-report";
import { stage } from "./stages-fixtures";
import type { WorkStage } from "../shared/contract";

const land: WorkStage = stage("land", { name: "Commit, PR", automation: { source: "flow", steps: [] } });

describe("ответ flow_stage, дождавшегося автоматизации", () => {
  it("реплику Flow отдаёт целиком и велит действовать в этом же ходе", () => {
    const text = waitedReply(land, { kind: "reply", text: "Flow: the automation stage is done — carry on.\nNext stage: demo \"Демонстрация\"." }, null);
    expect(text).toContain('Next stage: demo "Демонстрация".');
    expect(text).toContain("in this turn");
    expect(text).not.toContain("end your turn");
  });

  it("упавший шаг называет и велит закончить ход и сказать владельцу", () => {
    const text = waitedReply(land, { kind: "quiet" }, { kind: "failed", stage: land, step: "git.create-pr", error: "no remote" });
    expect(text).toContain("git.create-pr");
    expect(text).toContain("no remote");
    expect(text).toMatch(/end your turn and tell the owner/);
  });

  it("работа кончилась без реплики — ход кончается молча", () => {
    expect(waitedReply(land, { kind: "quiet" }, null)).toMatch(/end your turn without a message to the owner/);
  });

  it("не дождался — автоматизация ещё идёт, Flow напишет сам", () => {
    for (const kind of ["timeout", "aborted"] as const) {
      const text = waitedReply(land, { kind }, null);
      expect(text).toContain("still runs");
      expect(text).toMatch(/end your turn/);
    }
  });
});
