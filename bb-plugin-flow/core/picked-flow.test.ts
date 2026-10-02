import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { appliesPickedFlow } from "./picked-flow";

describe("какое сообщение применяет flow, выбранный над композером", () => {
  it("сообщение владельца, начинающее ход, применяет выбор", () => {
    expect(appliesPickedFlow({ attempt: "start-turn", initiator: "user", retry: false })).toBe(true);
  });

  it("свойство: применяет только начало хода владельцем без повтора", () => {
    fc.assert(
      fc.property(fc.constantFrom("start-turn" as const, "join-turn" as const), fc.constantFrom("user", "agent", "system"), fc.boolean(), (attempt, initiator, retry) => {
        expect(appliesPickedFlow({ attempt, initiator, retry })).toBe(attempt === "start-turn" && initiator === "user" && !retry);
      }),
    );
  });
});
