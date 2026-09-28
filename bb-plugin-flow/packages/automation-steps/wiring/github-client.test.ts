// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { githubClient } from "./github-client";

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status, headers }));
const REQ = { method: "GET" as const, path: "/repos/e0068/bb-plugins/branches/main" };

describe("githubClient", () => {
  it("обычный ответ → статус и тело, как раньше", async () => {
    answer(200, { name: "main" }, { "x-ratelimit-remaining": "4999", "x-ratelimit-reset": "1790200000" });
    expect(await githubClient("t").send(REQ)).toEqual({ status: 200, data: { name: "main" } });
  });

  it("403 не про лимит → статус и тело, решает вызывающий", async () => {
    answer(403, { message: "Resource not accessible" }, { "x-ratelimit-remaining": "4000" });
    expect(await githubClient("t").send(REQ)).toEqual({ status: 403, data: { message: "Resource not accessible" } });
  });

  it("исчерпанный лимит → ошибка с понятным текстом вместо HTTP 403", async () => {
    answer(403, { message: "API rate limit exceeded for user ID 1." }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790200000" });
    await expect(githubClient("t").send(REQ)).rejects.toThrow(/^Лимит GitHub API исчерпан, сбросится в \d\d:\d\d$/);
  });
});
