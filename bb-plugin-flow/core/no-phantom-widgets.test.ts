import { describe, expect, it } from "vitest";

import { failureWakeText } from "./automation-run";
import { FLOW_RULE } from "./stages";

const stage = { id: "finalize", kind: "skill" as const, skill: "", name: "Finalize", executors: [] };

describe("агент не ссылается на виджеты и команды, которых не присылал", () => {
  it("правило flow запрещает отсылать владельца к виджету или команде «выше», не прислав их", () => {
    expect(FLOW_RULE).toMatch(/never point the owner to a widget or a command "above" that you did not send/i);
  });

  it("реплика об упавшем шаге велит отдать команду через share_command и не ссылаться на неприсланную", () => {
    const text = failureWakeText(stage, "git.pull-main", "main has diverged", "Своё распоряжение владельца");
    expect(text).toMatch(/share_command/);
    expect(text).toMatch(/never point the owner to a command "above" that you did not send/i);
    expect(text).toContain("Своё распоряжение владельца");
  });
});
