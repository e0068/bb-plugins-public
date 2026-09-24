// @vitest-environment node
import { describe, expect, it } from "vitest";

import { holdsForNextFlow } from "./next-run-hold";

const owner = { finished: true, attempt: "start-turn", initiator: "user", retry: false } as const;

describe("сообщение ждёт выбора flow", () => {
  it("прогон завершён, и владелец начинает ход — сообщение придержано", () => {
    expect(holdsForNextFlow(owner)).toBe(true);
  });

  it.each([
    ["прогон не завершён", { ...owner, finished: false }],
    ["пишет агент другого треда", { ...owner, initiator: "agent" }],
    ["системное сообщение", { ...owner, initiator: "system" }],
    ["повтор упавшего хода", { ...owner, retry: true }],
    ["сообщение вклинивается в идущий ход", { ...owner, attempt: "join-turn" }],
  ] as const)("%s — сообщение уходит как раньше", (_, attempt) => {
    expect(holdsForNextFlow(attempt)).toBe(false);
  });
});
