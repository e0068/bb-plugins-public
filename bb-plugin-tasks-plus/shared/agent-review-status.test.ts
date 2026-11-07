import { describe, expect, it } from "vitest";

import { isOpenStatus, TASK_STATUSES } from "./enums.js";
import { claimDecision } from "./task-claim.js";
import { BOARD_STATUSES } from "../views/board/drop-position.js";
import { statusFromFolder } from "../filesync/map.js";

describe("Agent Review — ревью агента между работой и ревью владельца (BBPL-1043)", () => {
  it("стоит сразу за In Progress и перед Owner Review в порядке статусов и колонок доски", () => {
    for (const order of [TASK_STATUSES, BOARD_STATUSES] as readonly (readonly string[])[]) {
      expect(order.indexOf("agent_review")).toBe(order.indexOf("in_progress") + 1);
      expect(order.indexOf("in_review")).toBe(order.indexOf("agent_review") + 1);
    }
  });

  it("задача на ревью агента ещё открыта", () => {
    expect(isOpenStatus("agent_review")).toBe(true);
  });

  it("задачу на ревью агента, взятую другой машиной, не перехватить", () => {
    const takenBy = { machine: "other", threadId: null, at: "2026-11-07T12:00:00.000Z" };
    expect(claimDecision({ status: "agent_review", takenBy }, "me")).toEqual({ taken: takenBy });
  });

  it("папка доски agent_review или «Agent Review» читается этим статусом", () => {
    expect(statusFromFolder("agent_review")).toBe("agent_review");
    expect(statusFromFolder("Agent Review")).toBe("agent_review");
  });
});
