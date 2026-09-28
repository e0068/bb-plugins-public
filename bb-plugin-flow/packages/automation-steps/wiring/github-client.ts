// Layer 3 — the single network effect point: fetch to api.github.com.
// Implements the CreatePrPorts port without throwing on an HTTP error code:
// the status and body go to the orchestrator (create-pr.ts), which decides
// whether it's a success or a failure. The one exception is an exhausted rate
// limit: no caller can do anything with it but tell the owner when it resets,
// so it throws that text (core/rate-limit.ts) instead.
import type { GithubRequest } from "../core/github-requests";
import { rateLimitError } from "../core/rate-limit";
import type { CreatePrPorts, GithubResponse } from "./create-pr";

const API_BASE = "https://api.github.com";

/** The plugin server runs on the owner's machine, so its local time is the owner's clock. */
const ownerClock = (at: Date): string => at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

export function githubClient(token: string): CreatePrPorts {
  return {
    async send(req: GithubRequest): Promise<GithubResponse> {
      const hasBody = req.body !== undefined;
      const res = await fetch(`${API_BASE}${req.path}`, {
        method: req.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(hasBody ? { "content-type": "application/json" } : {}),
        },
        body: hasBody ? JSON.stringify(req.body) : undefined,
      });
      const limit = rateLimitError(
        { status: res.status, remaining: res.headers.get("x-ratelimit-remaining"), reset: res.headers.get("x-ratelimit-reset") },
        ownerClock,
      );
      if (limit !== null) throw new Error(limit);
      return { status: res.status, data: await parseBody(res) };
    },
  };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
