import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundledImports, HOST_SHIMMED, readSourceFiles } from "../layer-guard/index.js";
import { automationsClient, automationsUrl, isCatalogResponse, isRunResponse, type CatalogResponse, type RunResponse } from "./index.js";

const CATALOG: CatalogResponse = {
  automations: [{ id: "click-pr", name: "Pull Request", enabled: true }],
  triggers: [{ id: "flow.stage-done", label: "Этап Flow завершён", group: "flow" }],
  conditions: [{ id: "pr.open", label: "PR открыт", group: "pr" }],
  actions: [{ id: "git.merge", label: "Смёрджить PR", group: "git" }],
};
const RUN: RunResponse = { executed: ["git.merge"], skipped: null, error: null };

type Call = { url: string; init: RequestInit | undefined };
function fakeFetch(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return answer(call);
  }) as unknown as typeof fetch;
  return { calls, impl };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("automationsUrl", () => {
  it("builds urls under the Automations plugin's http routes", () => {
    expect(automationsUrl("http://127.0.0.1:1", "run")).toBe("http://127.0.0.1:1/api/v1/plugins/automations-builder/http/run");
    expect(automationsUrl("", "catalog")).toBe("/api/v1/plugins/automations-builder/http/catalog");
  });
});

describe("automationsClient", () => {
  it("POST carries a JSON body, content-type json and the given origin; GET carries neither body nor content-type", async () => {
    const { calls, impl } = fakeFetch((call) => (call.url.endsWith("catalog") ? json(CATALOG) : json(RUN)));
    const client = automationsClient("http://127.0.0.1:1", impl, { origin: "http://127.0.0.1:1" });
    expect(await client.catalog()).toEqual({ ok: true, value: CATALOG });
    expect(await client.run({ threadId: "t1", automationId: "click-pr" })).toEqual({ ok: true, value: RUN });
    const [get, post] = calls;
    expect(get!.init?.method ?? "GET").toBe("GET");
    expect(get!.init?.body).toBeUndefined();
    expect(new Headers(get!.init?.headers).get("content-type")).toBeNull();
    expect(post!.init?.method).toBe("POST");
    expect(JSON.parse(String(post!.init?.body))).toEqual({ threadId: "t1", automationId: "click-pr" });
    const headers = new Headers(post!.init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("origin")).toBe("http://127.0.0.1:1");
  });

  it("never throws: 404 is not-installed, 5xx is http, a throw is network, a wrong shape is bad-response", async () => {
    expect(await automationsClient("", fakeFetch(() => json({}, 404)).impl).catalog()).toMatchObject({ ok: false, reason: "not-installed", status: 404 });
    expect(await automationsClient("", fakeFetch(() => json({}, 500)).impl).run({ threadId: "t", actionId: "git.merge" })).toMatchObject({ ok: false, reason: "http", status: 500 });
    expect(await automationsClient("", fakeFetch(() => Promise.reject(new Error("down"))).impl).emit({ trigger: "flow.stage-done", threadId: "t" })).toMatchObject({ ok: false, reason: "network" });
    expect(await automationsClient("", fakeFetch(() => json({ nope: true })).impl).catalog()).toMatchObject({ ok: false, reason: "bad-response" });
  });

  it("emit answers ok on any 2xx", async () => {
    expect(await automationsClient("", fakeFetch(() => json({ executed: [] })).impl).emit({ trigger: "flow.stage-done", threadId: "t", context: { stageId: "review" } })).toEqual({ ok: true, value: null });
  });
});

describe("shape guards", () => {
  it("accept the documented shapes and refuse others", () => {
    expect(isCatalogResponse(CATALOG)).toBe(true);
    expect(isCatalogResponse({ ...CATALOG, automations: [{ id: 1 }] })).toBe(false);
    expect(isRunResponse(RUN)).toBe(true);
    expect(isRunResponse({ executed: [], skipped: "later", error: null })).toBe(false);
  });
});

describe("the package", () => {
  it("bundles no third-party import", () => {
    expect(bundledImports(readSourceFiles(fileURLToPath(new URL(".", import.meta.url))), HOST_SHIMMED)).toEqual([]);
  });
});

describe("automationsClient timeouts", () => {
  it("a request that ran out of time is timeout, not network", async () => {
    const timedOut = fakeFetch(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")));
    expect(await automationsClient("", timedOut.impl, { timeoutMs: 10 }).run({ threadId: "t", automationId: "a" })).toEqual({ ok: false, reason: "timeout" });
  });
});
