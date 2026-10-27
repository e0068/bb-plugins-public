// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { stillAwaiting } from "./awaiting";

// Случай треда «Разбор тредов за сутки» 17.10: шаг git.commit этапа Commit упал и ждал Retry или Skip, потом Commit убрали
// из flow Research — полоса над композером его больше не рисует, а красный значок в левой панели висел.
const research = ["research", "analyze", "propose", "dispatch", "archive"];

describe("ожидание этапа, убранного из flow", () => {
  it("упавший шаг убранного этапа больше не ждёт владельца, этапа из flow — ждёт", () => {
    expect(stillAwaiting({ kind: "automation", briefId: "automation:commit" }, research)).toBe(false);
    expect(stillAwaiting({ kind: "automation", briefId: "automation:commit" }, [...research, "commit"])).toBe(true);
  });

  it("Action убранного этапа тоже не ждёт", () => {
    expect(stillAwaiting({ kind: "action", briefId: "action:deploy" }, research)).toBe(false);
    expect(stillAwaiting({ kind: "action", briefId: "action:deploy" }, ["deploy"])).toBe(true);
  });

  it("тред без flow не держит ни упавший шаг, ни Action", () => {
    expect(stillAwaiting({ kind: "automation", briefId: "automation:commit" }, [])).toBe(false);
    expect(stillAwaiting({ kind: "action", briefId: "action:deploy" }, [])).toBe(false);
  });

  it("ожидание брифа не зависит от этапов flow", () => {
    const kinds = ["questions", "criteria", "select", "demo", "approve"] as const;
    fc.assert(
      fc.property(fc.constantFrom(...kinds), fc.string(), fc.array(fc.string()), (kind, briefId, stageIds) => {
        expect(stillAwaiting({ kind, briefId }, stageIds)).toBe(true);
      }),
    );
  });
});
