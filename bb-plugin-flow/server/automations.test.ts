// @vitest-environment node
import { describe, expect, it } from "vitest";

import { automationsBridge } from "./automations";

const base = "http://127.0.0.1:38886";

function host(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const warnings: string[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  const bb = { server: { loopbackBaseUrl: base }, log: { warn: (message: string) => void warnings.push(message) } };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return answer(String(url), init);
  }) as unknown as typeof fetch;
  return { bb, fetchImpl, warnings, requests };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("automationsBridge", () => {
  it("sends requests to bb's loopback with origin equal to it", async () => {
    const { bb, fetchImpl, requests } = host(() => json({ executed: ["git.merge"], skipped: null, error: null }));
    const bridge = automationsBridge(bb, fetchImpl);
    expect(await bridge.run("click-merge", "t1")).toEqual({ ok: true, value: { executed: ["git.merge"], skipped: null, error: null } });
    expect(requests[0]!.url).toBe(`${base}/api/v1/plugins/automations-builder/http/run`);
    expect(new Headers(requests[0]!.init?.headers).get("origin")).toBe(base);
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({ threadId: "t1", automationId: "click-merge" });
  });

  it("run answers not-installed on 404", async () => {
    const { bb, fetchImpl } = host(() => json({}, 404));
    expect(await automationsBridge(bb, fetchImpl).run("x", "t1")).toMatchObject({ ok: false, reason: "not-installed" });
  });

  it("emit never throws: a network error and a 404 are logged, not raised", async () => {
    const down = host(() => Promise.reject(new Error("refused")));
    await expect(automationsBridge(down.bb, down.fetchImpl).emit("flow.stage-done", "t1", { stageId: "review" })).resolves.toBeUndefined();
    expect(down.warnings).toHaveLength(1);
    const absent = host(() => json({}, 404));
    await automationsBridge(absent.bb, absent.fetchImpl).emit("flow.brief-answered", "t1");
    expect(absent.warnings).toEqual([]);
  });

  it("emit carries the trigger, the thread and the stage", async () => {
    const { bb, fetchImpl, requests } = host(() => json({ executed: [] }));
    await automationsBridge(bb, fetchImpl).emit("flow.stage-done", "t1", { stageId: "review" });
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({ trigger: "flow.stage-done", threadId: "t1", context: { stageId: "review" } });
  });

  it("reads the loopback address at call time, not when made", async () => {
    let reads = 0;
    const bb = {
      get server() {
        reads += 1;
        return { loopbackBaseUrl: base };
      },
      log: { warn: () => undefined },
    };
    const bridge = automationsBridge(bb, (async () => json({ executed: [] })) as unknown as typeof fetch);
    expect(reads).toBe(0);
    await bridge.emit("flow.brief-answered", "t1");
    expect(reads).toBe(1);
  });
});

describe("automationsBridge before bb listens", () => {
  it("emit swallows a loopback address that is not readable yet, and logs it", async () => {
    const warnings: string[] = [];
    const bb = {
      get server(): { loopbackBaseUrl: string } {
        throw new Error("not listening");
      },
      log: { warn: (message: string) => void warnings.push(message) },
    };
    await expect(automationsBridge(bb, (async () => new Response("{}")) as unknown as typeof fetch).emit("flow.stage-done", "t1")).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe("automationsBridge timeouts", () => {
  it("run carries a ceiling, so a hung Automations cannot hold the agent's tool forever", async () => {
    const { bb, fetchImpl, requests } = host(() => json({ executed: [], skipped: null, error: null }));
    await automationsBridge(bb, fetchImpl).run("x", "t1");
    expect(requests[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("an emit that timed out is logged as possibly still running, not as lost", async () => {
    const { bb, fetchImpl, warnings } = host(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")));
    await automationsBridge(bb, fetchImpl).emit("flow.stage-done", "t1");
    expect(warnings[0]).toContain("may still be running");
  });
});
