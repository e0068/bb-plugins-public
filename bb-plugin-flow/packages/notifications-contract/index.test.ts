import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundledImports, HOST_SHIMMED, readSourceFiles } from "../layer-guard/index.js";
import { isNotificationInput, notificationsClient, notificationsUrl, type NotificationInput } from "./index.js";

const INPUT: NotificationInput = {
  source: "flow",
  kind: "awaiting",
  title: "Ждёт ответа — бриф «Центр уведомлений»",
  threadId: "thr_1",
  threadTitle: "Создать плагин",
  url: null,
  dedupeKey: "brief:dec_1",
};

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

describe("notificationsUrl", () => {
  it("points at the push route of the notifications plugin", () => {
    expect(notificationsUrl("http://127.0.0.1:1")).toBe("http://127.0.0.1:1/api/v1/plugins/notifications/http/push");
  });
});

describe("isNotificationInput", () => {
  it("accepts a whole record, with or without the optional parts set", () => {
    expect(isNotificationInput(INPUT)).toBe(true);
    expect(isNotificationInput({ ...INPUT, threadTitle: null, dedupeKey: null, url: "https://github.com/o/r/pull/1" })).toBe(true);
  });

  it("rejects an empty title or thread id and a missing field", () => {
    expect(isNotificationInput({ ...INPUT, title: "" })).toBe(false);
    expect(isNotificationInput({ ...INPUT, threadId: "" })).toBe(false);
    const { url: _url, ...withoutUrl } = INPUT;
    expect(isNotificationInput(withoutUrl)).toBe(false);
    expect(isNotificationInput(null)).toBe(false);
    expect(isNotificationInput([INPUT])).toBe(false);
  });
});

describe("notificationsClient.push", () => {
  it("posts the record as JSON with the given origin", async () => {
    const fetch = fakeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await notificationsClient("http://b", fetch.impl, { origin: "http://b" }).push(INPUT)).toEqual({ ok: true, value: null });
    expect(fetch.calls[0]!.url).toBe("http://b/api/v1/plugins/notifications/http/push");
    expect(fetch.calls[0]!.init!.method).toBe("POST");
    expect((fetch.calls[0]!.init!.headers as Record<string, string>).origin).toBe("http://b");
    expect(JSON.parse(String(fetch.calls[0]!.init!.body))).toEqual(INPUT);
  });

  it("names why a push did not land, never throwing", async () => {
    const answer = (status: number) => notificationsClient("", fakeFetch(() => new Response("{}", { status })).impl).push(INPUT);
    expect(await answer(404)).toEqual({ ok: false, reason: "not-installed", status: 404 });
    expect(await answer(500)).toEqual({ ok: false, reason: "http", status: 500 });
    expect(await notificationsClient("", fakeFetch(() => Promise.reject(new TypeError("fetch failed"))).impl).push(INPUT)).toEqual({ ok: false, reason: "network" });
    const timedOut = fakeFetch(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")));
    expect(await notificationsClient("", timedOut.impl, { timeoutMs: 10 }).push(INPUT)).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("the package", () => {
  it("bundles no third-party import", () => {
    expect(bundledImports(readSourceFiles(fileURLToPath(new URL(".", import.meta.url))), HOST_SHIMMED)).toEqual([]);
  });
});
