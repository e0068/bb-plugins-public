import { describe, expect, it } from "vitest";

import { retryPolicyOf, wakesAgentAfterLastRetry } from "./automation-run";

describe("автоповтор автоматизаций по умолчанию", () => {
  it("без настроек упавший шаг повторяется через 30 секунд, до 10 попыток", () => {
    expect(retryPolicyOf({})).toEqual({ seconds: 30, attempts: 10 });
  });

  it("без настроек после последней попытки агент получает реплику", () => {
    expect(wakesAgentAfterLastRetry({})).toBe(true);
  });

  it("выбор владельца сильнее умолчания", () => {
    expect(retryPolicyOf({ retryInSeconds: 0, retryAttempts: 0 })).toEqual({ seconds: 0, attempts: 0 });
    expect(wakesAgentAfterLastRetry({ wakeAgentAfterLastRetry: false })).toBe(false);
  });
});
