// @vitest-environment node
// Выключенный плагин Automations bb отвечает 503 «is not running (status: disabled)»: это то же, что плагина нет,
// и журнал Flow не копит на каждое событие предупреждение, по которому потом ставят неверный диагноз.
import { describe, expect, it } from "vitest";

import { automationsBridge } from "./automations";

const base = "http://127.0.0.1:38886";

const bridgeAnswering = (status: number, body: unknown) => {
  const warnings: string[] = [];
  const bb = { server: { loopbackBaseUrl: base }, log: { warn: (message: string) => void warnings.push(message) } };
  const fetchImpl = (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  return { bridge: automationsBridge(bb, fetchImpl), warnings };
};

describe("событие Flow выключенному плагину Automations", () => {
  it("не даёт предупреждения в журнале", async () => {
    const { bridge, warnings } = bridgeAnswering(503, { ok: false, error: 'plugin "automations-builder" is not running (status: disabled)' });
    await bridge.emit("flow.stage-done", "t1", { stageId: "review" });
    expect(warnings).toEqual([]);
  });

  it("настоящий сбой плагина по-прежнему предупреждает", async () => {
    const { bridge, warnings } = bridgeAnswering(500, { ok: false, error: "boom" });
    await bridge.emit("flow.stage-done", "t1");
    expect(warnings).toHaveLength(1);
  });
});
