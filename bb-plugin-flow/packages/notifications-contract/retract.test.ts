import { describe, expect, it } from "vitest";
import { isNotificationRetraction, notificationsClient, notificationsUrl } from "./index.js";

const RETRACTION = { source: "flow", dedupeKey: "brief:dec_1" };

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

describe("notificationsUrl with a path", () => {
  it("points at the retract route when asked, at push otherwise", () => {
    expect(notificationsUrl("http://b", "retract")).toBe("http://b/api/v1/plugins/notifications/http/retract");
    expect(notificationsUrl("http://b")).toBe("http://b/api/v1/plugins/notifications/http/push");
  });
});

describe("isNotificationRetraction", () => {
  it("accepts a source id with a filled key", () => {
    expect(isNotificationRetraction(RETRACTION)).toBe(true);
  });

  it("rejects an empty key, a bad source id, a missing field and a non-object", () => {
    expect(isNotificationRetraction({ ...RETRACTION, dedupeKey: "" })).toBe(false);
    expect(isNotificationRetraction({ ...RETRACTION, source: "Not A Plugin" })).toBe(false);
    expect(isNotificationRetraction({ source: "flow" })).toBe(false);
    expect(isNotificationRetraction({ ...RETRACTION, dedupeKey: null })).toBe(false);
    expect(isNotificationRetraction(null)).toBe(false);
    expect(isNotificationRetraction([RETRACTION])).toBe(false);
  });
});

describe("notificationsClient.retract", () => {
  it("posts the retraction as JSON to the retract route with the given origin", async () => {
    const fetch = fakeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await notificationsClient("http://b", fetch.impl, { origin: "http://b" }).retract(RETRACTION)).toEqual({ ok: true, value: null });
    expect(fetch.calls[0]!.url).toBe("http://b/api/v1/plugins/notifications/http/retract");
    expect(fetch.calls[0]!.init!.method).toBe("POST");
    expect((fetch.calls[0]!.init!.headers as Record<string, string>).origin).toBe("http://b");
    expect(JSON.parse(String(fetch.calls[0]!.init!.body))).toEqual(RETRACTION);
  });

  it("names why a retraction did not land, never throwing", async () => {
    const answer = (status: number) => notificationsClient("", fakeFetch(() => new Response("{}", { status })).impl).retract(RETRACTION);
    expect(await answer(404)).toEqual({ ok: false, reason: "not-installed", status: 404 });
    expect(await answer(400)).toEqual({ ok: false, reason: "http", status: 400 });
    expect(await notificationsClient("", fakeFetch(() => Promise.reject(new TypeError("fetch failed"))).impl).retract(RETRACTION)).toEqual({ ok: false, reason: "network" });
    const timedOut = fakeFetch(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")));
    expect(await notificationsClient("", timedOut.impl, { timeoutMs: 10 }).retract(RETRACTION)).toEqual({ ok: false, reason: "timeout" });
  });
});
